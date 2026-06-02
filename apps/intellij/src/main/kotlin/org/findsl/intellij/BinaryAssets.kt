// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest

/**
 * Reine, IntelliJ-freie Helfer für die Lazy-Download-Distribution (ADR #243 §1/§2):
 * Plattform → Release-Asset-Name und SHA-256-Berechnung. Ohne Platform-
 * Abhängigkeiten, damit beides ohne IDE-Bootstrap unit-testbar ist.
 */
object BinaryAssets {

    /**
     * Release-Asset-Name `<exeBase>-<os>-<arch>[.exe]` (exakt wie `release.yml`
     * / ADR §1: `darwin-arm64` · `darwin-x64` · `linux-x64` · `win-x64.exe`),
     * oder `null` für eine nicht unterstützte Plattform (z. B. `linux-arm64`).
     *
     * @param exeBase `findsl-lsp` oder `findsl`.
     * @param osName  `System.getProperty("os.name")`.
     * @param osArch  `System.getProperty("os.arch")`.
     */
    fun assetName(exeBase: String, osName: String, osArch: String): String? {
        val os = osName.lowercase()
        return when (normalizeArch(osArch)) {
            "arm64" -> if (isMac(os)) "$exeBase-darwin-arm64" else null
            "x64" -> when {
                isMac(os) -> "$exeBase-darwin-x64"
                isWindows(os) -> "$exeBase-win-x64.exe"
                isLinux(os) -> "$exeBase-linux-x64"
                else -> null
            }
            else -> null
        }
    }

    private fun isMac(os: String) = os.contains("mac") || os.contains("darwin") || os.contains("os x")
    private fun isWindows(os: String) = os.contains("win")
    private fun isLinux(os: String) = os.contains("nux") || os.contains("nix")

    /** Vereinheitlicht die JVM-`os.arch`-Werte auf `arm64` / `x64`. */
    private fun normalizeArch(osArch: String): String = when (osArch.lowercase()) {
        "aarch64", "arm64" -> "arm64"
        "x86_64", "amd64", "x64" -> "x64"
        else -> osArch.lowercase()
    }

    /** SHA-256 von `file` als Kleinbuchstaben-Hex — matcht das `checksums.json`-Format. */
    fun sha256Hex(file: Path): String {
        val md = MessageDigest.getInstance("SHA-256")
        Files.newInputStream(file).use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
}
