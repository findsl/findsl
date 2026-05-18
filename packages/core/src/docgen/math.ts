// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Mathematische Notation in Doku-Kommentaren (Issue #6).
 *
 * Eine gemeinsame Schicht für alle drei Renderer:
 * - Erkennung von `$…$` (inline) / `$$…$$` (block) nach normativer Regel
 *   (SPEC § 4.x). Markdown bleibt roh; HTML/PDF rendern echte Formeln.
 * - HTML: KaTeX `renderToString` (server-seitig, deterministisch).
 * - PDF: MathJax tex→SVG (liteAdaptor, kein Browser), lazy geladen,
 *   `fontCache:'none'` + fester `idPrefix` ⇒ byte-stabil/idempotent.
 * - markdown-it Inline-/Block-Parser-Rules (gemeinsam für HTML & PDF;
 *   die Renderer-Ausgabe unterscheidet sich je Format und wird vom
 *   jeweiligen Renderer gesetzt).
 *
 * Mathe wird über `quelle.ts` `PROTECT_RE` vor §-Linkify geschützt und
 * steht nie in Code-Fences (dort literal) — siehe SPEC § 4.x.
 */

import katex from 'katex';
import type MarkdownIt from 'markdown-it';
import type { StateInline } from 'markdown-it/index.js';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';

const DOLLAR = 0x24; // '$'

/**
 * Inline-Erkennung (normativ, SPEC § 4.x):
 * `$` öffnet nur, wenn nicht escaped und nicht direkt Whitespace folgt;
 * schließt nur, wenn kein Whitespace davor und keine Ziffer dahinter
 * (⇒ `5 $`, `100 $`, einzelnes `$` bleiben literal). Kein `$`/Zeilen-
 * umbruch im Inhalt. Block `$$…$$` wird separat (Block-Rule) erkannt.
 */
const INLINE_RE = /\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/;

/** Liefert true, wenn an `pos` ein nicht-escaptes `$` steht. */
function unescapedDollar(src: string, pos: number): boolean {
    if (src.charCodeAt(pos) !== DOLLAR) return false;
    let bs = 0;
    for (let i = pos - 1; i >= 0 && src.charCodeAt(i) === 0x5c; i--) bs++;
    return bs % 2 === 0;
}

/**
 * markdown-it Inline-Rule `math_inline`: erzeugt ein Token mit
 * `content` = TeX-Quelle. Vor `escape` registrieren, damit `\$`
 * korrekt als literales Dollar behandelt wird.
 */
function mathInline(state: StateInline, silent: boolean): boolean {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== DOLLAR) return false;
    // Kein `$$` hier (Block-Rule zuständig); `$$` inline ⇒ kein Math.
    if (state.src.charCodeAt(start + 1) === DOLLAR) return false;
    if (!unescapedDollar(state.src, start)) return false;
    const rest = state.src.slice(start);
    const m = INLINE_RE.exec(rest);
    if (!m || m.index !== 0) return false;
    const tex = m[1];
    if (!silent) {
        const token = state.push('math_inline', 'math', 0);
        token.content = tex;
        token.markup = '$';
    }
    state.pos += m[0].length;
    return true;
}

/**
 * markdown-it Block-Rule `math_block`: `$$ … $$` (ein- oder mehrzeilig).
 * Öffnendes `$$` muss am Zeilenanfang (nach optionalem Whitespace)
 * stehen; Inhalt bis zum nächsten `$$`.
 */
