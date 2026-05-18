// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

/**
 * Eingebaute FinDSL-Aufzählung {@code Tarifart} (SPEC § 8.5) — kein
 * Import in FinDSL nötig, daher Teil der Runtime (Spiegel der global
 * registrierten {@code SymbolValue}s des Interpreters). Vergleich per
 * Name = Java-Enum-Identität.
 */
public enum Tarifart {
    /** Grundtarif (§ 32a Abs. 1 EStG). */
    Grundtarif,
    /** Splitting-Verfahren (§ 32a Abs. 5 EStG). */
    Splitting
}
