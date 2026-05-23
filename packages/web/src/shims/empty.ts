// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Leeres Modul. Per esbuild-`alias` für Node-only-Abhängigkeiten, die im
 * Browser-Graph zwar IMPORTIERT, aber nie AUFGERUFEN werden — konkret der
 * Node-pdfmake-Printer (`pdfmake/js/Printer.js`, pdfkit) + dessen virtual-fs:
 * `docgen/pdf.ts` importiert sie auf Modulebene, der Browser nutzt aber nur
 * das reine `buildPdfDoc` (Doc-Definition) + den pdfmake-Browser-Build.
 */

export default {};
