// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

/**
 * Eingebaute FinDSL-Aufzählung {@code Steuerklasse} (SPEC § 8.5) — kein
 * Import in FinDSL nötig, daher Teil der Runtime (Lohnsteuer-Kontext).
 * Vergleich per Name = Java-Enum-Identität.
 */
public enum Steuerklasse {
    I,
    II,
    III,
    IV,
    V,
    VI
}
