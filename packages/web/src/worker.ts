// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * @findsl/web/worker — FinDSL-Language-Server im Browser (Web-Worker).
 *
 * Startet dieselbe Langium-Engine wie die VS-Code-Extension (kein VSIX, nur
 * der Server) über `EmptyFileSystem` — § -Hover, Completion, Diagnostics,
 * Semantic Tokens. Custom Requests `findsl/check`, `findsl/generate` und
 * `findsl/eval` (Ausdruck im Browser auswerten, Issue #164) auf derselben
 * Connection.
 *
 * Single Source: `@findsl/core`. node:-Imports (path/fs) der Sprachdienste
 * werden im Browser-Build via esbuild-`alias` durch Shims ersetzt
 * (siehe esbuild.web.mjs).
 */

import { EmptyFileSystem } from 'langium';
import { startLanguageServer } from 'langium/lsp';
import {
    BrowserMessageReader,
    BrowserMessageWriter,
    createConnection,
} from 'vscode-languageserver/browser';
import { createFindslServices } from '@findsl/core/language/findsl-module.js';
import { registerLinkedEditingRangeHandler } from '@findsl/core/language/findsl-linked-editing.js';
import { runCheck } from './check.js';
import { runGenerate } from './generate.js';
import { runEval } from './eval.js';
import type { CheckResult, EvalResult, GenerateResult, Target } from './types.js';

declare const self: DedicatedWorkerGlobalScope;

const connection = createConnection(
    new BrowserMessageReader(self),
    new BrowserMessageWriter(self),
);

const { shared } = createFindslServices({ connection, ...EmptyFileSystem });

// Custom Requests auf derselben Connection (vor dem Listen via
// startLanguageServer registrieren).
connection.onRequest(
    'findsl/check',
    (params: { uri: string }): Promise<CheckResult> => runCheck(shared, params.uri),
);
connection.onRequest(
    'findsl/generate',
    (params: { uri: string; target: Target; className?: string }): Promise<GenerateResult> =>
        runGenerate(shared, params.uri, params.target, { className: params.className }),
);
connection.onRequest(
    'findsl/eval',
    (params: { uri: string; expr: string }): Promise<EvalResult> =>
        runEval(shared, params.uri, params.expr),
);

// Linked Editing (#21): Langium verdrahtet diesen Request nicht selbst.
registerLinkedEditingRangeHandler(connection, shared);

startLanguageServer(shared);
