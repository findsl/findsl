// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * `findsl/check` — führt die `prüfe`-Fälle des offenen Dokuments bit-genau wie
 * CLI-`test` aus (`runPruefe`, derselbe decimal.js-Interpreter). Single-File:
 * das Dokument liegt im LSP-`LangiumDocuments` (vom Editor geöffnet).
 */

import { URI } from 'langium';
import { runPruefe } from '@findsl/core/interpret/pruefe.js';
import type { Program } from '@findsl/core/language/generated/ast.js';
import type { CheckResult, Diagnostic, PruefeCase } from './types.js';

interface SharedLike {
    workspace: {
        LangiumDocuments: {
            getDocument(uri: URI): {
                parseResult: { value: unknown };
                diagnostics?: Diagnostic[];
            } | undefined;
        };
        DocumentBuilder: {
            build(docs: unknown[], opts?: { validation?: boolean }): Promise<void>;
        };
    };
}

function jetzt(): number {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export async function runCheck(shared: SharedLike, uri: string): Promise<CheckResult> {
    const t0 = jetzt();
    const document = shared.workspace.LangiumDocuments.getDocument(URI.parse(uri));
    if (!document) {
        return { cases: [], passed: 0, total: 0, durationMs: 0, diagnostics: [] };
    }
    // Linking/Validierung sicherstellen (runPruefe braucht aufgelöste Referenzen).
    await shared.workspace.DocumentBuilder.build([document], { validation: true });
    const program = document.parseResult.value as Program;
    const report = runPruefe(program);

    const cases: PruefeCase[] = report.results.map((r) => ({
        name: r.pruefeName ? `${r.pruefeName} › ${r.testfallLabel}` : r.testfallLabel,
        status: r.status,
        message: r.detail || undefined,
    }));

    return {
        cases,
        passed: report.passed,
        total: report.total,
        durationMs: Math.round(jetzt() - t0),
        diagnostics: document.diagnostics ?? [],
    };
}
