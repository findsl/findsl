/**
 * Doc-Generator — redaktionell gestaltetes Audit-PDF via `pdfmake`
 * (rein-JS, Standard-14-Fonts → keine Font-Assets, voll offline/
 * deterministisch).
 *
 * Designsystem: bewusste Schrift-Paarung — **Times** als Display-Serife
 * (Deckblatt, Kapitel-, ToC-Titel), **Helvetica** für Fließtext/Label/
 * Eyebrows, **Courier** für Code. Warme Light-Palette (cremeweißes
 * Papier, Terracotta-Akzent, an die Claude-Docs angelehnt). Redaktionelle
 * Struktur: Deckblatt mit Eyebrow/Akzentregel/Metablock, nummerierte
 * Kapitel-Opener, Bereichs-Eyebrows mit Haarlinie, Code-Boxen mit
 * Akzent-Rail + „FINDSL"-Tab (whitespace-treu via NBSP), Quelle-Aside, Zebra-Tabellen,
 * hierarchisches ToC, feine Kopf-/Fußzeile. Geteilter FinDSL-Tokenizer.
 *
 * `buildPdfDoc` ist reines, testbares Datenmodell (pdfmake-Definition);
 * `renderPdf` erzeugt daraus den Binär-Stream.
 */

// pdfmake 0.3 ist CJS (`js/*`); `src/` ist roh-ESM und bricht unter
// NodeNext. Statische Default-Imports der **kompilierten CJS-Module**
// werden von esbuild korrekt ins Self-contained-Bundle gerollt; die
// CJS↔ESM-Interop-Divergenz (esbuild liefert die Klasse direkt, Node-
// ESM/tsc liefert `module.exports` mit `.default`-Property — CLAUDE § 7)
// wird unten einheitlich per `?.default ?? mod` aufgelöst.
import pdfmakePrinterCjs from 'pdfmake/js/Printer.js';
import pdfmakeVfsCjs from 'pdfmake/js/virtual-fs.js';
import pdfmakeUrlResolverCjs from 'pdfmake/js/URLResolver.js';
import pdfkitCjs from 'pdfkit';

/** Entpackt die `.default`-Hülle nur, wenn vorhanden (runtime-robust). */
function cjsDefault<T>(mod: unknown): T {
    const m = mod as { default?: unknown };
    return (m && typeof m === 'object' && 'default' in m
        ? (m.default as T)
        : (mod as T));
}
import MarkdownIt from 'markdown-it';
import type Token from 'markdown-it/lib/token.mjs';
import type {
    TDocumentDefinitions, Content, CustomTableLayout, TableCell,
} from 'pdfmake/interfaces.js';
import type { DocModel, DeclDoc } from './model.js';
import { groupDecls } from './markdown.js';
import { tokenizeFindsl, type TokenKind } from './findsl-tokens.js';
import { installMathRules, ensureMathJax, texToSvg, texToPlain } from './math.js';
import type { DocKopf } from './kopf.js';

export interface PdfOptions {
    readonly stand?: string;
    readonly titel?: string;
    /** Front-Matter-Dokumentkopf (Deckblatt + Einleitung). Ohne Kopf
     *  bleibt das Deckblatt unverändert (FinDSL-Default + Sprach-Sub). */
    readonly kopf?: DocKopf;
}

// Alle Standard-14 (in pdfkit eingebaut) → keine Font-Dateien, voll
// offline/deterministisch. Times = redaktionelle Display-Serife.
const FONTS = {
    Helvetica: {
        normal: 'Helvetica', bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique', bolditalics: 'Helvetica-BoldOblique',
    },
    Times: {
        normal: 'Times-Roman', bold: 'Times-Bold',
        italics: 'Times-Italic', bolditalics: 'Times-BoldItalic',
    },
    Courier: {
        normal: 'Courier', bold: 'Courier-Bold',
        italics: 'Courier-Oblique', bolditalics: 'Courier-BoldOblique',
    },
};

/**
 * Design-Tokens — warme, redaktionelle Light-Palette (an die Claude-
 * Docs angelehnt: cremeweißes Papier, warmes Grau). Terracotta-Akzent
 * trägt die Struktur (Regeln, Nummern, Rails, Links, Callout).
 * `pageBg` tönt jede Seite; Überschriften nutzen `ink` (kein Akzent).
 */
const C = {
    pageBg: '#faf9f5',                        // Papier (Creme)
    fg: '#1a1813',                            // Überschriften/Ink
    body: '#3c392f',                          // Fließtext
    muted: '#8a8475',                         // Eyebrows/Meta/Captions
    faint: '#b3ad9c',                         // dezenteste Schrift
    rule: '#e5e1d4',                          // Haarlinien/Rahmen
    accent: '#bf512e',                        // Terracotta
    accentDeep: '#9a3f22',
    accentSoft: '#f6e9e0',                    // Callout-/Tab-Füllung
    codeBg: '#f4f1e9', codeBorder: '#e6e1d2', codeFg: '#2b281f',
    zebra: '#f3efe5', tableHead: '#efeadd',
    surface: '#ffffff',
};
/** Highlight-Farben — warm abgestimmt auf das Creme-Papier. */
const TK: Record<TokenKind, { color: string; bold?: boolean; italics?: boolean }> = {
    kw: { color: '#9a2bd8', bold: true },
    type: { color: '#0a7d6c' },
    str: { color: '#b3541e' },
    num: { color: '#1f6feb' },
    com: { color: '#8a8475', italics: true },
    anno: { color: '#a8341f', bold: true },
    plain: { color: '#2b281f' },
};

/** Inhaltsbreite A4 bei 50pt Seitenrändern (für Linien/Canvas). */
const CONTENT_W = 495;

