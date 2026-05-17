import { describe, it, expect } from 'vitest';
import { Environment } from '../../src/interpret/environment.js';
import { InterpretError, NumericValue, WAHR } from '../../src/interpret/values.js';

describe('Environment', () => {
    it('define + lookup im selben Frame', () => {
        const env = new Environment();
        env.define('x', NumericValue.ganzzahl(42));
        const v = env.lookup('x');
        expect(v?.kind).toBe('numeric');
    });

    it('lookup im Parent', () => {
        const parent = new Environment();
        parent.define('x', WAHR);
        const child = parent.child();
        expect(child.lookup('x')?.kind).toBe('bool');
    });

    it('Kind-Frame schattiert Parent (falls neu definiert)', () => {
        const parent = new Environment();
        parent.define('x', NumericValue.ganzzahl(1));
        const child = parent.child();
        child.define('x', NumericValue.ganzzahl(2));
        expect((child.lookup('x') as NumericValue).value.toString()).toBe('2');
        expect((parent.lookup('x') as NumericValue).value.toString()).toBe('1');
    });

    it('Mehrfach-Deklaration im selben Frame wirft', () => {
        const env = new Environment();
        env.define('x', WAHR);
        expect(() => env.define('x', WAHR)).toThrow(InterpretError);
    });

    it('lookup auf unbekannten Namen → undefined', () => {
        const env = new Environment();
        expect(env.lookup('unbekannt')).toBeUndefined();
    });

    it('has() berücksichtigt Parent-Chain', () => {
        const parent = new Environment();
        parent.define('x', WAHR);
        const child = parent.child();
        expect(child.has('x')).toBe(true);
        expect(child.has('y')).toBe(false);
    });
});
