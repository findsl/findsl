// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.intellij.openapi.fileChooser.FileChooserDescriptorFactory
import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.panel
import java.nio.file.Files
import java.nio.file.Path

/**
 * Plugin-Einstellungsseite „FinDSL" (Settings → FinDSL). Trägt die manuell
 * konfigurierten Pfade zu den nativen Binaries — der **Air-Gap-Fallback**
 * (ADR #243 §5): In abgeschotteten Netzen lädt der Administrator die Binaries
 * einmal manuell von der GitHub-Release-Seite und trägt die Pfade hier ein;
 * [FinDslNativeBinary] nutzt sie als Auflösungs-Stufe 2.
 *
 * Validierung ist **nicht blockierend** (Warnung): ein noch nicht
 * bereitgestelltes Binary soll sich trotzdem speichern lassen.
 */
class FinDslConfigurable : BoundConfigurable("FinDSL") {

    private val settings = FinDslSettings.getInstance()

    override fun createPanel(): DialogPanel = panel {
        group("Native Binaries (Air-Gap / manueller Pfad)") {
            row("LSP-Server-Binary (findsl-lsp):") {
                textFieldWithBrowseButton(
                    "FinDSL-LSP-Server-Binary wählen",
                    null,
                    FileChooserDescriptorFactory.createSingleFileDescriptor(),
                )
                    .bindText(settings.state::lspBinaryPath)
                    .align(AlignX.FILL)
                    .validationOnInput { if (pathUnusable(it.text)) warning(NOT_EXECUTABLE) else null }
            }
            row("CLI-Binary (findsl):") {
                textFieldWithBrowseButton(
                    "FinDSL-CLI-Binary wählen",
                    null,
                    FileChooserDescriptorFactory.createSingleFileDescriptor(),
                )
                    .bindText(settings.state::cliBinaryPath)
                    .align(AlignX.FILL)
                    .validationOnInput { if (pathUnusable(it.text)) warning(NOT_EXECUTABLE) else null }
            }
            row {
                comment(
                    "Air-Gap: Binaries einmal von der GitHub-Release-Seite laden und die " +
                        "Pfade hier eintragen. Leere Felder ⇒ es greift der Env-Override " +
                        "(<code>FINDSL_LSP_PATH</code>/<code>FINDSL_CLI_PATH</code>) bzw. das " +
                        "im Plugin gebündelte Binary. Nach einer Änderung den LSP-Server " +
                        "neu starten (oder die IDE), damit der neue Pfad greift.",
                )
            }
        }
    }

    /** `true`, wenn ein gesetzter Pfad nicht (als ausführbare Datei) brauchbar ist. */
    private fun pathUnusable(text: String): Boolean {
        val path = text.trim()
        return path.isNotEmpty() && !Files.isExecutable(Path.of(path))
    }

    private companion object {
        const val NOT_EXECUTABLE =
            "Pfad existiert nicht oder ist nicht ausführbar — wird zur Laufzeit ignoriert."
    }
}
