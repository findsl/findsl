// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

// Bewusst minimal-deklaratives Kotlin-DSL (Audit/Determinismus, ADR2):
// keine imperative Build-Logik, alle Versionen im Versionskatalog
// gepinnt, JDK-Toolchain fest auf 21 (ADR9), Daemon aus (reproduzierbar).

plugins {
    `java-library`
}

group = "org.findsl"
// Single Source of Truth: die Projektversion lebt in der Datei `VERSION`
// (deklarativ gelesen, trim() gegen abschließenden Zeilenumbruch). Finaler
// Versions-Pin in Phase 4 (mit dem generierten Code gekoppelt).
version = file("VERSION").readText().trim()

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation(platform(libs.junit.bom))
    testImplementation(libs.junit.jupiter)
    testRuntimeOnly(libs.junit.platform.launcher)
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "failed", "skipped")
    }
}
