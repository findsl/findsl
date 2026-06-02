// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service

/**
 * Persistente, anwendungsweite Plugin-Einstellungen: manuell konfigurierte
 * Pfade zu den nativen FinDSL-Binaries (LSP-Server `findsl-lsp` + CLI `findsl`).
 *
 * Zweck = **Air-Gap-Fallback** (ADR #243 §5,
 * `apps/intellij/docs/binary-distribution.md`): In abgeschotteten Netzen ohne
 * GitHub-Zugriff trägt der Administrator die lokal bereitgestellten Binaries
 * hier ein; [FinDslNativeBinary.resolveOrExtract] nutzt sie als Auflösungs-
 * **Stufe 2** (nach dem Env/System-Property-Override, vor dem gebündelten
 * Binary). Application-Level, nicht projektgebunden — die Binaries sind eine
 * Eigenschaft der Maschine, nicht des Projekts.
 */
@Service(Service.Level.APP)
@State(name = "FinDslSettings", storages = [Storage("findsl.xml")])
class FinDslSettings : PersistentStateComponent<FinDslSettings.State> {

    /** Serialisierter Zustand (von der UI direkt gebunden, daher `var`). */
    data class State(
        var lspBinaryPath: String = "",
        var cliBinaryPath: String = "",
    )

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }

    /** Konfigurierter LSP-Server-Binary-Pfad, getrimmt; `null` wenn leer. */
    fun lspPath(): String? = state.lspBinaryPath.trim().ifEmpty { null }

    /** Konfigurierter CLI-Binary-Pfad, getrimmt; `null` wenn leer. */
    fun cliPath(): String? = state.cliBinaryPath.trim().ifEmpty { null }

    companion object {
        fun getInstance(): FinDslSettings = service()
    }
}
