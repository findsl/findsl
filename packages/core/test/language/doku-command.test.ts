// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * `findsl.doku.generate` (Issue #95) — die reine Render-Funktion `renderDoku`.
 * Der Extension-Host ruft das gleichnamige Server-Kommando, das `renderDoku`
 * auf dem geparsten Dokument ausführt. Hier wird die pure Logik getestet
 * (kein LSP-Connection-/Services-Mock nötig).
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { renderDoku } from '../../src/language/findsl-commands.js';

const SOURCE = [
    '--',
    '# Demo-Modul',
    '',
    'Kurze Modul-Dokumentation.',
    '--',
    'fn Verdopple(x: Ganzzahl): Ganzzahl = x + x',
    '',
].join('\n');

describe('findsl.doku.generate — renderDoku (#95)', () => {
    it('Markdown: Modulname aus Dateiname via deriveClassName, Deklaration dokumentiert', async () => {
        const program = await parseSource(SOURCE);
        const r = renderDoku(program, SOURCE, 'einkommensteuer.findsl', 'markdown');
        expect(r.format).toBe('markdown');
        expect(r.filename).toBe('Einkommensteuer.doc.md');
        expect(r.content).toContain('Verdopple');
        expect(r.content.length).toBeGreaterThan(0);
    });

    it('HTML: PascalCase-Wortsplit im Namen + .doc.html-Suffix, Markup gerendert', async () => {
        const program = await parseSource(SOURCE);
        const r = renderDoku(program, SOURCE, 'kraftstg-tarif.findsl', 'html');
        expect(r.format).toBe('html');
        expect(r.filename).toBe('KraftstgTarif.doc.html');
        expect(r.content).toMatch(/<\w+/);          // enthält HTML-Markup
        expect(r.content).toContain('Verdopple');
    });
});