function mathBlock(
    state: StateBlock,
    startLine: number,
    endLine: number,
    silent: boolean,
): boolean {
    const begin = state.bMarks[startLine] + state.tShift[startLine];
    let pos = begin;
    const max = state.eMarks[startLine];
    if (pos + 2 > max) return false;
    if (state.src.charCodeAt(pos) !== DOLLAR || state.src.charCodeAt(pos + 1) !== DOLLAR) {
        return false;
    }
    if (!unescapedDollar(state.src, pos)) return false;
    pos += 2;

    const firstLineRest = state.src.slice(pos, max);
    // Einzeiliges `$$ … $$`?
    const single = firstLineRest.indexOf('$$');
    let content = '';
    let nextLine = startLine;
    if (single >= 0) {
        content = firstLineRest.slice(0, single).trim();
        if (silent) return true;
    } else {
        let buf = firstLineRest;
        let found = false;
        for (nextLine = startLine + 1; nextLine < endLine; nextLine++) {
            const ls = state.bMarks[nextLine] + state.tShift[nextLine];
            const le = state.eMarks[nextLine];
            const line = state.src.slice(state.bMarks[nextLine], le);
            const close = line.indexOf('$$');
            if (close >= 0) {
                buf += '\n' + state.src.slice(ls, state.bMarks[nextLine] + close);
                found = true;
                break;
            }
            buf += '\n' + state.src.slice(ls, le);
        }
        if (!found) return false; // ungepaartes `$$` ⇒ kein Block (literal)
        if (silent) return true;
        content = buf.replace(/^\s+|\s+$/g, '');
    }

    const token = state.push('math_block', 'math', 0);
    token.block = true;
    token.content = content;
    token.markup = '$$';
    token.map = [startLine, nextLine + 1];
    state.line = single >= 0 ? startLine + 1 : nextLine + 1;
    return true;
}

/**
 * Registriert die gemeinsamen Math-Parser-Rules an einer markdown-it-
 * Instanz. Die Renderer-Rules (`math_inline`/`math_block`) setzt der
 * jeweilige Renderer selbst (HTML: KaTeX-HTML; PDF: separater
 * Token-Walk mit SVG).
 */
export function installMathRules(md: MarkdownIt): void {
    md.inline.ruler.before('escape', 'math_inline', mathInline);
    md.block.ruler.before('fence', 'math_block', mathBlock, {
        alt: ['paragraph', 'reference', 'blockquote', 'list'],
    });
}

/**
 * Rendert TeX zu KaTeX-HTML (server-seitig, synchron, deterministisch).
 * `throwOnError:false` ⇒ fehlerhaftes TeX wird als rote KaTeX-Meldung
 * dargestellt statt eine Exception zu werfen; `trust:false` blockt
 * `\href`/HTML-Injektion; `strict:'ignore'` ⇒ keine Warnlogs.
 */
export function renderMathHtml(tex: string, display: boolean): string {
    return katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        trust: false,
        strict: 'ignore',
        output: 'htmlAndMathml',
    });
}

// --- PDF: MathJax tex→SVG (lazy, deterministisch) -------------------------

interface MathjaxConverter {
    convert(tex: string, opts: { display: boolean }): unknown;
}
interface MathjaxAdaptor {
    innerHTML(node: unknown): string;
}

let mjDoc: MathjaxConverter | null = null;
let mjAdaptor: MathjaxAdaptor | null = null;

/**
 * Initialisiert MathJax einmalig (lazy `import()` ⇒ nur der PDF-Pfad
 * zieht die schwere Abhängigkeit). `fontCache:'none'` + fester
 * `idPrefix` ⇒ keine instabilen SVG-IDs ⇒ byte-stabile/idempotente
 * PDF-Ausgabe. Kein Browser/DOM (liteAdaptor).
 */
export async function ensureMathJax(): Promise<void> {
    if (mjDoc) return;
    const { mathjax } = await import('mathjax-full/js/mathjax.js');
    const { TeX } = await import('mathjax-full/js/input/tex.js');
    const { SVG } = await import('mathjax-full/js/output/svg.js');
    const { liteAdaptor } = await import('mathjax-full/js/adaptors/liteAdaptor.js');
    const { RegisterHTMLHandler } = await import('mathjax-full/js/handlers/html.js');
    const { AllPackages } = await import('mathjax-full/js/input/tex/AllPackages.js');
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const tex = new TeX({ packages: AllPackages });
    const svg = new SVG({ fontCache: 'none' });
    mjAdaptor = adaptor as unknown as MathjaxAdaptor;
    mjDoc = mathjax.document('', { InputJax: tex, OutputJax: svg }) as unknown as MathjaxConverter;
}

