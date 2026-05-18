// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildDocModel, findFinFiles } from '../../src/docgen/model.js';
import { renderMarkdown } from '../../src/docgen/markdown.js';
import { renderHtml } from '../../src/docgen/html.js';
import { buildPdfDoc } from '../../src/docgen/pdf.js';
import { ensureMathJax } from '../../src/docgen/math.js';
import type { DocModel } from '../../src/docgen/model.js';

const SRC = `--
# Tarif-Modul

Die Steuer folgt der Formel $E = m \\cdot c^2$ (inline).

Display-Formel:

$$\\tau(x) = \\frac{a \\cdot x + b}{100}$$

Literales \\$ und 5 $ bleiben Text. Fremd-HTML: <script>x</script>.

@param zve das zu versteuernde Einkommen $zve \\geq 0$
--
fn steuer(zve: Euro): Euro = zve
`;

function findChild(c: unknown, pred: (n: Record<string, unknown>) => boolean): boolean {
    if (Array.isArray(c)) return c.some((x) => findChild(x, pred));
    if (c && typeof c === 'object') {
        const o = c as Record<string, unknown>;
        if (pred(o)) return true;
        return Object.values(o).some((v) => findChild(v, pred));
    }
    return false;
}

describe('Math-Rendering MD/HTML/PDF (Issue #6)', () => {
    let model: DocModel;
    let dir: string;

    beforeAll(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'findsl-mathr-'));
        await fs.writeFile(path.join(dir, 'tarif.findsl'), SRC);
        model = await buildDocModel(await findFinFiles(dir));
        await ensureMathJax();
    });

    it('Phase 3 — Markdown reicht $…$/$$…$$ roh durch (kanonisch)', () => {
        const md = renderMarkdown(model);
        expect(md).toContain('$E = m \\cdot c^2$');
        expect(md).toContain('$$\\tau(x) = \\frac{a \\cdot x + b}{100}$$');
        // Literales/„5 $" bleibt Text; kein KaTeX im MD.
        expect(md).not.toContain('class="katex"');
    });

    it('Phase 4 — HTML rendert KaTeX (inline + display) + KaTeX-CSS inline', () => {
        const html = renderHtml(model, { stand: '2026-05-18' });
        expect(html).toContain('class="katex"');           // Inline gerendert
        expect(html).toContain('katex-display');            // Block gerendert
        expect(html).toContain('class="math-block"');       // Block-Wrapper
        // Self-contained: KaTeX-CSS + inline-Fonts im <style>.
        expect(html).toContain('@font-face');
        expect(html).toContain('data:font/woff2;base64,');
        expect(html).toContain('.katex{color:inherit}');
        // §-Linkify hat Mathe nicht zerrissen, Fremd-HTML bleibt escaped.
        expect(html).toContain('&lt;script&gt;');
        expect(html).not.toContain('<script>x</script>');
    });

    it('Phase 4 — HTML idempotent (zweimal byte-gleich)', () => {
        expect(renderHtml(model, { stand: 'x' })).toBe(renderHtml(model, { stand: 'x' }));
    });

    it('Phase 5 — PDF: Block-Mathe als echtes SVG-Content, Inline als TeX-Fallback', () => {
        const doc = buildPdfDoc(model);
        const hasSvg = findChild(
            doc.content,
            (n) => typeof n.svg === 'string' && (n.svg as string).includes('<svg'),
        );
        expect(hasSvg).toBe(true);
        // Inline-TeX-Fallback (Code-Stil) trägt die TeX-Quelle.
        const hasInlineTex = findChild(
            doc.content,
            (n) => n.style === 'code' && typeof n.text === 'string'
                && (n.text as string).includes('c^2'),
        );
        expect(hasInlineTex).toBe(true);
    });

    it('Phase 5 — PDF docDefinition idempotent (stabile SVG-IDs)', () => {
        const a = JSON.stringify(buildPdfDoc(model));
        const b = JSON.stringify(buildPdfDoc(model));
        expect(a).toBe(b);
    });
});