const MD = new MarkdownIt({ html: false, linkify: true, typographer: false });
// Gemeinsame Math-Parser-Rules (wie HTML); der PDF-Token-Walk erkennt
// `math_block`/`math_inline` selbst (Block → echtes SVG via MathJax,
// Inline → TeX-Fallback, da pdfmake kein Inline-SVG im Textfluss kann).
installMathRules(MD);

/**
 * FinDSL-Quelltext → farbige pdfmake-Text-Runs (geteilter Tokenizer).
 *
 * pdfmake kollabiert in Textknoten ASCII-Whitespace (führende
 * Einrückung wird getrimmt, Mehrfach-Leerzeichen zu einem) — Code-
 * Einrückung und Spalten-Ausrichtung gingen verloren. Lösung:
 * reguläre Leerzeichen → geschützte Leerzeichen (NBSP, U+00A0). In
 * Courier (Monospace, WinAnsi enthält NBSP als Space-Breite) bleibt
 * die Ausrichtung byte-genau; `\n` bleibt harter Zeilenumbruch.
 */
function findslSpans(code: string): Content[] {
    return tokenizeFindsl(code).map((t) => ({
        text: t.text.replace(/ /g, '\u00A0'),
        ...TK[t.kind],
    }));
}

// Code-Box: warme Füllung, feine Rahmenlinie + kräftige Akzent-„Rail"
// links (designter Code-Block-Look, bringt Farbe ins Raster).
const codeLayout: CustomTableLayout = {
    hLineWidth: () => 0.75,
    vLineWidth: (i) => (i === 0 ? 2.5 : 0.75),
    hLineColor: () => C.codeBorder,
    vLineColor: (i) => (i === 0 ? C.accent : C.codeBorder),
    fillColor: () => C.codeBg,
    paddingLeft: () => 12, paddingRight: () => 11,
    paddingTop: () => 8, paddingBottom: () => 8,
};

// Quelle-Aside: leise — dünne Akzent-Leiste links, KEINE Füllung.
const quelleLayout: CustomTableLayout = {
    hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 1.5 : 0),
    vLineColor: () => C.accent, fillColor: () => null,
    paddingLeft: () => 9, paddingRight: () => 0,
    paddingTop: () => 2, paddingBottom: () => 2,
};

// Tabellen: Kopf mit warmer Tönung + Akzent-Unterstrich, Zebra-Reihen,
// keine Vertikallinien (ruhiges, modernes Raster).
const gridLayout: CustomTableLayout = {
    hLineWidth: (i) => (i === 1 ? 1.5 : 0),
    vLineWidth: () => 0,
    hLineColor: () => C.accent,
    fillColor: (rowIndex) =>
        (rowIndex === 0 ? C.tableHead
            : rowIndex % 2 === 0 ? C.zebra : null),
    paddingLeft: () => 10, paddingRight: () => 10,
    paddingTop: () => 7, paddingBottom: () => 7,
};

/** Schattierte Code-Box mit Syntax-Highlight + dezentem „FINDSL"-Label. */
function codeBlock(code: string): Content {
    return {
        stack: [
            { text: 'FINDSL', style: 'codeLabel' },
            {
                table: {
                    widths: ['*'],
                    // `preserveLeadingSpaces`: pdfmake trimmt sonst die
                    // führende Whitespace JEDER Zeile (auch NBSP) →
                    // Einrückung ginge verloren. NBSP (findslSpans)
                    // hält zusätzlich das interne Spalten-Padding.
                    body: [[{
                        text: findslSpans(code), style: 'code',
                        preserveLeadingSpaces: true,
                    }]],
                },
                layout: codeLayout,
            },
        ],
        margin: [0, 3, 0, 10],
    };
}

/** Leiser Quellen-Aside (dünne Akzent-Leiste, kleine Schrift). */
function quelleCallout(body: Content[]): Content {
    return {
        table: {
            widths: ['*'],
            body: [[{
                text: [{ text: 'Quelle  ', color: C.muted }, ...body],
                fontSize: 8.5, color: C.muted, lineHeight: 1.3,
            }]],
        },
        layout: quelleLayout,
        margin: [0, 3, 0, 5],
    };
}

/** Volle Haarlinie (Bereichs-/Kapitel-Trenner). */
function hairline(weight: number, color: string, top: number, bottom: number): Content {
    return {
        canvas: [{
            type: 'line', x1: 0, y1: 0, x2: CONTENT_W, y2: 0,
            lineWidth: weight, lineColor: color,
        }],
        margin: [0, top, 0, bottom],
    };
}

/** Inline-Tokens (children) → pdfmake Text-Spans (fett/kursiv/Code/Link). */
function inlineSpans(children: ReadonlyArray<Token>): Content[] {
    const out: Content[] = [];
    let bold = false, italic = false, link: string | undefined;
    for (const t of children) {
        switch (t.type) {
            case 'text': out.push({
                text: t.content, bold, italics: italic,
                ...(link ? { link, color: C.accent } : {}),
            }); break;
            case 'code_inline': out.push({
                text: t.content, style: 'code',
                ...(link ? { link, color: C.accent } : {}),
            }); break;
            case 'strong_open': bold = true; break;
            case 'strong_close': bold = false; break;
            case 'em_open': italic = true; break;
            case 'em_close': italic = false; break;
            case 'link_open': link = t.attrGet('href') ?? undefined; break;
            case 'link_close': link = undefined; break;
            case 'softbreak': out.push({ text: ' ' }); break;
            case 'hardbreak': out.push({ text: '\n' }); break;
            // Inline-Mathe: pdfmake kann kein SVG im fließenden Text-
            // Array platzieren → lesbarer, WinAnsi-sicherer Klartext
            // (kursiv, math-artig) statt Roh-TeX. (HTML rendert Inline-
            // Mathe voll via KaTeX; Block-Mathe ist auch im PDF echtes
            // SVG. Siehe SPEC § 4.x.)
            case 'math_inline': out.push({
                text: texToPlain(t.content), italics: true,
                ...(link ? { link, color: C.accent } : {}),
            }); break;
            default: break;
        }
    }
    return out.length ? out : [{ text: '' }];
}

