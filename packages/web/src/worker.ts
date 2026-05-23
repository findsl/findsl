// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * @findsl/web/worker — FinDSL-Language-Server im Browser (Web-Worker).
 *
 * Startet dieselbe Langium-Engine wie die VS-Code-Extension (kein VSIX, nur
 * der Server) über `EmptyFileSystem` — § -Hover, Completion, Diagnostics,
 * Semantic Tokens. Custom Requests `findsl/check` und `findsl/generate`
 * folgen in Phase 3/4 auf derselben Connection.
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

declare const self: DedicatedWorkerGlobalScope;

const connection = createConnection(
    new BrowserMessageReader(self),
    new BrowserMessageWriter(self),
);

const { shared } = createFindslServices({ connection, ...EmptyFileSystem });

startLanguageServer(shared);
