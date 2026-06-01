// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.util.SystemInfo
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermission

/**
 * Löst die ins Plugin gebündelten nativen FinDSL-Binaries auf — den
 * LSP-Server (`findsl-lsp`, #239/#240) UND das CLI (`findsl`, für den
 * Test-Runner #256). Beide sind Node-SEA-Binaries und teilen dieselbe
 * Auflösungs-/Extraktionsstrategie (und vor allem dieselbe Sicherheits-
 * absicherung), daher hier zentral statt dupliziert.
 *
 * Reihenfolge:
 *  1. Override `<sysProp>` (System-Property) bzw. `<envVar>` (Umgebung) — für
 *     die lokale Entwicklung (zeigt z. B. auf `packages/lsp/dist/findsl-lsp`),
 *     ohne das Binary ins Plugin zu kopieren.
 *  2. Das gebündelte Binary aus `/<resourceDir>/<exe>`, extrahiert in ein
 *     per-User-Cacheverzeichnis und ausführbar gemacht.
 *
 * Die Hash-basierte Cache-Optimierung und die Lazy-Download-Distribution sind
 * #243 vorbehalten — hier bewusst einfach (bei jedem Start neu geschrieben),
 * Korrektheit vor Geschwindigkeit.
 */
object FinDslNativeBinary {
    private val LOG = logger<FinDslNativeBinary>()

    /**
     * @param exeBase   Basisname ohne Endung (`findsl-lsp` / `findsl`).
     * @param resourceDir Plugin-Ressourcen-Unterordner (`server` / `cli`).
     * @param cacheSubdir Unterordner im IDE-System-Verzeichnis (`findsl-lsp` / `findsl-cli`).
     * @param sysProp   System-Property-Override (`findsl.lsp.path` / `findsl.cli.path`).
     * @param envVar    Umgebungsvariablen-Override (`FINDSL_LSP_PATH` / `FINDSL_CLI_PATH`).
     */
    fun resolveOrExtract(
        exeBase: String,
        resourceDir: String,
        cacheSubdir: String,
        sysProp: String,
        envVar: String,
    ): Path {
        val exe = if (SystemInfo.isWindows) "$exeBase.exe" else exeBase

        val override = System.getProperty(sysProp) ?: System.getenv(envVar)
        if (!override.isNullOrBlank()) {
            val path = Path.of(override)
            if (Files.isExecutable(path)) return path
            LOG.warn("$sysProp/$envVar=$override ist nicht ausführbar — wird ignoriert.")
        }

        val resource = "/$resourceDir/$exe"
        val input = FinDslNativeBinary::class.java.getResourceAsStream(resource)
            ?: throw IllegalStateException(
                "FinDSL-Binary nicht im Plugin gefunden ($resource). Im Dev-Build "
                    + "`npm run binary` (Repo-Root) ausführen oder $envVar setzen.",
            )
        // Per-User IDE-System-Verzeichnis — NICHT das welt-schreibbare
        // java.io.tmpdir: dort könnte ein anderer lokaler Nutzer/Prozess das
        // Binary unterschieben, das die IDE dann ausführt (lokale Code-
        // Ausführung). Konsistent mit FinDslBundleProvider.
        val cacheDir = PathManager.getSystemDir().resolve(cacheSubdir)
        Files.createDirectories(cacheDir)
        restrictToOwner(cacheDir)
        val target = cacheDir.resolve(exe)
        input.use { Files.copy(it, target, StandardCopyOption.REPLACE_EXISTING) }
        restrictToOwner(target)
        return target
    }

    /**
     * Beschränkt Datei/Verzeichnis auf den Eigentümer (`rwx------`) — kein
     * Group-/Others-Zugriff, damit kein anderer lokaler Nutzer das extrahierte
     * Binary lesen oder ersetzen kann. No-op auf Windows (kein POSIX). Das
     * Owner-Execute-Bit macht das Binary zugleich lauffähig.
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
