/**
 * Phase 1 — Type-Checker-Dispatch der Skalar-Rundungs-Methoden (SPEC
 * § 11.1) und der Text-Methoden (SPEC § 11.5), additiv (freie
 * Rundungsfunktionen bleiben bis Phase 3 parallel gültig).
 *
 * Vertrag § 11.1:
 *  - `.abrunden()`/`.aufrunden()` NUR auf `EuroCent`/`Dezimal`; sonst Fehler.
 *  - `Dezimal`-Empfänger → `Ganzzahl` (kein Kontext nötig).
 *  - `EuroCent`-Empfänger → Ziel `Euro` ODER `Cent` aus dem erwarteten Typ
 *    (Annotation / `als`-Cast / fn-Rückgabetyp). Kein Kontext → Fehler
 *    „Zielgenauigkeit unbestimmt".
 *  - funktioniert auch über `ParenChain` (`(satz * basis).abrunden()`).
 *
 * Vertrag § 11.5: Text-Methoden mit korrekten Ergebnistypen; unbekannte
 * Text-Methode → Fehler.
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import {
    TypeEnv,
    buildContext,
    infer,
    resolveTypeAnnotation,
    typeCheckProgram,
    typeToString,
} from '../../src/language/findsl-types.js';
import { checkAgainstAnnotation } from '../../src/language/findsl-type-check.js';
import { isKonstDecl, type Expr } from '../../src/language/generated/ast.js';

/** Typfehler eines vollständigen Snippets. */
async function diags(src: string): Promise<string[]> {
    const program = await parseSource(src);
    const msgs: string[] = [];
    typeCheckProgram(program, (_n, m) => msgs.push(m));
    return msgs;
}

/**
 * Kontext-aufgelöster Typ von `<expr>` gegen die Annotation `ann`:
 * parst `konst R: <ann> = <expr>`, prüft den Wert bidirektional gegen
 * `ann` und liefert [aufgelöster Typ, gemeldete Fehler].
 */
async function inCtx(ann: string, expr: string): Promise<[string, string[]]> {
    const program = await parseSource(`konst R: ${ann} = ${expr}\n`);
    const ctx = buildContext(program);
    let decl: { type?: unknown; value?: Expr } | undefined;
    for (const d of program.decls) {
        if (isKonstDecl(d) && d.name === 'R') decl = d;
    }
    if (!decl?.value || !decl.type) throw new Error('konst R fehlt');
    const msgs: string[] = [];
    const expected = resolveTypeAnnotation(decl.type as never, ctx);
    const t = checkAgainstAnnotation(decl.value, expected, new TypeEnv(), ctx, (_n, m) => msgs.push(m));
    return [typeToString(t), msgs];
}

/** Annotation-unabhängiger `infer`-Typ (über `konst R: Dezimal = expr`). */
async function inferType(expr: string): Promise<string> {
    const program = await parseSource(`konst R: Dezimal = ${expr}\n`);
    const ctx = buildContext(program);
    let value: Expr | undefined;
    for (const d of program.decls) if (isKonstDecl(d) && d.name === 'R') value = d.value;
    if (!value) throw new Error('konst R fehlt');
    return typeToString(infer(value, new TypeEnv(), ctx, () => {}));
}

describe('§11.1 — Rundung: Dezimal-Empfänger → Ganzzahl (kontextfrei)', () => {
    it('Dezimal.abrunden() → Ganzzahl', async () => {
        expect(await inferType('(7,8 als Dezimal).abrunden()')).toBe('Ganzzahl');
    });
    it('Dezimal.aufrunden() → Ganzzahl', async () => {
        expect(await inferType('(7,2 als Dezimal).aufrunden()')).toBe('Ganzzahl');
    });
    it('Dezimal-Rundung erzeugt keinen Kontext-Fehler', async () => {
        expect(await diags('konst R: Ganzzahl = (3,7 als Dezimal).aufrunden()\n')).toEqual([]);
    });
});

