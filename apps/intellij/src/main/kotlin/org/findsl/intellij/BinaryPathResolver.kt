// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import java.nio.file.Files
import java.nio.file.Path

/**
 * Reine, IntelliJ-freie Pfad-Auswahl für die Binary-Auflösung
 * ([FinDslNativeBinary]). Bewusst ohne Platform-Abhängigkeiten, damit die
 * Auflösungs-Priorität ohne IDE-Bootstrap unit-testbar ist.
 *
 * Reihenfolge der Kandidaten = Priorität: Env/System-Property-Override zuerst,
 * dann der in den Plugin-Einstellungen konfigurierte Air-Gap-Pfad (ADR #243 §4).
 */
object BinaryPathResolver {

    /** `true`, wenn `candidate` gesetzt (nicht leer/blank) ist. */
    fun isSet(candidate: String?): Boolean = !candidate.isNullOrBlank()

    /** Der Kandidat als ausführbarer [Path], oder `null` (leer/nicht ausführbar). */
    fun usable(candidate: String?): Path? {
        if (!isSet(candidate)) return null
        val path = Path.of(candidate!!.trim())
        return if (Files.isExecutable(path)) path else null
    }

    /**
     * Erster ausführbarer Pfad aus `candidates` (in Reihenfolge = Priorität),
     * oder `null`, wenn keiner gesetzt **und** ausführbar ist.
     */
    fun firstUsable(candidates: List<String?>): Path? = candidates.firstNotNullOfOrNull { usable(it) }
}
