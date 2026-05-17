/**
 * TDD-RED: deutsche Zahl-Notation (SPEC § 2.7).
 *
 * Neu:  `.` = Tausender-Trenner (Gruppen zu 3, optional), `,` =
 *       Dezimaltrenner, `_` entfällt. Per-Typ-Schreibweise:
 *       Euro/Cent ganzzahlig (kein `,`), EuroCent genau 2 Nachkomma.
 * Alt (`12_096`, `9.3`) ist ungültig.
 *
 * Diese Tests sind ABSICHTLICH ROT gegen den aktuellen Stand.
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';

const MOD_URI = 'file:///m.findsl';

/** Fehler-Diagnosen (Severity 1) eines validierten Moduls. */
async function errs(src: string): Promise<string[]> {
    const program = await parseSource(src, { validate: true, uri: MOD_URI });
    const doc = (program as { $document?: { diagnostics?: { severity?: number; message: string }[] } }).$document;
    return (doc?.diagnostics ?? []).filter((d) => d.severity === 1).map((d) => d.message);
}

describe('Zahl-Notation — neue deutsche Schreibweise parst', () => {
    it('Ganzzahl mit Tausender-Punkt: `12.096`', async () => {
        expect(await errs('konst R: Ganzzahl = 12.096\n')).toEqual([]);
    });

    it('mehrfach gruppiert: `3.332.222`', async () => {
        expect(await errs('konst R: Ganzzahl = 3.332.222\n')).toEqual([]);
    });

    it('Dezimal mit Komma + Gruppierung: `10.911,92`', async () => {
        expect(await errs('konst R: Dezimal = 10.911,92\n')).toEqual([]);
    });

    it('Prozent mit Komma: `9,3%`', async () => {
        expect(await errs('konst R: Prozent = 9,3%\n')).toEqual([]);
    });

    it('ungruppiert bleibt gültig: `1000`', async () => {
        expect(await errs('konst R: Ganzzahl = 1000\n')).toEqual([]);
    });
});

describe('Zahl-Notation — alte Schreibweise ist Fehler', () => {
    it('Unterstrich-Gruppierung `12_096` ungültig', async () => {
        expect((await errs('konst R: Ganzzahl = 12_096\n')).length).toBeGreaterThan(0);
    });

    it('Punkt-Dezimaltrenner `9.3` ungültig', async () => {
        expect((await errs('konst R: Dezimal = 9.3\n')).length).toBeGreaterThan(0);
    });
});

describe('Zahl-Notation — Per-Typ-Schreibweise (sonst Fehler)', () => {
    it('Euro mit Nachkommastelle ist Fehler', async () => {
        const e = await errs('konst R: Euro = 1,50\n');
        expect(e.some((m) => /ganzzahl|Nachkomma/i.test(m))).toBe(true);
    });

    it('Cent mit Nachkommastelle ist Fehler', async () => {
        const e = await errs('konst R: Cent = 3,3\n');
        expect(e.some((m) => /ganzzahl|Nachkomma/i.test(m))).toBe(true);
    });

    it('EuroCent ohne zwei Nachkommastellen ist Fehler', async () => {
        const e = await errs('konst R: EuroCent = 3434\n');
        expect(e.some((m) => /zwei Nachkomma/i.test(m))).toBe(true);
    });

    it('EuroCent mit genau zwei Nachkommastellen ist gültig', async () => {
        expect(await errs('konst R: EuroCent = 3.434,00\n')).toEqual([]);
    });

    it('Euro ganzzahlig mit Gruppierung ist gültig', async () => {
        expect(await errs('konst R: Euro = 3.332.222\n')).toEqual([]);
    });
});