/** Geometrie eines gerenderten Formel-SVG (pt-skaliert für pdfmake). */
export interface MathSvg {
    readonly svg: string;
    readonly width: number;
    readonly height: number;
}

/**
 * Wandelt TeX zu einem eigenständigen SVG-String (für pdfmake `{svg}`).
 * Synchron — `ensureMathJax()` muss vorher awaited worden sein
 * (Pre-Pass in `renderPdf`). Höhe/Breite aus dem `ex`-Maß des SVG
 * (1 ex ≈ 8 pt bei 16 px Standard) in Punkte umgerechnet.
 */
export function texToSvg(tex: string, display: boolean): MathSvg {
    if (!mjDoc || !mjAdaptor) {
        throw new Error('MathJax nicht initialisiert — ensureMathJax() vor texToSvg() awaiten');
    }
    const node = mjDoc.convert(tex, { display });
    let svg = mjAdaptor.innerHTML(node);
    // ID-Stabilität: MathJax vergibt fortlaufende IDs (MJX-1, …). Ein
    // fester, inhaltsabhängiger Präfix macht wiederholte Läufe für
    // dieselbe Formel byte-identisch und kollisionsfrei zwischen Formeln.
    const slug = hashTex(tex, display);
    svg = svg.replace(/MJX-\d+-/g, `MJX-${slug}-`);
    const wMatch = svg.match(/width="([\d.]+)ex"/);
    const hMatch = svg.match(/height="([\d.]+)ex"/);
    // pdfmake skaliert das SVG auf `width` pt (Seitenverhältnis aus
    // viewBox) ⇒ die On-Page-Schriftgröße ist linear in diesem Faktor.
    // MathJax-`ex` ≈ 0,45 em; bei 10 pt Fließtext (defaultStyle in
    // pdf.ts) ist 1 ex ≈ 4,5 pt. Früher 8 ⇒ Display-Mathe ~1,8× zu
    // groß (Issue: „viel zu große Schrift"). 4,5 ⇒ Formel = Textgröße.
    const EX_TO_PT = 4.5;
    const width = wMatch ? Math.round(parseFloat(wMatch[1]) * EX_TO_PT) : 0;
    const height = hMatch ? Math.round(parseFloat(hMatch[1]) * EX_TO_PT) : 0;
    return { svg, width, height };
}

/** Kurzer deterministischer Hash der Formel (FNV-1a) für stabile IDs. */
function hashTex(tex: string, display: boolean): string {
    let h = 0x811c9dc5;
    const s = (display ? 'D:' : 'I:') + tex;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36);
}

// --- PDF: Inline-TeX → lesbarer, WinAnsi-sicherer Klartext ----------------
//
// pdfmake kann in einem Text-Array kein SVG platzieren ⇒ Inline-Mathe
// braucht einen Text-Fallback. Das PDF nutzt Standard-14-Fonts (WinAnsi);
// `≤ ≥ ≠ − √` und Tief-/Hochstellungen außer ¹²³ fehlen dort und würden
// im PDF verschwinden. Daher bewusst ASCII-Operatoren (`<=`, `>=`, `!=`,
// `sqrt(…)`, `_x`/`^(…)`). Rein deterministisch ⇒ PDF bleibt idempotent.
// (HTML rendert Inline-Mathe weiterhin voll via KaTeX — nur der PDF-
// Inline-Pfad nutzt diese Funktion; Block-Mathe ist auch im PDF SVG.)

/** Hochstell-Glyphen, die WinAnsi (Standard-14) abdeckt: nur ¹ ² ³. */
const SUP_WINANSI: Record<string, string> = { '1': '¹', '2': '²', '3': '³' };

/** Text-Makros: nur der Gruppeninhalt zählt (Schriftart irrelevant fürs PDF). */
const TEXT_CMD = new Set([
    'text', 'textrm', 'textbf', 'textit', 'textsf', 'texttt', 'textnormal',
    'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathcal', 'mathbb', 'mathfrak',
    'operatorname', 'boldsymbol', 'symbf', 'bm',
]);

