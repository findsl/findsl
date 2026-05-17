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
            default: break;
        }
    }
    return out.length ? out : [{ text: '' }];
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
            out.push({
                text: inl?.children ? inlineSpans(inl.children) : (inl?.content ?? ''),
                margin: [0, 2, 0, 6],
            });
            i += 2;
        } else if (t.type === 'fence' || t.type === 'code_block') {
            out.push(codeBlock(t.content.replace(/\n$/, '')));
        } else if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
            const ordered = t.type === 'ordered_list_open';
            const items: Content[] = [];
            i++;
            while (i < toks.length && toks[i].type !== (ordered ? 'ordered_list_close' : 'bullet_list_close')) {
                if (toks[i].type === 'inline') {
                    items.push({ text: inlineSpans(toks[i].children ?? []) });
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
        ...rows.map((r) => r.map((c) => ({ text: c }))),
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
                    ...d.params.map((p) => [{ text: p.name }, { text: p.desc }]),
                ],
            },
            layout: gridLayout, margin: [0, 4, 0, 8],
        });
    }
    if (d.returns) {
        out.push({
            text: [
                { text: 'Rückgabe  ', bold: true, color: C.accent },
                { text: d.returns, color: C.body },
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
    const titel = kopf?.titel ?? opts.titel ?? 'FinDSL-Dokumentation';
    // Ohne Kopf: bisheriger fester FinDSL-Untertitel (rückwärtskompatibel).
    // Mit Kopf: nur der Front-Matter-Untertitel (sonst keine Sub-Zeile).
    const untertitel = kopf
        ? kopf.untertitel
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
    const pdfDoc = await printer.createPdfKitDocument(buildPdfDoc(model, opts));
    return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        pdfDoc.on('data', (c: Buffer) => chunks.push(c));
        pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
        pdfDoc.on('error', reject);
        pdfDoc.end();
    });
}
