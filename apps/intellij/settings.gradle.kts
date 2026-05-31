// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

rootProject.name = "findsl-intellij"

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
    }
}

// Die IntelliJ-Platform-/Marketplace-Repositories werden im build.gradle.kts
// über `intellijPlatform { defaultRepositories() }` definiert (Plugin-2.x-
// Konvention) → Project-Repositories zulassen.
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_PROJECT)
}
