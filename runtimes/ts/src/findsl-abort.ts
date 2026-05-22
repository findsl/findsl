// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Spiegel des FinDSL-`abbruch`-Ausdrucks (SPEC § 4.19, ADR4) —
 * `values.ts AbbruchSignal`. 1:1-Port von `org.findsl.runtime.FinDslAbort`.
 *
 * Generierter Code fängt sie nie; sie propagiert bis zur Lauf-Grenze.
 * Generierte Vitest-Tests prüfen einen erwarteten Abbruch via
 * `expect(() => …).toThrow(FinDslAbort)` (`erwartet abbruch`).
 */
export class FinDslAbort extends Error {
    readonly reason: string;

    constructor(reason: string) {
        super('abbruch: ' + reason);
        this.name = 'FinDslAbort';
        this.reason = reason;
    }
}
