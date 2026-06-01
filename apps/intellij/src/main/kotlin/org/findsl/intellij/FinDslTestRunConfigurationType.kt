// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.intellij.execution.configurations.ConfigurationFactory
import com.intellij.execution.configurations.ConfigurationType
import com.intellij.execution.configurations.ConfigurationTypeBase
import com.intellij.execution.configurations.RunConfiguration
import com.intellij.execution.configurations.RunConfigurationOptions
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.NotNullLazyValue

/**
 * Run-Configuration-Typ „FinDSL-Test" (#256): führt `prüfe`-Tests über das
 * native CLI (`findsl test … --reporter=teamcity`) aus und zeigt das Ergebnis
 * im nativen Test-Runner-Fenster. Ergänzt die Editor-Ausführung aus #241
 * (CodeLens) / #255 (Gutter-Icons) um eine zentrale Test-Übersicht.
 */
class FinDslTestRunConfigurationType : ConfigurationTypeBase(
    ID,
    "FinDSL-Test",
    "Führt FinDSL-prüfe-Tests aus und zeigt sie im Test-Runner-Fenster",
    NotNullLazyValue.createValue { FinDslIcons.FILE },
) {
    init {
        addFactory(FinDslTestConfigurationFactory(this))
    }

    companion object {
        const val ID = "FinDslTestRunConfiguration"
    }
}

/** Persistente Optionen einer FinDSL-Test-Konfiguration. */
class FinDslTestRunConfigurationOptions : RunConfigurationOptions() {
    private val targetProperty = string("").provideDelegate(this, "target")

    /** Ziel für `findsl test`: Datei, Verzeichnis oder Glob (absoluter Pfad). */
    var target: String
        get() = targetProperty.getValue(this).orEmpty()
        set(value) = targetProperty.setValue(this, value)
}

class FinDslTestConfigurationFactory(type: ConfigurationType) : ConfigurationFactory(type) {
    override fun getId(): String = "FinDslTest"

    override fun createTemplateConfiguration(project: Project): RunConfiguration =
        FinDslTestRunConfiguration(project, this, "FinDSL-Test")

    override fun getOptionsClass(): Class<FinDslTestRunConfigurationOptions> =
        FinDslTestRunConfigurationOptions::class.java
}
