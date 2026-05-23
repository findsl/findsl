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
    const out = ts.transpileModule(tsSource, {
        compilerOptions: {
            target: ts.ScriptTarget.ES2022,
            module: ts.ModuleKind.ESNext,
            removeComments: false,
            newLine: ts.NewLineKind.LineFeed,
        },
        reportDiagnostics: true,
    });
    // Der Input ist Emitter-Output (immer valides TS); eine Diagnose deutet
    // auf einen Emitter-Bug → werfen statt still leeres JS (ok:true) liefern.
    const fehler = (out.diagnostics ?? []).filter(
        (d) => d.category === ts.DiagnosticCategory.Error,
    );
    if (fehler.length > 0) {
        const msg = fehler
            .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
            .join('; ');
        throw new Error(`JS-Strip-Diagnose: ${msg}`);
    }
    return out.outputText;
}
