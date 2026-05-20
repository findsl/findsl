// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Shared Doc-Kommentar-Utilities — extrahiert aus `docgen/model.ts`,
 * damit auch der LSP-Hover-Provider (`findsl-hover.ts`) strukturierte
 * `@param`/`@rückgabe`-Sektionen aus Doc-Kommentaren lesen kann
 * (Issue #65 Phase B/C).
 *
 * Pure Functions, keine Langium-Abhängigkeit — Eingabe ist der rohe
 * Doc-Kommentar-String (inklusive führender/abschließender `--`-Marker
 * möglich), Ausgabe ist strukturierte Prosa + Tag-Liste.
 */

/** Ein einzelner `@param <name> <desc>`-Eintrag aus dem Doc-Kommentar. */
export interface ParamDoc {
    readonly name: string;
    readonly desc: string;
}

/** Ergebnis des Tag-Parsings: bereinigte Prosa + strukturierte Tags. */
export interface DocTags {
    readonly prose: string;
    readonly params: ReadonlyArray<ParamDoc>;
    readonly returns?: string;
}

/**
 * Entfernt die `--`-Doc-Marker am Anfang/Ende sowie führende/
 * abschließende Leerzeilen. Liefert leeren String für `undefined`.
 */
export function stripDocMarkers(raw: string | undefined): string {
    if (!raw) return '';
    let s = raw;
    if (s.startsWith('--')) s = s.slice(2);
    if (s.endsWith('--'))   s = s.slice(0, -2);
    return s.replace(/^\s*\n/, '').replace(/\n\s*$/, '').trim();
}

/**
 * Trennt `@param <name> …` / `@rückgabe …` aus dem Doc-Markdown
 * heraus → strukturierte Tags + bereinigte Prosa. Fortsetzungszeilen
 * sind eingerückt (Ausrichtung); eine nicht-eingerückte oder leere
 * Zeile beendet einen Tag. Innerhalb von ``` … ```-Codeblöcken UND
 * `$$ … $$`-Math-Blöcken wird NICHT geparst (Tags bleiben dort
 * wörtlich in der Prosa).
 */
export function parseDocTags(doc: string): DocTags {
    const proseLines: string[] = [];
    const params: ParamDoc[] = [];
    let returns: string | undefined;
    let fence = false;
    let mathBlock = false;
    let active: { kind: 'param' | 'return'; name?: string; parts: string[] } | null = null;
    const flush = (): void => {
        if (!active) return;
        const desc = active.parts.join(' ').replace(/\s+/g, ' ').trim();
        if (active.kind === 'param' && active.name) {
            params.push({ name: active.name, desc });
        } else if (active.kind === 'return') {
            returns = desc;
        }
        active = null;
    };
    for (const ln of doc.split('\n')) {
        if (/^\s*```/.test(ln)) { flush(); fence = !fence; proseLines.push(ln); continue; }
        if (fence) { proseLines.push(ln); continue; }
        // Mehrzeilige `$$…$$`-Mathe wie Fences behandeln: Zeilen darin
        // sind Prosa und dürfen `@param`/`@rückgabe` NICHT triggern
        // (eine ungerade `$$`-Anzahl öffnet/schließt den Block).
        const dd = (ln.match(/\$\$/g) ?? []).length;
        if (mathBlock) { proseLines.push(ln); if (dd % 2 === 1) mathBlock = false; continue; }
        if (dd % 2 === 1) { flush(); mathBlock = true; proseLines.push(ln); continue; }
        const pm = ln.match(/^@param\s+(\S+)\s*(.*)$/u);
        const rm = ln.match(/^@rückgabe\s*(.*)$/u);
        if (pm) { flush(); active = { kind: 'param', name: pm[1], parts: pm[2] ? [pm[2]] : [] }; continue; }
        if (rm) { flush(); active = { kind: 'return', parts: rm[1] ? [rm[1]] : [] }; continue; }
        if (active) {
            if (/^\s+\S/.test(ln)) { active.parts.push(ln.trim()); continue; }
            flush();
        }
        proseLines.push(ln);
    }
    flush();
    const prose = proseLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { prose, params, returns };
}
