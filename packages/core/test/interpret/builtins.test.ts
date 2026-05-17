import { describe, it, expect } from 'vitest';
import { Environment } from '../../src/interpret/environment.js';
import { registerBuiltins } from '../../src/interpret/builtins.js';
import {
    BuiltinValue,
    InterpretError,
    NumericValue,
    WAHR,
    type Value,
} from '../../src/interpret/values.js';

function abrunden(): (args: ReadonlyArray<Value>) => Value {
    const env = new Environment();
    registerBuiltins((name, value) => env.define(name, value));
    const fn = env.lookup('abrundenEuro');
    if (!fn || fn.kind !== 'builtin') throw new Error('abrundenEuro nicht registriert');
    return (fn as BuiltinValue).impl;
}

describe('abrundenEuro', () => {
    it('positive Dezimal wird auf volle Euro abgerundet', () => {
        const result = abrunden()([NumericValue.dezimal('485.18')]) as NumericValue;
        expect(result.value.toString()).toBe('485');
        expect(result.tag).toBe('Euro');
    });

    it('schon ganze Zahl bleibt unverändert', () => {
        const result = abrunden()([NumericValue.ganzzahl(12096)]) as NumericValue;
        expect(result.value.toString()).toBe('12096');
        expect(result.tag).toBe('Euro');
    });

    it('negative Werte werden Richtung minus-Unendlich abgerundet (FLOOR)', () => {
        const result = abrunden()([NumericValue.dezimal('-0.5')]) as NumericValue;
        expect(result.value.toString()).toBe('-1');
    });

    it('Bruch unter 0.5 wird abgeschnitten', () => {
        const result = abrunden()([NumericValue.dezimal('10245.11')]) as NumericValue;
        expect(result.value.toString()).toBe('10245');
    });

    it('Bruch über 0.5 wird ebenfalls abgeschnitten (kein kaufmännisches Runden)', () => {
        const result = abrunden()([NumericValue.dezimal('10245.99')]) as NumericValue;
        expect(result.value.toString()).toBe('10245');
    });

    it('falsche Argumentanzahl wirft', () => {
        expect(() => abrunden()([])).toThrow(InterpretError);
        expect(() => abrunden()([NumericValue.ganzzahl(1), NumericValue.ganzzahl(2)])).toThrow(InterpretError);
    });

    it('Nicht-numerischer Wert wirft', () => {
        expect(() => abrunden()([WAHR])).toThrow(InterpretError);
    });
});