/**
 * Doc-Tag-Text (Markdown, bereits §-linkifiziert via model.ts) → pdfmake-
 * Inline-Runs. Für Tabellen-/Zeilen-Zellen (Parameter-Beschreibung,
 * Rückgabe, Feld-„Bedeutung"), damit `\`code\``/`*kursiv*`/`[§…](url)`
 * dort genauso interpretiert werden wie im Fließtext (`mdContent`),
 * statt roh als String zu erscheinen.
 */
function inlineMd(src: string): Content[] {
    const toks = MD.parseInline(src ?? '', {});
    return inlineSpans(toks[0]?.children ?? []);
}

// --- Echte Inline-Formeln: Flow-Layout (eigener Zeilenumbruch) -----------
//
// pdfmake 0.3 kann SVG NICHT in einen umbrechenden `text`-Array setzen
// (SVG/Bild ist ein Block-Leaf). Für *echt gerenderte* Inline-Mathe
// brechen wir den Absatz daher selbst um: Wörter werden mit pdfkits
// eigener Standard-14-Metrik vermessen (deterministisch, exakt wie beim
// späteren Rendern), Formeln sind echte MathJax-SVG (Inline-Modus). Jede
// Zeile wird als `columns`-Reihe gesetzt (Text-Segmente `width:'auto'` +
// SVG, vertikal nahe der Grundlinie zentriert). Nur aktiv, wenn ein
// Absatz/Listenpunkt Inline-Mathe enthält — sonst unveränderter
// `inlineSpans`-Pfad (Nicht-Mathe-PDFs bleiben byte-identisch).

interface MeasureDoc {
    font(n: string): unknown;
    fontSize(n: number): unknown;
    widthOfString(s: string): number;
}
let measureDoc: MeasureDoc | null = null;

/** Lazy pdfkit-Dokument nur zur Textbreiten-Messung (Standard-14, kein
 *  Seiteneffekt, deterministisch — identische AFM-Metrik wie pdfmake). */
function measurer(): MeasureDoc {
    if (!measureDoc) {
        const PDFDocument = cjsDefault<new (o: object) => MeasureDoc>(pdfkitCjs);
        measureDoc = new PDFDocument({ autoFirstPage: false });
    }
    return measureDoc;
}

interface RunStyle {
    readonly bold: boolean;
    readonly italic: boolean;
    readonly code: boolean;
    readonly link?: string;
}

/** Standard-14-Fontname passend zum Render-Stil (für die Messung). */
function fontFor(s: RunStyle): string {
    if (s.code) return 'Courier';
    if (s.bold && s.italic) return 'Helvetica-BoldOblique';
    if (s.bold) return 'Helvetica-Bold';
    if (s.italic) return 'Helvetica-Oblique';
    return 'Helvetica';
}
function sizeFor(s: RunStyle, base: number): number {
    return s.code ? base - 1.5 : base;            // 'code'-Style ist kleiner
}
function measure(text: string, s: RunStyle, base: number): number {
    const d = measurer();
    d.font(fontFor(s));
    d.fontSize(sizeFor(s, base));
    return d.widthOfString(text);
}

type Atom =
    | { readonly k: 'word'; readonly text: string; readonly s: RunStyle; readonly w: number }
    | { readonly k: 'space'; readonly w: number }
    | { readonly k: 'br' }
    | { readonly k: 'math'; readonly svg: string; readonly w: number; readonly h: number };

/** Inline-Tokens → flache Atom-Liste (Wörter/Spaces/Formeln) mit Stil. */
function inlineAtoms(children: ReadonlyArray<Token>, base: number): Atom[] {
    const atoms: Atom[] = [];
    let bold = false, italic = false;
    let link: string | undefined;
    const st = (code: boolean): RunStyle => ({ bold, italic, code, link });
    for (const t of children) {
        switch (t.type) {
            case 'text':
            case 'code_inline': {
                const code = t.type === 'code_inline';
                const s = st(code);
                for (const p of t.content.split(/(\s+)/)) {
                    if (p === '') continue;
                    if (/^\s+$/.test(p)) atoms.push({ k: 'space', w: measure(' ', s, base) });
                    else atoms.push({ k: 'word', text: p, s, w: measure(p, s, base) });
                }
                break;
            }
            case 'strong_open': bold = true; break;
            case 'strong_close': bold = false; break;
            case 'em_open': italic = true; break;
            case 'em_close': italic = false; break;
            case 'link_open': link = t.attrGet('href') ?? undefined; break;
            case 'link_close': link = undefined; break;
            case 'softbreak': atoms.push({ k: 'space', w: measure(' ', st(false), base) }); break;
            case 'hardbreak': atoms.push({ k: 'br' }); break;
            case 'math_inline': {
                try {
                    const { svg, width, height } = texToSvg(t.content, false);
                    atoms.push({ k: 'math', svg, w: Math.max(width, 1), h: Math.max(height, 1) });
                } catch {
                    // MathJax-Fehler: WinAnsi-sicherer Klartext-Fallback.
                    const s = st(false);
                    const txt = texToPlain(t.content);
                    atoms.push({ k: 'word', text: txt, s, w: measure(txt, s, base) });
                }
                break;
            }
            default: break;
        }
    }
    return atoms;
}

/** Wort/Space → pdfmake-Text-Run (fett/kursiv/Code/Link wie inlineSpans). */
function runOf(text: string, s: RunStyle): Content {
    if (s.code) {
        return { text, style: 'code', ...(s.link ? { link: s.link, color: C.accent } : {}) };
    }
    return {
        text, bold: s.bold, italics: s.italic,
        ...(s.link ? { link: s.link, color: C.accent } : {}),
    };
}

