// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

// Bewusst minimal-deklaratives Kotlin-DSL (Audit/Determinismus, ADR2):
// alle Versionen im Versionskatalog gepinnt, JDK-Toolchain fest auf 21
// (ADR9), Daemon aus (reproduzierbar).
//
// Zusätzlich (Issue #7): in der Verifikationsphase wird aus den FinDSL-
// Beispieldateien (`examples/**/*.findsl`) über das Node-Codegen-CLI
// Java erzeugt, kompiliert und doppelt geprüft:
//   • `generatedTest`  — das generierte `prüfe`→JUnit (= Interpreter-
//                         Orakel, bit-genau; runPruefeDecl-Spiegel)
//   • `structureTest`  — Form-Invarianten des Generats via JavaParser
// `test` bleibt davon UNBERÜHRT (nur die handgeschriebene Runtime —
// schnell, JDK-only, ohne Node); das volle Gate hängt an `check`.

plugins {
    `java-library`
}

group = "org.findsl"
// Single Source of Truth: die Projektversion lebt in der Datei `VERSION`.
version = file("VERSION").readText().trim()

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

// --- Monorepo-Bezug (runtimes/java/ ist Gradle-Root; Repo-Root = ../../) ---
val repoRoot = rootDir.parentFile.parentFile
val codegenCli = repoRoot.resolve("packages/cli/out/main.js")
val examplesDir = repoRoot.resolve("examples")
val genMainDir = layout.buildDirectory.dir("generated/sources/codegen")
val genTestDir = layout.buildDirectory.dir("generated/sources/codegen-test")

// --- Isolierte Source-Sets: Generat NICHT mit der Hand-Runtime mischen ---
sourceSets {
    create("generated") {
        java.setSrcDirs(listOf(genMainDir))
    }
    create("generatedTest") {
        java.setSrcDirs(listOf(genTestDir))
    }
    create("structureTest") {
        java.setSrcDirs(listOf("src/structureTest/java"))
    }
}

val mainOut = sourceSets["main"].output
val generatedOut = sourceSets["generated"].output

sourceSets["generated"].apply {
    compileClasspath += mainOut
    runtimeClasspath += mainOut
}
sourceSets["generatedTest"].apply {
    compileClasspath += mainOut + generatedOut
    runtimeClasspath += mainOut + generatedOut
}

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)

    // Generiertes prüfe→JUnit läuft unter der gepinnten Catalog-Engine
    // (eine JUnit-Welt — kein separates console-standalone-JAR mehr).
    "generatedTestImplementation"(platform(libs.junit.bom))
    "generatedTestImplementation"(libs.junit.jupiter)
    "generatedTestRuntimeOnly"(libs.junit.platform.launcher)

    // Struktur-Tests: JUnit + reiner Source-AST-Parser (liest die
    // generierten Dateien, prüft nur Form — keine Wert-Semantik).
    "structureTestImplementation"(platform(libs.junit.bom))
    "structureTestImplementation"(libs.junit.jupiter)
    "structureTestImplementation"(libs.javaparser.core)
    "structureTestRuntimeOnly"(libs.junit.platform.launcher)
}

// --- node-Executable-Auflösung: Configuration-Cache-sauber ---
// Wird Gradle aus einer IDE/GUI gestartet, erbt es den launchd-PATH
// (NICHT die Shell-rc) — nvm/Homebrew-`node` ist dann nicht im PATH.
// Reihenfolge: explizite Vorgabe → Prozess-PATH → bekannte Orte.
// Alle Quellen über `providers.*` (NICHT `System.getenv`/`project.find…`)
// → Config-Cache erkennt Änderungen sauber als Input.
val findslNodeProperty = providers.gradleProperty("findsl.node")
val findslNodeEnv = providers.environmentVariable("FINDSL_NODE")
val nodeEnv = providers.environmentVariable("NODE")
val pathEnv = providers.environmentVariable("PATH")
val userHomeSys = providers.systemProperty("user.home")
val osNameSys = providers.systemProperty("os.name")

