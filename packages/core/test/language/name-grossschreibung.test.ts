/**
 * Harte Regel (SPEC § 2.5): Namen von Funktionen, Datensätzen,
 * Aufzählungen und Aufzählungs-Werten müssen mit einem Großbuchstaben
 * beginnen (führende „_" erlaubt). Verstoß = Fehler. Builtins,
 * `var`/Parameter/Felder und `konst` (eigene Regel) sind nicht betroffen.
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';

const MOD = 'file:///m.findsl';

async function errs(src: string): Promise<string[]> {
    const program = await parseSource(src, { validate: true, uri: MOD });
    const doc = (program as { $document?: { diagnostics?: { severity?: number; message: string }[] } }).$document;
    return (doc?.diagnostics ?? []).filter((d) => d.severity === 1).map((d) => d.message);
}

describe('Großschreibung — gültige Namen', () => {
    it('Funktion UpperCamel ist gültig', async () => {
        expect(await errs('fn Verdoppeln(x: Euro): Euro = x + x\n')).toEqual([]);
    });
    it('führender Unterstrich + Großbuchstabe ist gültig', async () => {
        expect(await errs('fn _InternerHelfer(x: Euro): Euro = x\n')).toEqual([]);
    });
    it('Datensatz/Aufzählung/Enum-Werte groß ist gültig', async () => {
        expect(await errs(
            'datensatz Bescheid(zve: Euro)\n'
            + 'aufzählung Ampel { Rot, Gelb, Gruen }\n',
        )).toEqual([]);
    });
    it('Builtins (lowerCamel) im Aufruf sind unberührt', async () => {
        expect(await errs(
            '@Quelle("x")\nkonst R: Euro = abrundenEuro(2,50)\n',
        )).toEqual([]);
    });
});

describe('Großschreibung — Verstöße sind Fehler', () => {
    it('Funktion klein → Fehler', async () => {
        const e = await errs('fn verdoppeln(x: Euro): Euro = x + x\n');
        expect(e.some((m) => /Funktions-Name "verdoppeln".*Großbuchstaben/.test(m))).toBe(true);
    });
    it('Datensatz klein → Fehler', async () => {
        const e = await errs('datensatz bescheid(zve: Euro)\n');
        expect(e.some((m) => /Datensatz-Name "bescheid".*Großbuchstaben/.test(m))).toBe(true);
    });
    it('Aufzählung klein → Fehler', async () => {
        const e = await errs('aufzählung ampel { Rot }\n');
        expect(e.some((m) => /Aufzählungs-Name "ampel".*Großbuchstaben/.test(m))).toBe(true);
    });
    it('Aufzählungs-Wert klein → Fehler (Typ groß)', async () => {
        const e = await errs('aufzählung Ampel { rot, Gelb }\n');
        expect(e.some((m) => /Aufzählungs-Wert "rot".*Großbuchstaben/.test(m))).toBe(true);
        expect(e.some((m) => /"Gelb"/.test(m))).toBe(false);
    });
    it('var/Parameter bleiben lowerCamel (KEIN Großschreibungs-Fehler)', async () => {
        const e = await errs('fn F(einkommen: Euro): Euro = einkommen\n');
        expect(e.filter((m) => /Großbuchstaben/.test(m))).toEqual([]);
    });
});
