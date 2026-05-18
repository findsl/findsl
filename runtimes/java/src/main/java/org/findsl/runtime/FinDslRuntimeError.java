// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

/**
 * Spiegel von {@code values.ts InterpretError} (ADR4) — ein
 * Programmier-/Modellfehler (Division durch Null, fraktionaler
 * Euro/Cent an einer Annotation, Index außerhalb des Bereichs …),
 * <b>nicht</b> der fachliche {@link FinDslAbort}.
 *
 * <p>Unchecked. Im Orakel ist das die {@code 'error'}-Klassifikation
 * (≠ pass/fail/abbruch). Der Codegenerator lehnt Module ab, deren
 * Orakel-Lauf {@code error} ergibt (Gate 4) — produktionsreifer
 * generierter Code darf dies nie auslösen (der Type-Checker fängt es
 * vorher ab).
 */
public final class FinDslRuntimeError extends RuntimeException {

    private static final long serialVersionUID = 1L;

    public FinDslRuntimeError(String message) {
        super(message);
    }
}
