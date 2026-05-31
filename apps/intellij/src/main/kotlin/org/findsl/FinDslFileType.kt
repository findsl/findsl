// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl

import com.intellij.openapi.fileTypes.LanguageFileType
import javax.swing.Icon

/**
 * `.findsl`-Dateityp. Bindet die Endung an [FinDslLanguage]; über das
 * LSP4IJ-`languageMapping` (plugin.xml) startet die IDE dafür den FinDSL-
 * Language-Server. Syntax-Highlighting kommt über LSP Semantic Tokens.
 */
object FinDslFileType : LanguageFileType(FinDslLanguage) {
    override fun getName(): String = "FinDSL"

    override fun getDescription(): String =
        "FinDSL — domänenspezifische Sprache für die deutsche steuerliche Finanzverwaltung"

    override fun getDefaultExtension(): String = "findsl"

    override fun getIcon(): Icon = FinDslIcons.FILE
}
