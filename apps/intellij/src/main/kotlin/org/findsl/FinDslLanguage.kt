// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl

import com.intellij.lang.Language

/**
 * IntelliJ-`Language`-Anker für FinDSL. Die ID `FINDSL` verbindet den
 * [FinDslFileType] mit dem LSP4IJ-`languageMapping` (siehe plugin.xml).
 * Die eigentliche Sprachintelligenz liefert der externe LSP-Server.
 */
object FinDslLanguage : Language("FINDSL") {
    private fun readResolve(): Any = FinDslLanguage
    override fun getDisplayName(): String = "FinDSL"
}