/**
 * Bricht die Atome auf `maxWidth` um (greedy, rein metrik-getrieben ⇒
 * idempotent). Reine Textzeile → `{text:[…]}`; Zeile mit Formel →
 * `{columns:[…]}` (Text-Segmente + echtes Formel-SVG, vertikal nahe
 * der Grundlinie zentriert).
 */
// Horizontale Polsterung jeder Inline-Formel (zusätzlich zum normalen
// Wort-Space), damit Formeln nicht am Text kleben. LINKS als column-
// `margin` (wird von pdfmake honoriert). RECHTS als eigene Spacer-
// Spalte: das rechte column-`margin` rechnet pdfmake im columns-Layout
// NICHT in den Abstand zur Folgespalte ein. Beides fließt in den
// Zeilenumbruch ein ⇒ keine Überbreite, idempotent.
const MATH_PAD_L = 3;
const MATH_PAD_R = 6;

function layoutFlow(atoms: Atom[], maxWidth: number, base: number): Content[] {
    const lines: Atom[][] = [];
    let line: Atom[] = [];
    let w = 0;
    const flush = (): void => {
        while (line.length && line[line.length - 1].k === 'space') line.pop();
        lines.push(line);
        line = [];
        w = 0;
    };
    const effW = (a: Atom): number =>
        (a.k === 'math' ? a.w + MATH_PAD_L + MATH_PAD_R : a.k === 'br' ? 0 : a.w);
    for (const a of atoms) {
        if (a.k === 'br') { flush(); continue; }
        if (a.k === 'space') {
            if (line.length === 0) continue;
            if (w + a.w > maxWidth) { flush(); continue; }
            line.push(a); w += a.w; continue;
        }
        const ew = effW(a);
        if (line.length > 0 && w + ew > maxWidth) flush();
        line.push(a); w += ew;
    }
    flush();

    const gap = base * 0.4;
    const out: Content[] = [];
    for (const ln of lines) {
        if (ln.length === 0) { out.push({ text: ' ', fontSize: base * 0.5 }); continue; }
        const rowH = Math.max(base * 1.18, ...ln.map((a) => (a.k === 'math' ? a.h : 0)));
        if (!ln.some((a) => a.k === 'math')) {
            const runs: Content[] = [];
            for (const a of ln) {
                if (a.k === 'space') runs.push({ text: ' ' });
                else if (a.k === 'word') runs.push(runOf(a.text, a.s));
            }
            out.push({ text: runs, margin: [0, 0, 0, gap] });
            continue;
        }
        const cols: Content[] = [];
        let buf: Content[] = [];
        const flushBuf = (): void => {
            if (buf.length) {
                cols.push({
                    width: 'auto', text: buf,
                    margin: [0, Math.round((rowH - base) / 2), 0, 0],
                } as Content);
                buf = [];
            }
        };
        for (const a of ln) {
            if (a.k === 'math') {
                flushBuf();
                cols.push({
                    width: a.w, svg: a.svg, height: a.h,
                    margin: [MATH_PAD_L, Math.round((rowH - a.h) / 2), 0, 0],
                } as Content);
                cols.push({ text: '', width: MATH_PAD_R } as Content);
            } else if (a.k === 'space') {
                buf.push({ text: ' ' });
            } else if (a.k === 'word') {
                buf.push(runOf(a.text, a.s));
            }
        }
        flushBuf();
        out.push({ columns: cols, columnGap: 0, margin: [0, 0, 0, gap] });
    }
    return out;
}

/** Enthält die Inline-Token-Liste mindestens eine `$…$`-Formel? */
function hasInlineMath(children: ReadonlyArray<Token>): boolean {
    return children.some((t) => t.type === 'math_inline');
}

/** Konkreter Block-Typ (spread-bar; `Content` ist eine zu weite Union). */
type FlowBlock = { text: Content[] } | { stack: Content[] };

/** Absatz/Listenpunkt: mit Inline-Mathe → Flow-Layout, sonst Textspans. */
function flowOrText(children: ReadonlyArray<Token>, maxWidth: number, base = 10): FlowBlock {
    if (!hasInlineMath(children)) return { text: inlineSpans(children) };
    return { stack: layoutFlow(inlineAtoms(children, base), maxWidth, base) };
}

// --- WinAnsi-Transliteration (Standard-14-Grenze) ------------------------
//
// Das PDF nutzt Standard-14-Fonts → nur WinAnsi (CP1252) ist darstellbar.
// Doc-Prosa enthält aber Unicode-Sonderzeichen (`≥ ≤ → ⇒ − √ …`), die
// pdfkit sonst als Leerzeichen/Tofu ausgibt. Diese werden NUR im PDF
// (nicht MD/HTML) deterministisch auf lesbares ASCII abgebildet; reine
// WinAnsi-Zeichen (inkl. `§ € ä ö ü ß – — … · × ÷ ± ¹²³ ‰`) bleiben
// unverändert. Ein einziger Baum-Durchlauf nach dem Aufbau erfasst jede
// `text`-Zeichenkette (SVG-Knoten werden ausgelassen).

/** Unicode-Codepoints > 0xFF, die WinAnsi (CP1252) dennoch abbildet. */
const WINANSI_HIGH = new Set([
    0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
    0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c,
    0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a,
    0x0153, 0x017e, 0x0178,
]);

