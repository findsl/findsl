/**
 * E2E-Tests für den Tree-Walker: parsen kleine FinDSL-Snippets, interpretieren
 * das resultierende Programm und prüfen das Ergebnis-Wert in der Konstanten R
 * (Konvention `parseExpr`-Helper) oder direkt einen aus dem Snippet
 * herausgelesenen Namen.
 */

import { describe, it, expect } from 'vitest';
import { parseExpr, parseSource } from '../helpers/parse.js';
import { interpretProgram } from '../../src/interpret/interpreter.js';
import {
    InterpretError,
    NumericValue,
    type RecordValue,
    type SymbolValue,
    type Value,
} from '../../src/interpret/values.js';

async function evalExprAsR(expr: string): Promise<Value> {
    const program = await parseExpr(expr);
    const mod = interpretProgram(program);
    const v = mod.env.lookup('R');
    if (!v) throw new Error('Konstante R nicht definiert');
    return v;
}

describe('Arithmetik', () => {
    it('Addition mit Tausender-Trenner', async () => {
        const v = await evalExprAsR('12.000 + 96') as NumericValue;
        expect(v.value.toString()).toBe('12096');
    });

    it('Subtraktion bleibt exakt', async () => {
        const v = await evalExprAsR('1,30 - 1,00') as NumericValue;
        expect(v.value.toString()).toBe('0.3');
    });

    it('Multiplikation Prozent · Ganzzahl', async () => {
        const v = await evalExprAsR('42% * 100') as NumericValue;
        expect(v.value.toString()).toBe('42');
    });

    it('Division promotet zu Dezimal', async () => {
        const v = await evalExprAsR('10 / 4') as NumericValue;
        expect(v.value.toString()).toBe('2.5');
        expect(v.tag).toBe('Dezimal');
    });

    it('Division durch Null wirft', async () => {
        await expect(evalExprAsR('1 / 0')).rejects.toThrow(InterpretError);
    });

    it('Unäres Minus', async () => {
        const v = await evalExprAsR('-(5 + 3)') as NumericValue;
        expect(v.value.toString()).toBe('-8');
    });

    it('Tag-Propagation: Euro + Ganzzahl bleibt Euro', async () => {
        // Anmerkung: die Typ-Annotation `konst A: Euro = 100` weist im
        // Skelett-Interpreter NICHT automatisch das Euro-Tag zu (das wäre
        // Type-Checker-Aufgabe, Roadmap (d)). Wir taggen daher per `als`.
        const program = await parseSource(
            'modul m\nkonst A: Euro = 100 als Euro\nkonst R: Euro = A + 5\n',
        );
        const mod = interpretProgram(program);
        const v = mod.env.lookup('R') as NumericValue;
        expect(v.tag).toBe('Euro');
        expect(v.value.toString()).toBe('105');
    });
});

describe('Vergleich und Logik', () => {
    it('==, !=, <, <=, >, >=', async () => {
        const cases: Array<[string, boolean]> = [
            ['5 == 5', true],
            ['5 != 5', false],
            ['5 < 6',  true],
            ['5 <= 5', true],
            ['6 > 5',  true],
            ['5 >= 6', false],
        ];
        for (const [src, expected] of cases) {
            const v = await evalExprAsR(src);
            expect(v.kind).toBe('bool');
            expect((v as { value: boolean }).value).toBe(expected);
        }
    });

    it('und ist short-circuit', async () => {
        const program = await parseSource(
            'modul m\nkonst R: Dezimal = wenn (falsch und 1 / 0 == 0) 1 sonst 0\n',
        );
        const mod = interpretProgram(program);
        const v = mod.env.lookup('R') as NumericValue;
        expect(v.value.toString()).toBe('0');
    });

    it('oder als Elvis: nichts oder 0 ergibt 0', async () => {
        const program = await parseSource(
            'modul m\nkonst N: Euro? = nichts\nkonst R: Euro = N oder 0\n',
        );
        const mod = interpretProgram(program);
        const v = mod.env.lookup('R') as NumericValue;
        expect(v.value.toString()).toBe('0');
    });

    it('oder als Elvis: nicht-null linker Wert gewinnt', async () => {
        const program = await parseSource(
            'modul m\nkonst N: Euro? = 1230 als Euro\nkonst R: Euro = N oder 0\n',
        );
        const mod = interpretProgram(program);
        const v = mod.env.lookup('R') as NumericValue;
        expect(v.value.toString()).toBe('1230');
    });

    it('oder als logisches Oder bei Bools', async () => {
        const v = await evalExprAsR('wenn (falsch oder wahr) 1 sonst 0') as NumericValue;
        expect(v.value.toString()).toBe('1');
    });
});

