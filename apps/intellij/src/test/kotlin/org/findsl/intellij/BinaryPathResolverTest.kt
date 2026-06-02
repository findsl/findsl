// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.file.Files

/**
 * Sichert die Auflösungs-PRIORITÄT der Binary-Pfade ab (ADR #243 §4):
 * Override (Env/Sys-Property) vor Plugin-Settings, nicht ausführbare oder leere
 * Kandidaten werden übersprungen. Reine Logik, kein IDE-Bootstrap nötig.
 */
class BinaryPathResolverTest {

    private fun execFile(): String {
        val f = Files.createTempFile("findsl-exec", ".bin").toFile()
        f.deleteOnExit()
        assertTrue("setExecutable fehlgeschlagen", f.setExecutable(true))
        return f.absolutePath
    }

    private fun plainFile(): String {
        val f = Files.createTempFile("findsl-plain", ".bin").toFile()
        f.deleteOnExit()
        f.setExecutable(false)
        return f.absolutePath
    }

    @Test
    fun `isSet erkennt leere und gesetzte Werte`() {
        assertFalse(BinaryPathResolver.isSet(null))
        assertFalse(BinaryPathResolver.isSet(""))
        assertFalse(BinaryPathResolver.isSet("   "))
        assertTrue(BinaryPathResolver.isSet("/irgendwo/findsl-lsp"))
    }

    @Test
    fun `usable liefert nur ausfuehrbare Pfade`() {
        assertNull(BinaryPathResolver.usable(null))
        assertNull(BinaryPathResolver.usable(""))
        assertNull(BinaryPathResolver.usable("/nicht/vorhanden/findsl-lsp"))
        assertNull(BinaryPathResolver.usable(plainFile()))
        val exe = execFile()
        assertEquals(exe, BinaryPathResolver.usable(exe)?.toString())
    }

    @Test
    fun `firstUsable bevorzugt den fruehesten Kandidaten (Override vor Settings)`() {
        val override = execFile()
        val settings = execFile()
        assertEquals(override, BinaryPathResolver.firstUsable(listOf(override, settings))?.toString())
    }

    @Test
    fun `firstUsable ueberspringt nicht ausfuehrbare und leere Kandidaten`() {
        val settings = execFile()
        // Override nicht ausführbar → Settings greift:
        assertEquals(settings, BinaryPathResolver.firstUsable(listOf(plainFile(), settings))?.toString())
        // Override leer/null → Settings greift:
        assertEquals(settings, BinaryPathResolver.firstUsable(listOf(null, "  ", settings))?.toString())
    }

    @Test
    fun `firstUsable ist null ohne brauchbaren Kandidaten`() {
        assertNull(BinaryPathResolver.firstUsable(listOf(null, "", plainFile())))
    }
}
