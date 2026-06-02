// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.util.ui.StartupUiUtil
import com.redhat.devtools.lsp4ij.LanguageServerFactory
import com.redhat.devtools.lsp4ij.server.OSProcessStreamConnectionProvider
import com.redhat.devtools.lsp4ij.server.StreamConnectionProvider
import java.nio.file.Path

/**
 * LSP4IJ-Einstiegspunkt: liefert den StreamConnectionProvider, der den
 * FinDSL-Language-Server startet. Die gesamte Sprachintelligenz liegt im
 * Server (`@findsl/core`) — dieses Plugin ist nur die dünne Präsentations-
 * schicht (analog zur VS-Code-Extension).
 */
class FinDslLanguageServerFactory : LanguageServerFactory {
    override fun createConnectionProvider(project: Project): StreamConnectionProvider =
        FinDslStreamConnectionProvider(project)
}

/**
 * Startet das native, Node-freie LSP-Server-Binary `findsl-lsp` (#239) mit
 * `--stdio`. Binary-Auflösung in dieser Reihenfolge:
 *
 *  1. Override `findsl.lsp.path` (System-Property) bzw. `FINDSL_LSP_PATH`
 *     (Umgebung) — für die lokale Entwicklung (zeigt z. B. auf
 *     `packages/lsp/dist/findsl-lsp`), ohne das Binary ins Plugin zu kopieren.
 *  2. Das ins Plugin gebündelte Binary aus `/server/findsl-lsp[.exe]`, das
 *     beim Start in ein Cache-Verzeichnis extrahiert und ausführbar gemacht
 *     wird.
 *
 * Die Hash-basierte Cache-Optimierung und die Lazy-Download-Distribution sind
 * #243 vorbehalten — hier wird bewusst einfach gehalten (bei jedem Start neu
 * geschrieben), Korrektheit vor Geschwindigkeit.
 */
class FinDslStreamConnectionProvider(project: Project) : OSProcessStreamConnectionProvider() {
    init {
        val server = resolveServerExecutable()
        val commandLine = GeneralCommandLine(server.toString(), "--stdio")
        project.basePath?.let { commandLine.withWorkDirectory(it) }
        super.setCommandLine(commandLine)
    }

    /**
     * Meldet dem Server das aktuelle IDE-Theme (#250): Hover-Formeln werden als
     * `file://`-SVG mit fester Farbe gerendert (IntelliJs SVG-Loader wertet keine
     * `prefers-color-scheme`-Query aus), daher muss der Server „dark" vs. „light"
     * kennen, damit die Formel auf dem Hover-Hintergrund lesbar ist. Wird beim
     * `initialize` als `initializationOptions.findsl.theme` übertragen.
     */
    override fun getInitializationOptions(rootUri: VirtualFile?): Any {
        val dark = runCatching { StartupUiUtil.isDarkTheme }.getOrDefault(false)
        return mapOf("findsl" to mapOf("theme" to if (dark) "dark" else "light"))
    }

    companion object {
        private fun resolveServerExecutable(): Path =
            FinDslNativeBinary.resolveOrExtract(
                exeBase = "findsl-lsp",
                resourceDir = "server",
                cacheSubdir = "findsl-lsp",
                sysProp = "findsl.lsp.path",
                envVar = "FINDSL_LSP_PATH",
                settingsPath = FinDslSettings.getInstance().lspPath(),
            )
    }
}
