// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import {
    installMathRules,
    renderMathHtml,
    ensureMathJax,
    texToSvg,
} from '../../src/docgen/math.js';

function parse(src: string): MarkdownIt.Token[] {
    const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
    installMathRules(md);
    return md.parse(src, {});
}

/** Flacht Inline-Children + Block-Tokens zu Typ/Inhalt-Paaren. */
function mathTokens(src: string): Array<{ type: string; content: string }> {
    const out: Array<{ type: string; content: string }> = [];
    for (const t of parse(src)) {
        if (t.type === 'math_block') out.push({ type: t.type, content: t.content });
        for (const c of t.children ?? []) {
            if (c.type === 'math_inline') out.push({ type: c.type, content: c.content });
        }
    }
    return out;
}

describe('Math-Erkennung (SPEC § 4.x, normativ)', () => {
    it('Inline $…$ wird als math_inline erkannt', () => {
        expect(mathTokens('Formel $x^2 + 1$ im Text.')).toEqual([
            { type: 'math_inline', content: 'x^2 + 1' },
        ]);
    });

    it('Block $$…$$ (einzeilig) wird als math_block erkannt', () => {
        expect(mathTokens('$$\\sum_{i=1}^{n} x_i$$')).toEqual([
            { type: 'math_block', content: '\\sum_{i=1}^{n} x_i' },
        ]);
    });

    it('Block $$…$$ mehrzeilig', () => {
        const md = '$$\n\\frac{a}{b}\n+ c\n$$';
        expect(mathTokens(md)).toEqual([
            { type: 'math_block', content: '\\frac{a}{b}\n+ c' },
        ]);
    });

    it('"5 $" / einzelnes $ / Whitespace bleiben literal (kein Token)', () => {
        expect(mathTokens('Kosten 5 $ und 100 $ pro Stück.')).toEqual([]);
        expect(mathTokens('Ein einzelnes $ Zeichen.')).toEqual([]);
        expect(mathTokens('$ x $ mit Whitespace innen.')).toEqual([]);
    });

    it('\\$ ist literales Dollar (kein Math)', () => {
        expect(mathTokens('Preis \\$5 und \\$x\\$ literal.')).toEqual([]);
    });

    it('$$ wird VOR einzelnem $ erkannt (keine Fehlpaarung)', () => {
        expect(mathTokens('$$a+b$$')).toEqual([
            { type: 'math_block', content: 'a+b' },
        ]);
    });

    it('Ungepaartes $ / $$ → literal, kein Resttext-Verschlucken', () => {
        expect(mathTokens('Offen $x ohne Ende, danach normaler Text.')).toEqual([]);
        expect(mathTokens('$$ offen ohne Ende')).toEqual([]);
    });

    it('Mathe in ```findsl-Fence bleibt literal', () => {
        const src = '```findsl\nkonst x: Euro = 1 // $a+b$ und $$c$$\n```';
        expect(mathTokens(src)).toEqual([]);
        const toks = parse(src);
        expect(toks.some((t) => t.type === 'fence')).toBe(true);
    });

    it('mehrere Inline-Formeln in einem Absatz', () => {
        expect(mathTokens('$a$ und $b^2$ sowie $\\alpha$.')).toEqual([
            { type: 'math_inline', content: 'a' },
            { type: 'math_inline', content: 'b^2' },
            { type: 'math_inline', content: '\\alpha' },
        ]);
    });
});

describe('KaTeX-HTML (deterministisch, sicher)', () => {
    it('rendert KaTeX-Markup', () => {
        const html = renderMathHtml('x^2', false);
        expect(html).toContain('class="katex"');
        expect(html).toContain('</span>');
    });

    it('display vs inline unterscheidet sich', () => {
        expect(renderMathHtml('x', true)).toContain('katex-display');
        expect(renderMathHtml('x', false)).not.toContain('katex-display');
    });

    it('fehlerhaftes TeX wirft nicht (throwOnError:false)', () => {
        expect(() => renderMathHtml('\\frac{1}{', false)).not.toThrow();
    });

    it('idempotent (gleiche Eingabe ⇒ byte-gleich)', () => {
        expect(renderMathHtml('a+b', false)).toBe(renderMathHtml('a+b', false));
    });
});

describe('MathJax-SVG (PDF, deterministisch)', () => {
    it('texToSvg liefert SVG mit Maßen, zweimal byte-gleich', async () => {
        await ensureMathJax();
        const a = texToSvg('\\frac{a}{b}', true);
        const b = texToSvg('\\frac{a}{b}', true);
        expect(a.svg).toContain('<svg');
        expect(a.width).toBeGreaterThan(0);
        expect(a.height).toBeGreaterThan(0);
        expect(a.svg).toBe(b.svg); // Idempotenz / stabile IDs
    });

    it('verschiedene Formeln ⇒ kollisionsfreie IDs', async () => {
        await ensureMathJax();
        const a = texToSvg('x', false);
        const b = texToSvg('y', false);
        expect(a.svg).not.toBe(b.svg);
    });
});