// --- Codegen: Node-CLI → generated/ + generated-test/ ---
val generateFindslJava by tasks.registering(Exec::class) {
    group = "codegen"
    description = "Generiert Java aus examples/**/*.findsl (Interface+Impl → " +
        "generated; prüfe→JUnit → generatedTest)."

    // Alle Script-Level-Werte als TASK-LOKALE vals einfangen — sonst
    // referenziert die `doFirst`-Aktion das umgebende `Build_gradle`-
    // Script-Objekt und der Configuration-Cache scheitert beim
    // (De-)Serialisieren mit „cannot (de)serialize Gradle script object
    // references". Locals werden als ganz normale Closure-Captures
    // serialisiert.
    val codegenCliFile = codegenCli
    val examplesDirFile = examplesDir
    val genMainProvider = genMainDir
    val genTestProvider = genTestDir
    val nodePropProvider = findslNodeProperty
    val findslNodeEnvProvider = findslNodeEnv
    val nodeEnvProvider = nodeEnv
    val pathEnvProvider = pathEnv
    val userHomeProvider = userHomeSys
    val osNameProvider = osNameSys

    inputs.files(fileTree(examplesDirFile) { include("**/*.findsl") })
        .withPropertyName("findslSources")
        .withPathSensitivity(PathSensitivity.RELATIVE)
    // Vertrag (minimale Monorepo-Kopplung): `npm run build` baut das
    // CLI; hier nur Input (Re-Gen bei CLI-Änderung). Fehlt es → klarer
    // Fehler in doFirst (NICHT still grün).
    inputs.files(codegenCliFile).withPropertyName("codegenCli")
    outputs.dir(genMainProvider).withPropertyName("generatedMain")
    outputs.dir(genTestProvider).withPropertyName("generatedTest")

    doFirst {
        if (!codegenCliFile.exists()) {
            throw GradleException(
                "Codegen-CLI fehlt: $codegenCliFile\n" +
                "Bitte zuerst im Repo-Root `npm run build` ausführen " +
                "(Gradle baut bewusst kein TypeScript — minimale Kopplung).",
            )
        }
        // Node-Resolution inline (eine Top-Level-`fun` würde wieder das
        // Script-Objekt referenzieren → Configuration-Cache-Fehler).
        val osName = osNameProvider.get()
        val exe = if (osName.lowercase().contains("win")) "node.exe" else "node"
        val explicit = nodePropProvider.orNull
            ?: findslNodeEnvProvider.orNull
            ?: nodeEnvProvider.orNull
        var node: File? = null
        // 1) explizite Vorgabe (höchste Priorität, reproduzierbar/CI)
        if (!explicit.isNullOrBlank()) {
            val f = File(explicit)
            if (f.isFile && f.canExecute()) node = f
        }
        // 2) PATH des Gradle-Prozesses
        if (node == null) {
            node = (pathEnvProvider.orNull ?: "").split(File.pathSeparatorChar)
                .asSequence()
                .filter { it.isNotBlank() }
                .map { File(it, exe) }
                .firstOrNull { it.isFile && it.canExecute() }
        }
        // 3) bekannte Installationsorte
        if (node == null) {
            val userHome = userHomeProvider.get()
            val candidates = mutableListOf(
                File("/opt/homebrew/bin/$exe"),     // Homebrew (Apple Silicon)
                File("/usr/local/bin/$exe"),        // Homebrew (Intel) / manuell
                File("/usr/bin/$exe"),              // System
                File("$userHome/.volta/bin/$exe"),
                File("$userHome/.asdf/shims/$exe"),
            )
            File("$userHome/.nvm/versions/node").takeIf { it.isDirectory }
                ?.listFiles { f -> f.isDirectory }
                ?.maxByOrNull { it.name }           // höchste nvm-Version
                ?.let { candidates.add(File(it, "bin/$exe")) }
            node = candidates.firstOrNull { it.isFile && it.canExecute() }
        }
        if (node == null) {
            throw GradleException(
                "`node` nicht gefunden. Gradle aus einer IDE/GUI erbt NICHT " +
                "den Shell-PATH (nvm/Homebrew). Abhilfe (eine genügt):\n" +
                "  • mit explizitem Pfad:  ./gradlew check -Pfindsl.node=$(which node)\n" +
                "  • per Umgebungsvariable: FINDSL_NODE=$(which node) ./gradlew check\n" +
                "  • oder ./gradlew aus einem Terminal mit `node` im PATH starten\n" +
                "  • oder via Repo-Root: `npm run codegen:difftest`",
            )
        }
        // Bare `node` (aus commandLine) durch absoluten Pfad ersetzen;
        // die `args` bleiben unverändert.
        executable = node.absolutePath
        // Deterministisch: stale Generat entfernen (das CLI räumt das
        // Zielverzeichnis nicht selbst). Pure java.io — KEINE Project-API
        // in der Task-Aktion (Configuration-Cache-kompatibel).
        for (dir in listOf(genMainProvider.get().asFile, genTestProvider.get().asFile)) {
            if (dir.exists()) {
                dir.walkBottomUp().forEach { it.delete() }
            }
        }
    }

    commandLine(
        "node", codegenCliFile.absolutePath, "codegen", examplesDirFile.absolutePath,
        "-l", "java",
        "-o", genMainProvider.get().asFile.absolutePath,
        "-t", genTestProvider.get().asFile.absolutePath,
    )
}

tasks.named("compileGeneratedJava") { dependsOn(generateFindslJava) }
tasks.named("compileGeneratedTestJava") { dependsOn(generateFindslJava) }

// --- Verifikation ---
tasks.test {
    useJUnitPlatform()
    testLogging { events("passed", "failed", "skipped") }
}

// Bit-Genauigkeit: das generierte `prüfe`→JUnit gegen die Runtime
// (= Interpreter-Orakel, runPruefeDecl-Spiegel — unveränderte Aussage
// wie bisher der difftest).
val generatedTest by tasks.registering(Test::class) {
    group = "verification"
    description = "Führt das generierte prüfe→JUnit aus (bit-genau zum " +
        "Interpreter-Orakel)."
    testClassesDirs = sourceSets["generatedTest"].output.classesDirs
    classpath = sourceSets["generatedTest"].runtimeClasspath
    useJUnitPlatform()
    testLogging { events("passed", "failed", "skipped") }
    dependsOn(tasks.named("compileGeneratedTestJava"))
}

// Form-Invarianten des Generats (JavaParser; keine Wert-Semantik).
val structureTest by tasks.registering(Test::class) {
    group = "verification"
    description = "Prüft die Struktur des generierten Java (JavaParser)."
    testClassesDirs = sourceSets["structureTest"].output.classesDirs
    classpath = sourceSets["structureTest"].runtimeClasspath
    useJUnitPlatform()
    testLogging { events("passed", "failed", "skipped") }
    systemProperty("findsl.gen.main", genMainDir.get().asFile.absolutePath)
    systemProperty("findsl.gen.test", genTestDir.get().asFile.absolutePath)
    dependsOn(generateFindslJava)
}

// `test` = nur Runtime (Isolation/ADR10). Volles Gate an `check`.
tasks.named("check") {
    dependsOn(generatedTest, structureTest)
}
