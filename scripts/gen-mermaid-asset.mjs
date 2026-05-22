#!/usr/bin/env node
/**
 * Bündelt mermaid zu EINEM self-contained IIFE-Skript und bettet es als
 * TypeScript-String ein, das der PAP-HTML-Emitter inline in die erzeugte
 * HTML schreibt — damit die Audit-HTML ohne Internet/CDN rendert.
 *
 * Warum re-bündeln statt `dist/mermaid.min.js` direkt zu nehmen: die
 * gelieferte `mermaid.min.js` exponiert KEIN sauberes Browser-Global
 * (`(__esbuild_esm_mermaid_nm||={}).mermaid = …`, kein `window.mermaid`).
 * Wir bündeln daher mermaids ESM-Entry mit dem projekteigenen esbuild zu
 * einem IIFE mit festem Global-Namen `mermaidBundle` (dynamische Chunk-
 * Importe werden inline gezogen → eine Datei).
 *
 * Ergebnis: `packages/core/src/papgen/mermaid-asset.generated.ts`.
 * Wird vor `tsc` ausgeführt (siehe `npm run build`); Datei steht in
 * `.gitignore` — die Quelle ist die mermaid-Dependency (Renovate-getrackt).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const mermaidPkg = path.join(repoRoot, 'node_modules', 'mermaid');
const entry = path.join(mermaidPkg, 'dist', 'mermaid.esm.min.mjs');
const outFile = path.join(
    repoRoot, 'packages', 'core', 'src', 'papgen', 'mermaid-asset.generated.ts',
);

if (!fs.existsSync(entry)) {
    console.error(`✗ mermaid-ESM-Entry fehlt: ${entry}\n`
        + '  Ist die "mermaid"-Dependency installiert? (npm install)');
    process.exit(1);
}

const version = JSON.parse(
    fs.readFileSync(path.join(mermaidPkg, 'package.json'), 'utf8'),
).version;

const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    globalName: 'mermaidBundle',
    minify: true,
    write: false,
    platform: 'browser',
    legalComments: 'none',
    logLevel: 'silent',
});
if (result.warnings.length > 0) {
    console.warn(`[gen-mermaid-asset] ${result.warnings.length} esbuild-Warnung(en):`);
    for (const w of result.warnings) console.warn(`  • ${w.text}`);
}
const js = result.outputFiles[0].text;

// Self-contained-Check: keine dynamischen Importe → eine Datei, kein
// Nachladen (sonst rendert die Offline-HTML nicht).
if (/\bimport\s*\(/.test(js)) {
    console.error('✗ mermaid-Bundle lädt noch dynamisch nach — nicht single-'
        + 'file-tauglich. esbuild-Optionen/mermaid-Version prüfen.');
    process.exit(1);
}

const ts = `// AUTO-GENERATED — NICHT VON HAND EDITIEREN.
// Quelle: mermaid@${version}, gebündelt via esbuild (scripts/gen-mermaid-asset.mjs,
// Teil von \`npm run build\`). Self-contained IIFE, Global \`mermaidBundle\`.
// ${js.length} Zeichen.

export const MERMAID_VERSION = ${JSON.stringify(version)};

export const MERMAID_JS: string = ${JSON.stringify(js)};
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, ts);
console.log(`[gen-mermaid-asset] mermaid@${version} (${(js.length / 1024 / 1024).toFixed(1)} MiB) `
    + `→ ${path.relative(repoRoot, outFile)}`);
