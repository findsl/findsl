// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * FinDSL-LanguageServer — überschreibt nur den Aufbau der
 * `InitializeResult`-Capabilities.
 *
 * Hintergrund (Issue #90, Phase A): Langiums {@link DefaultLanguageServer}
 * meldet `codeActionProvider` lediglich als Boolean (`true`), sobald ein
 * `CodeActionProvider` gebunden ist — OHNE `codeActionKinds`. Damit kennt
 * VS Code die unterstützten Kinds nicht und blendet u.a. den
 * „Organize Imports"-Command (`source.organizeImports`) für `.findsl`
 * komplett aus; auch der vscode-languageclient registriert dann keinen
 * kind-spezifischen Provider.
 *
 * Wir kündigen daher exakt die Kinds an, die
 * {@link import('./findsl-codeaction.js').FindslCodeActionProvider}
 * tatsächlich liefert:
 *   - `quickfix`               — ungenutzten Import / einzelnes Symbol entfernen
 *   - `source.organizeImports` — Importe sortieren + dedupen
 *   - `refactor.extract`       — Konstante extrahieren (Phase B)
 */

import { DefaultLanguageServer } from 'langium/lsp';
import { CodeActionKind, type InitializeParams, type InitializeResult } from 'vscode-languageserver';
import { setClientName, setClientTheme } from './client-math-mode.js';

/** Die vom CodeActionProvider real erzeugten Kinds. */
const FINDSL_CODE_ACTION_KINDS: readonly string[] = [
    CodeActionKind.QuickFix,
    CodeActionKind.SourceOrganizeImports,
    CodeActionKind.RefactorExtract,
];

export class FindslLanguageServer extends DefaultLanguageServer {
    protected override buildInitializeResult(params: InitializeParams): InitializeResult {
        // Client-Kontext merken (#250): Name bestimmt den Hover-Formel-Modus
        // (VS Code → data:-URL-SVG; IntelliJ/LSP4IJ → file://-SVG). Das Theme aus
        // den initializationOptions setzt die feste Formelfarbe im file://-Pfad
        // (IntelliJs SVG-Loader wertet keine prefers-color-scheme-Query aus).
        setClientName(params.clientInfo?.name);
        const initOpts = params.initializationOptions as { findsl?: { theme?: unknown } } | undefined;
        setClientTheme(initOpts?.findsl?.theme);
        const result = super.buildInitializeResult(params);
        // SelectionRange (#19): Langium meldet die Capability nicht (kein
        // Default-Service). Der Provider ist in FinDSL immer gebunden und der
        // Handler wird am Entrypoint registriert (main.ts / worker.ts) →
        // Capability hier unbedingt ankündigen.
        result.capabilities.selectionRangeProvider = true;
        // Nur ersetzen, wenn der Provider tatsächlich gebunden ist (Langium
        // setzt dann `true`); sonst die Default-Entscheidung respektieren.
        if (result.capabilities.codeActionProvider) {
            result.capabilities.codeActionProvider = {
                codeActionKinds: [...FINDSL_CODE_ACTION_KINDS],
            };
        }
        // Linked Editing (#21): Capability selbst ankündigen — Langium kennt
        // den Service nicht, der Handler wird in den Entry-Points verdrahtet
        // (registerLinkedEditingRangeHandler).
        result.capabilities.linkedEditingRangeProvider = true;
        return result;
    }
}
