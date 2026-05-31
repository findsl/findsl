// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.event.EditorFactoryEvent
import com.intellij.openapi.editor.event.EditorFactoryListener
import com.intellij.openapi.editor.markup.GutterIconRenderer
import com.intellij.openapi.editor.markup.HighlighterLayer
import com.intellij.openapi.editor.markup.HighlighterTargetArea
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.project.Project
import com.redhat.devtools.lsp4ij.LSPIJUtils
import com.redhat.devtools.lsp4ij.LanguageServerManager
import com.redhat.devtools.lsp4ij.commands.CommandExecutor
import com.redhat.devtools.lsp4ij.commands.LSPCommandContext
import org.eclipse.lsp4j.Command
import org.eclipse.lsp4j.DocumentSymbol
import org.eclipse.lsp4j.DocumentSymbolParams
import org.eclipse.lsp4j.SymbolInformation
import org.eclipse.lsp4j.SymbolKind
import org.eclipse.lsp4j.TextDocumentIdentifier
import org.eclipse.lsp4j.jsonrpc.messages.Either
import javax.swing.Icon

/**
 * Setzt pro `testfall` ein „Run"-Gutter-Icon am linken Editorrand (#255) —
 * Pendant zu den Gutter-Pfeilen des VS-Code-Test-Controllers. Ein Klick führt
 * genau diesen Testfall über `findsl.pruefe.run [uri, pruefeIndex, testfallIndex]`
 * aus (kein Server-Change; der Server unterstützt den `testfallIndex` bereits).
 *
 * Bewusst PSI-unabhängig über das `MarkupModel` statt über einen
 * `RunLineMarkerContributor`: Die `.findsl`-Dateien sind PSI-los (TextMate),
 * es gibt also kein PsiElement pro `testfall`-Zeile. Die Positionen kommen aus
 * den LSP-DocumentSymbols (`prüfe` = Namespace, `testfall` = Method-Kinder).
 */
class FinDslTestGutterListener : EditorFactoryListener {

    override fun editorCreated(event: EditorFactoryEvent) {
        val editor = event.editor
        val project = editor.project ?: return
        val vfile = FileDocumentManager.getInstance().getFile(editor.document) ?: return
        if (!vfile.name.endsWith(SUFFIX)) return

        val uri = LSPIJUtils.toUriAsString(vfile)
        // Asynchron: Server (bei Bedarf gestartet) → DocumentSymbols → auf dem EDT
        // die Gutter-Icons setzen. Kein blockierendes Warten.
        LanguageServerManager.getInstance(project)
            .getLanguageServer(SERVER_ID)
            .thenAccept { item ->
                if (item == null) return@thenAccept
                item.textDocumentService
                    .documentSymbol(DocumentSymbolParams(TextDocumentIdentifier(uri)))
                    .thenAccept { symbols ->
                        if (symbols.isNullOrEmpty()) return@thenAccept
                        ApplicationManager.getApplication().invokeLater {
                            if (!editor.isDisposed) renderTestGutters(project, editor, uri, symbols)
                        }
                    }
            }
    }

    /**
     * Setzt die Gutter-Icons: jeder `prüfe`-Block (Namespace, Reihenfolge =
     * `pruefeIndex`) trägt seine `testfall`-Kinder (Method, Reihenfolge =
     * `testfallIndex`). Index-Logik identisch zur VS-Code-Extension.
     */
    private fun renderTestGutters(
        project: Project,
        editor: Editor,
        uri: String,
        symbols: List<Either<SymbolInformation, DocumentSymbol>>,
    ) {
        val document = editor.document
        var pruefeIndex = 0
        for (either in symbols) {
            if (!either.isRight) continue
            val pruefe = either.right
            if (pruefe.kind != SymbolKind.Namespace) continue
            val currentPruefe = pruefeIndex++
            pruefe.children?.forEachIndexed { testfallIndex, testfall ->
                if (testfall.kind != SymbolKind.Method) return@forEachIndexed
                val line = testfall.selectionRange.start.line
                if (line !in 0 until document.lineCount) return@forEachIndexed
                val highlighter = editor.markupModel.addRangeHighlighter(
                    document.getLineStartOffset(line),
                    document.getLineEndOffset(line),
                    HighlighterLayer.ADDITIONAL_SYNTAX,
                    null,
                    HighlighterTargetArea.EXACT_RANGE,
                )
                highlighter.gutterIconRenderer =
                    TestfallGutterIconRenderer(project, uri, currentPruefe, testfallIndex, testfall.name)
            }
        }
    }

    companion object {
        private const val SUFFIX = ".findsl"
        private const val SERVER_ID = "findslLanguageServer"
    }
}

/** „Run"-Gutter-Icon für einen einzelnen `testfall`; Klick führt ihn via LSP aus. */
private class TestfallGutterIconRenderer(
    private val project: Project,
    private val uri: String,
    private val pruefeIndex: Int,
    private val testfallIndex: Int,
    private val label: String,
) : GutterIconRenderer() {

    override fun getIcon(): Icon = AllIcons.RunConfigurations.TestState.Run

    override fun getTooltipText(): String = "Testfall „${label}“ ausführen"

    override fun isNavigateAction(): Boolean = true

    override fun getClickAction(): AnAction = object : AnAction() {
        override fun actionPerformed(e: AnActionEvent) {
            val command = Command(
                "Testfall ausführen",
                RUN_PRUEFE_COMMAND,
                listOf<Any>(uri, pruefeIndex, testfallIndex),
            )
            val context = LSPCommandContext(command, project)
            context.setPreferredLanguageServerId(SERVER_ID)
            CommandExecutor.executeCommand(context)
        }
    }

    // equals/hashCode sind Pflicht — sonst flackern/verdoppeln sich die Icons
    // bei jedem Markup-Vergleich.
    override fun equals(other: Any?): Boolean =
        other is TestfallGutterIconRenderer &&
            other.uri == uri && other.pruefeIndex == pruefeIndex && other.testfallIndex == testfallIndex

    override fun hashCode(): Int = ((uri.hashCode() * 31) + pruefeIndex) * 31 + testfallIndex

    private companion object {
        const val RUN_PRUEFE_COMMAND = "findsl.pruefe.run"
        const val SERVER_ID = "findslLanguageServer"
    }
}
