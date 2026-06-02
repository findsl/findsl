// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.nio.file.Files

/**
 * Sichert das Plattform→Asset-Mapping (exakt wie `release.yml`/ADR §1) und die
 * SHA-256-Berechnung (Manifest-Format) ab. Reine Logik, kein IDE-Bootstrap.
 */
class BinaryAssetsTest {

    @Test
    fun `macOS-Assets (arm64 + x64), beide Basisnamen`() {
        assertEquals("findsl-lsp-darwin-arm64", BinaryAssets.assetName("findsl-lsp", "Mac OS X", "aarch64"))
        assertEquals("findsl-darwin-arm64", BinaryAssets.assetName("findsl", "Mac OS X", "aarch64"))
        assertEquals("findsl-lsp-darwin-x64", BinaryAssets.assetName("findsl-lsp", "Mac OS X", "x86_64"))
    }

    @Test
    fun `Windows-Asset traegt exe-Endung`() {
        assertEquals("findsl-lsp-win-x64.exe", BinaryAssets.assetName("findsl-lsp", "Windows 11", "amd64"))
        assertEquals("findsl-win-x64.exe", BinaryAssets.assetName("findsl", "Windows 11", "amd64"))
    }

    @Test
    fun `Linux-Asset (nur x64)`() {
        assertEquals("findsl-lsp-linux-x64", BinaryAssets.assetName("findsl-lsp", "Linux", "amd64"))
        assertEquals("findsl-lsp-linux-x64", BinaryAssets.assetName("findsl-lsp", "Linux", "x86_64"))
    }

    @Test
    fun `nicht unterstuetzte Plattformen sind null`() {
        assertNull(BinaryAssets.assetName("findsl-lsp", "Linux", "aarch64")) // linux-arm64: ADR §1 nicht gelistet
        assertNull(BinaryAssets.assetName("findsl-lsp", "Windows 11", "aarch64")) // win-arm64 nicht gebaut
        assertNull(BinaryAssets.assetName("findsl-lsp", "SunOS", "sparc"))
    }

    @Test
    fun `sha256Hex matcht den bekannten Vektor fuer "abc"`() {
        val f = Files.createTempFile("findsl-sha", ".bin")
        f.toFile().deleteOnExit()
        Files.write(f, "abc".toByteArray(Charsets.UTF_8))
        assertEquals(
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            BinaryAssets.sha256Hex(f),
        )
    }
}
