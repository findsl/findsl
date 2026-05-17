/**
 * Unit-Tests für die Typ-Datenstruktur und die Subtyp-Regeln aus SPEC § 3.
 */

import { describe, it, expect } from 'vitest';
import {
    TCent,
    TDezimal,
    TEuro,
    TEuroCent,
    TGanzzahl,
    TNichts,
    TNull,
    TProzent,
    TUnknown,
    TWahrheit,
    assignable,
    isGeld,
    isNumeric,
    isWahrheit,
    typeEq,
    typeToString,
    type Type,
} from '../../src/language/findsl-types.js';

describe('isGeld / isNumeric / isWahrheit', () => {
    it('erkennt die drei Geldtypen', () => {
        expect(isGeld(TEuro)).toBe(true);
        expect(isGeld(TEuroCent)).toBe(true);
        expect(isGeld(TCent)).toBe(true);
        expect(isGeld(TDezimal)).toBe(false);
        expect(isGeld(TProzent)).toBe(false);
    });

    it('isNumeric umfasst Geld + Ganzzahl + Dezimal + Prozent', () => {
        expect(isNumeric(TEuro)).toBe(true);
        expect(isNumeric(TGanzzahl)).toBe(true);
        expect(isNumeric(TDezimal)).toBe(true);
        expect(isNumeric(TProzent)).toBe(true);
        expect(isNumeric(TWahrheit)).toBe(false);
    });

    it('isWahrheit akzeptiert beide Schreibweisen', () => {
        expect(isWahrheit(TWahrheit)).toBe(true);
        expect(isWahrheit({ kind: 'primitive', name: 'Wahrheit' })).toBe(true);
    });
});

describe('typeEq', () => {
    it('Primitive gleich nach Name', () => {
        expect(typeEq(TEuro, TEuro)).toBe(true);
        expect(typeEq(TEuro, TGanzzahl)).toBe(false);
    });

    it('Nullable gleich, wenn inner gleich', () => {
        expect(typeEq(TNull(TEuro), TNull(TEuro))).toBe(true);
        expect(typeEq(TNull(TEuro), TNull(TGanzzahl))).toBe(false);
    });

    it('Wahrheit ≡ Wahrheitswert', () => {
        const wt: Type = { kind: 'primitive', name: 'Wahrheit' };
        expect(typeEq(TWahrheit, wt)).toBe(true);
    });

    it('unknown ist mit sich selbst gleich', () => {
        expect(typeEq(TUnknown, TUnknown)).toBe(true);
    });
});

describe('assignable (Subtyping)', () => {
    it('reflexiv', () => {
        expect(assignable(TEuro, TEuro)).toBe(true);
    });

    it('Geld-Promotion: Euro → EuroCent → Cent', () => {
        expect(assignable(TEuro,     TEuroCent)).toBe(true);
        expect(assignable(TEuroCent, TCent)).toBe(true);
        expect(assignable(TEuro,     TCent)).toBe(true);
    });

    it('Keine Demotion: Cent → Euro verboten', () => {
        expect(assignable(TCent, TEuro)).toBe(false);
        expect(assignable(TEuroCent, TEuro)).toBe(false);
    });

    it('T <: T?', () => {
        expect(assignable(TEuro, TNull(TEuro))).toBe(true);
        expect(assignable(TGanzzahl, TNull(TGanzzahl))).toBe(true);
    });

    it('Geld-Promotion auch unter Nullable', () => {
        expect(assignable(TEuro, TNull(TCent))).toBe(true);
    });

    it('nichts passt in jedes Nullable', () => {
        expect(assignable(TNichts, TNull(TEuro))).toBe(true);
    });

    it('nichts passt NICHT in non-nullable', () => {
        expect(assignable(TNichts, TEuro)).toBe(false);
    });

    it('unknown ist überall zuweisungskompatibel (tolerant)', () => {
        expect(assignable(TUnknown, TEuro)).toBe(true);
        expect(assignable(TEuro, TUnknown)).toBe(true);
    });

    it('Verschiedene Primitive nicht kompatibel', () => {
        expect(assignable(TGanzzahl, TEuro)).toBe(false);
        expect(assignable(TProzent, TGanzzahl)).toBe(false);
    });
});

describe('typeToString', () => {
    it('Primitive zeigt Name', () => {
        expect(typeToString(TEuro)).toBe('Euro');
    });
    it('Nullable mit ?-Suffix', () => {
        expect(typeToString(TNull(TEuro))).toBe('Euro?');
    });
    it('Liste<T>', () => {
        const t: Type = { kind: 'list', element: TEuro };
        expect(typeToString(t)).toBe('Liste<Euro>');
    });
    it('Funktionstyp', () => {
        const t: Type = { kind: 'function', params: [TEuro, TGanzzahl], result: TEuro };
        expect(typeToString(t)).toBe('(Euro, Ganzzahl) -> Euro');
    });
    it('unknown wird kompakt dargestellt', () => {
        expect(typeToString(TUnknown)).toBe('?');
    });
});

describe('Idempotenz von TNull', () => {
    it('T?? ≡ T?', () => {
        const once = TNull(TEuro);
        const twice = TNull(once);
        expect(twice).toBe(once);
    });
});
