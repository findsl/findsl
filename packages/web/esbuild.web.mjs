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

// index (check/generate) kommt in Phase 3/4 dazu.
const entryPoints = { worker: 'src/worker.ts' };

const result = await esbuild.build({
    absWorkingDir: __dirname,
    entryPoints,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    outdir: 'dist',
    metafile: true,
    logLevel: 'warning',
    alias: {
        'node:path': shim('path.ts'),
        'node:fs': shim('fs.ts'),
        'node:module': shim('module.ts'),
    },
});

// --- Guard: kein Node-Builtin / keine CLI-Schicht im Browser-Bundle ---
const verboten = [
    [/from\s*["']node:/, 'node:-Import'],
    [/require\(\s*["']node:/, 'require(node:)'],
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
