// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Eingebaute FinDSL-Aufzählung `Tarifart` — kein Import in FinDSL nötig,
 * daher Teil der Runtime (Einkommensteuer-Kontext). Vergleich per
 * Identität (`===`). 1:1-Port von `org.findsl.runtime.Tarifart`.
 */
export enum Tarifart {
    /** Grundtarif (§ 32a Abs. 1 EStG). */
    Grundtarif,
    /** Splitting-Verfahren (§ 32a Abs. 5 EStG). */
    Splitting,
}
