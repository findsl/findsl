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
 *
 * Bewusst NICHT angekündigt: `refactor.*`. Das kommt erst mit Phase B
 * (Konstante extrahieren), zusammen mit dem produzierenden Code.
 */

import { DefaultLanguageServer } from 'langium/lsp';
import { CodeActionKind, type InitializeParams, type InitializeResult } from 'vscode-languageserver';

/** Die vom CodeActionProvider real erzeugten Kinds (Phase A). */
const FINDSL_CODE_ACTION_KINDS: readonly string[] = [
    CodeActionKind.QuickFix,
    CodeActionKind.SourceOrganizeImports,
];

export class FindslLanguageServer extends DefaultLanguageServer {
    protected override buildInitializeResult(params: InitializeParams): InitializeResult {
        const result = super.buildInitializeResult(params);
        // Nur ersetzen, wenn der Provider tatsächlich gebunden ist (Langium
        // setzt dann `true`); sonst die Default-Entscheidung respektieren.
        if (result.capabilities.codeActionProvider) {
            result.capabilities.codeActionProvider = {
                codeActionKinds: [...FINDSL_CODE_ACTION_KINDS],
            };
        }
        return result;
    }
}
