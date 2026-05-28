/**
 * Zentraler Builtin-Methoden-Dispatch für die LSP-Provider.
 *
 * Vier Konsumenten brauchen dieselbe Frage „Welche Methoden gelten auf
 * diesem Empfänger?" zu beantworten:
 *   - `findsl-completion.ts`     → Methoden-Vorschläge
 *   - `findsl-hover.ts`          → Hover-Doc für eine Methode
 *   - `findsl-signature-help.ts` → Parameter-Signatur eines Methoden-Aufrufs
 *   - `findsl-inlay-hints.ts`    → Parameter-Namen als Inlay
 *
 * Vor diesem Modul lebte die Dispatch-Logik dupliziert in `findsl-completion`
 * (Methoden-Vorschläge) und in `findsl-method-inference` (Typ-Resolution).
 * Dieser Helper konsolidiert sie auf einen einzigen Punkt — die
 * Method-Inference selbst bleibt in `findsl-method-inference.ts`, denn sie
 * macht GENERISCHE Typsubstitution (Element-Typ, Kontext-Inferenz für
 * Rundung), während dieser Helper nur die ANWENDBAREN DEFs liefert.
 *
 * Spiegelt die Splits aus PR #192 (ROUNDING_METHOD_DEFS § 11.1 + LIMIT_STEP
 * § 11.6) — Euro/Cent/Ganzzahl bekommen nur § 11.6, nicht § 11.1.
 *
 * Bewusst eigenes Modul (nicht in `findsl-stdlib.ts`): stdlib bleibt
 * type-frei, sonst entstünde ein Zyklus mit `findsl-types.ts`.
 */

import {
    LIMIT_STEP_METHOD_DEFS,
    LIST_METHOD_DEFS,
    SCALAR_METHOD_DEFS,
    TEXT_METHOD_DEFS,
    type BuiltinMethodDef,
} from './findsl-stdlib.js';
import { isNumeric, type Type } from './findsl-types.js';

const EMPTY: ReadonlyArray<BuiltinMethodDef> = [];

/**
 * Welche Methoden-DEFs sind auf `recv` anwendbar?
 *
 * Verhalten ist exakt das, das der Type-Checker akzeptiert:
 *  - `Liste<T>` / `Bereich<T>` → § 11.2 Listen-Methoden.
 *  - `EuroCent` / `Dezimal` / `Prozent` (Werte mit Nachkommastellen) →
 *    § 11.1 Rundung **und** § 11.6 Grenzwert/Stufen.
 *  - `Euro` / `Cent` / `Ganzzahl` → nur § 11.6 (kein `.abrunden` auf
 *    Werten ohne Nachkommastellen).
 *  - `Text` → § 11.5 Text-Methoden.
 *  - Alles andere (Wahrheitswert, Record, unknown, Enum, Function) → leer.
 *
 * Nullable wird transparent unwrapped (`Liste<T>?` zeigt dieselben
 * Methoden wie `Liste<T>` — der LSP-Provider entscheidet später, ob er
 * Sicher-Zugriff (`?.`) anbietet oder den Wert direkt anzeigt).
 */
export function getMethodDefs(recv: Type): ReadonlyArray<BuiltinMethodDef> {
    const t = recv.kind === 'nullable' ? recv.inner : recv;
    if (t.kind === 'list') return LIST_METHOD_DEFS;
    if (t.kind !== 'primitive') return EMPTY;
    if (t.name === 'EuroCent' || t.name === 'Dezimal' || t.name === 'Prozent') {
        return SCALAR_METHOD_DEFS;
    }
    if (isNumeric(t)) return LIMIT_STEP_METHOD_DEFS;
    if (t.name === 'Text') return TEXT_METHOD_DEFS;
    return EMPTY;
}

/** Convenience: ein einzelner DEF, oder `undefined`. */
export function findMethodDef(recv: Type, name: string): BuiltinMethodDef | undefined {
    return getMethodDefs(recv).find((d) => d.name === name);
}

/**
 * Parameter-Namen aus einer DEF-`signature` extrahieren.
 *
 * Beispiele:
 *   `(grenze: T) -> T`                     → `['grenze']`
 *   `(start: A, f: (A, T) -> A) -> A`      → `['start', 'f']`
 *   `([p: (T) -> Wahrheitswert]) -> Ganzzahl` → `['p']`
 *   `() -> T`                              → `[]`
 *   `Ganzzahl` (Property, keine Klammern)  → `[]`
 *
 * Klammer-Tiefe wird mitgezählt — Lambda-Argumente mit eigenen Kommata
 * werden korrekt als ein Parameter gehalten.
 */
export function paramNamesFromSignature(sig: string): ReadonlyArray<string> {
    const open = sig.indexOf('(');
    if (open < 0) return [];
    const close = matchingClose(sig, open);
    if (close < 0) return [];
    const inner = sig.slice(open + 1, close).trim();
    if (inner.length === 0) return [];
    return splitTopLevelCommas(inner).map(extractParamName);
}

/** Index der zu `(` an `openIdx` passenden `)`, oder −1. */
function matchingClose(s: string, openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
        const c = s[i];
        if (c === '(') depth++;
        else if (c === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}

/** Splittet an Kommas auf Tiefe 0 (`(...)`, `<...>`, `[...]` werden mitgezählt). */
function splitTopLevelCommas(s: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(' || c === '<' || c === '[') depth++;
        else if (c === ')' || c === '>' || c === ']') depth--;
        else if (c === ',' && depth === 0) {
            out.push(s.slice(start, i));
            start = i + 1;
        }
    }
    out.push(s.slice(start));
    return out;
}

/** Eine einzelne Parameter-Deklaration → Name (`p: Type` → `p`). */
function extractParamName(part: string): string {
    // Optional-Klammerung `[p: T]` der `zähle`-Signatur abstreifen.
    const clean = part.trim()
        .replace(/^\[/, '')
        .replace(/\]$/, '');
    const colon = topLevelColonIndex(clean);
    return (colon >= 0 ? clean.slice(0, colon) : clean).trim();
}

/** Erstes `:` auf Tiefe 0; −1 wenn keines (z. B. lambda-Param ohne Annotation). */
function topLevelColonIndex(s: string): number {
    let depth = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (c === '(' || c === '<' || c === '[') depth++;
        else if (c === ')' || c === '>' || c === ']') depth--;
        else if (c === ':' && depth === 0) return i;
    }
    return -1;
}
