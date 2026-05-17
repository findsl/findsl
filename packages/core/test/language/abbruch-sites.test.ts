/**
 * Tests für den Audit-Collector `collectAbbruchSites` (SPEC § 4.19).
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { collectAbbruchSites } from '../../src/language/findsl-abbruch-sites.js';

describe('collectAbbruchSites', () => {
    it('sammelt statische Begründung mit Funktion und @Quelle', async () => {
        const program = await parseSource(`modul m
@Quelle("§ 32a EStG")
fn estGrundtarif(zve: Euro): Euro = wähle {
    falls zve < 0 als Euro -> abbruch("§ 32a EStG: negatives zvE unzulässig")
    sonst                  -> 0 als Euro
}
`);
        const sites = collectAbbruchSites(program);
        expect(sites).toHaveLength(1);
        expect(sites[0].enthaltenIn).toBe('estGrundtarif');
        expect(sites[0].begruendung).toBe('§ 32a EStG: negatives zvE unzulässig');
        expect(sites[0].dynamisch).toBe(false);
        expect(sites[0].quelle).toBe('§ 32a EStG');
        expect(sites[0].zeile).toBe(4);
    });

    it('markiert dynamische Begründung (Interpolation) und behält Slots', async () => {
        const program = await parseSource(`modul m
fn f(zve: Euro): Euro = abbruch("negativ: \${zve}")
`);
        const sites = collectAbbruchSites(program);
        expect(sites).toHaveLength(1);
        expect(sites[0].dynamisch).toBe(true);
        expect(sites[0].begruendung).toContain('${zve}');
        expect(sites[0].enthaltenIn).toBe('f');
        expect(sites[0].quelle).toBeUndefined();
    });

    it('sammelt mehrere Stellen projektweit', async () => {
        const program = await parseSource(`modul m
fn a(x: Euro): Euro = abbruch("A")
fn b(x: Euro): Euro = wähle {
    falls x < 0 als Euro -> abbruch("B1")
    sonst                -> abbruch("B2")
}
`);
        const sites = collectAbbruchSites(program);
        expect(sites.map((s) => s.begruendung).sort()).toEqual(['A', 'B1', 'B2']);
        expect(sites.filter((s) => s.enthaltenIn === 'b')).toHaveLength(2);
    });

    it('ohne abbruch: leere Liste', async () => {
        const program = await parseSource(`modul m
fn f(x: Euro): Euro = x
`);
        expect(collectAbbruchSites(program)).toEqual([]);
    });
});
