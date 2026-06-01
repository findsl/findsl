// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Tests für die file://-SVG-Aufbereitung (#250): IntelliJs Hover lädt keine
 * `data:`-URLs, daher wird die MathJax-Formel als Datei abgelegt — mit px-Maßen
 * (statt MathJax-`ex`) und fester Theme-Farbe (JSVG kennt keine Media-Query).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureMathJax, texToSvg } from '../../src/docgen/math.js';
import { svgToHoverFileUrl } from '../../src/language/hover-math-svg-file.js';

describe('svgToHoverFileUrl (#250 file://-SVG für IntelliJ)', () => {
    beforeAll(async () => { await ensureMathJax(); });

    it('schreibt eine SVG-Datei und liefert eine file://-URL', () => {
        const { svg } = texToSvg('\\frac{a}{b}', true);
        const url = svgToHoverFileUrl(svg, /* isDark */ true, /* display */ true);
        expect(url.startsWith('file://')).toBe(true);
        expect(url.endsWith('.svg')).toBe(true);
        expect(fs.existsSync(fileURLToPath(url))).toBe(true);
    });

    it('rechnet MathJax-ex-Maße in px um (IntelliJ-Bildlader)', () => {
        const { svg } = texToSvg('\\frac{a}{b}', true);
        const content = fs.readFileSync(fileURLToPath(svgToHoverFileUrl(svg, false, true)), 'utf8');
        expect(content).toMatch(/width="[\d.]+px"/);
        expect(content).toMatch(/height="[\d.]+px"/);
        expect(content).not.toMatch(/(width|height)="[\d.]+ex"/);
    });

    it('setzt die Formelfarbe fest nach Theme (dark vs. light)', () => {
        const { svg } = texToSvg('x^2', false);
        expect(fs.readFileSync(fileURLToPath(svgToHoverFileUrl(svg, true, false)), 'utf8')).toContain('#cccccc');
        expect(fs.readFileSync(fileURLToPath(svgToHoverFileUrl(svg, false, false)), 'utf8')).toContain('#1f2328');
    });

    it('Inline-Formeln werden kleiner skaliert als Block-Formeln', () => {
        const { svg } = texToSvg('x^2', false);
        const widthPx = (url: string): number => {
            const content = fs.readFileSync(fileURLToPath(url), 'utf8');
            return parseFloat(/width="([\d.]+)px"/.exec(content)![1]);
        };
        const inline = widthPx(svgToHoverFileUrl(svg, false, /* display */ false));
        const block = widthPx(svgToHoverFileUrl(svg, false, /* display */ true));
        expect(inline).toBeLessThan(block);
    });

    it('gleiche Formel + gleiches Theme + gleicher Kontext → stabile (identische) URL', () => {
        const { svg } = texToSvg('a + b', false);
        expect(svgToHoverFileUrl(svg, false, false)).toBe(svgToHoverFileUrl(svg, false, false));
    });
});
