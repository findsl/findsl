// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * `texToPlain(tex)` — wandelt einen TeX-Ausdruck in lesbaren ASCII-/
 * WinAnsi-sicheren Klartext. Extrahiert aus `docgen/math.ts` als
 * geteilte Utility, weil sowohl der PDF-Renderer (Inline-Fallback) als
 * auch der LSP-Hover-Renderer (Issue #65 Phase C — VS Code rendert
 * `$…$` nicht als KaTeX) die gleiche Klartext-Darstellung brauchen.
 *
 * Beispiele:
 *   `\frac{\text{zvE} - \text{GFB}}{10000}`  →  `(zvE - GFB)/10000`
 *   `E = m \cdot c^2`                         →  `E = m · c²`
 *   `zve \geq 0`                              →  `zve >= 0`
 *
 * Pure Function — deterministisch, keine externen Abhängigkeiten.
 */

/** Hochstell-Glyphen, die WinAnsi (Standard-14) abdeckt: nur ¹ ² ³. */
const SUP_WINANSI: Record<string, string> = { '1': '¹', '2': '²', '3': '³' };

/** Text-Makros: nur der Gruppeninhalt zählt (Schriftart irrelevant). */
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
 * Wandelt einen TeX-Ausdruck in lesbaren, WinAnsi-sicheren Klartext.
 * Rein, deterministisch.
 *
 * Beispiele:
 *   `\frac{\text{zvE} - \text{GFB}}{10000}` → `(zvE - GFB)/10000`
 *   `E = m \cdot c^2`                        → `E = m · c²`
 *   `zve \geq 0`                             → `zve >= 0`
 */
export function texToPlain(tex: string): string {
    // Escapes zuerst über distinkte ASCII-Marker neutralisieren, damit
    // sie weder als Brace/Subscript noch als Makro geparst werden.
    // Wir nutzen Kontrollzeichen \x01–\x04 (kommen in echtem Quelltext
    // praktisch nie vor); am Ende werden sie zurückübersetzt.
    const s0 = tex
        .replace(/\\\\/g, '\x01')
        .replace(/\\\{/g, '\x02')
        .replace(/\\\}/g, '\x03')
        .replace(/\\_/g,  '\x04')
        .replace(/\\([%&#$ ])/g, (_, c: string) => (c === ' ' ? ' ' : c));
    return walkTex(s0)
        .replace(/\x01/g, ' ')
        .replace(/\x02/g, '{')
        .replace(/\x03/g, '}')
        .replace(/\x04/g, '_')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
}
