/**
 * Kopiert Nicht-TS-Assets in den Build-Output (`tsc` emittiert nur aus
 * `.ts`):
 *
 *   1. `builtins.json` → `packages/core/out/language/`. `findsl-stdlib.ts`
 *      bindet sie per statischem `import builtins from './builtins.json'
 *      with { type: 'json' }`. Node-ESM löst diesen Pfad relativ zur
 *      kompilierten `.js` in `out/language/` auf — `tsc` kopiert die JSON
 *      aber NICHT dorthin; ohne diesen Schritt fehlt sie im unbundled
 *      tsc-Lauf (`node packages/cli/out/main.js`).
 *   2. `findsl.tmLanguage.json` → `apps/vscode/syntaxes/` (für das
 *      `.vsix`-Paket der Extension).
 *
 * Das esbuild-Bundle ist von (1) NICHT betroffen — esbuild inlinet die
 * JSON statisch. Dieser Schritt ist nur für den unbundled tsc-Output
 * bzw. das Extension-Packaging.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const assets = [
    // builtins.json wird von findsl-stdlib via createRequire zur Laufzeit
    // aus dem tsc-Output (@findsl/core) geladen.
    ['packages/core/src/language/builtins.json',
     'packages/core/out/language/builtins.json'],
    // TextMate-Grammatik in die Extension spiegeln (für das .vsix-Paket).
    ['packages/core/syntaxes/findsl.tmLanguage.json',
     'apps/vscode/syntaxes/findsl.tmLanguage.json'],
];

for (const [from, to] of assets) {
    const src = path.join(root, from);
    const dst = path.join(root, to);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    console.log(`[copy-assets] ${from} → ${to}`);
}
