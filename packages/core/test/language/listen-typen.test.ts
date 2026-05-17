/**
 * Phase 3 — Type-Checker für Liste/Bereich/Lambda-Params/für-jeden/Index
 * und die Listen-Methoden (SPEC § 11.2). Prüft: (a) inferierte Typen
 * korrekt (`typeOfR`, annotation-unabhängig direkt via `infer`),
 * (b) valide Konstrukte erzeugen keine Typfehler, (c) Fehlfälle gemeldet.
 */

import { describe, it, expect } from 'vitest';
import { parseExpr, parseSource } from '../helpers/parse.js';
import {
    TypeEnv,
    buildContext,
    infer,
    typeCheckProgram,
    typeToString,
} from '../../src/language/findsl-types.js';
import { isKonstDecl, type Expr } from '../../src/language/generated/ast.js';

/** Inferierter Typ des Ausdrucks (über `konst R: Dezimal = <expr>`). */
async function typeOfR(expr: string): Promise<string> {
    const program = await parseExpr(expr);
    const ctx = buildContext(program);
    let value: Expr | undefined;
    for (const d of program.decls) {
        if (isKonstDecl(d) && d.name === 'R') value = d.value;
    }
    if (!value) throw new Error('konst R fehlt');
    return typeToString(infer(value, new TypeEnv(), ctx, () => {}));
}

/** Typfehler-Meldungen eines vollständigen Snippets. */
async function diags(src: string): Promise<string[]> {
    const program = await parseSource(src);
    const msgs: string[] = [];
    typeCheckProgram(program, (_n, m) => msgs.push(m));
    return msgs;
}

const L = (m: string) => `{ var xs: Liste<Ganzzahl> = [1, 2, 3]  ${m} }`;

describe('Liste/Bereich — Inferenz', () => {
    it('Listen-Literal homogen → Liste<Ganzzahl>', async () => {
        expect(await typeOfR('[1, 2, 3]')).toBe('Liste<Ganzzahl>');
    });
    it('leere Liste → Liste<?>', async () => {
        expect(await typeOfR('[]')).toBe('Liste<?>');
    });
    it('Bereich → Liste<Element>', async () => {
        expect(await typeOfR('0 bis 10')).toBe('Liste<Ganzzahl>');
        expect(await typeOfR('0 bis 10 schritt 2')).toBe('Liste<Ganzzahl>');
    });
    it('Bereich<T>-Annotation löst zu Liste<T> auf (zuweisbar, keine Fehler)', async () => {
        expect(await diags('konst R: Bereich<Ganzzahl> = 1 bis 5\n')).toEqual([]);
    });
    it('Liste<T>-Annotation akzeptiert Literal (bidirektional)', async () => {
        expect(await diags('konst R: Liste<Euro> = [1.000, 2.000]\n')).toEqual([]);
    });
});

describe('für jeden — Inferenz', () => {
    it('liefert Liste<BodyTyp>', async () => {
        expect(await typeOfR('für jeden x aus [1, 2, 3] { x * 2 }')).toBe('Liste<Ganzzahl>');
    });
    it('verschachtelt → Liste<Liste<…>>', async () => {
        expect(await typeOfR('für jeden a aus [1, 2] { für jeden b aus [3] { a + b } }'))
            .toBe('Liste<Liste<Ganzzahl>>');
    });
    it('Quelle keine Liste → Fehler', async () => {
        const d = await diags('konst R: Dezimal = für jeden x aus 5 { x }\n');
        expect(d.some((m) => /keine Liste/.test(m))).toBe(true);
    });
});

describe('Lambda mit Parametern — bidirektional', () => {
    const base = 'fn Anwenden(f: (Ganzzahl) -> Ganzzahl, x: Ganzzahl): Ganzzahl = f(x)\n';
    it('Lambda-Argument typt fehlerfrei (Param aus Kontext)', async () => {
        expect(await diags(base + 'konst R: Ganzzahl = Anwenden({ y -> y + 1 }, 5)\n'))
            .toEqual([]);
    });
    it('falscher Lambda-Rückgabetyp wird gemeldet', async () => {
        const d = await diags(base + 'konst R: Ganzzahl = Anwenden({ y -> wahr }, 5)\n');
        expect(d.some((m) => /passt nicht/.test(m))).toBe(true);
    });
    it('Lambda mit eigener Param-Annotation', async () => {
        expect(await diags(base + 'konst R: Ganzzahl = Anwenden({ y: Ganzzahl -> y * 2 }, 3)\n'))
            .toEqual([]);
    });
});

describe('Listen-Methoden § 11.2 — Substitution', () => {
    it('.länge → Ganzzahl', async () => {
        expect(await typeOfR(L('xs.länge'))).toBe('Ganzzahl');
    });
    it('.leer → Wahrheitswert', async () => {
        expect(await typeOfR(L('xs.leer'))).toBe('Wahrheitswert');
    });
    it('.kopf → Element, .rest → Liste<Element>', async () => {
        expect(await typeOfR(L('xs.kopf'))).toBe('Ganzzahl');
        expect(await typeOfR(L('xs.rest'))).toBe('Liste<Ganzzahl>');
    });
    it('.zuordnen({ x -> x + 1 }) → Liste<Ganzzahl>', async () => {
        expect(await typeOfR(L('xs.zuordnen({ x -> x + 1 })'))).toBe('Liste<Ganzzahl>');
    });
    it('.summe() / .größtes() → Element', async () => {
        expect(await typeOfR(L('xs.summe()'))).toBe('Ganzzahl');
        expect(await typeOfR(L('xs.größtes()'))).toBe('Ganzzahl');
    });
    it('.filtern(…).zusammenfassen(0, …) → Ganzzahl', async () => {
        expect(await typeOfR(L('xs.filtern({ x -> x > 2 }).zusammenfassen(0, { acc, x -> acc + x })')))
            .toBe('Ganzzahl');
    });
    it('.zähle() → Ganzzahl, .enthält(2) → Wahrheitswert', async () => {
        expect(await typeOfR(L('xs.zähle()'))).toBe('Ganzzahl');
        expect(await typeOfR(L('xs.enthält(2)'))).toBe('Wahrheitswert');
    });
    it('unbekannte Listen-Methode → Fehler', async () => {
        const d = await diags('konst R: Dezimal = ' + L('xs.gibtsnicht()') + '\n');
        expect(d.some((m) => /keine Methode/.test(m))).toBe(true);
    });
});

describe('Index [i]', () => {
    it('Index auf Liste → Elementtyp', async () => {
        expect(await typeOfR(L('xs[1]'))).toBe('Ganzzahl');
    });
    it('Index auf Nicht-Liste → Fehler', async () => {
        const d = await diags('konst R: Dezimal = { var n: Ganzzahl = 5  n[0] }\n');
        expect(d.some((m) => /Index-Zugriff .* nicht-Liste/.test(m))).toBe(true);
    });
});