/** Nicht-WinAnsi-Sonderzeichen → lesbares ASCII-Äquivalent. */
const WA_MAP: Record<string, string> = {
    '≥': '>=', '≤': '<=', '≠': '!=', '≈': '~', '≅': '~', '≡': '=',
    '≙': '=', '∼': '~', '≪': '<<', '≫': '>>',
    '→': '->', '←': '<-', '↔': '<->', '↦': '->', '⇒': '=>', '⇐': '<=',
    '⇔': '<=>', '↑': '^', '↓': 'v',
    '−': '-', '∓': '-/+', '∗': '*', '∙': '·', '∘': 'o', '·': '·',
    '√': 'sqrt', '∛': 'cbrt', '∞': 'unendlich', '∝': '~', '∂': 'd',
    '∇': 'grad', '∑': 'Summe', '∏': 'Produkt', '∫': 'Integral',
    '∈': ' in ', '∉': ' nicht in ', '∋': ' enthaelt ', '∅': '{}',
    '⊂': ' Teilmenge ', '⊆': ' Teilmenge ', '⊃': ' Obermenge ',
    '⊇': ' Obermenge ', '∪': ' vereinigt ', '∩': ' geschnitten ',
    '∀': 'fuer alle ', '∃': 'es existiert ', '∄': 'kein ',
    '⊕': '(+)', '⊗': '(x)', '⋯': '...', '⋮': '...', '⋱': '...',
    '′': "'", '″': "''", '‱': ' pro 10000',
    '⌈': '[', '⌉': ']', '⌊': '[', '⌋': ']', '⟨': '<', '⟩': '>',
    '⁰': '^0', '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8',
    '⁹': '^9', '⁺': '^+', '⁻': '^-', '⁼': '^=', '⁽': '^(', '⁾': '^)',
    'ⁿ': '^n', 'ⁱ': '^i',
    '₀': '_0', '₁': '_1', '₂': '_2', '₃': '_3', '₄': '_4', '₅': '_5',
    '₆': '_6', '₇': '_7', '₈': '_8', '₉': '_9', '₊': '_+', '₋': '_-',
    '₌': '_=', '₍': '_(', '₎': '_)',
    'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
    'ζ': 'zeta', 'η': 'eta', 'θ': 'theta', 'ι': 'iota', 'κ': 'kappa',
    'λ': 'lambda', 'μ': 'mu', 'ν': 'nu', 'ξ': 'xi', 'π': 'pi', 'ρ': 'rho',
    'σ': 'sigma', 'τ': 'tau', 'υ': 'ypsilon', 'φ': 'phi', 'χ': 'chi',
    'ψ': 'psi', 'ω': 'omega', 'Γ': 'Gamma', 'Δ': 'Delta', 'Θ': 'Theta',
    'Λ': 'Lambda', 'Ξ': 'Xi', 'Π': 'Pi', 'Σ': 'Sigma', 'Φ': 'Phi',
    'Ψ': 'Psi', 'Ω': 'Omega',
};

/** Macht eine Zeichenkette WinAnsi-/Standard-14-darstellbar. */
function winAnsi(s: string): string {
    let out = '';
    for (const ch of s) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp <= 0xff || WINANSI_HIGH.has(cp)) { out += ch; continue; }
        if (ch in WA_MAP) { out += WA_MAP[ch]; continue; }
        // Unbekanntes Nicht-WinAnsi-Zeichen weglassen (rendert sonst
        // ohnehin als Tofu/Leerzeichen).
    }
    return out;
}

/**
 * Deep-Walk über den pdfmake-Baum: jede `text`-Zeichenkette wird
 * WinAnsi-sicher gemacht. `svg`-Knoten bleiben unangetastet (XML +
 * MathJax rendert eigene Glyphen). Mutiert in-place; rein
 * deterministisch ⇒ PDF bleibt idempotent.
 */
function sanitizeWinAnsi(node: unknown): void {
    if (Array.isArray(node)) { for (const n of node) sanitizeWinAnsi(n); return; }
    if (!node || typeof node !== 'object') return;
    const o = node as Record<string, unknown>;
    for (const k of Object.keys(o)) {
        if (k === 'svg') continue;
        const v = o[k];
        if (k === 'text' && typeof v === 'string') o[k] = winAnsi(v);
        else sanitizeWinAnsi(v);
    }
}

const HEAD_STYLE: Record<string, string> = {
    h1: 'mdH1', h2: 'mdH2', h3: 'mdH3', h4: 'mdH4', h5: 'mdH4', h6: 'mdH4',
};

/** Doc-Kommentar-Markdown → pdfmake-Content (Headings, Absatz, fett/
 *  kursiv, Inline-/Block-Code, Listen, Links). */
function mdContent(src: string): Content[] {
    if (!src) return [];
    const toks = MD.parse(src, {});
    const out: Content[] = [];
    for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.type === 'heading_open') {
            const inl = toks[i + 1];
            out.push({
                text: inl?.children ? inlineSpans(inl.children) : (inl?.content ?? ''),
                style: HEAD_STYLE[t.tag] ?? 'mdH4',
            });
            i += 2;
        } else if (t.type === 'paragraph_open') {
            const inl = toks[i + 1];
            const node: FlowBlock = inl?.children
                ? flowOrText(inl.children, CONTENT_W)
                : { text: [{ text: inl?.content ?? '' }] };
            out.push({ ...node, margin: [0, 2, 0, 6] });
            i += 2;
        } else if (t.type === 'math_block') {
            // Block-Mathe: echtes Vektor-SVG (MathJax); Breite auf den
            // Satzspiegel begrenzt, Seitenverhältnis bleibt (nur width).
            const { svg, width } = texToSvg(t.content, true);
            out.push({
                svg,
                width: Math.min(width, CONTENT_W),
                alignment: 'center',
                margin: [0, 6, 0, 10],
            });
        } else if (t.type === 'fence' || t.type === 'code_block') {
            out.push(codeBlock(t.content.replace(/\n$/, '')));
        } else if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
            const ordered = t.type === 'ordered_list_open';
            const items: Content[] = [];
            i++;
            while (i < toks.length && toks[i].type !== (ordered ? 'ordered_list_close' : 'bullet_list_close')) {
                if (toks[i].type === 'inline') {
                    items.push(flowOrText(toks[i].children ?? [], CONTENT_W - 22));
                }
                i++;
            }
            out.push(ordered
                ? { ol: items, margin: [0, 2, 0, 8] }
                : { ul: items, margin: [0, 2, 0, 8] });
        }
    }
    return out;
}

