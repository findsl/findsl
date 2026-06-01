// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Schreibt gerenderte MathJax-Formel-SVGs als Dateien und liefert `file://`-URLs
 * für Hover-Karten in Clients, die `data:`-URL-Bilder nicht rendern (IntelliJ via
 * LSP4IJ — siehe `client-math-mode.ts`). Zwei Anpassungen gegenüber dem
 * VS-Code-/`data:`-Pfad:
 *
 *  1. **Größe:** MathJax liefert `width`/`height` in `ex`. IntelliJs SVG-Loader
 *     (JSVG) hat im `<img>`-Kontext keine umgebende Schriftgröße, an der `ex`
 *     hinge → in feste `px` umrechnen, damit die Formel sinnvoll groß ist.
 *  2. **Farbe:** JSVG wertet `@media (prefers-color-scheme)` nicht aus. Statt der
 *     query (VS-Code-Pfad) eine feste Farbe nach gemeldetem IDE-Theme setzen,
 *     sodass die Formel auf hellem wie dunklem Hover-Hintergrund lesbar ist.
 *
 * Sicherheit: Cache-Verzeichnis pro Unix-UID (`os.tmpdir()` ist auf macOS bereits
 * per-User; der UID-Suffix isoliert zusätzlich auf geteilten `/tmp`), Verzeichnis
 * `0700`, Dateien `0600`. Deterministischer Dateiname (Inhalts-Hash) ⇒ stabile
 * URL pro Formel, kein unbegrenztes Wachstum. Es wird stets neu geschrieben
 * (kein „existiert schon"-Skip), damit kein vorab untergeschobener Inhalt unter
 * einem erratenen Hash-Namen ausgeliefert wird.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

/** MathJax-`ex` → `px` für IntelliJs Bild-Renderer. 8 px/ex ergibt eine
 *  Formelgröße knapp über dem Hover-Fließtext — gut lesbar, nicht überdimensioniert. */
const EX_TO_PX = 8;

const CACHE_DIR = path.join(os.tmpdir(), `findsl-hover-math-${process.getuid?.() ?? 'win'}`);

/** `width="X ex"`/`height="Y ex"` → feste `px`-Maße (s. EX_TO_PX). */
function toPixelSize(svg: string): string {
    return svg
        .replace(/width="([\d.]+)ex"/, (_m, v: string) => `width="${(parseFloat(v) * EX_TO_PX).toFixed(1)}px"`)
        .replace(/height="([\d.]+)ex"/, (_m, v: string) => `height="${(parseFloat(v) * EX_TO_PX).toFixed(1)}px"`);
}

/** Feste Formelfarbe (statt der `data:`-Pfad-Media-Query) — JSVG wertet keine
 *  Media-Queries aus. MathJax malt mit `currentColor`; wir setzen `color` am SVG. */
function withThemeColor(svg: string, isDark: boolean): string {
    const color = isDark ? '#cccccc' : '#1f2328';
    return svg.replace(/(<svg[^>]*>)/, `$1<style>svg{color:${color}}</style>`);
}

let cacheDirReady = false;
function ensureCacheDir(): void {
    if (cacheDirReady) return;
    fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    cacheDirReady = true;
}

/**
 * Bereitet das MathJax-SVG für IntelliJ auf (px-Größe + Theme-Farbe), schreibt es
 * als Datei und liefert eine `file://`-URL für ein Markdown-`<img>`.
 */
export function svgToHoverFileUrl(svg: string, isDark: boolean): string {
    ensureCacheDir();
    const prepared = withThemeColor(toPixelSize(svg), isDark);
    const hash = createHash('sha1').update(prepared).digest('hex').slice(0, 16);
    const file = path.join(CACHE_DIR, `${hash}.svg`);
    fs.writeFileSync(file, prepared, { mode: 0o600 });
    return pathToFileURL(file).href;
}

/** Test-Helper: Cache-Verzeichnis + URL offenlegen (für Datei-Existenz-Assertions). */
export function hoverMathCacheDirForTest(): string {
    return CACHE_DIR;
}
