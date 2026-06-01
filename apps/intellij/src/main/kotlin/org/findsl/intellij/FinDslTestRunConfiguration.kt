// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.intellij

import com.intellij.execution.DefaultExecutionResult
import com.intellij.execution.ExecutionResult
import com.intellij.execution.Executor
import com.intellij.execution.configurations.CommandLineState
import com.intellij.execution.configurations.ConfigurationFactory
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.configurations.RunConfiguration
import com.intellij.execution.configurations.RunConfigurationBase
import com.intellij.execution.configurations.RuntimeConfigurationError
import com.intellij.execution.process.KillableColoredProcessHandler
import com.intellij.execution.process.ProcessHandler
import com.intellij.execution.process.ProcessTerminatedListener
import com.intellij.execution.runners.ExecutionEnvironment
import com.intellij.execution.runners.ProgramRunner
import com.intellij.execution.testframework.sm.FileUrlProvider
import com.intellij.execution.testframework.sm.SMTestRunnerConnectionUtil
import com.intellij.execution.testframework.sm.runner.SMRunnerConsolePropertiesProvider
import com.intellij.execution.testframework.sm.runner.SMTRunnerConsoleProperties
import com.intellij.execution.testframework.sm.runner.SMTestLocator
import com.intellij.openapi.options.SettingsEditor
import com.intellij.openapi.project.Project
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import java.nio.charset.StandardCharsets
import javax.swing.JComponent

/** Name des Test-Frameworks im Test-Runner-Fenster (Splitter-State-Key etc.). */
const val FINDSL_TEST_FRAMEWORK = "FinDSL"

/**
 * Run-Configuration für `findsl test … --reporter=teamcity` (#256). Startet das
 * native CLI als Prozess; dessen TeamCity-Service-Messages rendert IntelliJ
 * nativ als Test-Baum (inkl. Re-Run-Failed, Statistiken, Navigation).
 */
class FinDslTestRunConfiguration(
    project: Project,
    factory: ConfigurationFactory,
    name: String,
) : RunConfigurationBase<FinDslTestRunConfigurationOptions>(project, factory, name),
    SMRunnerConsolePropertiesProvider {

    public override fun getOptions(): FinDslTestRunConfigurationOptions =
        super.getOptions() as FinDslTestRunConfigurationOptions

    /** Ziel für `findsl test` (Datei, Ordner oder Glob). */
    var target: String
        get() = options.target
        set(value) {
            options.target = value
        }

    override fun getConfigurationEditor(): SettingsEditor<out RunConfiguration> =
        FinDslTestSettingsEditor()

    override fun checkConfiguration() {
        if (target.isBlank()) {
            throw RuntimeConfigurationError("Kein Test-Ziel angegeben (Datei, Ordner oder Glob).")
        }
    }

    override fun createTestConsoleProperties(executor: Executor): SMTRunnerConsoleProperties =
        FinDslTestConsoleProperties(this, executor)

    override fun getState(executor: Executor, environment: ExecutionEnvironment): CommandLineState =
        FinDslTestCommandLineState(this, environment)
}

/**
 * Test-Console-Properties. `getTestLocator` löst die `file://`-locationHints des
 * Reporters auf — Doppelklick im Test-Baum öffnet die Quelldatei.
 */
private class FinDslTestConsoleProperties(
    config: FinDslTestRunConfiguration,
    executor: Executor,
) : SMTRunnerConsoleProperties(config, FINDSL_TEST_FRAMEWORK, executor) {
    override fun getTestLocator(): SMTestLocator = FileUrlProvider.INSTANCE
}

/** Startet den CLI-Prozess und hängt das Test-Runner-Fenster an dessen stdout. */
private class FinDslTestCommandLineState(
    private val config: FinDslTestRunConfiguration,
    environment: ExecutionEnvironment,
) : CommandLineState(environment) {

    override fun startProcess(): ProcessHandler {
        val cli = FinDslNativeBinary.resolveOrExtract(
            exeBase = "findsl",
            resourceDir = "cli",
            cacheSubdir = "findsl-cli",
            sysProp = "findsl.cli.path",
            envVar = "FINDSL_CLI_PATH",
        )
        val commandLine = GeneralCommandLine(cli.toString(), "test", config.target, "--reporter=teamcity")
            .withCharset(StandardCharsets.UTF_8)
        config.project.basePath?.let { commandLine.withWorkDirectory(it) }
        val handler = KillableColoredProcessHandler(commandLine)
        ProcessTerminatedListener.attach(handler)
        return handler
    }

    override fun execute(executor: Executor, runner: ProgramRunner<*>): ExecutionResult {
        val processHandler = startProcess()
        val console = SMTestRunnerConnectionUtil.createAndAttachConsole(
            FINDSL_TEST_FRAMEWORK,
            processHandler,
            config.createTestConsoleProperties(executor),
        )
        return DefaultExecutionResult(console, processHandler)
    }
}

/** Minimaler Editor: ein Feld für das Test-Ziel (vom Producer i. d. R. vorbefüllt). */
private class FinDslTestSettingsEditor : SettingsEditor<FinDslTestRunConfiguration>() {
    private val targetField = JBTextField()

    override fun resetEditorFrom(s: FinDslTestRunConfiguration) {
        targetField.text = s.target
    }

    override fun applyEditorTo(s: FinDslTestRunConfiguration) {
        s.target = targetField.text
    }

    override fun createEditor(): JComponent =
        FormBuilder.createFormBuilder()
            .addLabeledComponent("Ziel (Datei, Ordner oder Glob):", targetField)
            .panel
}
