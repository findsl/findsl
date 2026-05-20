// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Strukturiertes Markdown-Rendering für Hover-Karten (Issue #65 Phase C).
 *
 * Nimmt einen rohen `--…--`-Doc-Kommentar + optionale Param-Namen-
 * Liste + optionale `@Quelle`-Annotationen und produziert eine
 * Markdown-Karte mit klar getrennten Sektionen:
 *
 *   <Prosa-Beschreibung>
 *
 *   **Parameter**
 *   - `paramName` — Beschreibung
 *   - …
 *
 *   **Rückgabe**
 *   Beschreibung
 *
 *   ---
 *   *Quelle:* …
 *
 * Math-Notation (`$…$` inline, `$$…$$` block) wird in einem CommonMark-
 * sicheren Code-Span/Code-Block gerendert — der LSP-Client (VS Code)
 * rendert keinen KaTeX im Hover, das wäre Editor-spezifisch.
 *
 * Reine Funktion ohne Langium-Abhängigkeit (nimmt nur Strings + Listen
 * entgegen) — leicht testbar.
 */

import { parseDocTags, stripDocMarkers } from './doc-tags.js';
import { texToPlain } from './tex-to-plain.js';

export interface QuelleAnnotation {
    readonly value: string;
}

export interface RenderInput {
    /** Der rohe `--…--`-Doc-Kommentar (mit Markern); leer/`undefined` → keine Prosa-Sektion. */
    readonly docRaw?: string;
    /** Reihenfolge der formal deklarierten Parameter (für `@param`-Sortierung
     *  + Erkennung von „unbekannten" `@param`-Tags, deren Name nicht im
     *  Signatur-Param-Set steckt — diese bleiben am Ende erhalten). */
    readonly paramOrder?: ReadonlyArray<string>;
    /** Extrahierte `@Quelle("...")`-Werte. */
    readonly quellen?: ReadonlyArray<QuelleAnnotation>;
}

/**
 * Rendert die Hover-Karten-Sektionen unter der Code-Signatur.
 * Liefert leeren String, wenn weder Doc noch Quellen vorhanden sind.
 */
export function renderDocForHover(input: RenderInput): string {
    const { docRaw, paramOrder, quellen } = input;
    const stripped = stripDocMarkers(docRaw);
    const sections: string[] = [];

    if (stripped) {
        const tags = parseDocTags(stripped);
        const prose = formatProse(tags.prose);
        if (prose) sections.push(prose);

        // Parameter-Sektion: Reihenfolge folgt `paramOrder`, falls vorhanden;
        // unbekannte `@param`-Tags (Tippfehler im Doc) bleiben sichtbar am
        // Ende, damit der Autor sie sieht.
        if (tags.params.length > 0) {
            const sorted = sortParams(tags.params, paramOrder);
            const list = sorted
                .map((p) => `- \`${p.name}\` — ${escapeInline(p.desc)}`)
                .join('\n');
            sections.push(`**Parameter**\n${list}`);
        }

        if (tags.returns) {
            sections.push(`**Rückgabe**\n${escapeInline(tags.returns)}`);
        }
    }

    if (quellen && quellen.length > 0) {
        const lines = quellen.map((q) => `*Quelle:* ${q.value}`).join('\n\n');
        sections.push(lines);
    }

    return sections.join('\n\n---\n\n');
}

/**
 * Bereitet die Prosa für die Hover-Karte auf:
 *
 * - Block-Math (`$$…$$`) → über `texToPlain` zu lesbarem Plain-Text
 *   gewandelt + als Fenced Code-Block ausgegeben (LSP-Clients wie
 *   VS Code rendern keinen KaTeX im Hover; der Klartext ist im Editor
 *   sofort verständlich).
 * - Inline-Math (`$…$`) → via `texToPlain` zu Plain-Text + als
 *   Backtick-Code-Span. Beispiel: `$\frac{a}{b}$` → `` `(a)/(b)` ``.
 * - Mehrfache Leerzeilen werden auf Doppel-Leerzeile reduziert.
 *
 * Hintergrund: VS Code unterstützt **kein KaTeX-Rendering** in
 * Hover-Karten. Roher TeX (`\frac{...}{...}`, `\cdot`, `\geq`) ist
 * unleserlich, ein ```math-Block bleibt ebenfalls Roh-Text. Klartext
 * via `texToPlain` (= derselbe Algorithmus wie der PDF-Inline-
 * Fallback) ist die portable Lower-Bound-Lösung für alle Editoren.
 */
function formatProse(prose: string): string {
    if (!prose) return '';
    let out = prose;
    // Block-Math: `$$ ... $$` → klartext-gerenderter ```findsl-Block.
    // `findsl`-Sprache, damit das Syntax-Highlighting-Theme einen
    // ruhigen Hintergrund gibt — der Inhalt selbst ist Plain-Text.
    out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) => {
        const plain = texToPlain(inner.trim());
        return '```findsl\n' + plain + '\n```';
    });
    // Inline-Math: `$x + y$` → `` `x + y` `` (Klartext, kein TeX).
    // Vorsicht: nicht innerhalb bereits gefencter Code-Blöcke ersetzen
    // (sehr selten im Korpus; pragmatisch akzeptiert).
    out = out.replace(/\$([^\n$]+?)\$/g, (_m, inner: string) => {
        const plain = texToPlain(inner.trim());
        return '`' + plain + '`';
    });
    out = out.replace(/\n{3,}/g, '\n\n');
    return out.trim();
}

/** Escape Markdown-Sonderzeichen in einer einzeiligen Beschreibung (für
 *  Parameter-/Rückgabe-Listen): wir vermeiden, dass `*` / `_` / `` ` `` im
 *  Beschreibungstext ungewollt Formatierung triggern. Pragmatisch: nur
 *  führende `-`/`*` schützen (Liste-Marker), den Rest in der Prosa
 *  lassen — die meisten Doc-Texte sind reines Deutsch ohne Markdown. */
function escapeInline(s: string): string {
    return s.replace(/^([-*])/, '\\$1');
}

/** Sortiert Tags in der Param-Reihenfolge der Funktion/Datensatz-Signatur.
 *  Unbekannte Tags (kein Match in `paramOrder`) wandern ans Ende, ihre
 *  relative Reihenfolge bleibt erhalten. */
function sortParams(
    params: ReadonlyArray<{ name: string; desc: string }>,
    paramOrder?: ReadonlyArray<string>,
): ReadonlyArray<{ name: string; desc: string }> {
    if (!paramOrder || paramOrder.length === 0) return params;
    const known: typeof params[number][] = [];
    const unknown: typeof params[number][] = [];
    const indexOf = new Map(paramOrder.map((n, i) => [n, i]));
    for (const p of params) {
        if (indexOf.has(p.name)) known.push(p);
        else unknown.push(p);
    }
    known.sort((a, b) => (indexOf.get(a.name) ?? 0) - (indexOf.get(b.name) ?? 0));
    return [...known, ...unknown];
}
