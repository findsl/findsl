// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see ../../LICENSE) OR a commercial licence
// from devtank42 GmbH (see ../../LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl

import com.intellij.ide.FileIconProvider
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import javax.swing.Icon

/**
 * Datei-Icon für `.findsl` ohne eigenen `FileType` — ein eigener FileType würde
 * das TextMate-Highlighting der Community Edition deaktivieren (siehe
 * [FinDslBundleProvider]). `FileIconProvider` wird vor dem FileType-Icon und
 * für jede `VirtualFile` konsultiert, also unabhängig vom (fehlenden) FileType.
 */
class FinDslFileIconProvider : FileIconProvider {
    override fun getIcon(file: VirtualFile, flags: Int, project: Project?): Icon? =
        if ("findsl".equals(file.extension, ignoreCase = true)) FinDslIcons.FILE else null
}
