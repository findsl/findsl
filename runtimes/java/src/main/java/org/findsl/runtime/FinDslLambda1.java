// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

/**
 * Einstelliges FinDSL-Lambda als Java-Functional-Interface — Ziel des
 * Lowerings für parametrische Lambdas {@code { p -> ausdruck }} (Spiegel
 * {@code values.ts FunctionValue.lambda} + {@code interpreter.ts
 * callClosure}). FinDSL ist single-assignment, daher sind erfasste
 * äußere Bindungen automatisch „effectively final" — Java-Lambda-Closure
 * bildet das Capture nativ ab.
 *
 * @param <A> Argumenttyp.
 * @param <R> Ergebnistyp.
 */
@FunctionalInterface
public interface FinDslLambda1<A, R> {

    /**
     * Wendet das Lambda einmal auf ein Argument an.
     *
     * @param arg Eingabewert.
     * @return Ergebnis der Lambda-Auswertung.
     */
    R apply(A arg);
}