/** Tabelle (Feld-/Abbruch-Liste) im Theme-Raster mit Kopf-Füllung. */
function gridTable(head: string[], rows: string[][]): Content {
    const body: TableCell[][] = [
        head.map((h) => ({ text: h, bold: true, color: C.fg })),
        ...rows.map((r) => r.map((c) => ({ text: inlineMd(c) }))),
    ];
    return {
        table: { headerRows: 1, widths: ['auto', 'auto', '*'], body },
        layout: gridLayout, margin: [0, 4, 0, 10],
    };
}

function declContent(d: DeclDoc): Content[] {
    const out: Content[] = [
        {
            text: [
                { text: d.kind, decoration: 'underline', decorationColor: TK.kw.color },
                { text: ` ${d.name}` },
            ],
            style: 'decl', tocItem: true, tocStyle: 'tocDecl',
            // pdfmake liest die ToC-Einrückung aus `tocMargin`
            // (nicht aus `tocStyle.margin`) → Decls deutlich rechts
            // eingerückt unter ihrem Bereich.
            tocMargin: [42, 1.5, 0, 1.5],
        } as Content,
        codeBlock(d.signature),
        ...mdContent(d.doc),
    ];
    // Strukturierte @param/@rückgabe (datensatz: in Felder eingewoben).
    if (d.params && d.params.length > 0) {
        out.push({ text: 'Parameter', style: 'tagLabel' });
        out.push({
            table: {
                headerRows: 1, widths: ['auto', '*'],
                body: [
                    [{ text: 'Name', bold: true, color: C.fg },
                     { text: 'Beschreibung', bold: true, color: C.fg }],
                    ...d.params.map((p) => [
                        { text: p.name }, { text: inlineMd(p.desc) },
                    ]),
                ],
            },
            layout: gridLayout, margin: [0, 4, 0, 8],
        });
    }
    if (d.returns) {
        out.push({
            text: [
                { text: 'Rückgabe  ', bold: true, color: C.accent },
                ...inlineMd(d.returns),
            ],
            style: 'tagReturn',
        });
    }
    if (d.fields && d.fields.length > 0) {
        out.push(gridTable(
            ['Feld', 'Typ', 'Bedeutung'],
            d.fields.map((f) => [f.name, f.type, f.doc ?? '']),
        ));
    }
    if (d.values && d.values.length > 0) {
        out.push({
            text: [{ text: 'Werte: ', bold: true }, d.values.join(', ')],
            margin: [0, 2, 0, 6],
        });
    }
    for (const e of d.examples ?? []) {
        // Titel + Code als EINE Einheit: großer Abstand davor, enger
        // Bezug zum eigenen Code darunter → Titel gehört klar VOR
        // (und zu) seinem Testfall, nicht zum Block davor.
        out.push({
            stack: [
                {
                    text: `Testfall — ${e.label}${e.erwartetAbbruch ? ' (erwartet abbruch)' : ''}`,
                    style: 'exLabel',
                },
                codeBlock(e.code),
            ],
            margin: [0, 16, 0, 0],
        });
    }
    for (const q of d.quellen) {
        if (q.refs.length === 0) {
            out.push(quelleCallout([{ text: q.text, color: C.muted }]));
        } else {
            const links: Content[] = q.refs.flatMap((r, i) => [
                ...(i ? [{ text: ', ', color: C.muted } as Content] : []),
                {
                    text: `§ ${r.num} ${r.abk}`, link: r.url,
                    color: C.accent, decoration: 'underline',
                } as Content,
            ]);
            out.push(quelleCallout([{ text: q.text, color: C.muted }, '   ', ...links]));
        }
    }
    return out;
}

