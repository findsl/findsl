/**
 * Phase 2 — Interpreter-Eval für Liste/Bereich/Lambda-Closure/für-jeden/Index.
 * Reine Interpreter-Tests (kein Typ-Gate): parsen Snippet, interpretieren,
 * prüfen die Konstante `R` bzw. einen Namen aus dem Quelltext.
 */

import { describe, it, expect } from 'vitest';
import { parseExpr, parseSource } from '../helpers/parse.js';
import { interpretProgram } from '../../src/interpret/interpreter.js';
import {
    InterpretError,
    ListValue,
    NumericValue,
    type Value,
} from '../../src/interpret/values.js';

async function R(expr: string): Promise<Value> {
    const mod = interpretProgram(await parseExpr(expr));
    const v = mod.env.lookup('R');
    if (!v) throw new Error('R nicht definiert');
    return v;
}
async function Rsrc(src: string): Promise<Value> {
    const mod = interpretProgram(await parseSource(src));
    const v = mod.env.lookup('R');
    if (!v) throw new Error('R nicht definiert');
    return v;
}
const nums = (l: Value): string[] =>
    (l as ListValue).elements.map((e) => (e as NumericValue).value.toString());

describe('Listen-Literal', () => {
    it('[1, 2, 3] → ListValue mit Elementen', async () => {
        const l = await R('[1, 2, 3]');
        expect(l.kind).toBe('list');
        expect(nums(l)).toEqual(['1', '2', '3']);
    });

    it('leere Liste []', async () => {
        expect((await R('[]') as ListValue).elements.length).toBe(0);
    });

    it('Elemente werden ausgewertet (links→rechts)', async () => {
        expect(nums(await R('[1 + 1, 2 * 3, 10 - 4]'))).toEqual(['2', '6', '6']);
    });

    it('verschachtelte Liste', async () => {
        const l = await R('[[1], [2, 3]]') as ListValue;
        expect((l.elements[0] as ListValue).elements.length).toBe(1);
        expect((l.elements[1] as ListValue).elements.length).toBe(2);
    });
});

describe('Bereich (numerisch, materialisiert)', () => {
    it('0 bis 5 inklusiv', async () => {
        expect(nums(await R('0 bis 5'))).toEqual(['0', '1', '2', '3', '4', '5']);
    });
    it('0 bis unter 5 exklusiv', async () => {
        expect(nums(await R('0 bis unter 5'))).toEqual(['0', '1', '2', '3', '4']);
    });
    it('0 bis 10 schritt 2', async () => {
        expect(nums(await R('0 bis 10 schritt 2'))).toEqual(['0', '2', '4', '6', '8', '10']);
    });
    it('from > to → leere Liste', async () => {
        expect((await R('10 bis 5') as ListValue).elements.length).toBe(0);
    });
    it('Schrittweite 0 wirft', async () => {
        await expect(R('0 bis 10 schritt 0')).rejects.toThrow(InterpretError);
    });
    it('Schrittweite negativ wirft', async () => {
        await expect(R('0 bis 10 schritt -1')).rejects.toThrow(InterpretError);
    });
    it('Aufzählungs-Bereich vorerst nicht ausführbar (klare Meldung)', async () => {
        await expect(R('Grundtarif bis Splitting')).rejects.toThrow(/Aufz.*Bereich/);
    });
});

describe('für-jeden (≡ zuordnen, eager L→R)', () => {
    it('produziert Liste der Body-Werte', async () => {
        expect(nums(await R('für jeden x aus [1, 2, 3] { x * 10 }'))).toEqual(['10', '20', '30']);
    });
    it('über Bereich', async () => {
        expect(nums(await R('für jede n aus (1 bis 4) { n + 1 }'))).toEqual(['2', '3', '4', '5']);
    });
    it('verschachtelt → Liste<Liste>', async () => {
        const l = await R('für jeden a aus [1, 2] { für jeden b aus [10, 20] { a + b } }') as ListValue;
        expect(nums(l.elements[0])).toEqual(['11', '21']);
        expect(nums(l.elements[1])).toEqual(['12', '22']);
    });
    it('Body mit var-Setup', async () => {
        expect(nums(await R('für jeden x aus [2, 3] { var q: Dezimal = x * x  q + 1 }')))
            .toEqual(['5', '10']);
    });
    it('Quelle keine Liste → wirft', async () => {
        await expect(R('für jeden x aus 5 { x }')).rejects.toThrow(InterpretError);
    });
});

describe('Index-Zugriff [i] (0-basiert)', () => {
    // Index ist ChainOp einer CallChain → Wurzel muss ein gebundener
    // Identifier sein (Literal-Indexierung `[..][i]` ist keine CallChain).
    it('Element bei Index', async () => {
        expect((await R('{ var xs: Dezimal = [10, 20, 30]  xs[1] }') as NumericValue)
            .value.toString()).toBe('20');
    });
    it('Index außerhalb wirft (Bug-Klasse, kein abbruch)', async () => {
        await expect(R('{ var xs: Dezimal = [1, 2]  xs[5] }')).rejects.toThrow(InterpretError);
    });
    it('negativer Index wirft', async () => {
        await expect(R('{ var xs: Dezimal = [1, 2]  xs[-1] }')).rejects.toThrow(InterpretError);
    });
    it('nicht-ganzzahliger Index wirft', async () => {
        await expect(R('{ var xs: Dezimal = [1, 2]  xs[0,5] }')).rejects.toThrow(InterpretError);
    });
});

