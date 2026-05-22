// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * PAP-Emitter: FlowGraph → Mermaid-Flowchart.
 *
 * Mermaid rendert nativ in VS Code, GitHub-Markdown und der Doc-Generator-
 * HTML — daher das MVP-Zielformat (Tier 1). DIN-66001-Symboltreue (echte
 * SVG-Symbole) folgt im DOT/SVG-Emitter (Tier 2). Knoten-Shape-Abbildung:
 *
 *   start/ende  → `([…])`   Stadium (Grenzstelle)
 *   operation   → `[…]`     Rechteck
 *   decision    → `{…}`     Raute (2-Wege)
 *   case        → `{{…}}`   Hexagon (n-Wege-Fallunterscheidung)
 *   subprogram  → `[[…]]`   Unterprogramm (vordefinierter Prozess)
 *   ausgabe     → `[/…/]`   Parallelogramm (Ausgabe)
 *
 * Reihenfolge der Knoten/Kanten = Modell-Reihenfolge (deterministisch).
 */

import type { FlowGraph, FlowNode, NodeKind, PapModul } from './model.js';

export type MermaidTheme = 'default' | 'neutral' | 'dark' | 'forest';

export interface MermaidOptions {
    /** Fluss-Richtung: `TD` (oben→unten, Default) oder `LR` (links→rechts). */
    readonly direction?: 'TD' | 'LR';
    /** Mermaid-Built-in-Theme (`%%{init}%%`); Default `default`. */
    readonly theme?: MermaidTheme;
    /** Semantische Knoten-Färbung je Knotenart (classDef, Default an). */
    readonly farben?: boolean;
    /** Nur die `class <id> <art>`-Zuweisungen emittieren (Knoten bekommen
     *  ihre Art als CSS-Klasse), OHNE classDef-Farben. Der HTML-Emitter
     *  nutzt das, um die Knoten per Seiten-CSS hell/dunkel zu färben
     *  (prefers-color-scheme) — classDef würde Inline-`!important` setzen,
     *  das kein Seiten-CSS überschreiben kann. */
    readonly klassen?: boolean;
    /** Native Mermaid-Tooltips (`click … "text"`) emittieren (Default an).
     *  Der HTML-Emitter setzt `false` und liefert eigene KaTeX-Tooltips —
     *  die §-Links (`href`) bleiben erhalten. */
    readonly tooltips?: boolean;
}

export interface ClassStyle {
    readonly fill: string;
    readonly stroke: string;
    readonly color?: string;
}

/** Kanten-/Linienfarbe je Helligkeit (dezent). Auch vom HTML-Emitter für
 *  das prefers-color-scheme-CSS genutzt. */
export const LINE_COLOR = { light: '#c8ccd1', dark: '#5a5e63' } as const;

// Dezente Palette: niedrig gesättigte, helle Füllungen mit zarten Rändern
// und weichem Grau-Text statt lauter „Ampel"-Farben. Semantik bleibt lesbar
// (start blau, ende grün, abbruch rot, decision/case bernstein, …), aber
// ruhig/harmonisch.

/** Palette für helle Themes (default/neutral/forest). */
export const LIGHT: Record<NodeKind, ClassStyle> = {
    start: { fill: '#eef4fe', stroke: '#a9c7f5', color: '#3c4043' },
    ende: { fill: '#eaf5ee', stroke: '#a6d5b8', color: '#3c4043' },
    abbruch: { fill: '#fdecea', stroke: '#f1b0a8', color: '#3c4043' },
    operation: { fill: '#f6f7f8', stroke: '#d8dce0', color: '#3c4043' },
    decision: { fill: '#fdf6e0', stroke: '#ecd79b', color: '#3c4043' },
    case: { fill: '#fcf0e2', stroke: '#f0c79a', color: '#3c4043' },
    subprogram: { fill: '#eeeffb', stroke: '#c3c6ef', color: '#3c4043' },
    ausgabe: { fill: '#e6f4f3', stroke: '#a7d4d1', color: '#3c4043' },
    eingabe: { fill: '#e9f3fb', stroke: '#b2d3ec', color: '#3c4043' },
};

/** Palette für das `dark`-Theme (gedämpfte Füllungen, zarte Rahmen). */
export const DARK: Record<NodeKind, ClassStyle> = {
    start: { fill: '#1e2a3a', stroke: '#3f6092', color: '#e3e3e3' },
    ende: { fill: '#1d2e25', stroke: '#3f5f4b', color: '#e3e3e3' },
    abbruch: { fill: '#32211f', stroke: '#714842', color: '#e3e3e3' },
    operation: { fill: '#26282a', stroke: '#3c4043', color: '#e3e3e3' },
    decision: { fill: '#2d291b', stroke: '#564b2c', color: '#e3e3e3' },
    case: { fill: '#2d251b', stroke: '#56452c', color: '#e3e3e3' },
    subprogram: { fill: '#222338', stroke: '#3e4070', color: '#e3e3e3' },
    ausgabe: { fill: '#163230', stroke: '#2c534f', color: '#e3e3e3' },
    eingabe: { fill: '#19293a', stroke: '#345066', color: '#e3e3e3' },
};

