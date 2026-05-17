/**
 * TDD-RED → GREEN: generische Zahl-Rundung `aufrunden`/`abrunden`.
 *
 * `aufrunden(wert: Dezimal): Ganzzahl` — kleinste Ganzzahl ≥ wert
 * (Richtung +∞, ROUND_CEIL).
 * `abrunden(wert: Dezimal): Ganzzahl`  — größte Ganzzahl ≤ wert
 * (Richtung −∞, ROUND_FLOOR).
 *
 * Motiviert vom KraftStG (§ 9: „für je 100 cm³ Hubraum oder einen Teil
 * davon" = aufgerundete Einheitenzahl). Builtins werden ergänzt, sobald
 * reale Beispiele sie nachfragen (builtins.ts-Politik).
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { interpretProgram } from '../../src/interpret/interpreter.js';
import type { NumericValue } from '../../src/interpret/values.js';

async function evalGanzzahl(expr: string, validate = false): Promise<NumericValue> {
    const program = await parseSource(
        `--\nx\n--\n@Quelle("t")\nkonst R: Ganzzahl = ${expr}\n`,
        { validate },
    );
    const v = interpretProgram(program).env.lookup('R');
    if (!v || v.kind !== 'numeric') throw new Error('R nicht numerisch');
    return v as NumericValue;
}

describe('aufrunden(Dezimal): Ganzzahl — Richtung +∞', () => {
    it('echter Bruch wird hochgerundet (15,98 → 16)', async () => {
        const v = await evalGanzzahl('aufrunden(1598 / 100)');
        expect(v.tag).toBe('Ganzzahl');
        expect(v.value.toString()).toBe('16');
    });
    it('ganzzahliger Wert bleibt unverändert (16,0 → 16)', async () => {
        expect((await evalGanzzahl('aufrunden(1600 / 100)')).value.toString()).toBe('16');
    });
    it('knapp über der Grenze rundet hoch (16,01 → 17)', async () => {
        expect((await evalGanzzahl('aufrunden(1601 / 100)')).value.toString()).toBe('17');
    });
    it('Komma-Literal als Argument (15,98 → 16)', async () => {
        expect((await evalGanzzahl('aufrunden(15,98)')).value.toString()).toBe('16');
    });
    it('negativer Wert: −1,2 → −1', async () => {
        expect((await evalGanzzahl('aufrunden(0 - 12 / 10)')).value.toString()).toBe('-1');
    });
    it('0 → 0', async () => {
        expect((await evalGanzzahl('aufrunden(0)')).value.toString()).toBe('0');
    });
});

describe('abrunden(Dezimal): Ganzzahl — Richtung −∞', () => {
    it('echter Bruch wird abgerundet (15,98 → 15)', async () => {
        const v = await evalGanzzahl('abrunden(1598 / 100)');
        expect(v.tag).toBe('Ganzzahl');
        expect(v.value.toString()).toBe('15');
    });
    it('ganzzahliger Wert bleibt unverändert (16,0 → 16)', async () => {
        expect((await evalGanzzahl('abrunden(1600 / 100)')).value.toString()).toBe('16');
    });
    it('Komma-Literal als Argument (15,98 → 15)', async () => {
        expect((await evalGanzzahl('abrunden(15,98)')).value.toString()).toBe('15');
    });
    it('negativer Wert: −1,2 → −2', async () => {
        expect((await evalGanzzahl('abrunden(0 - 12 / 10)')).value.toString()).toBe('-2');
    });
});

describe('Type-Checker akzeptiert Ganzzahl-Rückgabe', () => {
    it('konst R: Ganzzahl = aufrunden(...) ist diagnosefrei', async () => {
        // validate:true → voller Validator-Pfad (Typ Ganzzahl == Annotation)
        const v = await evalGanzzahl('aufrunden(2598 / 100)', true);
        expect(v.value.toString()).toBe('26');
    });
});
