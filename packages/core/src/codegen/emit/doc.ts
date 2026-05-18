// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Target-neutraler, deterministischer Pretty-Printer-Kern (ADR1 `emit/`).
 *
 * Reine, seiteneffektfreie Funktion ohne `Map`-/`Date`-Iteration → die
 * Ausgabe ist eine reine Funktion der Eingabe. Damit ist die Codegen-
 * Projektkultur „byte-identische Ausgabe bei Wiederholung" (Risiko R9)
 * auf der untersten Schicht strukturell garantiert: `render(d) === render(d)`.
 *
 * Dieses Modell ist sprach-unabhängig (ADR11) — der Java-Emitter, später
 * TS/JS-Emitter, bauen denselben `Doc` und teilen `render`.
 */

export type Doc =
    | { readonly kind: 'text'; readonly text: string }
    | { readonly kind: 'line' }
    | { readonly kind: 'concat'; readonly parts: ReadonlyArray<Doc> }
    | { readonly kind: 'indent'; readonly doc: Doc };

/** Literaler Text (darf KEINE Zeilenumbrüche enthalten — dafür `line`). */
export function text(s: string): Doc {
    return { kind: 'text', text: s };
}

/** Zeilenumbruch + Einrückung der aktuellen Tiefe. */
export const line: Doc = { kind: 'line' };

/** Verkettung mehrerer Dokumente in stabiler Reihenfolge. */
export function concat(...parts: ReadonlyArray<Doc>): Doc {
    return { kind: 'concat', parts };
}

/** Erhöht die Einrückungstiefe für das umschlossene Dokument um eins. */
export function indent(doc: Doc): Doc {
    return { kind: 'indent', doc };
}

export interface RenderOptions {
    /** Einrückungseinheit je Tiefenstufe. Default: 4 Leerzeichen. */
    readonly indentUnit?: string;
}

/**
 * Rendert ein `Doc` deterministisch zu Text. Keine Quelle von
 * Nicht-Determinismus (kein Datum, keine ungeordnete Iteration).
 */
export function render(doc: Doc, opts: RenderOptions = {}): string {
    const unit = opts.indentUnit ?? '    ';
    let out = '';
    const go = (d: Doc, depth: number): void => {
        switch (d.kind) {
            case 'text':
                out += d.text;
                break;
            case 'line':
                out += '\n' + unit.repeat(depth);
                break;
            case 'concat':
                for (const p of d.parts) go(p, depth);
                break;
            case 'indent':
                go(d.doc, depth + 1);
                break;
        }
    };
    go(doc, 0);
    return out;
}