describe('§11.1 — Rundung: Prozent-Empfänger → Prozent (kontextfrei)', () => {
    it('Prozent.abrunden() → Prozent', async () => {
        expect(await inferType('(42,7%).abrunden()')).toBe('Prozent');
    });
    it('Prozent.aufrunden() → Prozent', async () => {
        expect(await inferType('(5,5%).aufrunden()')).toBe('Prozent');
    });
    it('Prozent-Rundung erzeugt keinen Kontext-Fehler', async () => {
        expect(await diags('konst R: Prozent = (42,7%).abrunden()\n')).toEqual([]);
    });
    it('Prozent-Empfänger via Referenz (kein Empfänger-Fehler mehr)', async () => {
        expect(await diags(
            'konst SATZ: Prozent = 5,5%\nkonst R: Prozent = SATZ.aufrunden()\n',
        )).toEqual([]);
    });
});

describe('§11.1 — Rundung: EuroCent-Empfänger, Ziel aus Kontext', () => {
    it('Annotation Euro → Euro', async () => {
        const [t, errs] = await inCtx('Euro', '(2.303,32 als EuroCent).abrunden()');
        expect(t).toBe('Euro');
        expect(errs).toEqual([]);
    });
    it('Annotation Cent → Cent', async () => {
        const [t, errs] = await inCtx('Cent', '(2.303,32 als EuroCent).abrunden()');
        expect(t).toBe('Cent');
        expect(errs).toEqual([]);
    });
    it('fn-Rückgabetyp liefert den Kontext', async () => {
        const src =
            'fn AufVolleEuro(x: EuroCent): Euro = x.abrunden()\n';
        expect(await diags(src)).toEqual([]);
    });
    it('als-Cast liefert den Kontext', async () => {
        expect(await diags(
            'konst R: Cent = (1,50 als EuroCent).abrunden() als Cent\n',
        )).toEqual([]);
    });
    it('EuroCent ohne Kontext (Dezimal-Annotation kein Rundungsziel) → Fehler', async () => {
        const [, errs] = await inCtx('Dezimal', '(2.303,32 als EuroCent).abrunden()');
        expect(errs.join(' ')).toMatch(/Zielgenauigkeit unbestimmt/);
    });
});

describe('§11.1 — Empfänger-Restriktion', () => {
    it('Euro.abrunden() → Fehler (keine Nachkommastellen)', async () => {
        const [, errs] = await inCtx('Euro', '(5 als Euro).abrunden()');
        expect(errs.join(' ')).toMatch(/nur auf .*EuroCent.*Dezimal|EuroCent.*Dezimal/);
    });
    it('Cent.aufrunden() → Fehler', async () => {
        const [, errs] = await inCtx('Cent', '(5 als Cent).aufrunden()');
        expect(errs.join(' ')).toMatch(/EuroCent.*Dezimal/);
    });
    it('Ganzzahl.abrunden() → Fehler', async () => {
        const [, errs] = await inCtx('Ganzzahl', '(5).abrunden()');
        expect(errs.join(' ')).toMatch(/EuroCent.*Dezimal/);
    });
    it('Text.abrunden() → Fehler', async () => {
        const [, errs] = await inCtx('Ganzzahl', '("x").abrunden()');
        expect(errs.join(' ')).toMatch(/EuroCent.*Dezimal/);
    });
});

describe('§11.1 — Rundung über ParenChain (Kern-Tarifmuster)', () => {
    it('(satz * basis).abrunden() mit Euro-Kontext', async () => {
        const src =
            'konst SATZ: Prozent = 5,5%\n' +
            'fn Soli(est: Euro): Euro = (SATZ * est).abrunden()\n';
        expect(await diags(src)).toEqual([]);
    });
    it('wähle-Arm: berechneten Wert runden, fn-Rückgabetyp als Kontext', async () => {
        const src =
            'konst K3: Prozent = 42%\n' +
            'fn Kfb(s: Steuerklasse, z: EuroCent): Euro = wähle (s) {\n' +
            '    falls I, II      -> 0\n' +
            '    sonst            -> (z * K3).abrunden()\n' +
            '}\n';
        expect(await diags(src)).toEqual([]);
    });
});

