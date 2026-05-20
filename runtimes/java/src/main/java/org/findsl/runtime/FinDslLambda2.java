// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

/**
 * Zweistelliges FinDSL-Lambda als Java-Functional-Interface — Ziel des
 * Lowerings für parametrische 2-arg-Lambdas {@code { a, b -> ausdruck }},
 * insbesondere als Argument von {@code Liste.zusammenfassen(start, fn)}
 * (SPEC § 11.2 Fold/Reduce). Spiegel {@code values.ts FunctionValue.lambda}
 * + {@code interpreter.ts callClosure}. FinDSL ist single-assignment,
 * daher sind erfasste äußere Bindungen automatisch „effectively final" —
 * Java-Lambda-Closure bildet das Capture nativ ab.
 *
 * @param <A> Typ des ersten Arguments (Akkumulator).
 * @param <B> Typ des zweiten Arguments (Listenelement).
 * @param <R> Ergebnistyp (= Akkumulator-Typ bei Fold).
 */
@FunctionalInterface
public interface FinDslLambda2<A, B, R> {

    /**
     * Wendet das Lambda einmal auf zwei Argumente an.
     *
     * @param a erstes Argument (Akkumulator bei Fold).
     * @param b zweites Argument (Listenelement bei Fold).
     * @return Ergebnis der Lambda-Auswertung.
     */
    R apply(A a, B b);
}
