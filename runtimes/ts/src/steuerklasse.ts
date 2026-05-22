// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Eingebaute FinDSL-Aufzählung `Steuerklasse` (SPEC § 8.5) — kein Import
 * in FinDSL nötig, daher Teil der Runtime (Lohnsteuer-Kontext). Vergleich
 * per Identität (`===`) = Java-Enum-Identität. 1:1-Port von
 * `org.findsl.runtime.Steuerklasse`.
 */
export enum Steuerklasse {
    I,
    II,
    III,
    IV,
    V,
    VI,
}
