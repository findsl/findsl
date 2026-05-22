// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Direkte Unit-Tests der TS-Runtime `FinDslListe` (§ 11.2) gegen den
 * Interpreter-ORAKEL-Kontrakt — ergänzend zum Differential-Gate, das nur
 * die vom Korpus-`prüfe` ausgeübten Pfade abdeckt. Insbesondere die
 * Totalität von `.rest` auf leerer Liste (PR #109-Review HIGH): das Orakel
 * (`interpreter.ts`) liefert dort `[]`, KEINEN Wurf — anders als `kopf`/
 * `größtes`/`kleinstes`.
 */

import { describe, it, expect } from 'vitest';
// Direkter Import der Runtime-Quelle (vom Differential-Gate sonst nur
// eingebettet/generiert konsumiert).
import { FinDslListe } from '../../../../runtimes/ts/src/findsl-liste.js';
import { FinDslNumber, FinDslRuntimeError } from '../../../../runtimes/ts/src/findsl-number.js';

const g = (n: string): FinDslNumber => FinDslNumber.ganzzahl(n);

describe('FinDslListe — Orakel-Kontrakt (§ 11.2)', () => {
    describe('.rest — total (Orakel els.slice(1))', () => {
        it('leere Liste → leere Liste (KEIN Wurf)', () => {
            const r = FinDslListe.empty<FinDslNumber>().rest();
            expect(r.leer()).toBe(true);
            expect(r.elements.length).toBe(0);
        });

        it('[a, b, c] → [b, c]', () => {
            const r = FinDslListe.of([g('1'), g('2'), g('3')]).rest();
            expect(r.elements.length).toBe(2);
            expect(r.kopf().equalsValue(g('2'))).toBe(true);
        });
    });

    describe('werfende Methoden (Orakel-Bug-Klasse: nur kopf/größtes/kleinstes)', () => {
        it('.kopf auf leerer Liste wirft', () => {
            expect(() => FinDslListe.empty<FinDslNumber>().kopf())
                .toThrow(FinDslRuntimeError);
        });
        it('.größtes / .kleinstes auf leerer Liste werfen', () => {
            expect(() => FinDslListe.empty<FinDslNumber>().groesstes())
                .toThrow(FinDslRuntimeError);
            expect(() => FinDslListe.empty<FinDslNumber>().kleinstes())
                .toThrow(FinDslRuntimeError);
        });
    });

    describe('.summe — D1 (leere Liste → Ganzzahl 0)', () => {
        it('leere Liste → 0', () => {
            expect(FinDslListe.empty<FinDslNumber>().summe().equalsValue(g('0'))).toBe(true);
        });
        it('[2, 3, 5] → 10', () => {
            expect(FinDslListe.of([g('2'), g('3'), g('5')]).summe().equalsValue(g('10'))).toBe(true);
        });
    });

    describe('Basis-Methoden', () => {
        it('.länge / .leer / .enthält', () => {
            const xs = FinDslListe.of([g('1'), g('2')]);
            expect(xs.laenge().equalsValue(g('2'))).toBe(true);
            expect(xs.leer()).toBe(false);
            expect(xs.enthaelt(g('2'))).toBe(true);
            expect(xs.enthaelt(g('9'))).toBe(false);
        });

        it('.zuordnen bewahrt Reihenfolge', () => {
            const ys = FinDslListe.of([g('1'), g('2'), g('3')])
                .zuordnen((x) => x.add(g('10')));
            expect(ys.elements.map((e) => e.asText())).toEqual(['11', '12', '13']);
        });

        it('.bereich materialisiert inklusiv', () => {
            const r = FinDslListe.bereich(g('1'), g('3'), false, null);
            expect(r.elements.map((e) => e.asText())).toEqual(['1', '2', '3']);
        });
    });
});
