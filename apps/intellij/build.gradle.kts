// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType

plugins {
    kotlin("jvm") version "2.2.0"
    id("org.jetbrains.intellij.platform") version "2.16.0"
}

group = providers.gradleProperty("pluginGroup").get()
version = providers.gradleProperty("pluginVersion").get()

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

        testFramework(TestFrameworkType.Platform)
    }
}

kotlin {
    jvmToolchain(21)
}

intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild = providers.gradleProperty("pluginSinceBuild")
            // Offen nach oben (kein untilBuild) — wie LSP4IJ selbst.
            untilBuild = provider { null }
        }
    }
    // Signing/Publishing (signPlugin/publishPlugin) werden erst im Release-Setup
    // (#244/#245) mit Zertifikaten/Token konfiguriert — lokal `buildPlugin`/
    // `runIde` brauchen sie nicht.
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

sourceSets {
    named("main") {
        resources.srcDir(layout.buildDirectory.dir("generated-resources"))
    }
}

tasks.named("processResources") {
    dependsOn(embedLspServer)
}
