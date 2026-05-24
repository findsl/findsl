// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Browser-PDF (Path B): der Worker erzeugt die **pdfmake-Doc-Definition**
 * (inkl. Formeln als SVG via MathJax); die Website lädt pdfmake statisch
 * (idiomatisch) und macht daraus die PDF-Bytes — so muss der Worker NICHT den
 * node-lastigen pdfkit bündeln (~9 Polyfills).
 *
 * Lazy geladen (eigener Chunk: docgen/pdf + math + mathjax-full). Der Node-
 * pdfmake-Printer in docgen/pdf.ts ist per esbuild-`alias` (empty.ts) gestubbt
 * — buildPdfDoc nutzt ihn nicht.
 *
 * Hinweis: `background`/`header`/`footer` der Doc-Definition sind Funktionen
 * (Seiten-Dekoration) und damit NICHT JSON-serialisierbar → JSON.stringify
 * lässt sie weg. Inhalt + Mathe-SVGs bleiben vollständig; die Seiten-
 * Dekoration ergänzt die Website beim Rendern.
 */

import { buildPdfDoc } from '@findsl/core/docgen/pdf.js';
import { ensureMathJax } from '@findsl/core/docgen/math.js';
import type { DocModel } from '@findsl/core/docgen/model.js';

export async function pdfDocDefinition(model: DocModel, hasMath: boolean): Promise<string> {
    // buildPdfDoc ruft texToSvg NUR bei `$…$`/`$$…$$`-Formeln (Block → SVG,
    // Inline → Flow-Layout). Nur dann MathJax initialisieren — formelfreie
    // Module (häufigster Fall) laden den schweren mathjax-Chunk gar nicht
    // (Issue #136) und können nicht an dessen Init scheitern.
    if (hasMath) await ensureMathJax();
    return JSON.stringify(buildPdfDoc(model));
}