/** TeX-Makro → WinAnsi-sicherer Ersatz (leer = verworfen). */
const CMD_MAP: Record<string, string> = {
    left: '', right: '', big: '', Big: '', bigg: '', Bigg: '',
    bigl: '', bigr: '', Bigl: '', Bigr: '', biggl: '', biggr: '',
    displaystyle: '', textstyle: '', scriptstyle: '', limits: '', nolimits: '',
    ',': '', ';': '', ':': '', '!': '', quad: ' ', qquad: ' ',
    cdot: '·', cdotp: '·', times: '×', div: '÷', pm: '±', mp: '-/+',
    le: '<=', leq: '<=', leqslant: '<=', ge: '>=', geq: '>=', geqslant: '>=',
    ne: '!=', neq: '!=', approx: '~', sim: '~', simeq: '~', cong: '~',
    equiv: '=', propto: '~', ll: '<<', gg: '>>',
    to: '->', rightarrow: '->', longrightarrow: '->', Rightarrow: '=>',
    implies: '=>', iff: '<=>', leftarrow: '<-', mapsto: '->',
    ldots: '...', cdots: '...', dots: '...', vdots: '...', ddots: '...',
    infty: 'unendlich', partial: 'd', star: '*', ast: '*', circ: 'o',
    bullet: '·', oplus: '(+)', otimes: '(x)', cup: 'U', cap: '^',
    forall: 'fuer alle ', exists: 'es existiert ', nabla: 'grad', prime: "'",
    sum: 'Summe', prod: 'Produkt', int: 'Integral',
    lim: 'lim', log: 'log', ln: 'ln', exp: 'exp', sin: 'sin', cos: 'cos',
    tan: 'tan', min: 'min', max: 'max', gcd: 'ggT', det: 'det', dim: 'dim',
    lvert: '|', rvert: '|', vert: '|', lVert: '||', rVert: '||', Vert: '||',
    langle: '<', rangle: '>', backslash: '\\',
    alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta',
    epsilon: 'epsilon', varepsilon: 'epsilon', zeta: 'zeta', eta: 'eta',
    theta: 'theta', vartheta: 'theta', iota: 'iota', kappa: 'kappa',
    lambda: 'lambda', mu: 'mu', nu: 'nu', xi: 'xi', pi: 'pi', varpi: 'pi',
    rho: 'rho', varrho: 'rho', sigma: 'sigma', varsigma: 'sigma', tau: 'tau',
    upsilon: 'upsilon', phi: 'phi', varphi: 'phi', chi: 'chi', psi: 'psi',
    omega: 'omega', Gamma: 'Gamma', Delta: 'Delta', Theta: 'Theta',
    Lambda: 'Lambda', Xi: 'Xi', Pi: 'Pi', Sigma: 'Sigma',
    Upsilon: 'Upsilon', Phi: 'Phi', Psi: 'Psi', Omega: 'Omega',
};

interface TexGroup { readonly body: string; readonly end: number; }

/** Liest die `{ … }`-Gruppe ab `i` (s[i] === '{'); brace-balanciert. */
function readGroup(s: string, i: number): TexGroup {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
        if (s[j] === '{') depth++;
        else if (s[j] === '}' && --depth === 0) {
            return { body: s.slice(i + 1, j), end: j + 1 };
        }
    }
    return { body: s.slice(i + 1), end: s.length };
}

