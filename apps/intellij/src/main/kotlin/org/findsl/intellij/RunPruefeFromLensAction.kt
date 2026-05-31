// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.diagnostic.logger
import com.redhat.devtools.lsp4ij.commands.CommandExecutor
import com.redhat.devtools.lsp4ij.commands.LSPCommand
import com.redhat.devtools.lsp4ij.commands.LSPCommandAction
import com.redhat.devtools.lsp4ij.commands.LSPCommandContext
import org.eclipse.lsp4j.Command

/**
 * Führt einen `prüfe`-Block über die CodeLens „▶ Testfälle ausführen" aus.
 *
 * Die Lens trägt das **Client**-Kommando `findsl.pruefe.runFromLens` — der
 * Server registriert es bewusst NICHT als `executeCommand`. LSP4IJ erkennt
 * über die Action-`id` (= Command-id, siehe plugin.xml), dass dieses Kommando
 * client-seitig zu behandeln ist, und ruft [commandPerformed]. Wir reichen es
 * dann als das server-registrierte `findsl.pruefe.run` weiter (echtes
 * `workspace/executeCommand`) — **dieselbe Naht wie in der VS-Code-Extension,
 * ohne Server-Änderung**.
 *
 * Das Ergebnis zeigt der Server selbst: `window/showMessage` rendert LSP4IJ als
 * IDE-Notification, fehlgeschlagene Testfälle als `publishDiagnostics`-
 * Annotationen — hier ist dafür nichts weiter zu tun.
 */
class RunPruefeFromLensAction : LSPCommandAction() {

    // Der LSP-Request läuft im Hintergrund, nicht auf dem EDT.
    override fun getCommandPerformedThread(): ActionUpdateThread = ActionUpdateThread.BGT

    override fun commandPerformed(command: LSPCommand, e: AnActionEvent) {
        val project = e.project ?: return

        // Argumente der Lens: ["<documentUri>", <pruefeIndex>] (siehe findsl-codelens.ts).
        val uri = command.getArgumentAt(0, String::class.java)
        val pruefeIndex = command.getArgumentAt(1, Integer::class.java)
        if (uri == null || pruefeIndex == null) {
            LOG.warn("findsl.pruefe.runFromLens ohne erwartete Argumente [uri, pruefeIndex]: ${command.arguments}")
            return
        }

        // Als server-registriertes Kommando weiterreichen — CommandExecutor schickt
        // es (da `findsl.pruefe.run` in den Server-Capabilities steht) als echtes
        // workspace/executeCommand an genau den FinDSL-Server.
        val serverCommand = Command("prüfe ausführen", RUN_PRUEFE_COMMAND, listOf<Any>(uri, pruefeIndex))
        val context = LSPCommandContext(serverCommand, project)
        context.setPreferredLanguageServerId(SERVER_ID)
        CommandExecutor.executeCommand(context)
    }

    companion object {
        private val LOG = logger<RunPruefeFromLensAction>()
        private const val RUN_PRUEFE_COMMAND = "findsl.pruefe.run"

        /** serverId aus dem `fileNamePatternMapping` in plugin.xml. */
        private const val SERVER_ID = "findslLanguageServer"
    }
}
