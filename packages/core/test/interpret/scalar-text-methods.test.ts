/**
 * Phase 2 — Interpreter: Skalar-Rundungs-Methoden (SPEC § 11.1) und
 * Text-Methoden (SPEC § 11.5) zur Laufzeit. Type-Checker-UNABHÄNGIG —
 * `interpretProgram` läuft hier ohne Validierung; das EuroCent-Rundungs-
 * ziel wird über einen lokalen AST-Kontext-Walk bestimmt (Bindungs-/
 * Cast-/fn-Rückgabe-Annotation), Default `Euro`.
 *
 * Äquivalenz zur alten freien Form ist die Messlatte:
 *   `abrundenEuro(x)`  ≙  `x.abrunden()`  (EuroCent-Empfänger, Euro-Ziel)
 *   `abrunden(d)`      ≙  `d.abrunden()`  (Dezimal-Empfänger → Ganzzahl)
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { interpretProgram } from '../../src/interpret/interpreter.js';
import type { NumericValue, StringValue, ListValue, Value } from '../../src/interpret/values.js';

async function evalConst(src: string, name = 'R'): Promise<Value> {
    const program = await parseSource(src);
    const mod = interpretProgram(program);
    const v = mod.env.lookup(name);
    if (!v) throw new Error(`${name} nicht definiert`);
    return v;
}
async function num(src: string): Promise<NumericValue> {
    const v = await evalConst(src);
    if (v.kind !== 'numeric') throw new Error(`erwartet numeric, war ${v.kind}`);
    return v;
}

describe('§11.1 Interpreter — EuroCent-Rundung, Ziel aus Kontext', () => {
    it('Annotation Euro: abrunden floored, Tag Euro (≙ abrundenEuro)', async () => {
        const v = await num('konst R: Euro = (2.303,87 als EuroCent).abrunden()\n');
        expect(v.value.toString()).toBe('2303');
        expect(v.tag).toBe('Euro');
    });
    it('Annotation Euro: aufrunden Richtung +∞', async () => {
        const v = await num('konst R: Euro = (2.303,12 als EuroCent).aufrunden()\n');
        expect(v.value.toString()).toBe('2304');
        expect(v.tag).toBe('Euro');
    });
    it('als-Cast Cent: floor auf volle Cent, Tag Cent', async () => {
        const v = await num('konst R: Cent = (2,378 als EuroCent).abrunden() als Cent\n');
        expect(v.value.toString()).toBe('2.37');   // Euro-kanonisch (2,37 €)
        expect(v.tag).toBe('Cent');
    });
    it('fn-Rückgabetyp als Kontext (≙ abrundenEuro im fn-Body)', async () => {
        const v = await num(
            'fn Soli(e: Euro): Euro = (5,5% * e).abrunden()\n' +
            'konst R: Euro = Soli(30.000)\n',
        );
        expect(v.value.toString()).toBe('1650');
        expect(v.tag).toBe('Euro');
    });
    it('wähle-Arm im fn-Body: berechneten Wert runden', async () => {
        const v = await num(
            'konst K3: Prozent = 42%\n' +
            'fn Kfb(s: Steuerklasse, z: EuroCent): Euro = wähle (s) {\n' +
            '    falls I, II      -> 0\n' +
            '    sonst            -> (z * K3).abrunden()\n' +
            '}\n' +
            'konst R: Euro = Kfb(III, 10.000 als EuroCent)\n',
        );
        expect(v.value.toString()).toBe('4200');     // 10000 * 0,42 = 4200
        expect(v.tag).toBe('Euro');
    });
    it('arithmetischer Operand erbt fn-Rückgabe-Kontext', async () => {
        const v = await num(
            'fn KStAnp(kst: Euro): Euro = kst + (5% * kst).abrunden()\n' +
            'konst R: Euro = KStAnp(1.000)\n',
        );
        expect(v.value.toString()).toBe('1050');
        expect(v.tag).toBe('Euro');
    });
});

describe('§11.1 Interpreter — Prozent-Empfänger → volle Prozent', () => {
    it('abrunden auf volle Prozent (Einheit bleibt)', async () => {
        const v = await num('konst R: Prozent = (42,7%).abrunden()\n');
        expect(v.value.toString()).toBe('0.42');     // intern Bruch (= 42 %)
        expect(v.tag).toBe('Prozent');
    });
    it('aufrunden auf volle Prozent', async () => {
        const v = await num('konst R: Prozent = (5,5%).aufrunden()\n');
        expect(v.value.toString()).toBe('0.06');      // = 6 %
        expect(v.tag).toBe('Prozent');
    });
    it('Referenz-Empfänger, kontextfrei (kein InterpretError)', async () => {
        const v = await num(
            'konst SATZ: Prozent = 9,37%\nkonst R: Prozent = SATZ.abrunden()\n',
        );
        expect(v.value.toString()).toBe('0.09');      // = 9 %
        expect(v.tag).toBe('Prozent');
    });
});

describe('§11.1 Interpreter — Dezimal-Empfänger → Ganzzahl', () => {
    it('abrunden Richtung −∞ (auch negativ)', async () => {
        expect((await num('konst R: Ganzzahl = (7,8 als Dezimal).abrunden()\n')).value.toString()).toBe('7');
        expect((await num('konst R: Ganzzahl = (-1,2 als Dezimal).abrunden()\n')).value.toString()).toBe('-2');
    });
    it('aufrunden Richtung +∞ (≙ aufrunden, KraftSt „je angefangene Einheit")', async () => {
        expect((await num('konst R: Ganzzahl = (3,01 als Dezimal).aufrunden()\n')).value.toString()).toBe('4');
        const v = await num('konst R: Ganzzahl = (7,8 als Dezimal).aufrunden()\n');
        expect(v.value.toString()).toBe('8');
        expect(v.tag).toBe('Ganzzahl');
    });
});

describe('§11.1 Interpreter — tag-agnostisch (≙ alte freie Funktion)', () => {
    // Die Empfänger-Restriktion (EuroCent/Dezimal) ist ein STATISCHER
    // Phase-1-Gate (Type-Checker, getestet in language/scalar-text-
    // methods.test.ts). Der Interpreter ist abseits des Geldmodells
    // untypisiert: ein Laufzeit-Tag ≠ statischer Typ (leere `.summe()`
    // → D1 `Ganzzahl`; Prozent-Zwischen-Tags) darf die Rundung NICHT
    // kippen — sie folgt dem Euro-kanonischen Wert + Kontextziel,
    // wertgleich zur früheren freien `abrundenEuro`/`abrunden`.
    it('Ganzzahl-getaggte 0 (≙ leere .summe()) in Euro-Kontext → 0 Euro', async () => {
        const v = await num(
            'fn F(xs: Liste<EuroCent>): Euro = xs.summe().abrunden()\n' +
            'konst R: Euro = F([])\n',
        );
        expect(v.value.toString()).toBe('0');
        expect(v.tag).toBe('Euro');
    });
    it('Dezimal-Kontext bleibt Ganzzahl (kein Geldziel im Walk)', async () => {
        const v = await num('konst R: Ganzzahl = (9,9 als Dezimal).abrunden()\n');
        expect(v.value.toString()).toBe('9');
        expect(v.tag).toBe('Ganzzahl');
    });
});

describe('§11.5 Interpreter — Text-Methoden', () => {
    const withS = (decl: string) => `konst S: Text = "Hallo Welt"\n${decl}\n`;

    it('.länge → Anzahl Unicode-Zeichen', async () => {
        expect((await num(withS('konst R: Ganzzahl = S.länge'))).value.toString()).toBe('10');
    });
    it('.leer', async () => {
        const v = await evalConst(withS('konst R: Wahrheitswert = S.leer'));
        expect(v.kind === 'bool' && v.value).toBe(false);
        const e = await evalConst('konst S: Text = ""\nkonst R: Wahrheitswert = S.leer\n');
        expect(e.kind === 'bool' && e.value).toBe(true);
    });
    it('.alsText → identische Zeichenkette', async () => {
        const v = await evalConst(withS('konst R: Text = S.alsText'));
        expect(v.kind === 'string' && (v as StringValue).value).toBe('Hallo Welt');
    });
    it('.alsGroßbuchstaben() / .alsKleinbuchstaben()', async () => {
        const g = await evalConst(withS('konst R: Text = S.alsGroßbuchstaben()')) as StringValue;
        expect(g.value).toBe('HALLO WELT');
        const k = await evalConst(withS('konst R: Text = S.alsKleinbuchstaben()')) as StringValue;
        expect(k.value).toBe('hallo welt');
    });
    it('.beginntMit / .endetMit / .enthält', async () => {
        const b = await evalConst(withS('konst R: Wahrheitswert = S.beginntMit("Hallo")'));
        expect(b.kind === 'bool' && b.value).toBe(true);
        const e = await evalConst(withS('konst R: Wahrheitswert = S.endetMit("Welt")'));
        expect(e.kind === 'bool' && e.value).toBe(true);
        const c = await evalConst(withS('konst R: Wahrheitswert = S.enthält("lo W")'));
        expect(c.kind === 'bool' && c.value).toBe(true);
        const n = await evalConst(withS('konst R: Wahrheitswert = S.beginntMit("xyz")'));
        expect(n.kind === 'bool' && n.value).toBe(false);
    });
    it('.geteiltAn(t) → Liste<Text>', async () => {
        const v = await evalConst(withS('konst R: Liste<Text> = S.geteiltAn(" ")')) as ListValue;
        expect(v.kind).toBe('list');
        expect(v.elements.map((e) => (e as StringValue).value)).toEqual(['Hallo', 'Welt']);
    });
    it('.einrückungEntfernen() entfernt gemeinsamen Prefix', async () => {
        const src =
            'konst S: Text = """\n        zeile-eins\n        zeile-zwei\n"""\n' +
            'konst R: Text = S.einrückungEntfernen()\n';
        const v = await evalConst(src) as StringValue;
        // Gemeinsame 8-Leerzeichen-Einrückung entfernt: Inhaltszeilen
        // beginnen jetzt am Zeilenanfang (kein führender Whitespace mehr).
        expect(v.value).toMatch(/^zeile-eins$/m);
        expect(v.value).toMatch(/^zeile-zwei$/m);
        expect(v.value).not.toContain('        zeile');
    });
    it('unbekannte Text-Methode wirft InterpretError', async () => {
        await expect(evalConst(withS('konst R: Text = S.quatsch()'))).rejects.toThrow(/Text hat keine Methode/);
    });
    it('Aufruf-Methode ohne Argument → geordneter InterpretError (kein TypeError)', async () => {
        // Type-Checker ist (wie bei Listenmethoden) tolerant gegenüber
        // fehlendem Arg (Teil-Parse-Schonung) → Laufzeit muss sauber
        // `InterpretError` werfen statt nativem TypeError.
        await expect(evalConst(withS('konst R: Wahrheitswert = S.beginntMit()')))
            .rejects.toThrow(/Text\.beginntMit: Text-Argument erwartet, erhalten keines/);
    });
});