describe('§11.5 — Text-Methoden', () => {
    async function tdiags(decl: string): Promise<string[]> {
        return diags(`konst S: Text = "Hallo Welt"\n${decl}\n`);
    }

    it('.länge → Ganzzahl (Property)', async () => {
        expect(await tdiags('konst Q: Ganzzahl = S.länge')).toEqual([]);
    });
    it('.leer → Wahrheitswert (Property)', async () => {
        expect(await tdiags('konst Q: Wahrheitswert = S.leer')).toEqual([]);
    });
    it('.alsText → Text (Property)', async () => {
        expect(await tdiags('konst Q: Text = S.alsText')).toEqual([]);
    });
    it('.einrückungEntfernen() → Text', async () => {
        expect(await tdiags('konst Q: Text = S.einrückungEntfernen()')).toEqual([]);
    });
    it('.alsGroßbuchstaben() → Text', async () => {
        expect(await tdiags('konst Q: Text = S.alsGroßbuchstaben()')).toEqual([]);
    });
    it('.alsKleinbuchstaben() → Text', async () => {
        expect(await tdiags('konst Q: Text = S.alsKleinbuchstaben()')).toEqual([]);
    });
    it('.beginntMit(t) → Wahrheitswert', async () => {
        expect(await tdiags('konst Q: Wahrheitswert = S.beginntMit("Ha")')).toEqual([]);
    });
    it('.endetMit(t) → Wahrheitswert', async () => {
        expect(await tdiags('konst Q: Wahrheitswert = S.endetMit("lt")')).toEqual([]);
    });
    it('.enthält(t) → Wahrheitswert', async () => {
        expect(await tdiags('konst Q: Wahrheitswert = S.enthält("lo")')).toEqual([]);
    });
    it('.geteiltAn(t) → Liste<Text>', async () => {
        expect(await tdiags('konst Q: Liste<Text> = S.geteiltAn(" ")')).toEqual([]);
    });
    it('unbekannte Text-Methode → Fehler', async () => {
        const errs = await tdiags('konst Q: Text = S.quatschMethode()');
        expect(errs.join(' ')).toMatch(/Text hat keine Methode/);
    });
});

describe('§11.6 — Grenzwert-Methoden (.höchstens/.mindestens, typ-erhaltend, kontextfrei)', () => {
    it('Euro.höchstens(Euro) → Euro', async () => {
        const [t, errs] = await inCtx('Euro', '(100 als Euro).höchstens(80 als Euro)');
        expect(t).toBe('Euro');
        expect(errs).toEqual([]);
    });
    it('EuroCent.mindestens(0,00) → EuroCent (nacktes Literal promotet)', async () => {
        const [t, errs] = await inCtx('EuroCent', '(5,00 als EuroCent).mindestens(0,00)');
        expect(t).toBe('EuroCent');
        expect(errs).toEqual([]);
    });
    it('Ganzzahl.höchstens(Ganzzahl) → Ganzzahl', async () => {
        expect(await inferType('(7 als Ganzzahl).höchstens(3 als Ganzzahl)')).toBe('Ganzzahl');
    });
    it('Prozent.mindestens(Prozent) → Prozent', async () => {
        expect(await inferType('(40%).mindestens(20%)')).toBe('Prozent');
    });
    it('Clamp-Verkettung mindestens().höchstens() erzeugt keinen Fehler', async () => {
        expect(await diags(
            'konst R: Euro = (50 als Euro).mindestens(0 als Euro).höchstens(40 als Euro)\n',
        )).toEqual([]);
    });
    it('nicht-numerischer Empfänger (Text) → Empfänger-Fehler', async () => {
        const errs = await diags('konst S: Text = "x"\nkonst Q: Text = S.höchstens("y")\n');
        expect(errs.join(' ')).toMatch(/numerisch/);
    });
    it('Argument-Typ-Mismatch (Euro.höchstens(Prozent)) → Fehler', async () => {
        const [, errs] = await inCtx('Euro', '(100 als Euro).höchstens(25%)');
        expect(errs.length).toBeGreaterThan(0);
    });
});

