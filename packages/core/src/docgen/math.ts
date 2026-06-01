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

// `texToPlain` lebt unter `language/`, damit auch der LSP-Hover-Renderer
// es nutzen kann (Issue #65 Phase C). Re-Export hier, damit bestehende
// docgen-Konsumenten (pdf.ts) unverändert importieren können.
export { texToPlain } from '../language/tex-to-plain.js';

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
    let content: string;
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
 * Holt einen Named-Export interop-robust aus einem (kompilierten CJS-)
 * Modul. Hintergrund (Issue #136): `mathjax-full` liefert CJS; Node-
 * NodeNext stellt `import { liteAdaptor }` direkt bereit, aber esbuilds
 * Browser-Bundle kann den Named-Export hinter die `.default`-Hülle des
 * CJS↔ESM-Interops legen — dann käme `liteAdaptor` als `undefined`/
 * Namespace an (⇒ „liteAdaptor is not a function"). Reihenfolge wie das
 * `cjsDefault`-Muster in pdf.ts: erst direkter Named-Export, dann über
 * `.default`. In Node ändert sich nichts (direkter Export greift).
 */
function namedExport<T>(mod: unknown, name: string): T {
    const m = mod as Record<string, unknown>;
    if (m[name] !== undefined) return m[name] as T;
    const def = m.default as Record<string, unknown> | undefined;
    return (def?.[name] ?? def) as T;
}

/**
 * Initialisiert MathJax einmalig (lazy `import()` ⇒ nur der PDF-Pfad
 * zieht die schwere Abhängigkeit). `fontCache:'none'` + fester
 * `idPrefix` ⇒ keine instabilen SVG-IDs ⇒ byte-stabile/idempotente
 * PDF-Ausgabe. Kein Browser/DOM (liteAdaptor).
 */
export async function ensureMathJax(): Promise<void> {
    if (mjDoc) return;
    const mathjax = namedExport<{ document(s: string, o: unknown): unknown }>(
        await import('mathjax-full/js/mathjax.js'), 'mathjax');
    const TeX = namedExport<new (o: unknown) => unknown>(
        await import('mathjax-full/js/input/tex.js'), 'TeX');
    const SVG = namedExport<new (o: unknown) => unknown>(
        await import('mathjax-full/js/output/svg.js'), 'SVG');
    const liteAdaptor = namedExport<() => unknown>(
        await import('mathjax-full/js/adaptors/liteAdaptor.js'), 'liteAdaptor');
    const RegisterHTMLHandler = namedExport<(a: unknown) => void>(
        await import('mathjax-full/js/handlers/html.js'), 'RegisterHTMLHandler');
    const AllPackages = namedExport<readonly string[]>(
        await import('mathjax-full/js/input/tex/AllPackages.js'), 'AllPackages');
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    // Defense-in-Depth (Issue #73): `AllPackages` enthält `html`
    // (`\href{url}{…}`, `\htmlStyle{…}{…}`), `action` (Toggle/Tooltip
    // mit URL-/Skript-Hooks) und `require` (Laufzeit-Paketnachladen).
    // Diese haben in deutschen Steuer-Doku-Kommentaren keine legitime
    // Verwendung; sie wegzulassen schützt gegen künftige Switches zu
    // Inline-SVG-Rendering im Editor-Hover, wo `\href{javascript:…}`
    // sonst durchschlüge.
    const SAFE_PACKAGES = AllPackages.filter(
        (p: string) => !['html', 'action', 'require'].includes(p),
    );
    const tex = new TeX({ packages: SAFE_PACKAGES });
    const svg = new SVG({ fontCache: 'none' });
    mjAdaptor = adaptor as MathjaxAdaptor;
    mjDoc = mathjax.document('', { InputJax: tex, OutputJax: svg }) as MathjaxConverter;
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


