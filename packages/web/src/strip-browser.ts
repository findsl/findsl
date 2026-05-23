// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Browser-JS-Strip via `typescript` transpileModule (ersetzt den Node-only
 * `node:module.stripTypeScriptTypes` der CLI). Deterministisch (string→string,
 * kein fs). Wird per dynamischem Import lazy geladen (eigener Chunk), damit
 * der ~MB-schwere Compiler nur beim js-Target zieht.
 */

import * as ts from 'typescript';

export function tsToJs(tsSource: string): string {
    return ts.transpileModule(tsSource, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            removeComments: false,
            newLine: ts.NewLineKind.LineFeed,
        },
        reportDiagnostics: false,
    }).outputText;
}
