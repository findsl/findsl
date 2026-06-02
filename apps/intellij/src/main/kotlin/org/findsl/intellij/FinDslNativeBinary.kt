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
 * Reihenfolge (ADR #243 §4):
 *  1. Override `<sysProp>` (System-Property) bzw. `<envVar>` (Umgebung) — für
 *     die lokale Entwicklung (zeigt z. B. auf `packages/lsp/dist/findsl-lsp`),
 *     ohne das Binary ins Plugin zu kopieren.
 *  2. In den Plugin-Einstellungen konfigurierter Pfad (`settingsPath`,
 *     [FinDslSettings]) — der **Air-Gap-Fallback** (#243 §5): in abgeschotteten
 *     Netzen ohne GitHub-Zugriff trägt der Administrator hier den lokal
 *     bereitgestellten Binary-Pfad ein.
 *  3. Das ins Plugin gebündelte Binary aus `/<resourceDir>/<exe>` (Dev-/
 *     `buildPlugin`-Komfort), extrahiert in ein per-User-Cacheverzeichnis und
 *     ausführbar gemacht. Im Release-Plugin fehlt es bewusst (#244).
 *  4. **Lazy-Download** vom versions-gepinnten Release ([FinDslBinaryDownloader]):
 *     Cache-Treffer (SHA-256 passt) wiederverwenden, sonst herunterladen und
 *     gegen das eingebettete `checksums.json` verifizieren (#243 §4 Stufe 3/4).
 *  5. Schlägt alles fehl → Fehler mit Hinweis auf Einstellungen → FinDSL (#243 §5).
 */
object FinDslNativeBinary {
    private val LOG = logger<FinDslNativeBinary>()

    /**
     * @param exeBase   Basisname ohne Endung (`findsl-lsp` / `findsl`).
     * @param resourceDir Plugin-Ressourcen-Unterordner (`server` / `cli`).
     * @param cacheSubdir Unterordner im IDE-System-Verzeichnis (`findsl-lsp` / `findsl-cli`).
     * @param sysProp   System-Property-Override (`findsl.lsp.path` / `findsl.cli.path`).
     * @param envVar    Umgebungsvariablen-Override (`FINDSL_LSP_PATH` / `FINDSL_CLI_PATH`).
     * @param settingsPath In den Plugin-Einstellungen konfigurierter Pfad
     *   (Air-Gap-Fallback, Stufe 2); `null`/leer = nicht gesetzt.
     */
    fun resolveOrExtract(
        exeBase: String,
        resourceDir: String,
        cacheSubdir: String,
        sysProp: String,
        envVar: String,
        settingsPath: String?,
    ): Path {
        val exe = if (SystemInfo.isWindows) "$exeBase.exe" else exeBase

        // Stufe 1: Env/System-Property-Override (Entwicklung/CI).
        val override = System.getProperty(sysProp) ?: System.getenv(envVar)
        BinaryPathResolver.usable(override)?.let { return it }
        if (BinaryPathResolver.isSet(override)) {
            LOG.warn("$sysProp/$envVar=$override ist nicht ausführbar — wird ignoriert.")
        }

        // Stufe 2: in den Plugin-Einstellungen konfigurierter Pfad (Air-Gap, #243 §5).
        BinaryPathResolver.usable(settingsPath)?.let { return it }
        if (BinaryPathResolver.isSet(settingsPath)) {
            LOG.warn(
                "Einstellungen → FinDSL: Binary-Pfad '$settingsPath' ist nicht "
                    + "ausführbar — wird ignoriert.",
            )
        }

        // Stufe 3: ins Plugin gebündeltes Binary (Dev-/buildPlugin-Komfort).
        // Im Release-Plugin fehlt es bewusst (#244) → dann Stufe 4 (Download).
        val resource = "/$resourceDir/$exe"
        FinDslNativeBinary::class.java.getResourceAsStream(resource)?.let { input ->
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

        // Stufe 4: Lazy-Download vom versions-gepinnten Release (Cache + SHA-256,
        // ADR #243 §4). `null` = kein eingebettetes Manifest (Dev-Build) → Stufe 5.
        FinDslBinaryDownloader.resolveCachedOrDownload(exeBase)?.let { return it }

        // Stufe 5: nichts verfügbar.
        throw IllegalStateException(
            "FinDSL-Binary '$exe' nicht verfügbar (weder gebündelt noch ladbar). "
                + "In abgeschotteten Netzen (Air-Gap) den Pfad unter Einstellungen → "
                + "FinDSL eintragen oder $envVar setzen; im Dev-Build `npm run binary` "
                + "(Repo-Root) ausführen.",
        )
    }

    /**
     * Beschränkt Datei/Verzeichnis auf den Eigentümer (`rwx------`) — kein
     * Group-/Others-Zugriff, damit kein anderer lokaler Nutzer das extrahierte
     * Binary lesen oder ersetzen kann. No-op auf Windows (kein POSIX). Das
     * Owner-Execute-Bit macht das Binary zugleich lauffähig.
     */
    internal fun restrictToOwner(path: Path) {
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
