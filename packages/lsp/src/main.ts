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
import { setHoverSvgFileWriter } from '@findsl/core/language/hover-svg-writer.js';
import { svgToHoverFileUrl } from '@findsl/core/language/hover-math-svg-file.js';

// Robustheit: Ein langlaufender LSP-Server darf nicht an einer einzelnen
// unbehandelten Promise-Rejection sterben. Konkreter Fall: Sendet der Server
// einen `window/showMessageRequest` (u. a. über `connection.window.show*Message`,
// z. B. nach einem `prüfe`-Lauf), kann ein Client wie IntelliJ/LSP4IJ diese
// Anfrage canceln (RequestCancelled, -32800). Die zurückgegebene Promise rejectet
// dann; seit Node 15 beendet eine unbehandelte Rejection den Prozess — der Server
// stürbe still ab und ALLE LSP-Features wären weg (in VS Code via IPC trat das
// nicht auf, da dort nicht gecancelt wird). Daher global abfangen und auf stderr
// loggen — NICHT auf stdout, das ist bei `--stdio` der LSP-Transport.
process.on('unhandledRejection', (reason) => {
    console.error('[findsl-lsp] Unbehandelte Promise-Rejection (Server läuft weiter):', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[findsl-lsp] Unbehandelte Ausnahme (Server läuft weiter):', err);
});

// Node-Kontext (#250): den file://-SVG-Writer für Hover-Formeln registrieren.
// Clients ohne data:-URL-Bild im Hover (IntelliJ/LSP4IJ) bekommen die Formel so
// als SVG-Datei. Im Browser-LSP-Worker bleibt der Writer ungesetzt (data:-Pfad).
setHoverSvgFileWriter(svgToHoverFileUrl);

const connection = createConnection(ProposedFeatures.all);
const { shared } = createFindslServices({ connection, ...NodeFileSystem });
startLanguageServer(shared);
