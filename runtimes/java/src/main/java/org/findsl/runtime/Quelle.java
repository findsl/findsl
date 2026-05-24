// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Repeatable;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Gesetzliche Quelle einer generierten Deklaration (SPEC § 7, P4) — 1:1 aus
 * der FinDSL-{@code @Quelle("…")}-Annotation. {@code RUNTIME}-Retention,
 * damit Audit-/Reflection-Tooling die Norm-Verweise zur Laufzeit auswerten
 * kann. Wiederholbar (mehrere {@code @Quelle} je Element); der Compiler
 * bündelt sie automatisch in {@link Quellen}.
 */
@Documented
@Retention(RetentionPolicy.RUNTIME)
@Target({ ElementType.TYPE, ElementType.METHOD, ElementType.FIELD })
@Repeatable(Quellen.class)
public @interface Quelle {
    /** Norm-Verweis, z. B. {@code "§ 23 Absatz 1 KStG"}. */
    String value();
}
