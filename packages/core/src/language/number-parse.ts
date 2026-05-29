// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Gemeinsame Normalisierung deutscher Zahl-Literale (Issue #212).
 *
 * Einzige Quelle der Wahrheit für die Klassifikation eines `NumberLiteral`
 * — vom Interpreter-Orakel (`interpret/values.ts parseNumberLiteral`) UND
 * vom Codegen-Lowering (`codegen/lower/lower.ts`) genutzt. Liefert nur die
 * Klassifikation + normalisierte Ziffernfolge; den konkreten Zielwert
 * (`NumericValue` bzw. IR-`{factory,arg}`) baut der jeweilige Aufrufer.
 */

/** Klassifikation eines Zahl-Literals (vor Wrapper-/Geld-Auflösung). */
export type ParsedNumberKind = 'ganzzahl' | 'dezimal' | 'prozent';

export interface ParsedNumberLiteral {
    readonly kind: ParsedNumberKind;
    /**
     * Decimal-parsebare Ziffernfolge (deutsche Notation aufgelöst:
     * `.`-Tausender entfernt, `,`-Dezimaltrenner → `.`). Bei `prozent` noch
     * NICHT durch 100 geteilt — das macht der Aufrufer exakt via decimal.js.
     */
    readonly normalized: string;
}

/**
 * Parst die rohe Zeichenkette eines `NumberLiteral`. Deutsche Notation:
 * `.` = Tausender-Trenner (entfernt), `,` = Dezimaltrenner (→ `.`). Ein
 * `%`-Suffix klassifiziert als `prozent` (intern Bruchzahl, Division durch
 * 100 beim Aufrufer); ein Komma ohne `%` ergibt `dezimal`, sonst `ganzzahl`.
 */
export function parseGermanNumberLiteral(raw: string): ParsedNumberLiteral {
    const hasPercent = raw.endsWith('%');
    const body = hasPercent ? raw.slice(0, -1) : raw;
    const normalized = body.replace(/\./g, '').replace(',', '.');
    if (hasPercent) return { kind: 'prozent', normalized };
    if (body.includes(',')) return { kind: 'dezimal', normalized };
    return { kind: 'ganzzahl', normalized };
}
