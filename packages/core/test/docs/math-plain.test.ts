// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * `texToPlain` — Inline-TeX → lesbarer, WinAnsi-sicherer Klartext für den
 * PDF-Inline-Fallback (pdfmake-Text-Array kann kein SVG; Standard-14-Fonts
 * decken nur WinAnsi ab — daher ASCII-Operatoren `<=`/`>=`, keine `≤ ≥ √`).
 * Deterministisch ⇒ PDF-Idempotenz bleibt erhalten.
 */

import { describe, it, expect } from 'vitest';
import { texToPlain } from '../../src/docgen/math.js';

describe('texToPlain — TeX → WinAnsi-sicherer Klartext', () => {
    it('\\text{…} wird zum reinen Inhalt', () => {
        expect(texToPlain('\\text{zvE}')).toBe('zvE');
        expect(texToPlain('\\mathrm{abc}')).toBe('abc');
    });

    it('\\frac wird zu A/B, zusammengesetzte Seiten geklammert', () => {
        expect(texToPlain('\\frac{a}{b}')).toBe('a/b');
        expect(texToPlain('\\frac{a + b}{2}')).toBe('(a + b)/2');
    });

    it('Operatoren WinAnsi-sicher abgebildet', () => {
        expect(texToPlain('a \\le b')).toBe('a <= b');
        expect(texToPlain('a \\ge b')).toBe('a >= b');
        expect(texToPlain('a \\ne b')).toBe('a != b');
        expect(texToPlain('a \\cdot b')).toBe('a · b');
        expect(texToPlain('a \\times b')).toBe('a × b');
    });

    it('Hochstellung: 1/2/3 → ¹²³ (WinAnsi), sonst ^(…)', () => {
        expect(texToPlain('c^2')).toBe('c²');
        expect(texToPlain('x^{n+1}')).toBe('x^(n+1)');
        expect(texToPlain('10^4')).toBe('10^(4)');
    });

    it('Tiefstellung bleibt _x bzw. _(…)', () => {
        expect(texToPlain('a_2')).toBe('a_2');
        expect(texToPlain('C_{4}')).toBe('C_4');
        expect(texToPlain('x_{i+1}')).toBe('x_(i+1)');
    });

    it('escaptes \\_ wird literaler Unterstrich', () => {
        expect(texToPlain('\\text{ZONE\\_2}')).toBe('ZONE_2');
    });

    it('Spacing-Makros / \\left \\right verschwinden, Whitespace kollabiert', () => {
        expect(texToPlain('a \\, b \\quad c')).toBe('a b c');
        expect(texToPlain('\\left( a \\right)')).toBe('( a )');
    });

    it('reale est-Inline-Formeln', () => {
        expect(texToPlain('y = \\frac{\\text{zvE} - \\text{GFB}}{10000}'))
            .toBe('y = (zvE - GFB)/10000');
        expect(texToPlain('z = \\frac{\\text{zvE} - \\text{ZONE\\_2}}{10000}'))
            .toBe('z = (zvE - ZONE_2)/10000');
        expect(texToPlain('E = m \\cdot c^2')).toBe('E = m · c²');
        expect(texToPlain('zve \\geq 0')).toBe('zve >= 0');
    });

    it('idempotent / deterministisch', () => {
        const f = 'y = \\frac{\\text{zvE} - \\text{GFB}}{10000}';
        expect(texToPlain(f)).toBe(texToPlain(f));
    });

    it('unbekannte Makros werden verworfen, Text bleibt', () => {
        expect(texToPlain('\\foo x + 1')).toBe('x + 1');
    });
});
