// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Direkter Runtime-Unit-Test für `nichtNull` (Force-Unwrap `!!`, #117) —
 * lockt die Orakel-Parität, die das Differential-Gate NICHT abdeckt: der
 * Korpus übt `!!` nur auf nicht-`nichts` aus (kein `erwartet`-Fall für
 * Nicht-Abbruch-Laufzeitfehler im `prüfe`). Ohne diesen Test bliebe ein
 * Umstellen von `nichtNull` auf `FinDslAbort` unbemerkt (PR #124-Review M1).
 *
 * Orakel (`interpreter.ts`): `!!`-von-`nichts` wirft `InterpretError` —
 * KEIN `AbbruchSignal`. TS-Mirror: `FinDslRuntimeError`, NICHT `FinDslAbort`.
 */

import { describe, it, expect } from 'vitest';
import { nichtNull } from '../../../../runtimes/ts/src/findsl-nullable.js';
import { FinDslNumber, FinDslRuntimeError } from '../../../../runtimes/ts/src/findsl-number.js';
import { FinDslAbort } from '../../../../runtimes/ts/src/findsl-abort.js';

describe('nichtNull — Force-Unwrap-Parität (§ 4.7)', () => {
    it('nicht-nichts → durchgereicht (identische Referenz)', () => {
        const x = FinDslNumber.ganzzahl('42');
        expect(nichtNull(x, '!! Test')).toBe(x);
    });

    it('null → wirft FinDslRuntimeError (KEIN Abbruch — Orakel-treu)', () => {
        expect(() => nichtNull<FinDslNumber>(null, '!! auf nichts')).toThrow(FinDslRuntimeError);
        // Explizit absichern, dass es NICHT als Abbruch propagiert.
        try {
            nichtNull<FinDslNumber>(null, '!! auf nichts');
            expect.unreachable('nichtNull(null) hätte werfen müssen');
        } catch (err) {
            expect(err).toBeInstanceOf(FinDslRuntimeError);
            expect(err).not.toBeInstanceOf(FinDslAbort);
        }
    });
});
