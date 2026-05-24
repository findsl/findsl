// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Geteilte esbuild-Browser-Konfiguration für @findsl/web: die `alias`-Map,
 * die Node-Schichten (node:path/fs/module, langium/node, Node-pdfmake-Printer
 * + pdfkit) durch Browser-Shims/Stubs ersetzt. Vom Produktiv-Build
 * (`esbuild.web.mjs`) UND vom Bundle-Test (`test/pdf-bundle.test.ts`) genutzt,
 * damit der Test exakt dieselbe Browser-Auflösung prüft wie das Release-Bundle
 * (sonst entgeht ihm genau die CJS/ESM-Interop-Klasse aus Issue #136).
 */

import * as path from 'node:path';

/**
 * Liefert die Browser-`alias`-Map mit absoluten Shim-Pfaden relativ zum
 * Paketverzeichnis `pkgDir` (das `packages/web`, in dem `src/shims/` liegt).
 */
export function browserAlias(pkgDir) {
    const shim = (f) => path.join(pkgDir, 'src', 'shims', f);
    return {
        'node:path': shim('path.ts'),
        'node:fs': shim('fs.ts'),
        'node:fs/promises': shim('fs-promises.ts'),
        'node:module': shim('module.ts'),
        // Nackte (präfixlose) Builtins ebenfalls aliasen — falls Core/Deps
        // mal `from 'fs'` statt `from 'node:fs'` nutzen (umginge sonst Alias
        // UND Guard).
        path: shim('path.ts'),
        fs: shim('fs.ts'),
        'fs/promises': shim('fs-promises.ts'),
        module: shim('module.ts'),
        'langium/node': shim('langium-node.ts'),
        // Node-pdfmake-Printer (pdfkit) — von docgen/pdf.ts importiert, aber
        // im Browser ungenutzt (wir nehmen nur buildPdfDoc). Stub statt
        // pdfkit + ~9 Polyfills.
        'pdfmake/js/Printer.js': shim('empty.ts'),
        'pdfmake/js/virtual-fs.js': shim('empty.ts'),
        'pdfmake/js/URLResolver.js': shim('empty.ts'),
        'pdfkit': shim('empty.ts'),
    };
}
