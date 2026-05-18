// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

/**
 * Spiegel des FinDSL-{@code abbruch}-Ausdrucks (SPEC § 4.19, ADR4) —
 * {@code values.ts AbbruchSignal}.
 *
 * <p>Bewusst eine <b>unchecked</b> {@link RuntimeException}: generierter
 * Code fängt sie nie (analog dazu, dass kein {@code evalExpr}-Pfad sie
 * fängt); sie propagiert bis zur Lauf-Grenze. Generierte JUnit-Tests
 * prüfen einen erwarteten Abbruch über
 * {@code assertThrows(FinDslAbort.class, …)} ({@code erwartet abbruch}).
 */
public final class FinDslAbort extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final String reason;

    public FinDslAbort(String reason) {
        super("abbruch: " + reason);
        this.reason = reason;
    }

    /** Die Fachbegründung (inkl. evtl. §-Referenz) — ohne Präfix. */
    public String reason() {
        return reason;
    }
}