describe('Kontrollfluss', () => {
    it('wenn/sonst wählt Then-Zweig', async () => {
        const v = await evalExprAsR('wenn (wahr) 1 sonst 2') as NumericValue;
        expect(v.value.toString()).toBe('1');
    });

    it('wähle ohne subject: erster wahre Arm gewinnt', async () => {
        const program = await parseSource(
            `modul m
konst R: Dezimal = wähle {
    falls 1 == 2 -> 100
    falls 2 == 2 -> 200
    sonst         -> 300
}
`);
        const mod = interpretProgram(program);
        const v = mod.env.lookup('R') as NumericValue;
        expect(v.value.toString()).toBe('200');
    });

    it('wähle mit subject (Symbol-Match)', async () => {
        const program = await parseSource(
            `modul m
fn f(x: Tarifart): Dezimal = wähle (x) {
    falls Grundtarif -> 1
    falls Splitting  -> 2
}
konst R: Dezimal = f(Splitting)
`);
        const mod = interpretProgram(program);
        const v = mod.env.lookup('R') as NumericValue;
        expect(v.value.toString()).toBe('2');
    });

    it('wähle: mehrere Patterns pro Arm matchen disjunkt', async () => {
        const program = await parseSource(
            `modul m
fn f(s: Steuerklasse): Dezimal = wähle (s) {
    falls I, II -> 0
    falls III   -> 1
    falls IV, V, VI -> 2
}
konst A: Dezimal = f(II)
konst B: Dezimal = f(III)
konst C: Dezimal = f(VI)
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('A') as NumericValue).value.toString()).toBe('0');
        expect((mod.env.lookup('B') as NumericValue).value.toString()).toBe('1');
        expect((mod.env.lookup('C') as NumericValue).value.toString()).toBe('2');
    });

    it('wähle ohne passenden Arm wirft', async () => {
        const program = await parseSource(
            `modul m
konst R: Dezimal = wähle (Splitting) {
    falls Grundtarif -> 1
}
`);
        expect(() => interpretProgram(program)).toThrow(InterpretError);
    });
});

describe('Funktionen', () => {
    it('rekursive Funktion (Fakultät)', async () => {
        const program = await parseSource(
            `modul m
fn fak(n: Ganzzahl): Ganzzahl = wenn (n <= 1) 1 sonst n * fak(n - 1)
konst R: Ganzzahl = fak(5)
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as NumericValue).value.toString()).toBe('120');
    });

    it('Default-Parameter wird verwendet, wenn nicht übergeben', async () => {
        const program = await parseSource(
            `modul m
fn addiere(a: Ganzzahl, b: Ganzzahl = 10): Ganzzahl = a + b
konst R: Ganzzahl = addiere(5)
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as NumericValue).value.toString()).toBe('15');
    });

    it('Default sieht vorhergehende Parameter', async () => {
        const program = await parseSource(
            `modul m
fn f(a: Ganzzahl, b: Ganzzahl = a * 2): Ganzzahl = b
konst R: Ganzzahl = f(7)
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as NumericValue).value.toString()).toBe('14');
    });

    it('Benannter Aufruf', async () => {
        const program = await parseSource(
            `modul m
fn f(a: Ganzzahl, b: Ganzzahl): Ganzzahl = a - b
konst R: Ganzzahl = f(b = 3, a = 10)
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as NumericValue).value.toString()).toBe('7');
    });

    it('Block-Body mit let', async () => {
        const program = await parseSource(
            `modul m
fn f(x: Ganzzahl): Ganzzahl {
    var doppelt: Ganzzahl = x * 2
    doppelt + 1
}
konst R: Ganzzahl = f(5)
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as NumericValue).value.toString()).toBe('11');
    });

    it('Fehlendes Pflicht-Argument wirft', async () => {
        const program = await parseSource(
            `modul m
fn f(a: Ganzzahl): Ganzzahl = a
konst R: Ganzzahl = f()
`);
        expect(() => interpretProgram(program)).toThrow(InterpretError);
    });

    it('Unbekanntes benanntes Argument wirft', async () => {
        const program = await parseSource(
            `modul m
fn f(a: Ganzzahl): Ganzzahl = a
konst R: Ganzzahl = f(b = 1)
`);
        expect(() => interpretProgram(program)).toThrow(InterpretError);
    });
});

