import { describe, it, expect } from 'vitest';
import {
    BoolValue,
    FALSCH,
    InterpretError,
    ListValue,
    NICHTS,
    NumericValue,
    RecordValue,
    StringValue,
    SymbolValue,
    WAHR,
    isTruthy,
    parseNumberLiteral,
    valueToString,
    valuesCompare,
    valuesEqual,
} from '../../src/interpret/values.js';

describe('parseNumberLiteral', () => {
    it('erkennt Ganzzahl mit Tausender-Trenner', () => {
        const v = parseNumberLiteral('12.096');
        expect(v.tag).toBe('Ganzzahl');
        expect(v.value.toString()).toBe('12096');
    });

    it('erkennt Dezimal mit Komma-Bruch', () => {
        const v = parseNumberLiteral('932,30');
        expect(v.tag).toBe('Dezimal');
        expect(v.value.toString()).toBe('932.3');
    });

    it('Prozent wird zu Bruchzahl', () => {
        const v = parseNumberLiteral('42%');
        expect(v.tag).toBe('Prozent');
        expect(v.value.toString()).toBe('0.42');
    });

    it('Prozent mit Nachkommastellen', () => {
        const v = parseNumberLiteral('9,3%');
        expect(v.tag).toBe('Prozent');
        expect(v.value.toString()).toBe('0.093');
    });

    it('Tausender-Punkt entfernt, Komma wird Dezimaltrenner', () => {
        expect(parseNumberLiteral('1.000.000').value.toString()).toBe('1000000');
        expect(parseNumberLiteral('1.234,56').value.toString()).toBe('1234.56');
    });
});

describe('valuesEqual', () => {
    it('numeric: gleiche Decimal-Werte mit unterschiedlichem Tag sind gleich', () => {
        expect(valuesEqual(NumericValue.euro(100), NumericValue.ganzzahl(100))).toBe(true);
    });

    it('numeric: ungleiche Werte sind ungleich', () => {
        expect(valuesEqual(NumericValue.euro(100), NumericValue.euro(101))).toBe(false);
    });

    it('Symbol: nach Name', () => {
        expect(valuesEqual(new SymbolValue('Grundtarif'), new SymbolValue('Grundtarif'))).toBe(true);
        expect(valuesEqual(new SymbolValue('Grundtarif'), new SymbolValue('Splitting'))).toBe(false);
    });

    it('Record: gleicher Typ und Felder', () => {
        const a = new RecordValue('Pt', new Map([['x', NumericValue.ganzzahl(1)], ['y', NumericValue.ganzzahl(2)]]));
        const b = new RecordValue('Pt', new Map([['x', NumericValue.ganzzahl(1)], ['y', NumericValue.ganzzahl(2)]]));
        const c = new RecordValue('Pt', new Map([['x', NumericValue.ganzzahl(1)], ['y', NumericValue.ganzzahl(3)]]));
        expect(valuesEqual(a, b)).toBe(true);
        expect(valuesEqual(a, c)).toBe(false);
    });

    it('Record: unterschiedlicher Typ → ungleich', () => {
        const a = new RecordValue('A', new Map([['x', NumericValue.ganzzahl(1)]]));
        const b = new RecordValue('B', new Map([['x', NumericValue.ganzzahl(1)]]));
        expect(valuesEqual(a, b)).toBe(false);
    });

    it('null == null', () => {
        expect(valuesEqual(NICHTS, NICHTS)).toBe(true);
    });

    it('unterschiedliche Kinds sind ungleich', () => {
        expect(valuesEqual(NICHTS, FALSCH)).toBe(false);
        expect(valuesEqual(WAHR, NumericValue.ganzzahl(1))).toBe(false);
    });

    it('Bool nach Wert', () => {
        expect(valuesEqual(WAHR, WAHR)).toBe(true);
        expect(valuesEqual(WAHR, FALSCH)).toBe(false);
        expect(valuesEqual(WAHR, new BoolValue(true))).toBe(true);
    });

    it('String nach Wert', () => {
        expect(valuesEqual(new StringValue('a'), new StringValue('a'))).toBe(true);
        expect(valuesEqual(new StringValue('a'), new StringValue('b'))).toBe(false);
    });
});

describe('valuesCompare', () => {
    it('numerisch links < rechts', () => {
        expect(valuesCompare(NumericValue.ganzzahl(1), NumericValue.ganzzahl(2))).toBeLessThan(0);
    });

    it('numerisch gleich', () => {
        expect(valuesCompare(NumericValue.euro(50), NumericValue.dezimal(50))).toBe(0);
    });

    it('String-Vergleich', () => {
        expect(valuesCompare(new StringValue('a'), new StringValue('b'))).toBeLessThan(0);
    });

    it('Kind-Mismatch wirft', () => {
        expect(() => valuesCompare(WAHR, NumericValue.ganzzahl(1)))
            .toThrow(InterpretError);
    });
});

