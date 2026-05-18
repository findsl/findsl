// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Erzeugt `packages/core/src/docgen/katex-assets.ts` aus der
 * installierten KaTeX-Distribution: `katex.min.css`, in der jede
 * `@font-face`-`src`-Liste durch die **eine** woff2-Variante als
 * base64-`data:`-URI ersetzt wird (woff/ttf-Fallbacks entfallen —
 * woff2 deckt alle Zielbrowser ab).
 *
 * Ergebnis: ein self-contained CSS-String ⇒ die Single-File-HTML-Doku
 * braucht KEIN externes Font/CSS-Asset (passt zum Offline/Audit-Ethos).
 * Deterministisch (stabile Reihenfolge) ⇒ idempotenter, byte-stabiler
 * Generator-Output. Bei KaTeX-Bump erneut ausführen:
 *   node scripts/gen-katex-css.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const distCss = join(root, 'node_modules/katex/dist/katex.min.css');
const fontsDir = join(root, 'node_modules/katex/dist/fonts');
const outFile = join(root, 'packages/core/src/docgen/katex-assets.ts');

let css = readFileSync(distCss, 'utf-8');

// Jede `src:url(fonts/KaTeX_X.woff2) format("woff2"),url(...woff)…,url(…ttf)…`
// → nur die woff2-Variante als data:-URI.
css = css.replace(
    /src:url\(fonts\/(KaTeX_[A-Za-z0-9_-]+)\.woff2\)\s*format\("woff2"\)(?:,url\(fonts\/[^)]+\)\s*format\("[^"]+"\))*/g,
    (_m, base) => {
        const b64 = readFileSync(join(fontsDir, `${base}.woff2`)).toString('base64');
        return `src:url(data:font/woff2;base64,${b64}) format("woff2")`;
    },
);

if (/url\(fonts\//.test(css)) {
    throw new Error('gen-katex-css: nicht alle fonts/-URLs ersetzt — KaTeX-CSS-Format geändert?');
}

const version = JSON.parse(
    readFileSync(join(root, 'node_modules/katex/package.json'), 'utf-8'),
).version;

const banner = `// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2
//
// AUTOGENERIERT von scripts/gen-katex-css.mjs — NICHT von Hand ändern.
// Quelle: katex@${version} (katex.min.css + woff2-Fonts als data:-URI).
// Neu erzeugen: node scripts/gen-katex-css.mjs
`;

writeFileSync(
    outFile,
    `${banner}\n/** Self-contained KaTeX-CSS (woff2-Fonts inline) für die Single-File-HTML-Doku. */\nexport const KATEX_CSS = ${JSON.stringify(css)};\n`,
);

console.log(
    `[gen-katex-css] katex@${version} → ${outFile} (${(css.length / 1024).toFixed(0)} KiB)`,
);
