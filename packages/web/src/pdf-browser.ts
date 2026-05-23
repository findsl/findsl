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

export async function pdfDocDefinition(model: DocModel): Promise<string> {
    // buildPdfDoc ruft intern texToSvg (Block-Mathe → SVG) → MathJax muss
    // initialisiert sein.
    await ensureMathJax();
    return JSON.stringify(buildPdfDoc(model));
}
