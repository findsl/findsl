// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl

import com.intellij.openapi.util.IconLoader

/** Datei-Icon für `.findsl` (IntelliJ wählt anhand `findsl_dark.svg` Light/Dark). */
object FinDslIcons {
    @JvmField
    val FILE = IconLoader.getIcon("/icons/findsl.svg", FinDslIcons::class.java)
}
