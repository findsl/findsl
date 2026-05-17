// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * FinDSL Language Server — Entry-Point.
 *
 * Wird von der VS-Code-Extension (und anderen LSP-Clients) als
 * separater Prozess gestartet. Spricht LSP über stdin/stdout.
 */

import { startLanguageServer } from 'langium/lsp';
import { NodeFileSystem } from 'langium/node';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node.js';
import { createFindslServices } from '@findsl/core/language/findsl-module.js';

const connection = createConnection(ProposedFeatures.all);
const { shared } = createFindslServices({ connection, ...NodeFileSystem });
startLanguageServer(shared);
