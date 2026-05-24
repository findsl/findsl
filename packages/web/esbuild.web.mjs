// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Browser-Build für @findsl/web (esbuild, platform:browser, format:esm).
 * node:path/fs/module der Sprachdienste werden via `alias` durch Browser-
 * Shims ersetzt. GUARD: schlägt fehl bei verbliebenen node:-Specifiern oder
 * wenn `@findsl/cli` (Node-Schicht) in den Graph gerät.
 */

import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shim = (f) => path.join(__dirname, 'src', 'shims', f);

// worker = Laufzeit (LSP + check/generate); index = `.`-Export (nur Typen,
// die .d.ts liefert tsc separat im build:web).
const entryPoints = { worker: 'src/worker.ts', index: 'src/index.ts' };

const result = await esbuild.build({
    absWorkingDir: __dirname,
    entryPoints,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outdir: 'dist',
    // Code-Splitting: lazy `import()` (z. B. typescript für js, später
    // pdfmake/mathjax für pdf) landet in eigenen Chunks statt im Worker.
    splitting: true,
    chunkNames: 'chunks/[name]-[hash]',
    metafile: true,
    logLevel: 'warning',
    alias: {
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
    },
});

// --- Editor-Assets für Konsumenten (z. B. findsl/website-Playground) ---
// TextMate-Grammatik + language-configuration mitliefern, damit ein Monaco-
// Editor 1:1 wie die VS-Code-Extension hervorhebt — versioniert zusammen mit
// dem Worker, also kein Vendoring/Sync auf Konsumentenseite. Single Source:
// Grammatik aus packages/core/syntaxes (vgl. scripts/copy-assets.mjs, das sie
// auch in die Extension spiegelt), language-configuration aus apps/vscode.
const editorAssets = [
    ['../core/syntaxes/findsl.tmLanguage.json', 'dist/findsl.tmLanguage.json'],
    ['../../apps/vscode/language-configuration.json', 'dist/language-configuration.json'],
];
for (const [from, to] of editorAssets) {
    fs.mkdirSync(path.dirname(path.join(__dirname, to)), { recursive: true });
    fs.copyFileSync(path.join(__dirname, from), path.join(__dirname, to));
    console.log(`[web] Asset: ${from} → ${to}`);
}

// --- Guard: kein Node-Builtin / keine CLI-Schicht im Browser-Bundle ---
// Nackte (präfixlose) Builtins fängt esbuild selbst ab (bricht den Build mit
// „Could not resolve" ab, sofern nicht aliasiert) — ein Output-Scan dafür wäre
// nur ein False-Positive-Magnet (matcht `require("util")` in minifizierten
// Dep-Strings). Hier bleibt der Scan auf `node:`-Leaks + die CLI-Schicht.
const verboten = [
    [/from\s*["']node:/, 'node:-Import'],
    [/require\(\s*["']node:/, 'require(node:)'],
    [/import\(\s*["']node:/, 'dynamic import(node:)'],
    [/["']@findsl\/cli/, '@findsl/cli im Graph'],
];
let guardFehler = false;
for (const file of Object.keys(result.metafile.outputs)) {
    if (!file.endsWith('.js')) continue;
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const [re, was] of verboten) {
        if (re.test(src)) {
            console.error(`✗ Guard: ${was} in ${file} gefunden — Browser-untauglich.`);
            guardFehler = true;
        }
    }
}

// --- Bundle-Größen (AK 5: Budget-Awareness) ---
for (const [file, meta] of Object.entries(result.metafile.outputs)) {
    if (file.endsWith('.js')) {
        console.log(`[web] ${file}: ${(meta.bytes / 1024).toFixed(0)} KiB`);
    }
}

if (guardFehler) process.exit(1);
console.log('[web] Browser-Build ok — Guard grün.');