describe('Listen-Methoden § 11.2 (Laufzeit)', () => {
    const L = (m: string) => `{ var xs: Dezimal = [3, 1, 2]  ${m} }`;
    it('.länge / .leer', async () => {
        expect((await R(L('xs.länge')) as NumericValue).value.toString()).toBe('3');
        expect((await R('{ var xs: Dezimal = []  xs.leer }')).kind).toBe('bool');
    });
    it('.kopf / .rest', async () => {
        expect((await R(L('xs.kopf')) as NumericValue).value.toString()).toBe('3');
        expect(nums(await R(L('xs.rest')))).toEqual(['1', '2']);
    });
    it('.bei(i) — 0-basiert; OOB wirft', async () => {
        expect((await R(L('xs.bei(2)')) as NumericValue).value.toString()).toBe('2');
        await expect(R(L('xs.bei(9)'))).rejects.toThrow(InterpretError);
    });
    it('.enthält(x)', async () => {
        expect((await R(L('xs.enthält(2)')) as { value: boolean }).value).toBe(true);
        expect((await R(L('xs.enthält(7)')) as { value: boolean }).value).toBe(false);
    });
    it('.zuordnen(lambda) / .filtern(prädikat)', async () => {
        expect(nums(await R(L('xs.zuordnen({ x -> x * 10 })')))).toEqual(['30', '10', '20']);
        expect(nums(await R(L('xs.filtern({ x -> x > 1 })')))).toEqual(['3', '2']);
    });
    it('.zusammenfassen(start, f) — Fold', async () => {
        expect((await R(L('xs.zusammenfassen(0, { acc, x -> acc + x })')) as NumericValue)
            .value.toString()).toBe('6');
    });
    it('.zähle() und .zähle(prädikat)', async () => {
        expect((await R(L('xs.zähle()')) as NumericValue).value.toString()).toBe('3');
        expect((await R(L('xs.zähle({ x -> x > 1 })')) as NumericValue).value.toString()).toBe('2');
    });
    it('.summe() — leer → 0 (D1), sonst Faltung', async () => {
        expect((await R(L('xs.summe()')) as NumericValue).value.toString()).toBe('6');
        expect((await R('{ var xs: Dezimal = []  xs.summe() }') as NumericValue)
            .value.toString()).toBe('0');
    });
    it('.größtes() / .kleinstes(); leer → wirft (D1)', async () => {
        expect((await R(L('xs.größtes()')) as NumericValue).value.toString()).toBe('3');
        expect((await R(L('xs.kleinstes()')) as NumericValue).value.toString()).toBe('1');
        await expect(R('{ var xs: Dezimal = []  xs.größtes() }')).rejects.toThrow(InterpretError);
    });
    it('.zuordnen mit benannter Funktion (nicht nur Lambda)', async () => {
        const s = `
fn Verdopple(n: Ganzzahl): Ganzzahl = n * 2
konst R: Dezimal = { var xs: Dezimal = [1, 2, 3]  xs.zuordnen(Verdopple) }
`;
        expect(nums(await Rsrc(s))).toEqual(['2', '4', '6']);
    });
    it('Verkettung .filtern(…).zuordnen(…).summe()', async () => {
        const v = await R(L('xs.filtern({ x -> x > 1 }).zuordnen({ x -> x * x }).summe()'));
        expect((v as NumericValue).value.toString()).toBe('13');   // 3²+2² = 9+4
    });
});

describe('Lambda mit Parametern (Closure)', () => {
    const src = (call: string) => `
fn Anwenden(f: (Ganzzahl) -> Ganzzahl, x: Ganzzahl): Ganzzahl = f(x)
konst R: Ganzzahl = ${call}
`;
    it('Lambda als Argument wird aufgerufen', async () => {
        expect((await Rsrc(src('Anwenden({ y -> y + 1 }, 41)')) as NumericValue).value.toString())
            .toBe('42');
    });
    it('lexikalischer Capture (Closure sieht Definitions-Scope)', async () => {
        const s = `
fn Anwenden(f: (Ganzzahl) -> Ganzzahl, x: Ganzzahl): Ganzzahl = f(x)
konst BASIS: Ganzzahl = 100
konst R: Ganzzahl = Anwenden({ y -> y + BASIS }, 5)
`;
        expect((await Rsrc(s) as NumericValue).value.toString()).toBe('105');
    });
    it('mehrere Parameter', async () => {
        const s = `
fn Zwei(f: (Ganzzahl, Ganzzahl) -> Ganzzahl): Ganzzahl = f(3, 4)
konst R: Ganzzahl = Zwei({ a, b -> a * b })
`;
        expect((await Rsrc(s) as NumericValue).value.toString()).toBe('12');
    });
    it('Lambda mit Block-Body (var-Setup)', async () => {
        const s = `
fn Anwenden(f: (Ganzzahl) -> Ganzzahl, x: Ganzzahl): Ganzzahl = f(x)
konst R: Ganzzahl = Anwenden({ y -> var d: Ganzzahl = y * 2  d + 1 }, 10)
`;
        expect((await Rsrc(s) as NumericValue).value.toString()).toBe('21');
    });
    it('falsche Argumentanzahl wirft', async () => {
        await expect(Rsrc(src('Anwenden({ a, b -> a + b }, 1)'))).rejects.toThrow(InterpretError);
    });
});
