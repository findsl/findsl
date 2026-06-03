// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    kotlin("jvm") version "2.4.0"
    id("org.jetbrains.intellij.platform") version "2.16.0"
}

group = providers.gradleProperty("pluginGroup").get()
// Single Source of Truth: die Lockstep-Version lebt an der Repo-Wurzel
// (`<repo>/VERSION`) und wird hier direkt gelesen — kein zweiter Schreibort,
// kein Eintrag in gradle.properties, keine sync-version-Sonderbehandlung.
// `apps/intellij` liegt zwei Ebenen unter der Wurzel (wie `runtimes/java`).
version = rootDir.parentFile.parentFile.resolve("VERSION").readText().trim()

repositories {
    mavenCentral()
    // Pflicht in Plugin-2.x: stellt IDE-Artefakte UND Marketplace-Plugins bereit.
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Ziel-IDE: Community (kleinster gemeinsamer Nenner; läuft auch in Ultimate).
        create(
            IntelliJPlatformType.IntellijIdeaCommunity,
            providers.gradleProperty("platformVersion").get(),
        )
        // LSP4IJ als Marketplace-Plugin-Abhängigkeit (com.redhat.devtools.lsp4ij).
        // `plugin(...)`, NICHT `bundledPlugin(...)` — LSP4IJ wird nicht mit der
        // IDE ausgeliefert.
        plugin("com.redhat.devtools.lsp4ij", providers.gradleProperty("lsp4ijVersion").get())

        // Gebündeltes TextMate-Plugin: liefert die TextMateBundleProvider-API
        // (syntaktisches Highlighting via TextMate-Grammar, siehe
        // FinDslBundleProvider) — `bundledPlugin`, da mit der IDE ausgeliefert.
        bundledPlugin("org.jetbrains.plugins.textmate")

        testFramework(TestFrameworkType.Platform)
    }

    // JUnit4 für reine Unit-Tests (z. B. BinaryPathResolverTest) — das
    // Platform-Test-Framework exponiert es nicht auf dem Compile-Classpath.
    testImplementation("junit:junit:4.13.2")
}

kotlin {
    jvmToolchain(21)
}

intellijPlatform {
    // `buildSearchableOptions` startet eine Headless-IDE (`traverseUI`), um die
    // Settings-Suche vorzuindizieren — bekannt flaky (Sandbox-/Instanz-Kollision,
    // „External instance command", Boot-Timeouts) und nur eine Optimierung: die
    // Einstellungen (Settings → FinDSL) bleiben auch ohne Vorindex voll
    // durchsuchbar. Deaktiviert für robustes `buildPlugin` (auch im #244-Release);
    // entspricht dem JetBrains-Plugin-Template-Default.
    buildSearchableOptions = false

    pluginConfiguration {
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            // Offen nach oben (kein untilBuild) — wie LSP4IJ selbst.
            untilBuild = provider { null }
        }
    }
    // Signing/Publishing (#244). Werte aus Umgebungsvariablen (CI-Secrets) —
    // leer ⇒ `buildPlugin`/`runIde` bleiben unberührt; NUR `signPlugin`/
    // `publishPlugin` brauchen sie. Zertifikat-Beschaffung = #245.
    signing {
        certificateChain = providers.environmentVariable("JETBRAINS_CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("JETBRAINS_PRIVATE_KEY")
        password = providers.environmentVariable("JETBRAINS_PRIVATE_KEY_PASSWORD")
    }
    publishing {
        token = providers.environmentVariable("JETBRAINS_PUBLISH_TOKEN")
        // Pre-Releases (rc/eap) gehen in einen separaten Marketplace-Kanal;
        // Default = stabiler Kanal. Steuerbar über JETBRAINS_PUBLISH_CHANNEL.
        channels = providers.environmentVariable("JETBRAINS_PUBLISH_CHANNEL")
            .map { listOf(it) }
            .orElse(listOf("default"))
    }
}

// ---------------------------------------------------------------------------
// Server-Binary einbetten (#239 → #240)
// ---------------------------------------------------------------------------
// Der host-neutrale LSP-Server wird als natives Binary (`npm run binary:lsp`,
// Ausgabe packages/lsp/dist/findsl-lsp[.exe]) in die Plugin-Ressourcen unter
// `server/` gelegt; die FinDslLanguageServerFactory extrahiert und startet es
// mit `--stdio`. Fehlt das Binary (z. B. reiner Gerüst-Build in CI ohne
// vorheriges `binary:lsp`), wird der Schritt übersprungen — `buildPlugin`
// bleibt grün, der Server fehlt dann nur zur Laufzeit (Dev: `FINDSL_LSP_PATH`
// als Override, siehe Factory). Die robuste Distributionsstrategie ist #243.
val lspBinaryName =
    if (org.gradle.internal.os.OperatingSystem.current().isWindows) "findsl-lsp.exe" else "findsl-lsp"
val lspBinaryFile = layout.projectDirectory.file("../../packages/lsp/dist/$lspBinaryName")

val embedLspServer by tasks.registering(Copy::class) {
    description = "Kopiert das native LSP-Server-Binary in die Plugin-Ressourcen (server/)."
    val binary = lspBinaryFile.asFile
    onlyIf {
        val ok = binary.exists()
        if (!ok) {
            logger.warn(
                "[findsl] LSP-Binary fehlt: ${binary.path} — `npm run binary:lsp` im Repo-Root ausführen. "
                    + "Build läuft weiter; der Server fehlt zur Laufzeit (oder FINDSL_LSP_PATH setzen).",
            )
        }
        ok
    }
    from(binary)
    into(layout.buildDirectory.dir("generated-resources/server"))
}

// CLI-Binary einbetten (#256) — der Test-Runner (FinDslTestRunConfiguration)
// startet `findsl test … --reporter=teamcity`. Gleiche Strategie wie der
// LSP-Server: fehlt das Binary, wird der Schritt übersprungen (Dev:
// `FINDSL_CLI_PATH` als Override, siehe FinDslNativeBinary). Distribution → #243.
val cliBinaryName =
    if (org.gradle.internal.os.OperatingSystem.current().isWindows) "findsl.exe" else "findsl"
val cliBinaryFile = layout.projectDirectory.file("../../packages/cli/dist/$cliBinaryName")

val embedCliBinary by tasks.registering(Copy::class) {
    description = "Kopiert das native CLI-Binary in die Plugin-Ressourcen (cli/)."
    val binary = cliBinaryFile.asFile
    onlyIf {
        val ok = binary.exists()
        if (!ok) {
            logger.warn(
                "[findsl] CLI-Binary fehlt: ${binary.path} — `npm run binary:cli` im Repo-Root ausführen. "
                    + "Build läuft weiter; der Test-Runner fehlt zur Laufzeit (oder FINDSL_CLI_PATH setzen).",
            )
        }
        ok
    }
    from(binary)
    into(layout.buildDirectory.dir("generated-resources/cli"))
}

sourceSets {
    named("main") {
        resources.srcDir(layout.buildDirectory.dir("generated-resources"))
    }
}

tasks.named("processResources") {
    dependsOn(embedLspServer, embedCliBinary)
}