/** Reine pdfmake-Dokumentdefinition (testbar ohne Binär-Rendering). */
export function buildPdfDoc(model: DocModel, opts: PdfOptions = {}): TDocumentDefinitions {
    const kopf = opts.kopf;
    const titel = winAnsi(kopf?.titel ?? opts.titel ?? 'FinDSL-Dokumentation');
    // Ohne Kopf: bisheriger fester FinDSL-Untertitel (rückwärtskompatibel).
    // Mit Kopf: nur der Front-Matter-Untertitel (sonst keine Sub-Zeile).
    const untertitel = kopf
        ? (kopf.untertitel != null ? winAnsi(kopf.untertitel) : kopf.untertitel)
        : 'Domänenspezifische Sprache für die deutsche\nsteuerliche Finanzverwaltung';
    const nMod = model.modules.length;
    const nDecl = model.modules.reduce((a, m) => a + m.decls.length, 0);
    const metaZeile = (label: string, wert: string): Content =>
        ({ text: `${label}: ${wert}`, style: 'coverMeta' });

    // Deckblatt — linksbündig-redaktionell: Eyebrow, Serifen-Display-
    // Titel, Akzentregel, Untertitel, Metablock über Haarlinie.
    const content: Content[] = [
        { text: 'F I N D S L   ·   A U D I T', style: 'coverEyebrow', margin: [0, 158, 0, 0] },
        { text: titel, style: 'coverTitle' },
        {
            canvas: [{
                type: 'line', x1: 0, y1: 0, x2: 132, y2: 0,
                lineWidth: 3, lineColor: C.accent,
            }],
            margin: [0, 16, 0, 18],
        },
        ...(untertitel
            ? [{ text: untertitel, style: 'coverSub' } as Content]
            : []),
        hairline(0.75, C.rule, untertitel ? 64 : 10, 14),
        ...(kopf?.autor ? [metaZeile('Autor', kopf.autor)] : []),
        ...(kopf?.lizenz ? [metaZeile('Lizenz', kopf.lizenz)] : []),
        ...(opts.stand
            ? [{ text: `Stand: ${opts.stand}`, style: 'coverMeta' } as Content]
            : []),
        {
            text: `${nMod} Dateien · ${nDecl} Deklarationen`,
            style: 'coverMetaFaint', margin: [0, 4, 0, 0],
        },
        ...(kopf?.beschreibung
            ? [{ text: kopf.beschreibung, style: 'coverMetaFaint', margin: [0, 8, 0, 0] } as Content]
            : []),
        ...(kopf && kopf.metadaten.length > 0
            ? [{
                text: kopf.metadaten.map(([k, v]) => `${k}: ${v}`).join('   ·   '),
                style: 'coverMetaFaint', margin: [0, 6, 0, 0],
            } as Content]
            : []),
        { text: 'Erzeugt mit  findsl doku', style: 'coverFoot', margin: [0, 26, 0, 0] },
        { text: '', pageBreak: 'after' },
        // Einleitung (Front-Matter-Rumpf) als eigene Seite(n) vor dem ToC.
        ...(kopf?.einleitung
            ? [...mdContent(kopf.einleitung), { text: '', pageBreak: 'after' } as Content]
            : []),
        // KEIN pageBreak:'after' nach dem ToC — das erste Kapitel erzwingt
        // selbst `pageBreak:'before'`; sonst leere Seite dazwischen.
        { toc: { title: { text: 'Inhalt', style: 'tocTitle' } } },
    ];

    model.modules.forEach((m, mi) => {
        // Kapitel-Opener (Magazin-Stil): große Akzent-Nummer, Eyebrow,
        // Serifen-Titel, Akzentregel. pageBreak liegt auf dem ersten
        // Kapitel-Element (Nummer).
        content.push({
            text: String(mi + 1).padStart(2, '0'),
            style: 'chapNum', pageBreak: 'before',
        });
        content.push({ text: 'DATEI', style: 'chapEyebrow', margin: [0, 4, 0, 3] });
        content.push({
            text: m.name, style: 'h1',
            tocItem: true, tocStyle: 'tocModule',
            tocMargin: [0, 13, 0, 3],
        } as Content);
        // Relativer Dateipfad: kleine, ausgegraute Zeile unter dem
        // Kapitelnamen (Kapitel = Datei).
        content.push({ text: m.pfad, style: 'modulePfad' });
        content.push(hairline(2.5, C.accent, 6, 16));
        content.push(...mdContent(m.doc));
        for (const g of groupDecls(m.decls)) {
            // Bereichs-Eyebrow: Versal-Kopf (Ink, kein Akzent —
            // konsistent zur HTML-Überschriften-Regel) + Haarlinie.
            // Text-Knoten → `tocItem` (Hierarchie im ToC).
            content.push({
                text: g.header.toUpperCase(), style: 'group',
                tocItem: true, tocStyle: 'tocGroup',
                tocMargin: [16, 7, 0, 2],
            } as Content);
            content.push(hairline(0.75, C.rule, 5, 16));
            for (const d of g.decls) content.push(...declContent(d));
        }
        if (m.abbruchSites.length > 0) {
            content.push({
                text: 'EXPLIZIT AUSGESCHLOSSENE KONSTELLATIONEN',
                style: 'group',
            });
            content.push(hairline(0.75, C.rule, 5, 16));
            content.push(gridTable(
                ['In', 'Stelle', 'Begründung'],
                m.abbruchSites.map((s) => [
                    s.enthaltenIn ?? '—',
                    `Z. ${s.zeile}`,
                    (s.begruendung ?? '(dynamisch)') + (s.quelle ? ` · ${s.quelle}` : ''),
                ]),
            ));
        }
    });

    // Standard-14-Grenze: alle sichtbaren `text`-Strings WinAnsi-sicher
    // machen (SVG-Knoten ausgenommen). Einmaliger, deterministischer
    // Baum-Durchlauf ⇒ PDF bleibt idempotent; MD/HTML unberührt.
    sanitizeWinAnsi(content);

    return {
        info: { title: titel },
        // Cremeweißer Seitenhintergrund (Claude-Docs-Palette) auf
        // jeder Seite — Volltön-Rechteck hinter dem Inhalt.
        background: (_cur, size) => ({
            canvas: [{
                type: 'rect', x: 0, y: 0,
                w: size.width, h: size.height, color: C.pageBg,
            }],
        }),
        defaultStyle: { font: 'Helvetica', fontSize: 10, color: C.body, lineHeight: 1.4 },
        pageMargins: [50, 60, 50, 58],
        header: (cur) => (cur === 1 ? '' : {
            stack: [
                {
                    columns: [
                        {
                            text: 'FINDSL', width: 'auto', font: 'Helvetica',
                            bold: true, fontSize: 7, color: C.accent,
                            characterSpacing: 2,
                        },
                        {
                            text: titel, width: '*', alignment: 'right',
                            fontSize: 7.5, color: C.muted,
                        },
                    ],
                },
                {
                    canvas: [{
                        type: 'line', x1: 0, y1: 0, x2: CONTENT_W, y2: 0,
                        lineWidth: 0.5, lineColor: C.rule,
                    }],
                    margin: [0, 6, 0, 0],
                },
            ],
            margin: [50, 26, 50, 0],
        }),
        footer: (cur, count) => (cur === 1 ? '' : {
            stack: [
                {
                    canvas: [{
                        type: 'line', x1: 0, y1: 0, x2: CONTENT_W, y2: 0,
                        lineWidth: 0.5, lineColor: C.rule,
                    }],
                },
                {
                    columns: [
                        {
                            text: titel, width: '*', fontSize: 7,
                            color: C.faint,
                        },
                        {
                            text: `Seite ${cur} / ${count}`, width: 'auto',
                            alignment: 'right', fontSize: 7.5, color: C.muted,
                        },
                    ],
                    margin: [0, 7, 0, 0],
                },
            ],
            margin: [50, 14, 50, 0],
        }),
        content,
        styles: {
            // Deckblatt
            coverEyebrow: { font: 'Helvetica', fontSize: 9, bold: true, color: C.accent, characterSpacing: 3 },
            coverTitle: { font: 'Times', fontSize: 37, bold: true, color: C.fg, margin: [0, 12, 0, 0] },
            coverSub: { font: 'Times', italics: true, fontSize: 14, color: C.muted, lineHeight: 1.35 },
            coverMeta: { font: 'Helvetica', fontSize: 10, color: C.body, characterSpacing: 0.3 },
            coverMetaFaint: { font: 'Helvetica', fontSize: 9.5, color: C.muted },
            coverFoot: { font: 'Helvetica', fontSize: 8, color: C.faint, characterSpacing: 1 },
            // Kapitel-Opener
            chapNum: { font: 'Times', fontSize: 42, color: C.accent },
            chapEyebrow: { font: 'Helvetica', fontSize: 9, bold: true, color: C.muted, characterSpacing: 4 },
            // Struktur-Überschriften (Ink, kein Akzent)
            h1: { font: 'Times', fontSize: 24, bold: true, color: C.fg, margin: [0, 2, 0, 0] },
            modulePfad: { font: 'Courier', fontSize: 8, color: C.muted, margin: [0, 4, 0, 0] },
            h2: { font: 'Helvetica', fontSize: 13, bold: true, color: C.fg, margin: [0, 14, 0, 5] },
            group: {
                font: 'Helvetica', fontSize: 12, bold: true, color: C.fg,
                characterSpacing: 2.4, margin: [0, 30, 0, 4],
            },
            decl: { font: 'Helvetica', fontSize: 14, bold: true, color: C.fg, margin: [0, 18, 0, 4] },
            // Code + Labels
            code: { font: 'Courier', fontSize: 8.5, color: C.codeFg, lineHeight: 1.35 },
            codeLabel: {
                font: 'Helvetica', fontSize: 6, bold: true, color: C.accent,
                characterSpacing: 2, alignment: 'right', margin: [0, 0, 2, 2],
            },
            exLabel: { font: 'Times', italics: true, fontSize: 10.5, color: C.muted, margin: [0, 0, 0, 2] },
            tagLabel: {
                font: 'Helvetica', fontSize: 8, bold: true, color: C.muted,
                characterSpacing: 1.5, margin: [0, 12, 0, 4],
            },
            tagReturn: { font: 'Helvetica', fontSize: 10, margin: [0, 6, 0, 8] },
            // Inhaltsverzeichnis
            tocTitle: { font: 'Times', fontSize: 24, bold: true, color: C.fg, margin: [0, 0, 0, 8] },
            tocModule: { font: 'Times', fontSize: 12.5, bold: true, color: C.fg, margin: [0, 12, 0, 3] },
            tocGroup: {
                font: 'Helvetica', fontSize: 8, bold: true, color: C.muted,
                characterSpacing: 1.5, margin: [16, 5, 0, 2],
            },
            tocDecl: { font: 'Helvetica', fontSize: 9.5, color: C.body, margin: [40, 1.5, 0, 1.5] },
            // Doc-Kommentar-Überschriften (untergeordnet)
            mdH1: { font: 'Helvetica', fontSize: 13, bold: true, color: C.fg, margin: [0, 12, 0, 5] },
            mdH2: { font: 'Helvetica', fontSize: 11.5, bold: true, color: C.fg, margin: [0, 9, 0, 4] },
            mdH3: { font: 'Helvetica', fontSize: 10.5, bold: true, color: C.fg, margin: [0, 7, 0, 3] },
            mdH4: {
                font: 'Helvetica', fontSize: 9, bold: true, color: C.muted,
                characterSpacing: 0.5, margin: [0, 6, 0, 3],
            },
        },
    };
}