describe('valueToString', () => {
    it('Prozent zeigt %-Suffix (Komma-Dezimal, Leerzeichen)', () => {
        expect(valueToString(NumericValue.prozent(0.42))).toBe('42 %');
    });

    it('Euro: deutscher Tausender-Trenner, kein Suffix', () => {
        expect(valueToString(NumericValue.euro(12096))).toBe('12.096');
    });

    it('Bool zeigt deutsche Keywords', () => {
        expect(valueToString(WAHR)).toBe('wahr');
        expect(valueToString(FALSCH)).toBe('falsch');
    });

    it('nichts wird gedruckt', () => {
        expect(valueToString(NICHTS)).toBe('nichts');
    });

    it('Symbol als Bare-Name', () => {
        expect(valueToString(new SymbolValue('Grundtarif'))).toBe('Grundtarif');
    });

    it('Record: Typ(felder)', () => {
        const r = new RecordValue('Pt', new Map([
            ['x', NumericValue.ganzzahl(1)],
            ['y', NumericValue.ganzzahl(2)],
        ]));
        expect(valueToString(r)).toBe('Pt(x = 1, y = 2)');
    });

    it('String quoted', () => {
        expect(valueToString(new StringValue('hi'))).toBe('"hi"');
    });
});

describe('ListValue', () => {
    it('Konstruktion: kind und elements', () => {
        const l = new ListValue([NumericValue.ganzzahl(1), NumericValue.ganzzahl(2)]);
        expect(l.kind).toBe('list');
        expect(l.elements.length).toBe(2);
    });

    it('valuesEqual: gleiche Länge + elementweise gleich (tag-agnostisch)', () => {
        const a = new ListValue([NumericValue.euro(100), NumericValue.ganzzahl(2)]);
        const b = new ListValue([NumericValue.ganzzahl(100), NumericValue.euro(2)]);
        expect(valuesEqual(a, b)).toBe(true);
    });

    it('valuesEqual: leere Listen gleich', () => {
        expect(valuesEqual(new ListValue([]), new ListValue([]))).toBe(true);
    });

    it('valuesEqual: ungleiche Länge / ungleiche Elemente', () => {
        const a = new ListValue([NumericValue.ganzzahl(1)]);
        const b = new ListValue([NumericValue.ganzzahl(1), NumericValue.ganzzahl(2)]);
        const c = new ListValue([NumericValue.ganzzahl(9)]);
        expect(valuesEqual(a, b)).toBe(false);
        expect(valuesEqual(a, c)).toBe(false);
    });

    it('valuesEqual: verschachtelte Listen strukturell', () => {
        const a = new ListValue([new ListValue([NumericValue.ganzzahl(1)])]);
        const b = new ListValue([new ListValue([NumericValue.ganzzahl(1)])]);
        const c = new ListValue([new ListValue([NumericValue.ganzzahl(2)])]);
        expect(valuesEqual(a, b)).toBe(true);
        expect(valuesEqual(a, c)).toBe(false);
    });

    it('valuesEqual: Liste vs. Nicht-Liste → ungleich', () => {
        expect(valuesEqual(new ListValue([]), NICHTS)).toBe(false);
        expect(valuesEqual(new ListValue([NumericValue.ganzzahl(1)]), NumericValue.ganzzahl(1)))
            .toBe(false);
    });

    it('valuesCompare: Listen sind nicht ordnungsvergleichbar → wirft', () => {
        expect(() => valuesCompare(new ListValue([]), new ListValue([])))
            .toThrow(InterpretError);
    });

    it('valueToString: eckige Klammern, Komma-getrennt, Elemente rekursiv', () => {
        expect(valueToString(new ListValue([]))).toBe('[]');
        expect(valueToString(new ListValue([
            NumericValue.ganzzahl(1),
            NumericValue.ganzzahl(2),
            NumericValue.ganzzahl(3),
        ]))).toBe('[1, 2, 3]');
        expect(valueToString(new ListValue([new StringValue('a')]))).toBe('["a"]');
        expect(valueToString(new ListValue([
            new ListValue([NumericValue.ganzzahl(1)]),
            new ListValue([NumericValue.ganzzahl(2)]),
        ]))).toBe('[[1], [2]]');
    });

    it('isTruthy: Liste ist kein Wahrheitswert → wirft', () => {
        expect(() => isTruthy(new ListValue([]))).toThrow(InterpretError);
    });
});

describe('isTruthy', () => {
    it('Bool wahr → true', () => {
        expect(isTruthy(WAHR)).toBe(true);
    });

    it('Bool falsch → false', () => {
        expect(isTruthy(FALSCH)).toBe(false);
    });

    it('Nicht-Bool wirft', () => {
        expect(() => isTruthy(NumericValue.ganzzahl(1))).toThrow(InterpretError);
        expect(() => isTruthy(NICHTS)).toThrow(InterpretError);
    });
});
