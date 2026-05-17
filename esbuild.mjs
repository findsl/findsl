/**
 * esbuild-Pipeline (Workspace-Wurzel).
 *
 * Erzeugt die zwei CommonJS-Bundles der VS-Code-Extension:
 *   - apps/vscode/out/extension/main.cjs  — Extension-Activation (VS-Code-Host)
 *   - apps/vscode/out/language/main.cjs   — FinDSL-Language-Server (LSP-Subprozess)
 *
 * Beide CJS, weil VS Code Extension-/Server-Entrypoints nur als CommonJS
 * lädt; das Projekt ist ESM. `@findsl/core` wird über die `source`-
 * Export-Condition direkt aus dem TypeScript-Quelltext gebündelt
 * (kein vorheriges `tsc` nötig → der Bundle-Smoke-Test bleibt
 * tsc-unabhängig). `vscode`/`vscode-languageclient` sind Host-Module
 * und bleiben extern.
 */

import * as esbuild from 'esbuild';
import * as fs from 'node:fs';

/**
 * pdfkit (in pdfmake) liest seine Standard-14-AFM-Metriken zur Laufzeit
 * per `fs.readFileSync(__dirname/data/<font>.afm)`. esbuild bündelt
 * solche fs-Datendateien NICHT — im Bundle zeigt `__dirname` auf
 * `packages/cli/dist/`. Daher pdfkits `data/`-Verzeichnis (14 AFM +
 * sRGB-ICC, ~0,6 MB) neben das CLI-Bundle spiegeln, damit `doku -f pdf`
 * self-contained funktioniert (Bundle + sibling `data/`).
 */
function copyPdfkitData() {
    const from = 'node_modules/pdfkit/js/data';
    const to = 'packages/cli/dist/data';
    if (!fs.existsSync(from)) {
        console.warn(`[esbuild] WARNUNG: ${from} fehlt — PDF im CLI-Bundle nicht lauffähig.`);
        return;
    }
    fs.rmSync(to, { recursive: true, force: true });
    fs.cpSync(from, to, { recursive: true });
    console.log(`[esbuild] pdfkit-AFM-Daten → ${to}`);
}

const watchMode = process.argv.includes('--watch');
const isProd    = process.argv.includes('--production');

/** @type {import('esbuild').BuildOptions} */
const common = {
    bundle:     true,
    platform:   'node',
    target:     'node20',
    format:     'cjs',
    sourcemap:  !isProd,
    minify:     isProd,
    conditions: ['source'],
    external:   ['vscode', 'vscode-languageclient'],
    logLevel:   'info',
};

/** @type {Array<import('esbuild').BuildOptions>} */
const builds = [
    {
        ...common,
        entryPoints: ['apps/vscode/src/main.ts'],
        outfile:     'apps/vscode/out/extension/main.cjs',
    },
    {
        ...common,
        entryPoints: ['packages/lsp/src/main.ts'],
        outfile:     'apps/vscode/out/language/main.cjs',
    },
    {
        // Self-contained CLI: ein CJS-Bundle (alles inkl. @findsl/core
        // aus TS-Quelle, builtins.json statisch inline, pdfmake/langium/
        // markdown-it eingerollt). Braucht weder node_modules noch einen
        // @findsl/core-Build; Grundlage für das native Node-SEA-Binary.
        ...common,
        entryPoints: ['packages/cli/src/main.ts'],
        outfile:     'packages/cli/dist/findsl.cjs',
        // Kein banner-Shebang: packages/cli/src/main.ts hat bereits eine
        // Shebang-Zeile, die esbuild als Zeile 1 erhält (ein zweiter
        // banner-Shebang würde Zeile 2 ungültig machen).
    },
];

if (watchMode) {
    const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
    await Promise.all(contexts.map((c) => c.watch()));
    console.log('[esbuild] Watch-Modus aktiv. Strg+C zum Beenden.');
} else {
    await Promise.all(builds.map((b) => esbuild.build(b)));
    copyPdfkitData();
    console.log('[esbuild] Build fertig: apps/vscode/out/{extension,language}/main.cjs, packages/cli/dist/findsl.cjs (+ data/)');
}
