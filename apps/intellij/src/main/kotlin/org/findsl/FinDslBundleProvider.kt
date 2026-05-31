// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl

import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.logger
import org.jetbrains.plugins.textmate.api.TextMateBundleProvider
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/**
 * Stellt die `.findsl`-TextMate-Grammar als Bundle bereit, damit IntelliJ
 * Keywords, Kommentare und Strings einfärbt (syntaktisches Highlighting).
 *
 * Bewusst KEIN eigener `FileType`/`Language`: ein eigener FileType würde in
 * der Community Edition das TextMate-Highlighting deaktivieren. Die LSP-
 * Anbindung läuft daher über `fileNamePatternMapping` (siehe plugin.xml),
 * nicht über ein Language-Mapping.
 *
 * TextMate erwartet das Bundle als Verzeichnis auf der Platte — die im
 * Plugin-Jar liegenden Ressourcen werden hier in das IDE-System-Verzeichnis
 * extrahiert.
 */
class FinDslBundleProvider : TextMateBundleProvider {

    override fun getBundles(): List<TextMateBundleProvider.PluginBundle> {
        val dir = extractBundle() ?: return emptyList()
        return listOf(TextMateBundleProvider.PluginBundle("FinDSL", dir))
    }

    private fun extractBundle(): Path? = runCatching {
        val target = PathManager.getSystemDir().resolve("findsl-textmate")
        for (rel in BUNDLE_FILES) {
            val resource = "/textmate/findsl/$rel"
            val input = javaClass.getResourceAsStream(resource)
                ?: error("TextMate-Bundle-Ressource fehlt: $resource")
            val dest = target.resolve(rel)
            Files.createDirectories(dest.parent)
            input.use { Files.copy(it, dest, StandardCopyOption.REPLACE_EXISTING) }
        }
        target
    }.onFailure {
        LOG.warn("FinDSL-TextMate-Bundle konnte nicht bereitgestellt werden — kein Highlighting.", it)
    }.getOrNull()

    companion object {
        private val LOG = logger<FinDslBundleProvider>()
        private val BUNDLE_FILES = listOf("package.json", "syntaxes/findsl.tmLanguage.json")
    }
}
