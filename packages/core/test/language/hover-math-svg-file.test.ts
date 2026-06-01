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
        const url = svgToHoverFileUrl(svg, /* isDark */ true);
        expect(url.startsWith('file://')).toBe(true);
        expect(url.endsWith('.svg')).toBe(true);
        expect(fs.existsSync(fileURLToPath(url))).toBe(true);
    });

    it('rechnet MathJax-ex-Maße in px um (IntelliJ-Bildlader)', () => {
        const { svg } = texToSvg('\\frac{a}{b}', true);
        const content = fs.readFileSync(fileURLToPath(svgToHoverFileUrl(svg, false)), 'utf8');
        expect(content).toMatch(/width="[\d.]+px"/);
        expect(content).toMatch(/height="[\d.]+px"/);
        expect(content).not.toMatch(/(width|height)="[\d.]+ex"/);
    });

    it('setzt die Formelfarbe fest nach Theme (dark vs. light)', () => {
        const { svg } = texToSvg('x^2', false);
        expect(fs.readFileSync(fileURLToPath(svgToHoverFileUrl(svg, true)), 'utf8')).toContain('#cccccc');
        expect(fs.readFileSync(fileURLToPath(svgToHoverFileUrl(svg, false)), 'utf8')).toContain('#1f2328');
    });

    it('gleiche Formel + gleiches Theme → stabile (identische) URL', () => {
        const { svg } = texToSvg('a + b', false);
        expect(svgToHoverFileUrl(svg, false)).toBe(svgToHoverFileUrl(svg, false));
    });
});
