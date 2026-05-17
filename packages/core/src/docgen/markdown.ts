/**
 * Doc-Generator — kanonischer Markdown-Renderer.
 *
 * Markdown ist das stabile, maschinell parsbare Leitartefakt (P6);
 * HTML/PDF leiten sich daraus bzw. aus demselben `DocModel` ab.
 * Bewusst **deterministisch** (kein Zeitstempel) — Audit-
 * Reproduzierbarkeit. Datum/„Stand" setzt der Aufrufer (CLI/PDF-Cover).
 */

import type { DocModel, ModuleDoc, DeclDoc, QuelleEntry } from './model.js';
import type { AbbruchSite } from '../language/findsl-abbruch-sites.js';
import type { DocKopf } from './kopf.js';

/** GitHub-artiger Anker-Slug (kleinschreiben, Sonderzeichen → `-`). */
export function slug(s: string): string {
    return s.toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '');
}

/**
 * Bereichs-Gruppierung pro Modul (feste Reihenfolge): Konstanten,
 * Datensätze, Aufzählungen, Funktionen, Prüfungen. Die drei Kern-
 * bereiche sind benannt; `datensatz`/`aufzählung` bekommen einen
 * eigenen Bereich, damit nichts verlorengeht (P7 — alles sichtbar).
 */
export const DECL_GROUPS: ReadonlyArray<{
    readonly kind: DeclDoc['kind'];
    readonly header: string;
}> = [
    { kind: 'konst', header: 'Konstanten' },
    { kind: 'datensatz', header: 'Datensätze' },
    { kind: 'aufzählung', header: 'Aufzählungen' },
    { kind: 'fn', header: 'Funktionen' },
    { kind: 'prüfe', header: 'Prüfungen' },
];

/** Teilt Deklarationen in nicht-leere Bereiche (stabile Reihenfolge). */
export function groupDecls(
    decls: ReadonlyArray<DeclDoc>,
): ReadonlyArray<{ readonly header: string; readonly decls: ReadonlyArray<DeclDoc> }> {
    return DECL_GROUPS
        .map((g) => ({ header: g.header, decls: decls.filter((d) => d.kind === g.kind) }))
        .filter((g) => g.decls.length > 0);
}

/**
 * Verschiebt alle ATX-Headings eines Doc-Kommentar-Markdowns so nach
 * unten, dass die oberste Ebene mindestens `minLevel` ist (max H6).
 * Verhindert Hierarchie-Inversion: ein `# …` im Doc-Kommentar darf
 * nicht größer wirken als die umschließende `## Modul`/`### decl`-
 * Überschrift. Codeblöcke (``` … ```) werden übersprungen.
 */
function demoteHeadings(mdSrc: string, minLevel: number): string {
    const lines = mdSrc.split('\n');
    let fence = false;
    const heads: number[] = [];
    for (const ln of lines) {
        if (/^\s*```/.test(ln)) { fence = !fence; continue; }
        if (fence) continue;
        const m = ln.match(/^(#{1,6})\s+\S/);
        if (m) heads.push(m[1].length);
    }
    if (heads.length === 0) return mdSrc;
    const shift = Math.max(0, minLevel - Math.min(...heads));
    if (shift === 0) return mdSrc;
    fence = false;
    return lines.map((ln) => {
        if (/^\s*```/.test(ln)) { fence = !fence; return ln; }
        if (fence) return ln;
        const m = ln.match(/^(#{1,6})(\s+\S.*)$/);
        if (!m) return ln;
        const lvl = Math.min(6, m[1].length + shift);
        return '#'.repeat(lvl) + m[2];
    }).join('\n');
}

function quelleMarkdown(quellen: ReadonlyArray<QuelleEntry>): string {
    if (quellen.length === 0) return '';
    // Dezenter Quellen-Aside (Blockquote → klein/leise gerendert),
    // nicht als auffälliger Block.
    const lines = quellen.map((q) => {
        if (q.refs.length === 0) return `Quelle: ${q.text}`;
        const links = q.refs.map((r) => `[§ ${r.num} ${r.abk}](${r.url})`).join(', ');
        return `Quelle: ${q.text} — ${links}`;
    });
    return lines.map((l) => `> ${l}`).join('\n>\n');
}

function fence(code: string): string {
    return '```findsl\n' + code + '\n```';
}

/** Tabellenzellen-sicher: `|` maskieren (Markdown-Tabellen-Trenner). */
function escCell(s: string): string {
    return s.replace(/\|/g, '\\|');
}

/** `@param`/`@rückgabe` strukturiert: Parameter-Tabelle + Rückgabe. */
function tagsMarkdown(d: DeclDoc): string {
    const blocks: string[] = [];
    if (d.params && d.params.length > 0) {
        const rows = d.params.map(
            (p) => `| \`${p.name}\` | ${escCell(p.desc)} |`,
        );
        blocks.push(
            `**Parameter**\n\n| Name | Beschreibung |\n| --- | --- |\n${rows.join('\n')}`,
        );
    }
    if (d.returns) blocks.push(`**Rückgabe** — ${escCell(d.returns)}`);
    return blocks.join('\n\n');
}

function declMarkdown(d: DeclDoc): string {
    const parts: string[] = [`#### ${d.kind} \`${d.name}\``];
    parts.push(fence(d.signature));
    // Decl-Doc sitzt unter `#### decl` (Bereich H3 → Decl H4) → ab H5.
    if (d.doc) parts.push(demoteHeadings(d.doc, 5));

    const tags = tagsMarkdown(d);
    if (tags) parts.push(tags);

    if (d.fields && d.fields.length > 0) {
        const rows = d.fields.map(
            (f) => `| \`${f.name}\` | \`${f.type}\` | ${f.doc ?? ''} |`,
        );
        parts.push(`| Feld | Typ | Bedeutung |\n| --- | --- | --- |\n${rows.join('\n')}`);
    }
    if (d.values && d.values.length > 0) {
        parts.push(`**Werte:** ${d.values.map((v) => `\`${v}\``).join(', ')}`);
    }
    if (d.examples && d.examples.length > 0) {
        const ex = d.examples.map((e) => {
            const tag = e.erwartetAbbruch ? ' _(erwartet abbruch)_' : '';
            return `**Testfall — ${e.label}**${tag}\n\n${fence(e.code)}`;
        });
        parts.push(ex.join('\n\n'));
    }
    const q = quelleMarkdown(d.quellen);
    if (q) parts.push(q);
    return parts.join('\n\n');
}

function abbruchAnhang(sites: ReadonlyArray<AbbruchSite>): string {
    if (sites.length === 0) return '';
    const rows = sites.map((s) => {
        const grund = s.begruendung ?? '(dynamisch)';
        const wo = s.enthaltenIn ?? '—';
        const q = s.quelle ? ` · Quelle: ${s.quelle}` : '';
        return `| \`${wo}\` | Z. ${s.zeile} | ${grund}${q} |`;
    });
    return `### Explizit ausgeschlossene Konstellationen\n\n`
        + `| In | Stelle | Begründung |\n| --- | --- | --- |\n${rows.join('\n')}`;
}

