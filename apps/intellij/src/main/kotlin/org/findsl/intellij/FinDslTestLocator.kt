// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.intellij.execution.Location
import com.intellij.execution.PsiLocation
import com.intellij.execution.testframework.sm.runner.SMTestLocator
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.psi.PsiFile
import com.intellij.psi.PsiManager
import com.intellij.psi.search.GlobalSearchScope

/**
 * Löst die `file://<pfad>:<zeile>:<spalte>`-locationHints des TeamCity-Reporters
 * (#256) zu einer navigierbaren Location auf — mit explizitem
 * {@link OpenFileDescriptor} (zeilen-/spaltengenau), UNABHÄNGIG vom PSI-Typ.
 *
 * Warum nicht der eingebaute `FileUrlProvider`? Dessen zeilengenaue Navigation
 * greift nur für `PsiPlainText`-Dateien (`createLocationFor` prüft explizit
 * `instanceof PsiPlainText`); `.findsl` ist eine **TextMate**-Datei (bewusst kein
 * eigener FileType, damit das TextMate-Highlighting greift), für die
 * `FileUrlProvider` auf `PsiLocation.fromPsiElement(psiFile)` zurückfällt → die
 * Datei öffnet, der Cursor springt aber NICHT zur Zeile.
 */
object FinDslTestLocator : SMTestLocator {
    override fun getLocation(
        protocol: String,
        path: String,
        project: Project,
        scope: GlobalSearchScope,
    ): List<Location<*>> {
        if (protocol != PROTOCOL) return emptyList()

        val (filePath, line, column) = parsePathLineColumn(path)
        val virtualFile = LocalFileSystem.getInstance().findFileByPath(filePath) ?: return emptyList()
        val psiFile: PsiFile = PsiManager.getInstance(project).findFile(virtualFile) ?: return emptyList()

        // PsiLocation als Träger (erfüllt das Location-Interface); die eigentliche
        // Navigation läuft über den überschriebenen OpenFileDescriptor mit
        // 0-basierter Zeile/Spalte — daher PSI-typ-unabhängig.
        val location = object : PsiLocation<PsiFile>(project, psiFile) {
            override fun getOpenFileDescriptor(): OpenFileDescriptor =
                if (line > 0) {
                    OpenFileDescriptor(project, virtualFile, line - 1, (column - 1).coerceAtLeast(0))
                } else {
                    OpenFileDescriptor(project, virtualFile)
                }
        }
        return listOf(location)
    }

    /**
     * Spaltet `<pfad>[:<zeile>[:<spalte>]]` (1-basiert) — gleiche Heuristik wie
     * `FileUrlProvider` (der Doppelpunkt vor Index 3 ist ein Windows-Laufwerk,
     * kein Zeilen-Trenner). Ohne Position: Zeile/Spalte = -1.
     */
    private fun parsePathLineColumn(path: String): Triple<String, Int, Int> {
        val lastColon = path.lastIndexOf(':')
        if (lastColon <= 3) return Triple(path, -1, -1)
        val lastValue = path.substring(lastColon + 1).toIntOrNull() ?: -1
        val penultColon = path.lastIndexOf(':', lastColon - 1)
        if (penultColon > 3) {
            val penultValue = path.substring(penultColon + 1, lastColon).toIntOrNull() ?: -1
            if (penultValue > 0) return Triple(path.substring(0, penultColon), penultValue, lastValue)
        }
        return if (lastValue > 0) Triple(path.substring(0, lastColon), lastValue, -1) else Triple(path, -1, -1)
    }

    private const val PROTOCOL = "file"
}
