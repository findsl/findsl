/**
 * TDD-RED: deutsche Ausgabe-Formatierung (SPEC § 2.7-Tabelle / § 3.2).
 *
 * Kein `EUR`-Suffix. Tausender-Trenner `.` immer gesetzt, Dezimal `,`.
 * `Euro` ganzzahlig; `Cent` ganzzahliger Centbetrag (Euro-kanonisch
 * ×100); `EuroCent` genau 2 Nachkommastellen. Snippets nutzen nur
 * Integer/`%`/`als`, damit sie unter alter UND neuer Grammatik parsen
 * — rot ist hier ausschließlich die Formatierung.
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { interpretProgram } from '../../src/interpret/interpreter.js';
import { valueToString } from '../../src/interpret/values.js';

async function fmt(expr: string): Promise<string> {
    const program = await parseSource(`modul m\nkonst R: Dezimal = ${expr}\n`);
    const mod = interpretProgram(program);
    const v = mod.env.lookup('R');
    if (!v) throw new Error('R nicht definiert');
    return valueToString(v);
}

describe('Geld-Format — deutsche Schreibweise, kein EUR', () => {
    it('Ganzzahl gruppiert: 1000 → 1.000', async () => {
        expect(await fmt('1000')).toBe('1.000');
    });

    it('Ganzzahl mehrfach gruppiert: 3332222 → 3.332.222', async () => {
        expect(await fmt('3332222')).toBe('3.332.222');
    });

    it('Euro: 12096 → 12.096 (kein Suffix)', async () => {
        const s = await fmt('12096 als Euro');
        expect(s).toBe('12.096');
        expect(s).not.toMatch(/EUR/);
    });

    it('Cent: 1 als Cent → 1 (ganzzahliger Centbetrag)', async () => {
        expect(await fmt('1 als Cent')).toBe('1');
    });

    it('Cent gruppiert: 250000 als Cent → intern 2500€ → 250.000', async () => {
        expect(await fmt('250000 als Cent')).toBe('250.000');
    });

    it('EuroCent zwei Nachkommastellen: 3434 als EuroCent → 3.434,00', async () => {
        expect(await fmt('3434 als EuroCent')).toBe('3.434,00');
    });

    it('EuroCent aus Prozent·Euro: (101 als Euro) * 42% → 42,42', async () => {
        expect(await fmt('(101 als Euro) * 42%')).toBe('42,42');
    });

    it('Prozent: 42% → 42 % (Komma-Dezimal, Leerzeichen)', async () => {
        expect(await fmt('42%')).toBe('42 %');
    });

    it('keine Ausgabe enthält EUR/€-Suffix', async () => {
        for (const e of ['12096 als Euro', '1 als Cent', '3434 als EuroCent']) {
            expect(await fmt(e)).not.toMatch(/EUR|€/);
        }
    });
});
