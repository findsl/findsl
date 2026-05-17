/**
 * Tests für die kanonische Builtin-Quelle (findsl-stdlib + builtins.json).
 * Sichert ab, dass die Single Source of Truth die erwarteten SPEC-§-3.7-
 * Definitionen liefert und die abgeleiteten Helfer konsistent sind.
 */

import { describe, it, expect } from 'vitest';
import {
    BUILTIN_ENUM_DEFS,
    BUILTIN_FUNCTION_DEFS,
    BUILTIN_PRIMITIVE_TYPES,
    BUILTIN_ENUM_VALUE_TO_ENUM,
    BUILTIN_NAMES,
    isBuiltinName,
} from '../../src/language/findsl-stdlib.js';

describe('Builtin-Aufzählungen (SPEC § 3.7)', () => {
    it('Tarifart, Steuerklasse, Lohnzahlungszeitraum sind definiert', () => {
        const names = BUILTIN_ENUM_DEFS.map((e) => e.name);
        expect(names).toContain('Tarifart');
        expect(names).toContain('Steuerklasse');
        expect(names).toContain('Lohnzahlungszeitraum');
    });

    it('Tarifart hat genau Grundtarif + Splitting', () => {
        const t = BUILTIN_ENUM_DEFS.find((e) => e.name === 'Tarifart')!;
        expect([...t.values]).toEqual(['Grundtarif', 'Splitting']);
        expect(t.quelle).toMatch(/§ 32a EStG/);
    });

    it('Steuerklasse deckt I…VI ab', () => {
        const s = BUILTIN_ENUM_DEFS.find((e) => e.name === 'Steuerklasse')!;
        expect([...s.values]).toEqual(['I', 'II', 'III', 'IV', 'V', 'VI']);
    });
});

describe('Builtin-Funktionen', () => {
    it('Rundungsfunktionen sind definiert mit Ergebnistyp', () => {
        const fns = Object.fromEntries(
            BUILTIN_FUNCTION_DEFS.map((f) => [f.name, f.result]),
        );
        expect(fns.abrundenEuro).toBe('Euro');
        expect(fns.aufrundenEuro).toBe('Euro');
        expect(fns.abrundenCent).toBe('Cent');
        expect(fns.aufrundenCent).toBe('Cent');
    });
});

describe('Abgeleitete Helfer', () => {
    it('BUILTIN_PRIMITIVE_TYPES enthält die Geld- und Zahltypen', () => {
        for (const t of ['Euro', 'Cent', 'EuroCent', 'Ganzzahl', 'Dezimal', 'Prozent']) {
            expect(BUILTIN_PRIMITIVE_TYPES).toContain(t);
        }
    });

    it('BUILTIN_ENUM_VALUE_TO_ENUM mappt Werte auf ihren Typ', () => {
        expect(BUILTIN_ENUM_VALUE_TO_ENUM.get('Grundtarif')).toBe('Tarifart');
        expect(BUILTIN_ENUM_VALUE_TO_ENUM.get('III')).toBe('Steuerklasse');
        expect(BUILTIN_ENUM_VALUE_TO_ENUM.get('Monat')).toBe('Lohnzahlungszeitraum');
    });

    it('isBuiltinName erkennt Typen, Werte und Funktionen', () => {
        expect(isBuiltinName('Tarifart')).toBe(true);
        expect(isBuiltinName('Grundtarif')).toBe(true);
        expect(isBuiltinName('Euro')).toBe(true);
        expect(isBuiltinName('abrundenEuro')).toBe(true);
        expect(isBuiltinName('estGrundtarif')).toBe(false);
        expect(isBuiltinName('GFB')).toBe(false);
    });

    it('BUILTIN_NAMES ist die Vereinigung aller eingebauten Bezeichner', () => {
        expect(BUILTIN_NAMES.has('Splitting')).toBe(true);
        expect(BUILTIN_NAMES.has('Lohnzahlungszeitraum')).toBe(true);
        expect(BUILTIN_NAMES.has('Text')).toBe(true);
        expect(BUILTIN_NAMES.has('aufrundenCent')).toBe(true);
    });
});
