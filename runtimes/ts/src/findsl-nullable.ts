// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

import { FinDslRuntimeError } from './findsl-number.js';

/**
 * Force-Unwrap (`!!`, SPEC § 4.7) — TS-Pendant zu Java
 * `Objects.requireNonNull`. Liefert den Wert, wenn er nicht `null`
 * (`nichts`) ist; sonst wirft ein {@link FinDslRuntimeError} mit dem
 * Quell-Hint.
 *
 * Orakel-treu: der Interpreter wirft auf `!!`-von-`nichts` einen
 * `InterpretError` (KEIN Abbruch, `interpreter.ts`) — entsprechend ist
 * dies ein {@link FinDslRuntimeError}, nicht ein `FinDslAbort`.
 */
export function nichtNull<T>(value: T | null, hint: string): T {
    if (value === null) {
        throw new FinDslRuntimeError(hint);
    }
    return value;
}