describe('Datensätze', () => {
    it('Konstruktion positional + Feldzugriff', async () => {
        const program = await parseSource(
            `modul m
datensatz Pt(x: Ganzzahl, y: Ganzzahl)
konst P: Pt = Pt(3, 4)
konst R: Ganzzahl = P.x + P.y
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as NumericValue).value.toString()).toBe('7');
    });

    it('Konstruktion benannt mit Default', async () => {
        const program = await parseSource(
            `modul m
datensatz Cfg(host: Text = "localhost", port: Ganzzahl = 8080)
konst C: Cfg = Cfg(port = 9000)
`);
        const mod = interpretProgram(program);
        const c = mod.env.lookup('C') as RecordValue;
        const port = c.fields.get('port') as NumericValue;
        const host = c.fields.get('host') as { value: string };
        expect(port.value.toString()).toBe('9000');
        expect(host.value).toBe('localhost');
    });

    it('Default sieht bereits gesetzte Felder', async () => {
        const program = await parseSource(
            `modul m
datensatz B(a: Ganzzahl, b: Ganzzahl = a * 2)
konst X: B = B(a = 5)
`);
        const mod = interpretProgram(program);
        const x = mod.env.lookup('X') as RecordValue;
        expect((x.fields.get('b') as NumericValue).value.toString()).toBe('10');
    });

    it('Fehlendes Pflichtfeld wirft', async () => {
        const program = await parseSource(
            `modul m
datensatz Pt(x: Ganzzahl, y: Ganzzahl)
konst P: Pt = Pt(x = 1)
`);
        expect(() => interpretProgram(program)).toThrow(InterpretError);
    });

    it('Zugriff auf unbekanntes Feld wirft', async () => {
        const program = await parseSource(
            `modul m
datensatz Pt(x: Ganzzahl)
konst P: Pt = Pt(1)
konst R: Ganzzahl = P.unbekannt
`);
        expect(() => interpretProgram(program)).toThrow(InterpretError);
    });
});

describe('Cast und Symbol-Fallback', () => {
    it('Cast taggt NumericValue um', async () => {
        const v = await evalExprAsR('1.230 als Euro') as NumericValue;
        expect(v.tag).toBe('Euro');
        expect(v.value.toString()).toBe('1230');
    });

    it('Ungebundener PascalCase-Identifier wird Symbol', async () => {
        const program = await parseSource(
            `modul m
konst R: Tarifart = Grundtarif
`);
        const mod = interpretProgram(program);
        const v = mod.env.lookup('R') as SymbolValue;
        expect(v.kind).toBe('symbol');
        expect(v.name).toBe('Grundtarif');
    });

    it('Ungebundener kleingeschriebener Identifier wirft', async () => {
        const program = await parseSource(
            `modul m
konst R: Ganzzahl = unbekannt + 1
`);
        expect(() => interpretProgram(program)).toThrow(/Unbekannter Identifier/);
    });
});

describe('NullCheck und Sicher-Zugriff', () => {
    it('ist nichts → wahr', async () => {
        const program = await parseSource(
            `modul m
konst N: Euro? = nichts
konst R: Wahrheit = N ist nichts
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as { value: boolean }).value).toBe(true);
    });

    it('ist nicht nichts → falsch bei nichts', async () => {
        const program = await parseSource(
            `modul m
konst N: Euro? = nichts
konst R: Wahrheit = N ist nicht nichts
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as { value: boolean }).value).toBe(false);
    });

    it('Force-Unwrap auf nichts wirft', async () => {
        const program = await parseSource(
            `modul m
konst N: Euro? = nichts
konst R: Euro = N!!
`);
        expect(() => interpretProgram(program)).toThrow(InterpretError);
    });
});
