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
    LIST_METHOD_DEFS,
    SCALAR_METHOD_DEFS,
    TEXT_METHOD_DEFS,
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

describe('Builtin-Methoden-Kataloge (seit 2026-05-18, § 11)', () => {
    it('keine freien Builtin-Funktionen mehr (§ 11.1 ist Methode)', () => {
        expect(BUILTIN_FUNCTION_DEFS).toEqual([]);
    });

    it('SCALAR_METHOD_DEFS deckt abrunden/aufrunden ab (§ 11.1)', () => {
        const names = SCALAR_METHOD_DEFS.map((m) => m.name);
        expect(names).toEqual(['abrunden', 'aufrunden']);
        expect(SCALAR_METHOD_DEFS.every((m) => m.property === false)).toBe(true);
    });

    it('TEXT_METHOD_DEFS: Properties + Aufruf-Methoden (§ 11.5)', () => {
        const byName = Object.fromEntries(TEXT_METHOD_DEFS.map((m) => [m.name, m]));
        expect(byName['länge'].property).toBe(true);
        expect(byName['leer'].property).toBe(true);
        expect(byName['alsText'].property).toBe(true);
        expect(byName['einrückungEntfernen'].property).toBe(false);
        expect(byName['geteiltAn'].property).toBe(false);
    });

    it('LIST_METHOD_DEFS unverändert vorhanden (§ 11.2)', () => {
        expect(LIST_METHOD_DEFS.map((m) => m.name)).toContain('zuordnen');
        expect(LIST_METHOD_DEFS.map((m) => m.name)).toContain('summe');
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

    it('isBuiltinName erkennt Typen + Aufzählungs-Werte (keine freien Fn mehr)', () => {
        expect(isBuiltinName('Tarifart')).toBe(true);
        expect(isBuiltinName('Grundtarif')).toBe(true);
        expect(isBuiltinName('Euro')).toBe(true);
        // Freie Rundungsfunktionen entfernt (jetzt Methoden) → kein Builtin-Name:
        expect(isBuiltinName('abrundenEuro')).toBe(false);
        expect(isBuiltinName('estGrundtarif')).toBe(false);
        expect(isBuiltinName('GFB')).toBe(false);
    });

    it('BUILTIN_NAMES ist die Vereinigung aller eingebauten Bezeichner', () => {
        expect(BUILTIN_NAMES.has('Splitting')).toBe(true);
        expect(BUILTIN_NAMES.has('Lohnzahlungszeitraum')).toBe(true);
        expect(BUILTIN_NAMES.has('Text')).toBe(true);
        // Methoden-Namen sind KEINE freistehenden Builtin-Bezeichner:
        expect(BUILTIN_NAMES.has('aufrundenCent')).toBe(false);
        expect(BUILTIN_NAMES.has('abrunden')).toBe(false);
    });
});