/** Erzeugt den PDF-Binärstream (pdfmake `PdfPrinter`, Standard-Fonts). */
export async function renderPdf(model: DocModel, opts: PdfOptions = {}): Promise<Buffer> {
    // pdfmake 0.3 Node-Server-API ist kompiliertes CJS (`js/*`; `src/`
    // ist roh-ESM und bricht unter NodeNext). `createRequire` gibt
    // deterministische CJS-Semantik in ALLEN Runtimes (Node-CLI,
    // tsc-ESM, vitest) — das ESM-Default-Interop divergiert sonst
    // (CLAUDE § 7, „Drei-Runtime-Divergenz"). PdfPrinter braucht ein
    // VirtualFileSystem (Singleton) + URLResolver; Standard-14-Fonts
    // (Helvetica/Courier) laufen über pdfkit ohne Font-Dateien → voll
    // offline. `createPdfKitDocument` ist async.
    const PdfPrinter = cjsDefault<
        new (f: typeof FONTS, vfs: unknown, r: unknown) => {
            createPdfKitDocument(d: TDocumentDefinitions):
                Promise<NodeJS.ReadableStream & { end(): void }>;
        }
    >(pdfmakePrinterCjs);
    const vfs = cjsDefault<unknown>(pdfmakeVfsCjs);          // Singleton-Instanz
    const URLResolver = cjsDefault<new (fs: unknown) => unknown>(
        pdfmakeUrlResolverCjs,
    );
    const printer = new PdfPrinter(FONTS, vfs, new URLResolver(vfs));
    // MathJax einmalig initialisieren, bevor der synchrone Token-Walk
    // in buildPdfDoc → mdContent → texToSvg läuft (Block-Mathe → SVG).
    await ensureMathJax();
    const pdfDoc = await printer.createPdfKitDocument(buildPdfDoc(model, opts));
    return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        pdfDoc.on('data', (c: Buffer) => chunks.push(c));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', reject);
        pdfDoc.end();
    });
}