describe('§11.6 — Stufen-Methoden (.abrundenAuf/.aufrundenAuf, typ-erhaltend, kontextfrei)', () => {
    it('EuroCent.abrundenAuf(EuroCent) → EuroCent (kein Kontext nötig)', async () => {
        const [t, errs] = await inCtx(
            'EuroCent', '(12.345,67 als EuroCent).abrundenAuf(100,00 als EuroCent)',
        );
        expect(t).toBe('EuroCent');
        expect(errs).toEqual([]);
    });
    it('Euro.aufrundenAuf(Euro) → Euro', async () => {
        expect(await inferType('(1.234 als Euro).aufrundenAuf(1 als Euro)')).toBe('Euro');
    });
    it('Ganzzahl.abrundenAuf(Ganzzahl) → Ganzzahl', async () => {
        expect(await inferType('(125 als Ganzzahl).abrundenAuf(100 als Ganzzahl)')).toBe('Ganzzahl');
    });
    it('nicht-numerischer Empfänger (Text) → Empfänger-Fehler', async () => {
        const errs = await diags('konst S: Text = "x"\nkonst Q: Text = S.abrundenAuf("y")\n');
        expect(errs.join(' ')).toMatch(/numerisch/);
    });
});

describe('§11.1/§11.5 — Teil-Parse-Robustheit', () => {
    it('unvollständige Rundung kippt Validierung nicht', async () => {
        await expect(diags('konst R: Euro = (1,5 als EuroCent).abrunden(\n')).resolves.toBeDefined();
        await expect(diags('konst R: Text = "x".\n')).resolves.toBeDefined();
    });
});

describe('§3.4 — Prozent bei *,/ mit reinen Zahlen → Dezimal', () => {
    it('Ganzzahl × Prozent → Dezimal', async () => {
        expect(await inferType('100 * 10%')).toBe('Dezimal');
    });
    it('Dezimal × Prozent → Dezimal', async () => {
        expect(await inferType('(2,5 als Dezimal) * 10%')).toBe('Dezimal');
    });
    it('Prozent × Prozent → Dezimal', async () => {
        expect(await inferType('10% * 10%')).toBe('Dezimal');
    });
    it('Prozent / Ganzzahl → Dezimal', async () => {
        expect(await inferType('9,3% / 2')).toBe('Dezimal');
    });
    it('Geld × Prozent bleibt EuroCent (unverändert)', async () => {
        expect(await inferType('(100 als Euro) * 42%')).toBe('EuroCent');
    });
});

describe('§11.7 — Umwandlungs-Methoden .alsProzent()/.alsDezimal()', () => {
    it('Dezimal.alsProzent() → Prozent', async () => {
        expect(await inferType('(9,3 als Dezimal).alsProzent()')).toBe('Prozent');
    });
    it('Ganzzahl.alsProzent() → Prozent', async () => {
        expect(await inferType('(5).alsProzent()')).toBe('Prozent');
    });
    it('Prozent.alsDezimal() → Dezimal', async () => {
        expect(await inferType('(9,3%).alsDezimal()')).toBe('Dezimal');
    });
    it('.alsProzent() auf Prozent ist ein Empfänger-Fehler', async () => {
        const errs = await diags('konst R: Prozent = (9,3%).alsProzent()\n');
        expect(errs.join(' ')).toMatch(/alsProzent.*nur auf Ganzzahl\/Dezimal/);
    });
    it('.alsDezimal() auf Ganzzahl ist ein Empfänger-Fehler', async () => {
        const errs = await diags('konst R: Dezimal = (5).alsDezimal()\n');
        expect(errs.join(' ')).toMatch(/alsDezimal.*nur auf Prozent/);
    });
});
