/**
 * TDD-RED: `testfall` nutzt die Blockform `{ … }` statt `: ausdruck`
 * (SPEC § 10). Im Block sind beliebig viele Anweisungen (`var`-Setup)
 * plus eine finale Wahrheitswert-Assertion erlaubt; `erwartet abbruch`
 * bleibt davor. Die alte `:`-Form ist ungültig.
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { interpretProgram } from '../../src/interpret/interpreter.js';
import { runPruefe } from '../../src/interpret/pruefe.js';

const MOD = 'file:///m.findsl';

async function errs(src: string): Promise<string[]> {
    const program = await parseSource(src, { validate: true, uri: MOD });
    const doc = (program as { $document?: { diagnostics?: { severity?: number; message: string }[] } }).$document;
    return (doc?.diagnostics ?? []).filter((d) => d.severity === 1).map((d) => d.message);
}

describe('testfall — Blockform parst', () => {
    it('einzelne Assertion im Block', async () => {
        expect(await errs(
            'fn F(): Euro = 0 als Euro\n'
            + 'prüfe "P" {\n  testfall "a" {\n    F() == (0 als Euro)\n  }\n}\n',
        )).toEqual([]);
    });

    it('mehrzeilig: var-Setup + finale Assertion', async () => {
        expect(await errs(
            'fn F(x: Euro): Euro = x\n'
            + 'prüfe "P" {\n  testfall "mit Setup" {\n'
            + '    var a: Euro = 100 als Euro\n'
            + '    var b: Euro = 100 als Euro\n'
            + '    F(a) == b\n  }\n}\n',
        )).toEqual([]);
    });

    it('erwartet abbruch vor dem Block', async () => {
        expect(await errs(
            'fn T(x: Euro): Euro = wenn (x < (0 als Euro)) abbruch("neg") sonst x\n'
            + 'prüfe "P" {\n  testfall "lehnt ab" erwartet abbruch {\n    T(-1 als Euro)\n  }\n}\n',
        )).toEqual([]);
    });
});

describe('testfall — alte `:`-Form ist ungültig', () => {
    it('`testfall "x": expr` ist Syntaxfehler', async () => {
        expect((await errs(
            'fn F(): Euro = 0 als Euro\nprüfe "P" {\n  testfall "a": F() == (0 als Euro)\n}\n',
        )).length).toBeGreaterThan(0);
    });
});

describe('testfall — pruefe-Runner wertet den Block aus', () => {
    it('pass / fail / erwartet abbruch', async () => {
        const program = await parseSource(
            'fn T(x: Euro): Euro = wenn (x < (0 als Euro)) abbruch("neg") sonst x\n'
            + 'prüfe "S" {\n'
            + '  testfall "ok" {\n    var a: Euro = 5 als Euro\n    T(a) == (5 als Euro)\n  }\n'
            + '  testfall "kaputt" {\n    T(5 als Euro) == (99 als Euro)\n  }\n'
            + '  testfall "ablehnung" erwartet abbruch {\n    T(-1 als Euro)\n  }\n'
            + '}\n',
            { uri: MOD },
        );
        // Programm muss zumindest parsefähig sein (sonst kein sinnvoller Lauf).
        interpretProgram(program);
        const report = runPruefe(program);
        expect(report.passed).toBe(2);   // "ok" + "ablehnung"
        expect(report.failed).toBe(1);   // "kaputt"
    });
});
