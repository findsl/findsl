// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.google.gson.Gson
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.util.SystemInfo
import com.intellij.util.io.HttpRequests
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption

/**
 * Lazy-Download-Distribution der nativen Binaries (ADR #243 §4 Stufe 3/4).
 *
 * Das Release-Plugin enthält keine gebündelten Binaries, sondern nur das zur
 * Plugin-Build-Zeit eingebettete Manifest `/binaries/checksums.json`
 * (`{ version, binaries: { <asset> -> <sha256> } }`, #244). Beim ersten Bedarf
 * lädt das Plugin das zur laufenden Plattform passende Asset vom
 * **versions-gepinnten** GitHub-Release, verifiziert es **gegen die
 * eingebetteten, mitversionierten Hashes** (ein manipuliertes Asset wird
 * abgelehnt) und legt es versioniert in den per-User-Cache.
 *
 * Synchron (vom LSP-Start-Thread, NICHT EDT) — der Server braucht das Binary
 * vor dem Start; ~118 MB werden mit Fortschritt + Notification angezeigt.
 */
object FinDslBinaryDownloader {
    private val LOG = logger<FinDslBinaryDownloader>()

    private const val MANIFEST_RESOURCE = "/binaries/checksums.json"
    private const val RELEASE_BASE = "https://github.com/findsl/findsl/releases/download"
    private const val CACHE_ROOT = "findsl-binaries"
    private const val NOTIFICATION_GROUP = "FinDSL"

    private data class Manifest(val version: String? = null, val binaries: Map<String, String>? = null)

    /**
     * Liefert das native Binary `exeBase` aus dem Cache (SHA-verifiziert) oder
     * lädt es vom Release. `null`, wenn **kein** Manifest eingebettet ist
     * (Dev-Build) — dann ist kein verifizierbarer Download möglich.
     *
     * @throws IllegalStateException bei nicht unterstützter Plattform,
     *   fehlendem Asset, Netz- oder Verifikationsfehler — mit Hinweis auf
     *   Einstellungen → FinDSL (Air-Gap-Pfad).
     */
    fun resolveCachedOrDownload(exeBase: String): Path? {
        val manifest = loadManifest() ?: return null
        val version = manifest.version?.takeIf { it.isNotBlank() }
            ?: throw IllegalStateException("Eingebettetes checksums.json ohne 'version'.")
        val asset = BinaryAssets.assetName(
            exeBase,
            System.getProperty("os.name").orEmpty(),
            System.getProperty("os.arch").orEmpty(),
        ) ?: throw IllegalStateException(
            "Keine FinDSL-Binaries für diese Plattform "
                + "(${System.getProperty("os.name")}/${System.getProperty("os.arch")}). "
                + "Bitte den Binary-Pfad unter Einstellungen → FinDSL eintragen.",
        )
        val expectedSha = manifest.binaries?.get(asset) ?: throw IllegalStateException(
            "Asset '$asset' fehlt im eingebetteten checksums.json (v$version).",
        )

        val cacheDir = PathManager.getSystemDir().resolve(CACHE_ROOT).resolve(version)
        val target = cacheDir.resolve(localExeName(exeBase))

        // Stufe 3: Cache-Treffer mit passendem SHA-256 → ohne Netz wiederverwenden.
        if (Files.isRegularFile(target) && BinaryAssets.sha256Hex(target).equals(expectedSha, ignoreCase = true)) {
            return target
        }

        // Stufe 4: Download + Verifikation + Cache.
        return download(asset, version, expectedSha, cacheDir, target)
    }

    private fun download(asset: String, version: String, expectedSha: String, cacheDir: Path, target: Path): Path {
        Files.createDirectories(cacheDir)
        FinDslNativeBinary.restrictToOwner(cacheDir)
        val url = "$RELEASE_BASE/v$version/$asset"
        notify(
            "FinDSL: lade Sprachserver-Binary",
            "$asset (v$version) wird einmalig vom Release geladen …",
            NotificationType.INFORMATION,
        )
        val tmp = Files.createTempFile(cacheDir, "dl-", ".part")
        try {
            LOG.info("Lade FinDSL-Binary $asset (v$version) von $url")
            HttpRequests.request(url)
                .productNameAsUserAgent()
                .saveToFile(tmp.toFile(), ProgressManager.getInstance().progressIndicator)

            val actualSha = BinaryAssets.sha256Hex(tmp)
            if (!actualSha.equals(expectedSha, ignoreCase = true)) {
                throw IllegalStateException(
                    "SHA-256 von $asset stimmt nicht mit dem eingebetteten Manifest "
                        + "überein ($actualSha ≠ $expectedSha) — Asset abgelehnt.",
                )
            }
            Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING)
            FinDslNativeBinary.restrictToOwner(target) // setzt zugleich das Owner-Execute-Bit
            return target
        } catch (e: Exception) {
            runCatching { Files.deleteIfExists(tmp) }
            notify(
                "FinDSL: Sprachserver-Binary nicht verfügbar",
                "$asset konnte nicht geladen/verifiziert werden. In abgeschotteten Netzen "
                    + "den Pfad unter Einstellungen → FinDSL eintragen.",
                NotificationType.ERROR,
            )
            throw IllegalStateException(
                "FinDSL-Binary $asset (v$version) konnte nicht geladen/verifiziert werden: "
                    + "${e.message}. In abgeschotteten Netzen den Pfad unter "
                    + "Einstellungen → FinDSL eintragen.",
                e,
            )
        }
    }

    private fun localExeName(exeBase: String): String = if (SystemInfo.isWindows) "$exeBase.exe" else exeBase

    private fun loadManifest(): Manifest? {
        val stream = FinDslBinaryDownloader::class.java.getResourceAsStream(MANIFEST_RESOURCE) ?: return null
        return stream.use { Gson().fromJson(it.reader(Charsets.UTF_8), Manifest::class.java) }
    }

    private fun notify(title: String, content: String, type: NotificationType) {
        runCatching {
            NotificationGroupManager.getInstance()
                .getNotificationGroup(NOTIFICATION_GROUP)
                .createNotification(title, content, type)
                .notify(null)
        }.onFailure { LOG.info("Notification '$title' nicht zustellbar: ${it.message}") }
    }
}
