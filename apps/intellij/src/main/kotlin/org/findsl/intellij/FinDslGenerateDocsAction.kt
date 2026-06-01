// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.testFramework.LightVirtualFile
import com.redhat.devtools.lsp4ij.LSPIJUtils
import com.redhat.devtools.lsp4ij.LanguageServerManager
import org.eclipse.lsp4j.ExecuteCommandParams

/**
 * Action „FinDSL-Dokumentation generieren" (#242) — Pendant zu
 * `findsl.generateDocs` in VS Code. Ruft das Server-Kommando
 * `findsl.doku.generate` für die aktive `.findsl`-Datei auf (echtes
 * `workspace/executeCommand` über LSP4IJ) und öffnet das zurückgegebene
 * Markdown in einem ungespeicherten Editor-Tab; die `.md`-Endung aktiviert die
 * Vorschau des gebündelten IntelliJ-Markdown-Plugins.
 *
 * Wie bei CodeLens/Gutter liegt die Logik im Server (`@findsl/core`) — hier nur
 * der Aufruf + die Anzeige.
 */
class FinDslGenerateDocsAction : AnAction() {

    // update() liest nur die VirtualFile aus dem Kontext → kein EDT-Modellzugriff.
    override fun getActionUpdateThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabledAndVisible = findslFile(e) != null
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val file = findslFile(e) ?: return
        val uri = LSPIJUtils.toUriAsString(file)

        // Server (bei Bedarf gestartet) → executeCommand → DokuResult → auf dem EDT
        // im Editor öffnen. Kein blockierendes Warten.
        val params = ExecuteCommandParams(GENERATE_DOKU_COMMAND, listOf(uri, FORMAT))
        LanguageServerManager.getInstance(project)
            .getLanguageServer(SERVER_ID)
            .thenAccept { item ->
                val server = item?.server ?: return@thenAccept
                server.workspaceService.executeCommand(params)
                    .thenAccept { result ->
                        val doku = parseDokuResult(result) ?: return@thenAccept
                        ApplicationManager.getApplication().invokeLater {
                            openInEditor(project, doku)
                        }
                    }
                    .exceptionally { ex ->
                        LOG.warn("findsl.doku.generate fehlgeschlagen ($uri)", ex)
                        null
                    }
            }
            .exceptionally { ex ->
                LOG.warn("Language-Server für Doku-Generierung nicht verfügbar", ex)
                null
            }
    }

    /** Öffnet die generierte Doku als ungespeicherte In-Memory-Datei. */
    private fun openInEditor(project: Project, doku: DokuResultData) {
        val file = LightVirtualFile(doku.filename, doku.content)
        FileEditorManager.getInstance(project).openFile(file, /* focusEditor */ true)
    }

    /**
     * Extrahiert das `DokuResult` aus der `executeCommand`-Antwort. LSP4J liefert
     * unbekannte Command-Rückgaben als Gson-`JsonElement`; defensiv wird auch ein
     * bereits deserialisiertes Objekt (über `toJsonTree`) akzeptiert. `null`, wenn
     * der Server nichts/kein Objekt lieferte (z. B. Parse-Fehler).
     */
    private fun parseDokuResult(result: Any?): DokuResultData? {
        if (result == null) return null
        val json: JsonElement = if (result is JsonElement) result else GSON.toJsonTree(result)
        if (!json.isJsonObject) return null
        val obj = json.asJsonObject
        val content = obj.get("content")?.takeIf { it.isJsonPrimitive }?.asString ?: return null
        val filename = obj.get("filename")?.takeIf { it.isJsonPrimitive }?.asString ?: "FinDSL.doc.md"
        return DokuResultData(filename, content)
    }

    /** Die `.findsl`-Datei im Action-Kontext, sonst `null`. */
    private fun findslFile(e: AnActionEvent): VirtualFile? {
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return null
        return if (!file.isDirectory && file.name.endsWith(".findsl")) file else null
    }

    private data class DokuResultData(val filename: String, val content: String)

    companion object {
        private val LOG = logger<FinDslGenerateDocsAction>()
        private val GSON = Gson()
        private const val GENERATE_DOKU_COMMAND = "findsl.doku.generate"
        private const val SERVER_ID = "findslLanguageServer"
        // V1: Markdown (mit Vorschau, Akzeptanz #242). HTML-Format/Settings folgt.
        private const val FORMAT = "markdown"
    }
}
