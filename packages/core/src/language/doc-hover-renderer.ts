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
import { ensureMathJax, texToSvg } from '../docgen/math.js';

/** Cached MathJax-Init-Promise. Pro Prozess einmalig — bei jedem
 *  `renderDocForHover`-Aufruf wird das gleiche Promise awaited (no-op
 *  nach dem ersten Aufruf). */
let mathJaxInit: Promise<void> | null = null;
function readyMathJax(): Promise<void> {
    if (!mathJaxInit) mathJaxInit = ensureMathJax();
    return mathJaxInit;
}

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
 *
 * Asynchron, weil MathJax (für `$…$`/`$$…$$`-SVG-Rendering) einmalig
 * initialisiert werden muss. Nachfolgende Aufrufe sind ohne Latenz
 * (Cache via `readyMathJax`).
 */
export async function renderDocForHover(input: RenderInput): Promise<string> {
    const { docRaw, paramOrder, quellen } = input;
    const stripped = stripDocMarkers(docRaw);
    const sections: string[] = [];

    // MathJax frühzeitig initialisieren — falls die Prosa Formeln
    // enthält, brauchen wir den synchronen SVG-Renderer. Bei Fehlschlag
    // fällt `formatProse` automatisch auf `texToPlain` zurück.
    let mathReady = true;
    try {
        await readyMathJax();
    } catch {
        mathReady = false;
    }

    if (stripped) {
        const tags = parseDocTags(stripped);
        const prose = formatProse(tags.prose, mathReady);
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
 * Bereitet die Prosa für die Hover-Karte auf.
 *
 * Math-Notation wird über MathJax zu SVG gerendert und als
 * `data:image/svg+xml;utf8,…`-Markdown-Bild eingebettet — VS Code zeigt
 * das im Hover als echte mathematische Formel (Brüche, Subscripts,
 * Operatoren), nicht als rohen TeX-Code.
 *
 * - Block-Math (`$$…$$`) → eigenständiges Bild auf eigener Zeile.
 * - Inline-Math (`$…$`) → Inline-Bild im Fließtext.
 *
 * Fallback auf `texToPlain` (Klartext im Code-Span/Code-Block), wenn
 * MathJax nicht initialisiert ist oder der Render-Pfad eine Exception
 * wirft (z. B. ungültiges TeX, kaputte Math-Lib).
 */
function formatProse(prose: string, mathReady: boolean): string {
    if (!prose) return '';
    let out = prose;
    // Block-Math: `$$ ... $$` → SVG-Bild als Block.
    out = out.replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner: string) =>
        renderMath(inner.trim(), /* display */ true, mathReady));
    // Inline-Math: `$x + y$` → SVG-Bild inline.
    out = out.replace(/\$([^\n$]+?)\$/g, (_m, inner: string) =>
        renderMath(inner.trim(), /* display */ false, mathReady));
    out = out.replace(/\n{3,}/g, '\n\n');
    return out.trim();
}

/** TeX → Markdown-Bild (SVG-data-URL) oder Klartext-Fallback. */
function renderMath(tex: string, display: boolean, mathReady: boolean): string {
    if (mathReady) {
        try {
            const { svg } = texToSvg(tex, display);
            // SVG ohne XML-Deklaration und ohne `<?xml`-Header (MathJax
            // liefert reines `<svg …>…</svg>`) → direkt URL-kodieren.
            // `#`/`%`/`<` etc. müssen escaped sein; `encodeURIComponent`
            // ist die sicherste Variante für `data:image/svg+xml;utf8,…`.
            const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
            const alt = altText(tex);
            // Display-Math: leere Zeile davor/danach, sodass Markdown das
            // Bild als Block rendert statt inline. Inline-Math: kein
            // Umbruch, fließt im Satz.
            return display ? `\n\n![${alt}](${dataUrl})\n\n` : `![${alt}](${dataUrl})`;
        } catch {
            // Fall-through → Klartext
        }
    }
    // Fallback: lesbarer Klartext (cases-Pretty-Print, Unicode-Operatoren).
    const plain = texToPlain(tex);
    return display ? '\n\n```findsl\n' + plain + '\n```\n\n' : '`' + plain + '`';
}

/** Markdown-Alt-Text für das SVG-Bild — Klartext-Variante der Formel,
 *  damit Screen-Reader und Fall-zu-Markdown-Renderer (ohne Bild-Support)
 *  die Formel als lesbaren Text bekommen. */
function altText(tex: string): string {
    return texToPlain(tex).replace(/[\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
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