/** Mermaid-Label-Escaping: Anführungszeichen + spitze Klammern als
 *  Mermaid-Entities, damit `<=`/`==`/`"` Labels nicht zerbrechen. Der
 *  emitter-neutrale Zeilentrenner `\n` (aus dem Modell) wird zuletzt zu
 *  `<br/>` — NACH dem Escaping, damit das `<` des `<br/>` erhalten bleibt. */
function esc(s: string): string {
    return s
        .replace(/"/g, '#quot;')
        .replace(/</g, '#lt;')
        .replace(/>/g, '#gt;')
        .replace(/\n/g, '<br/>');
}

// Terminator (Grenzstelle) = gerundetes Rechteck `(…)` statt Stadium
// `([…])`: das Stadium wird bei vielzeiligem Text zur Ellipse und
// beschneidet breitere Zeilen am Rand. Das gerundete Rechteck hält
// mehrzeiligen Text formtreu; die Färbung trennt es vom scharfkantigen
// Operations-Rechteck `[…]`.
const SHAPE: Record<NodeKind, readonly [string, string]> = {
    start: ['(', ')'],
    ende: ['(', ')'],
    abbruch: ['(', ')'],
    operation: ['[', ']'],
    decision: ['{', '}'],
    case: ['{{', '}}'],
    subprogram: ['[[', ']]'],
    ausgabe: ['[/', '/]'],
    eingabe: ['[/', '/]'],
};

function nodeLine(n: FlowNode): string {
    const [open, close] = SHAPE[n.kind];
    // Leerzeile (`<br/><br/>`) als Abgrenzung vor der Gesetzes-Referenz.
    const label = n.quelle
        ? `${esc(n.label)}<br/><br/>⟨${esc(n.quelle)}⟩`
        : esc(n.label);
    return `    ${n.id}${open}"${label}"${close}`;
}

/** Tooltip-/Link-Text für `click`-Direktiven: einzeilig, ohne `"`. */
function clickStr(s: string): string {
    return s.replace(/\s+/g, ' ').replace(/"/g, "'").trim();
}

/** click-Link-Whitelist: nur https auf gesetze-im-internet.de. */
function isSafeUrl(url: string): boolean {
    try {
        const u = new URL(url);
        return u.protocol === 'https:'
            && (u.hostname === 'gesetze-im-internet.de'
                || u.hostname.endsWith('.gesetze-im-internet.de'));
    } catch {
        return false;
    }
}

/** Monospace-Schrift für die Diagramme (Code-Charakter von FinDSL). Per
 *  `%%{init}%%`-Direktive im Quelltext → wirkt in MD UND HTML (anders als
 *  ein globaler initialize-Config, den fremde .md-Renderer nicht kennen). */
const MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** `%%{init}%%`-Direktive: immer `fontFamily` (Monospace), zusätzlich das
 *  Theme bei Abweichung vom Default. Das dark-Tooltip-Styling liegt im
 *  HTML-Emitter (Seiten-CSS), nicht hier — Mermaids `themeCSS` erreicht den
 *  außerhalb des SVG lebenden Tooltip-`div` in vielen Renderern nicht. */
function initDirective(theme: MermaidTheme): string {
    // Dezente, helle Linienfarbe (themengerecht); weiche Kanten; kleinere
    // Monospace-Schrift.
    const lineColor = theme === 'dark' ? LINE_COLOR.dark : LINE_COLOR.light;
    const vars = `'fontFamily': '${MONO_FONT}', 'fontSize': '13px', 'lineColor': '${lineColor}'`;
    const flow = `'curve': 'basis', 'padding': 10, 'nodeSpacing': 45, 'rankSpacing': 45`;
    const themePart = theme === 'default' ? '' : `'theme': '${theme}', `;
    // Top-Level-`fontFamily` ZUSÄTZLICH zu themeVariables: Mermaid misst die
    // Label-Breite über die Top-Level-Schrift, rendert aber über die Theme-
    // Schrift — ohne Gleichstand schätzt es Monospace-Knoten zu schmal und
    // schneidet Text ab.
    return `%%{init: {${themePart}'fontFamily': '${MONO_FONT}', `
        + `'themeVariables': {${vars}}, 'flowchart': {${flow}}}}%%`;
}

/** Ein FlowGraph → ein Mermaid-`flowchart`-Block (ohne Code-Fence).
 *  `click`-Direktiven verlinken Gesetzes-§ (gesetze-im-internet) und legen
 *  den vollen `abbruch`-Wortlaut als Tooltip. Diese werden NUR in Renderern
 *  mit `securityLevel: 'loose'` (eigene HTML-Ausgabe, VS Code) aktiv — auf
 *  GitHub (strict) werden sie ignoriert, brechen das Diagramm aber nicht. */
export function renderMermaid(graph: FlowGraph, opts: MermaidOptions = {}): string {
    const dir = opts.direction ?? 'TD';
    const theme = opts.theme ?? 'default';
    const farben = opts.farben ?? true;
    const lines: string[] = [];
    // Init-Direktive (Monospace-Schrift + ggf. Theme) immer voranstellen.
    lines.push(initDirective(theme));
    lines.push(`flowchart ${dir}`);
    for (const n of graph.nodes) lines.push(nodeLine(n));
    for (const e of graph.edges) {
        lines.push(e.label !== undefined
            ? `    ${e.from} -->|"${esc(e.label)}"| ${e.to}`
            : `    ${e.from} --> ${e.to}`);
    }
    const withTips = opts.tooltips ?? true;
    for (const n of graph.nodes) {
        const tip = withTips && n.tooltip ? clickStr(n.tooltip) : undefined;
        // Defense-in-Depth: nur whitelisted https-§-Links als click-Ziel
        // (n.link stammt aus parseQuelleRefs, aber der Guard sitzt explizit
        // am Emit-Punkt — securityLevel:'loose' macht clicks im HTML aktiv).
        const link = n.link && isSafeUrl(n.link) ? n.link : undefined;
        if (link && tip) {
            lines.push(`    click ${n.id} href "${link}" "${tip}" _blank`);
        } else if (link) {
            lines.push(`    click ${n.id} href "${link}" _blank`);
        }
        // Tooltip OHNE Link: bewusst KEINE `click … callback`-Direktive.
        // Mermaids `click`-Grammatik bände hier einen JS-Handler namens
        // `callback`, den es nirgends gibt — in `securityLevel: 'loose'`-
        // Renderern (VS Code) ein Laufzeitfehler beim Klick, auf GitHub
        // (strict) wirkungslos. Reiche Tooltips liefert die HTML-Ausgabe
        // über die eigene KaTeX-Schicht (n.tooltipRaw).
    }
    const klassen = opts.klassen ?? false;
    if (farben || klassen) lines.push(...styleLines(graph, theme, farben));
    return lines.join('\n');
}

/** `classDef`/`class`-Zeilen für die semantische Knoten-Färbung — Knoten
 *  nach Art gruppiert, deterministisch in Knotenreihenfolge. Palette nach
 *  Theme (dunkel/hell). */
function styleLines(graph: FlowGraph, theme: MermaidTheme, mitFarben: boolean): string[] {
    const palette = theme === 'dark' ? DARK : LIGHT;
    const byKind = new Map<NodeKind, string[]>();
    for (const n of graph.nodes) {
        const ids = byKind.get(n.kind) ?? [];
        ids.push(n.id);
        byKind.set(n.kind, ids);
    }
    const out: string[] = [];
    for (const [kind, ids] of byKind) {
        if (mitFarben) {
            const s = palette[kind];
            const color = s.color ? `,color:${s.color}` : '';
            // Zarte 1px-Ränder (dezent) statt der dickeren Theme-Defaults.
            out.push(`    classDef ${kind} fill:${s.fill},stroke:${s.stroke},stroke-width:1px${color}`);
        }
        // `class`-Zuweisung immer: ohne classDef trägt der Knoten die Art als
        // CSS-Klasse, die der HTML-Emitter per Seiten-CSS einfärbt.
        out.push(`    class ${ids.join(',')} ${kind}`);
    }
    return out;
}

/** Ein Modul → Markdown-Dokument mit je `fn` einem ```mermaid-Block.
 *  Markdown, weil es mehrere Diagramme trägt und überall rendert
 *  (VS Code / GitHub / Doc-Generator-HTML). */
export function renderModuleMarkdown(modul: PapModul, opts: MermaidOptions = {}): string {
    const out: string[] = [`# Programmablaufpläne — ${modul.modul}`, ''];
    for (const g of modul.graphs) {
        out.push(`## ${g.fnName}`, '', '```mermaid', renderMermaid(g, opts), '```', '');
    }
    return out.join('\n');
}
