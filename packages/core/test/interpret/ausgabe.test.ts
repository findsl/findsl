/**
 * Tests für die `ausgabe`-Anweisung (SPEC § 5.4 / CLAUDE § 4.18).
 *
 * `ausgabe` ist eine Anweisung (kein Ausdruck), gibt keinen Wert zurück
 * und ist nur als eigene Block-Zeile gültig. Der Seiteneffekt wird über
 * eine injizierte `AusgabeSink` beobachtbar gemacht — bewusste P2-Ausnahme.
 *
 * Abgedeckt:
 *   - Parsen als Block-Zeile (gültig)
 *   - Ausdrucksposition ist ein Syntaxfehler (Anweisung, kein Ausdruck)
 *   - Sink fängt den Text, Auswertungsreihenfolge ist eager links→rechts
 *   - Nicht-Text-Argument: Laufzeit-Fallback `valueToString`
 *   - Integration über `prüfe`: `PruefeReport.ausgaben` sammelt den Lauf
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { interpretProgram } from '../../src/interpret/interpreter.js';
import { runPruefe } from '../../src/interpret/pruefe.js';

const MOD_URI = 'file:///m.findsl';

/** Parst Quelltext MIT Validierung und liefert Fehler-Diagnosen (Severity 1). */
async function parseErrors(source: string): Promise<string[]> {
    const program = await parseSource(source, { validate: true, uri: MOD_URI });
    const doc = (program as { $document?: { diagnostics?: { severity?: number; message: string }[] } }).$document;
    return (doc?.diagnostics ?? [])
        .filter((d) => d.severity === 1)
        .map((d) => d.message);
}

describe('ausgabe — Parsen', () => {
    it('ist als Block-Zeile gültig', async () => {
        const errs = await parseErrors(
            'fn F(): Ganzzahl = {\n  ausgabe("hallo")\n  42\n}\n',
        );
        expect(errs).toEqual([]);
    });

    it('ist in Ausdrucksposition ein Syntaxfehler (Anweisung, kein Ausdruck)', async () => {
        const errs = await parseErrors(
            'konst R: Ganzzahl = ausgabe("x")\n',
        );
        expect(errs.length).toBeGreaterThan(0);
    });
});

describe('ausgabe — Laufzeit-Seiteneffekt', () => {
    it('Sink fängt den Text-Parameter', async () => {
        const program = await parseSource(
            'konst R: Ganzzahl = {\n  ausgabe("trace: start")\n  1\n}\n',
            { uri: MOD_URI },
        );
        const out: string[] = [];
        interpretProgram(program, undefined, (t) => out.push(t));
        expect(out).toEqual(['trace: start']);
    });

    it('Auswertungsreihenfolge ist eager links→rechts (SPEC § 5.4)', async () => {
        const program = await parseSource(
            'konst R: Ganzzahl = {\n'
            + '  ausgabe("eins")\n  var x: Ganzzahl = 10\n  ausgabe("zwei")\n  x\n}\n',
            { uri: MOD_URI },
        );
        const out: string[] = [];
        interpretProgram(program, undefined, (t) => out.push(t));
        expect(out).toEqual(['eins', 'zwei']);
    });

    it('String-Interpolation wird ausgewertet', async () => {
        const program = await parseSource(
            'konst R: Ganzzahl = {\n  var z: Ganzzahl = 5\n  ausgabe("zve=${z}")\n  z\n}\n',
            { uri: MOD_URI },
        );
        const out: string[] = [];
        interpretProgram(program, undefined, (t) => out.push(t));
        expect(out).toEqual(['zve=5']);
    });

    it('Nicht-Text-Wert: Laufzeit-Fallback über valueToString', async () => {
        // Ohne Validierung erlaubt — der Type-Checker meldet das separat.
        const program = await parseSource(
            'konst R: Ganzzahl = {\n  ausgabe(42)\n  0\n}\n',
            { uri: MOD_URI },
        );
        const out: string[] = [];
        interpretProgram(program, undefined, (t) => out.push(t));
        expect(out).toEqual(['42']);
    });

    it('ohne Sink: kein Fehler, NOOP', async () => {
        const program = await parseSource(
            'konst R: Ganzzahl = {\n  ausgabe("verworfen")\n  7\n}\n',
            { uri: MOD_URI },
        );
        expect(() => interpretProgram(program)).not.toThrow();
    });
});

describe('ausgabe — Type-Check erzwingt Text', () => {
    it('Nicht-Text-Argument ist ein Typfehler', async () => {
        const errs = await parseErrors(
            'fn F(): Ganzzahl = {\n  ausgabe(42)\n  0\n}\n',
        );
        expect(errs.some((m) => /Text/.test(m))).toBe(true);
    });
});

describe('ausgabe — Integration über prüfe', () => {
    it('PruefeReport.ausgaben sammelt den Lauf', async () => {
        const program = await parseSource(
            'fn Berechne(): Ganzzahl = {\n  ausgabe("berechne aufgerufen")\n  3\n}\n'
            + 'prüfe "S" {\n  testfall "b" { Berechne() == 3 }\n}\n',
            { uri: MOD_URI },
        );
        const report = runPruefe(program);
        expect(report.passed).toBe(1);
        expect(report.ausgaben).toContain('berechne aufgerufen');
    });
});
