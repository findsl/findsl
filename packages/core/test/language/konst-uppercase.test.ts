/**
 * Harte Regel (SPEC § 2.5): `konst`-Namen müssen durchgängig GROSS
 * geschrieben sein — ASCII `^[A-Z][A-Z0-9_]*$` (UPPER_SNAKE_CASE).
 * Verstöße sind ein Fehler. Andere Deklarations-Arten sind nicht
 * betroffen.
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';

const MOD = 'file:///m.findsl';

async function errs(src: string): Promise<string[]> {
    const program = await parseSource(src, { validate: true, uri: MOD });
    const doc = (program as { $document?: { diagnostics?: { severity?: number; message: string }[] } }).$document;
    return (doc?.diagnostics ?? []).filter((d) => d.severity === 1).map((d) => d.message);
}

describe('konst-Name UPPER_SNAKE_CASE — gültig', () => {
    it('SCREAMING_SNAKE mit Ziffern/Unterstrich', async () => {
        expect(await errs(
            '@Quelle("x")\nkonst ZONE_4_OBERGRENZE: Euro = 277.825\n',
        )).toEqual([]);
    });

    it('Einzelbuchstabe ist gültig', async () => {
        expect(await errs('@Quelle("x")\nkonst K: Ganzzahl = 1\n')).toEqual([]);
    });

    it('langer Name', async () => {
        expect(await errs(
            '@Quelle("x")\nkonst ARBEITNEHMER_PAUSCHBETRAG: Euro = 1.230\n',
        )).toEqual([]);
    });
});

describe('konst-Name nicht GROSS — Fehler', () => {
    it('gemischte Schreibweise ist Fehler', async () => {
        const e = await errs('@Quelle("x")\nkonst An_Pauschalbetrag: Euro = 1.230\n');
        expect(e.some((m) => /GROSS|UPPER_SNAKE/i.test(m))).toBe(true);
    });

    it('komplett kleingeschrieben ist Fehler', async () => {
        const e = await errs('@Quelle("x")\nkonst gehalt: EuroCent = 1.230,00\n');
        expect(e.some((m) => /GROSS|UPPER_SNAKE/i.test(m))).toBe(true);
    });

    it('ein einzelner Kleinbuchstabe im Namen reicht für Fehler', async () => {
        const e = await errs('@Quelle("x")\nkonst UNSUEDa: Euro = 2\n');
        expect(e.some((m) => /GROSS|UPPER_SNAKE/i.test(m))).toBe(true);
    });
});

describe('konst-Regel ist unabhängig von der Großschreibungs-Regel', () => {
    it('var/Parameter/Datensatz-Felder dürfen lowerCamel sein (kein Fehler)', async () => {
        // Die UPPER_SNAKE-konst-Regel betrifft NUR `konst`. var/Param/
        // Felder behalten lowerCamelCase — hier korrekt, keine Diagnose.
        // (fn/Datensatz/Aufzählung/Enum-Wert sind separat groß-pflichtig,
        //  SPEC § 2.5 — siehe nächster Fall.)
        expect(await errs(
            'datensatz Steuerfall(jahresWert: Euro)\n'
            + 'fn BerechneWert(eingabe: Euro): Euro = {\n'
            + '  var zwischenWert: Euro = eingabe\n'
            + '  zwischenWert\n'
            + '}\n',
        )).toEqual([]);
    });

    it('lowercase fn/Datensatz sind ein Großschreibungs-Fehler (NICHT die konst-Regel)', async () => {
        // Gegenprobe: lowerCamel fn/datensatz lösen `findsl.name-`
        // `grossschreibung` aus — eine ANDERE Regel als die konst-
        // UPPER_SNAKE-Regel. Beweist die Abgrenzung beider Regeln.
        const eFn = await errs('fn berechneWert(eingabe: Euro): Euro = eingabe\n');
        expect(eFn.some((m) => /Großbuchstaben|SPEC § 2\.5/.test(m))).toBe(true);
        expect(eFn.some((m) => /GROSS|UPPER_SNAKE/i.test(m))).toBe(false);

        const eDs = await errs('datensatz steuerfall(jahresWert: Euro)\n');
        expect(eDs.some((m) => /Großbuchstaben|SPEC § 2\.5/.test(m))).toBe(true);
    });
});
