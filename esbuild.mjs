/**
 * esbuild-Pipeline (Workspace-Wurzel).
 *
 * Erzeugt die CommonJS-Bundles des Projekts:
 *   - apps/vscode/out/extension/main.cjs  — Extension-Activation (VS-Code-Host)
 *   - apps/vscode/out/language/main.cjs   — FinDSL-Language-Server (LSP-Subprozess, VS Code via IPC)
 *   - packages/lsp/dist/findsl-lsp.cjs    — host-neutraler Language-Server (andere Editoren, z. B. IntelliJ/LSP4IJ, via --stdio)
 *   - packages/cli/dist/findsl.cjs        — self-contained CLI (Grundlage des nativen Binarys)
 *
 * Alle CJS, weil VS Code Extension-/Server-Entrypoints nur als CommonJS
 * lädt; das Projekt ist ESM. `@findsl/core` wird über die `source`-
 * Export-Condition direkt aus dem TypeScript-Quelltext gebündelt
 * (kein vorheriges `tsc` nötig → der Bundle-Smoke-Test bleibt
 * tsc-unabhängig). `vscode`/`vscode-languageclient` sind Host-Module
 * und bleiben extern.
 */

import * as esbuild from 'esbuild';
import * as fs from 'node:fs';

/**
 * pdfkit (in pdfmake) liest seine Standard-14-AFM-Metriken (Helvetica/
 * Times/Courier …) zur Laufzeit per `fs.readFileSync(__dirname +
 * '/data/<font>.afm', 'utf8')`. esbuild bündelt solche fs-Datendateien
 * NICHT — früher wurde daher `pdfkit/js/data/` neben das Bundle kopiert
 * (kein echtes Single-File-Binary, Issue #121).
 *
 * Stattdessen die 14 AFM-Metriken zur BUNDLE-ZEIT inlinen: ein
 * `onLoad`-Plugin ersetzt beim Laden von `pdfkit.js` die 14
 * `readFileSync`-Aufrufe durch das eingebettete String-Literal des
 * jeweiligen AFM-Inhalts. Konsistent zu `embed-runtime-*.mjs`. Ein Guard
 * bricht den Build LAUT ab, wenn ≠ 14 Stellen ersetzt wurden (fängt einen
 * pdfkit-Versionsbump ab, statt still ein kaputtes PDF zu erzeugen).
 *
 * Nicht berührt: der einzelne `sRGB_…icc`-Read (pdfkit.js, PDF/A-Pfad) —
 * von der FinDSL-Doku (Standard-14-Fonts, kein PDF/A) nicht ausgeübt.
 * Falls je PDF/A genutzt wird, muss die ICC analog mit-eingebettet werden.
 */
function embedPdfkitAfm() {
    const dataDir = 'node_modules/pdfkit/js/data';
    const AFM_READ = /fs\.readFileSync\(__dirname \+ '\/data\/([\w-]+\.afm)', ?'utf8'\)/g;
    const EXPECTED = 14;
    return {
        name: 'embed-pdfkit-afm',
        setup(build) {
            build.onLoad({ filter: /pdfkit[/\\]js[/\\]pdfkit\.js$/ }, (args) => {
                const src = fs.readFileSync(args.path, 'utf8');
                let count = 0;
                const out = src.replace(AFM_READ, (_m, file) => {
                    count += 1;
                    return JSON.stringify(fs.readFileSync(`${dataDir}/${file}`, 'utf8'));
                });
                if (count !== EXPECTED) {
                    throw new Error(
                        `[esbuild] AFM-Embedding: ${count} statt ${EXPECTED} `
                        + 'readFileSync-Stellen in pdfkit.js ersetzt — pdfkit-Version/'
                        + '-Layout geändert? embedPdfkitAfm() in esbuild.mjs prüfen.');
                }
                console.log(`[esbuild] ${count} pdfkit-AFM-Metriken eingebettet (kein dist/data nötig).`);
                return { contents: out, loader: 'js' };
            });
        },
    };
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
        // Host-neutrales LSP-Server-Bundle (#238): identische Quelle wie das
        // vscode-`language`-Target, aber an einem eigenständig adressierbaren
        // Pfad und ohne vscode-`external` — der Server importiert weder
        // `vscode` noch `vscode-languageclient`, sondern spricht reines LSP.
        // Grundlage für andere Editoren (IntelliJ via LSP4IJ, #237) und das
        // Node-SEA-Binary (#239).
        ...common,
        entryPoints: ['packages/lsp/src/main.ts'],
        outfile:     'packages/lsp/dist/findsl-lsp.cjs',
        external:    [],
    },
    {
        // Self-contained CLI: ein CJS-Bundle (alles inkl. @findsl/core
        // aus TS-Quelle, builtins.json statisch inline, pdfmake/langium/
        // markdown-it eingerollt). Braucht weder node_modules noch einen
        // @findsl/core-Build; Grundlage für das native Node-SEA-Binary.
        ...common,
        entryPoints: ['packages/cli/src/main.ts'],
        outfile:     'packages/cli/dist/findsl.cjs',
        // AFM-Metriken inline (Issue #121) → self-contained Binary ohne
        // sibling `data/`. Nur am CLI-Build (VS-Code/LSP rendern kein PDF).
        plugins:     [embedPdfkitAfm()],
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
    console.log('[esbuild] Build fertig: apps/vscode/out/{extension,language}/main.cjs, packages/lsp/dist/findsl-lsp.cjs (host-neutral), packages/cli/dist/findsl.cjs (AFM eingebettet, self-contained).');
}
