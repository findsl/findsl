// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.intellij.execution.actions.ConfigurationContext
import com.intellij.execution.actions.LazyRunConfigurationProducer
import com.intellij.execution.configurations.ConfigurationFactory
import com.intellij.execution.configurations.ConfigurationTypeUtil
import com.intellij.openapi.util.Ref
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiElement

/**
 * Erzeugt aus dem Kontext (Rechtsklick auf eine `.findsl`-Datei im Editor oder
 * Projektbaum) eine {@link FinDslTestRunConfiguration} — „Run 'FinDSL-Test:
 * …'". Das Ziel ist der Dateipfad; das CLI überspringt Dateien ohne
 * `prüfe`-Blöcke selbst.
 */
class FinDslTestRunConfigurationProducer : LazyRunConfigurationProducer<FinDslTestRunConfiguration>() {

    override fun getConfigurationFactory(): ConfigurationFactory =
        ConfigurationTypeUtil
            .findConfigurationType(FinDslTestRunConfigurationType::class.java)
            .configurationFactories
            .first()

    override fun setupConfigurationFromContext(
        configuration: FinDslTestRunConfiguration,
        context: ConfigurationContext,
        sourceElement: Ref<PsiElement>,
    ): Boolean {
        val file = findslTarget(context) ?: return false
        configuration.target = file.path
        configuration.name = "FinDSL-Test: ${file.name}"
        return true
    }

    override fun isConfigurationFromContext(
        configuration: FinDslTestRunConfiguration,
        context: ConfigurationContext,
    ): Boolean {
        val file = findslTarget(context) ?: return false
        return configuration.target == file.path
    }

    /** Die `.findsl`-Datei im Kontext, sonst `null`. */
    private fun findslTarget(context: ConfigurationContext): VirtualFile? {
        val file = context.location?.virtualFile ?: return null
        return if (!file.isDirectory && file.name.endsWith(".findsl")) file else null
    }
}
