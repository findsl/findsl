// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Registry für den (Node-spezifischen) `file://`-SVG-Writer der Hover-Karten
 * (#250).
 *
 * `hover-math-svg-file.ts` nutzt `node:fs`/`crypto`/`os`/`url` und darf daher
 * NICHT in den Browser-Bundle (`@findsl/web`-LSP-Worker) gelangen. Der
 * Hover-Provider (`findsl-hover.ts`) läuft aber in BEIDEN Welten (Langium-Service
 * — Node-LSP wie Browser-Worker), darf den Writer also nicht direkt importieren.
 *
 * Lösung (Dependency-Injection ohne statische Kopplung): Der Node-LSP-Entry
 * (`packages/lsp/src/main.ts`) registriert den echten Writer hier; `findsl-hover`
 * liest ihn. Im Browser-Worker wird nichts registriert → der `svg-file`-Pfad
 * fällt auf die `data:`-URL zurück (dort ohnehin der aktive Modus). Dieses Modul
 * selbst ist Node-frei (nur ein Typ-Import, der zur Laufzeit verschwindet).
 */

import type { SvgFileWriter } from './doc-hover-renderer.js';

let writer: SvgFileWriter | undefined;

/** Vom Node-LSP-Entry gesetzt (`svgToHoverFileUrl` aus `hover-math-svg-file.ts`). */
export function setHoverSvgFileWriter(w: SvgFileWriter | undefined): void {
    writer = w;
}

/** `undefined`, solange kein Node-Writer registriert wurde (z. B. im Browser). */
export function getHoverSvgFileWriter(): SvgFileWriter | undefined {
    return writer;
}
