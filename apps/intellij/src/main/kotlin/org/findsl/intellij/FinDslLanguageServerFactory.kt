// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.SystemInfo
import com.redhat.devtools.lsp4ij.LanguageServerFactory
import com.redhat.devtools.lsp4ij.server.OSProcessStreamConnectionProvider
import com.redhat.devtools.lsp4ij.server.StreamConnectionProvider
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermission

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

    companion object {
        private val LOG = logger<FinDslStreamConnectionProvider>()
        private val EXE = if (SystemInfo.isWindows) "findsl-lsp.exe" else "findsl-lsp"

        private fun resolveServerExecutable(): Path {
            val override = System.getProperty("findsl.lsp.path")
                ?: System.getenv("FINDSL_LSP_PATH")
            if (!override.isNullOrBlank()) {
                val path = Path.of(override)
                if (Files.isExecutable(path)) return path
                LOG.warn("findsl.lsp.path/FINDSL_LSP_PATH=$override ist nicht ausführbar — wird ignoriert.")
            }
            return extractBundledServer()
        }

        private fun extractBundledServer(): Path {
            val resource = "/server/$EXE"
            val input = FinDslStreamConnectionProvider::class.java.getResourceAsStream(resource)
                ?: throw IllegalStateException(
                    "FinDSL-LSP-Binary nicht im Plugin gefunden ($resource). Im Dev-Build "
                        + "`npm run binary:lsp` (Repo-Root) ausführen oder FINDSL_LSP_PATH setzen.",
                )
            // Per-User IDE-System-Verzeichnis — NICHT das welt-schreibbare
            // java.io.tmpdir: dort könnte ein anderer lokaler Nutzer/Prozess das
            // Binary unterschieben, das die IDE dann ausführt (lokale Code-
            // Ausführung). Konsistent mit FinDslBundleProvider.
            val cacheDir = PathManager.getSystemDir().resolve("findsl-lsp")
            Files.createDirectories(cacheDir)
            restrictToOwner(cacheDir)
            val target = cacheDir.resolve(EXE)
            input.use { Files.copy(it, target, StandardCopyOption.REPLACE_EXISTING) }
            restrictToOwner(target)
            return target
        }

        /**
         * Beschränkt Datei/Verzeichnis auf den Eigentümer (`rwx------`) — kein
         * Group-/Others-Zugriff, damit kein anderer lokaler Nutzer das
         * extrahierte Binary lesen oder ersetzen kann. No-op auf Windows (kein
         * POSIX). Das Owner-Execute-Bit macht das Binary zugleich lauffähig.
         */
        private fun restrictToOwner(path: Path) {
            if (SystemInfo.isWindows) return
            runCatching {
                Files.setPosixFilePermissions(
                    path,
                    setOf(
                        PosixFilePermission.OWNER_READ,
                        PosixFilePermission.OWNER_WRITE,
                        PosixFilePermission.OWNER_EXECUTE,
                    ),
                )
            }.onFailure { LOG.warn("Owner-only-Berechtigungen für $path fehlgeschlagen", it) }
        }
    }
}