function moduleMarkdown(m: ModuleDoc): string {
    // Kapitel = Datei; Überschrift = Datei-Identität, darunter der
    // relative Dateipfad als kleine, ausgegraute Zeile (HTML/PDF
    // stylen sie; im kanonischen MD eine entzerrte Kursiv-Code-Zeile).
    const parts: string[] = [`## \`${m.name}\``, `*\`${m.pfad}\`*`];
    // Datei-Doc-Headings ab H4: H3 ist der Bereichs-Kategorie-Stil
    // (Konstanten/…) reserviert — der Datei-Titel soll prominent
    // (H4) bleiben, nicht wie eine Mini-Kategorie wirken.
    if (m.doc) parts.push(demoteHeadings(m.doc, 4));
    for (const g of groupDecls(m.decls)) {
        parts.push(`### ${g.header}`);
        for (const d of g.decls) parts.push(declMarkdown(d));
    }
    const anh = abbruchAnhang(m.abbruchSites);
    if (anh) parts.push(anh);
    return parts.join('\n\n');
}

function toc(model: DocModel): string {
    const lines: string[] = ['## Inhalt', ''];
    for (const m of model.modules) {
        lines.push(`- [${m.name}](#${slug(m.name)})`);
        for (const g of groupDecls(m.decls)) {
            lines.push(`  - ${g.header}`);
            for (const d of g.decls) {
                lines.push(`    - [${d.kind} ${d.name}](#${slug(`${d.kind} ${d.name}`)})`);
            }
        }
    }
    return lines.join('\n');
}

/**
 * Front-Matter-Dokumentkopf als Markdown: `# Titel`, kursiver
 * Untertitel, Metablock (Autor/Lizenz/Beschreibung + Metadaten-Tabelle)
 * und der Einleitungs-Markdown. Geteilt von Markdown- und HTML-Renderer.
 */
export function kopfMarkdown(kopf: DocKopf): string {
    const out: string[] = [`# ${kopf.titel}`];
    if (kopf.untertitel) out.push(`*${kopf.untertitel}*`);

    const meta: string[] = [];
    if (kopf.autor) meta.push(`**Autor:** ${kopf.autor}`);
    if (kopf.lizenz) meta.push(`**Lizenz:** ${kopf.lizenz}`);
    if (meta.length > 0) out.push(meta.join('  ·  '));
    if (kopf.beschreibung) out.push(kopf.beschreibung);

    if (kopf.metadaten.length > 0) {
        const rows = kopf.metadaten
            .map(([k, v]) => `| ${escCell(k)} | ${escCell(v)} |`)
            .join('\n');
        out.push(`| Schlüssel | Wert |\n| --- | --- |\n${rows}`);
    }
    if (kopf.einleitung) out.push(kopf.einleitung);
    return out.join('\n\n');
}

export interface MarkdownOptions {
    /** Dokumenttitel `# …` ausgeben (Default: true; HTML/PDF aus). */
    readonly title?: boolean;
    /** Inline-Inhaltsverzeichnis ausgeben (Default: true; HTML-Sidebar
     *  ersetzt es → dort `false`). */
    readonly toc?: boolean;
    /** Front-Matter-Dokumentkopf (ersetzt den Default-Titel). Ohne
     *  Kopf bleibt die Ausgabe unverändert (`# FinDSL-Dokumentation`). */
    readonly kopf?: DocKopf;
}

/** Rendert das vollständige Dokument als kanonisches Markdown. */
export function renderMarkdown(model: DocModel, opts: MarkdownOptions = {}): string {
    const withTitle = opts.title ?? true;
    const withToc = opts.toc ?? true;
    const blocks: string[] = [];
    if (withTitle) {
        blocks.push(opts.kopf ? kopfMarkdown(opts.kopf) : '# FinDSL-Dokumentation');
    }
    if (withToc) blocks.push(toc(model));
    blocks.push(...model.modules.map(moduleMarkdown));
    return blocks.join('\n\n') + '\n';
}