function skipSpaces(s: string, i: number): number {
    while (i < s.length && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n')) i++;
    return i;
}

/** Liest ein Makro-Argument: `{Gruppe}` oder ein einzelnes Token. */
function readArg(s: string, i: number): TexGroup {
    const j = skipSpaces(s, i);
    if (s[j] === '{') return readGroup(s, j);
    const m = s.slice(j).match(/^(\\[a-zA-Z]+|\\.|[^{}\s])/);
    return m ? { body: m[0], end: j + m[0].length } : { body: '', end: j + 1 };
}

/** Hoch-/Tiefstellungs-Argument lesen (Gruppe oder ein Token). */
function readScript(s: string, i: number): TexGroup {
    if (s[i] === '{') return readGroup(s, i);
    const m = s.slice(i).match(/^(\\[a-zA-Z]+|\\.|.)/);
    return m ? { body: m[0], end: i + m[0].length } : { body: '', end: i + 1 };
}

/** Klammert zusammengesetzte Ausdrücke (für `\frac`-Seiten). */
function wrap(x: string): string {
    const t = x.trim();
    return /^[A-Za-zÄÖÜäöüß0-9_.]+$/.test(t) ? t : `(${t})`;
}

function walkTex(s: string): string {
    let r = '';
    let i = 0;
    while (i < s.length) {
        const ch = s[i];
        if (ch === '\\') {
            const m = s.slice(i).match(/^\\([a-zA-Z]+|.)/);
            if (!m) { i++; continue; }
            const name = m[1];
            i += m[0].length;
            if (TEXT_CMD.has(name)) {
                const g = readArg(s, i);
                r += walkTex(g.body);
                i = g.end;
            } else if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
                const g1 = readArg(s, i);
                const g2 = readArg(s, g1.end);
                r += `${wrap(walkTex(g1.body))}/${wrap(walkTex(g2.body))}`;
                i = g2.end;
            } else if (name === 'sqrt') {
                let j = skipSpaces(s, i);
                if (s[j] === '[') { const k = s.indexOf(']', j); j = k < 0 ? j + 1 : k + 1; }
                const g = readArg(s, j);
                r += `sqrt(${walkTex(g.body)})`;
                i = g.end;
            } else if (name === 'binom' || name === 'dbinom' || name === 'tbinom') {
                const g1 = readArg(s, i);
                const g2 = readArg(s, g1.end);
                r += `C(${walkTex(g1.body)},${walkTex(g2.body)})`;
                i = g2.end;
            } else if (name === 'begin' || name === 'end') {
                const j = skipSpaces(s, i);
                i = s[j] === '{' ? readGroup(s, j).end : j;
            } else if (name in CMD_MAP) {
                r += CMD_MAP[name];
            }
            // Unbekanntes Makro: verwerfen, umgebenden Text behalten.
        } else if (ch === '^') {
            const g = readScript(s, i + 1);
            const c = walkTex(g.body);
            r += (c.length === 1 && SUP_WINANSI[c]) ? SUP_WINANSI[c] : `^(${c})`;
            i = g.end;
        } else if (ch === '_') {
            const g = readScript(s, i + 1);
            const c = walkTex(g.body);
            r += c.length === 1 ? `_${c}` : `_(${c})`;
            i = g.end;
        } else if (ch === '{') {
            const g = readGroup(s, i);
            r += walkTex(g.body);
            i = g.end;
        } else if (ch === '}') {
            i++;
        } else if (ch === '&') {
            r += ' ';
            i++;
        } else {
            r += ch;
            i++;
        }
    }
    return r;
}

/**
 * Wandelt einen Inline-TeX-Ausdruck in lesbaren, WinAnsi-sicheren
 * Klartext (PDF-Inline-Fallback, SPEC § 4.x). Rein, deterministisch
 * ⇒ idempotente PDF-Ausgabe.
 *
 * Beispiele:
 *   `\frac{\text{zvE} - \text{GFB}}{10000}` → `(zvE - GFB)/10000`
 *   `E = m \cdot c^2`                        → `E = m · c²`
 *   `zve \geq 0`                             → `zve >= 0`
 */
export function texToPlain(tex: string): string {
    // Escapes zuerst über PUA-Platzhalter neutralisieren, damit sie
    // weder als Brace/Subscript noch als Makro geparst werden.
    const s0 = tex
        .replace(/\\\\/g, '\uE000')
        .replace(/\\\{/g, '\uE001')
        .replace(/\\\}/g, '\uE002')
        .replace(/\\_/g, '\uE003')
        .replace(/\\([%&#$ ])/g, (_, c: string) => (c === ' ' ? ' ' : c));
    return walkTex(s0)
        .replace(/\uE000/g, ' ')
        .replace(/\uE001/g, '{')
        .replace(/\uE002/g, '}')
        .replace(/\uE003/g, '_')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}
