/**
 * Typisierter Zugriff auf die eingebauten Definitionen (Standard-Modul).
 *
 * Single Source of Truth ist `builtins.json` — diese Datei wrappt sie nur
 * typsicher und stellt abgeleitete Helfer bereit. Konsumenten:
 *   - `findsl-types.ts`   → Type-Checker (Enum-/Funktions-Signaturen)
 *   - `findsl-hover.ts`   → Hover-Karten (Doc + Quelle)
 *   - `findsl-scope.ts`   → Import-Diagnose ("Builtin nicht importierbar")
 *
 * `scripts/enhance-textmate.mjs` liest `builtins.json` separat per `fs`
 * (kein TS-Import möglich, weil Plain-Node-Skript) — die JSON bleibt also
 * die gemeinsame Wahrheit für ALLE vier Stellen.
 */

// Statischer JSON-Import mit Import-Attribut: funktioniert in ALLEN drei
// Laufzeiten —
//   - esbuild-CJS-Bundle (LSP-Server): wird statisch inlined
//   - tsc-ESM-Output (`node out/cli/main.js`): Node-ESM akzeptiert `with`
//   - vitest/vite: inlined ebenfalls
// `module: NodeNext` ist Voraussetzung für die `with`-Syntax.
import builtins from './builtins.json' with { type: 'json' };

export interface BuiltinEnumDef {
    readonly name:   string;
    readonly values: ReadonlyArray<string>;
    readonly doc:    string;
    readonly quelle: string;
}

export interface BuiltinFunctionDef {
    readonly name:      string;
    readonly signature: string;
    /** Rückgabetyp als Primitive-Name (z. B. "Euro"). */
    readonly result:    string;
    readonly doc:       string;
    readonly quelle?:   string;
}

export const BUILTIN_PRIMITIVE_TYPES: ReadonlyArray<string> =
    builtins.primitiveTypes;

export const BUILTIN_ENUM_DEFS: ReadonlyArray<BuiltinEnumDef> =
    builtins.enums;

export const BUILTIN_FUNCTION_DEFS: ReadonlyArray<BuiltinFunctionDef> =
    builtins.functions;

/** Eine eingebaute Methode (SPEC § 11.1/§ 11.2/§ 11.5) — reine
 *  LSP-Metadaten (Label/Signatur/Doc) für Completion & Hover. Die
 *  eigentliche Typ-Logik lebt im Type-Checker (`findsl-types`:
 *  `listMethod`/`scalarRoundingMethod`/`textMethod`), da sie
 *  kontext-/generik-abhängig ist — diese Kataloge sind NUR die
 *  Namens-/Doc-Quelle. */
export interface BuiltinMethodDef {
    readonly name:      string;
    readonly signature: string;
    readonly doc:       string;
    /** `true` = Eigenschaft (ohne `()`), sonst Aufruf-Methode. */
    readonly property:  boolean;
}

export const LIST_METHOD_DEFS: ReadonlyArray<BuiltinMethodDef> = [
    { name: 'länge',          signature: 'Ganzzahl',                                property: true,  doc: 'Anzahl der Elemente.' },
    { name: 'leer',           signature: 'Wahrheitswert',                           property: true,  doc: 'wahr, wenn die Liste keine Elemente hat.' },
    { name: 'kopf',           signature: 'T',                                       property: true,  doc: 'Erstes Element (Laufzeitfehler bei leerer Liste).' },
    { name: 'rest',           signature: 'Liste<T>',                                property: true,  doc: 'Alle Elemente außer dem ersten.' },
    { name: 'bei',            signature: '(i: Ganzzahl) -> T',                      property: false, doc: 'Element bei 0-basiertem Index `i` (Fehler außerhalb).' },
    { name: 'enthält',        signature: '(x: T) -> Wahrheitswert',                 property: false, doc: 'wahr, wenn `x` enthalten ist.' },
    { name: 'zuordnen',       signature: '(f: (T) -> U) -> Liste<U>',               property: false, doc: 'Bildet jedes Element mit `f` ab (Map).' },
    { name: 'filtern',        signature: '(p: (T) -> Wahrheitswert) -> Liste<T>',   property: false, doc: 'Behält die Elemente, für die `p` wahr ist (Filter).' },
    { name: 'zusammenfassen', signature: '(start: A, f: (A, T) -> A) -> A',         property: false, doc: 'Faltet die Liste von links (Fold/Reduce).' },
    { name: 'zähle',          signature: '([p: (T) -> Wahrheitswert]) -> Ganzzahl', property: false, doc: 'Anzahl insgesamt oder (mit Prädikat) der passenden Elemente.' },
    { name: 'summe',          signature: '() -> T',                                 property: false, doc: 'Summe der Elemente (numerisch); leere Liste → 0.' },
    { name: 'größtes',        signature: '() -> T',                                 property: false, doc: 'Größtes Element (Fehler bei leerer Liste).' },
    { name: 'kleinstes',      signature: '() -> T',                                 property: false, doc: 'Kleinstes Element (Fehler bei leerer Liste).' },
];

/**
 * Skalar-Rundungs-Methoden (SPEC § 11.1) auf `EuroCent`/`Dezimal`.
 * Reine LSP-Metadaten (Label/Signatur/Doc) für Completion & Hover; die
 * kontextgetriebene Zielauflösung (`EuroCent` → `Euro`/`Cent` aus dem
 * erwarteten Typ; `Dezimal` → `Ganzzahl`) lebt im Type-Checker
 * (`findsl-types.scalarRoundingMethod`). Dieser Katalog ist NUR die
 * Namens-/Doc-Quelle. */
export const SCALAR_METHOD_DEFS: ReadonlyArray<BuiltinMethodDef> = [
    { name: 'abrunden',  signature: '() -> Euro|Cent|Ganzzahl', property: false, doc: 'Rundet **ab** (Richtung −∞). Nur auf `EuroCent` (Ziel `Euro`/`Cent` aus dem Kontext) oder `Dezimal` (→ `Ganzzahl`). SPEC § 11.1.' },
    { name: 'aufrunden', signature: '() -> Euro|Cent|Ganzzahl', property: false, doc: 'Rundet **auf** (Richtung +∞). Nur auf `EuroCent` (Ziel `Euro`/`Cent` aus dem Kontext) oder `Dezimal` (→ `Ganzzahl`); „je angefangene Einheit"-Tarife. SPEC § 11.1.' },
];

/** Text-Methoden (SPEC § 11.5). Properties (`länge`/`leer`/`alsText`)
 *  ohne `()`, sonst Aufruf-Methoden. Typ-Logik in
 *  `findsl-types.textMethod`. Die `.alsText(format = …)`-Variante ist in
 *  v1.0 NICHT enthalten (SPEC § 11.5 Status). */
export const TEXT_METHOD_DEFS: ReadonlyArray<BuiltinMethodDef> = [
    { name: 'länge',              signature: 'Ganzzahl',                  property: true,  doc: 'Anzahl Unicode-Zeichen.' },
    { name: 'leer',               signature: 'Wahrheitswert',             property: true,  doc: 'wahr, wenn die Länge 0 ist.' },
    { name: 'alsText',            signature: 'Text',                      property: true,  doc: 'Identitäts-Konversion (Default-Formatierung).' },
    { name: 'einrückungEntfernen',signature: '() -> Text',                property: false, doc: 'Entfernt den gemeinsamen Whitespace-Prefix aller Zeilen.' },
    { name: 'alsGroßbuchstaben',  signature: '() -> Text',                property: false, doc: 'Komplette Großschreibung.' },
    { name: 'alsKleinbuchstaben', signature: '() -> Text',                property: false, doc: 'Komplette Kleinschreibung.' },
    { name: 'beginntMit',         signature: '(prefix: Text) -> Wahrheitswert', property: false, doc: 'Präfix-Test.' },
    { name: 'endetMit',           signature: '(suffix: Text) -> Wahrheitswert', property: false, doc: 'Suffix-Test.' },
    { name: 'enthält',            signature: '(teil: Text) -> Wahrheitswert',   property: false, doc: 'Substring-Test.' },
    { name: 'geteiltAn',          signature: '(trenner: Text) -> Liste<Text>',  property: false, doc: 'Split an der Trennzeichenfolge.' },
];

/** Aufzählungs-Wert → enthaltender Aufzählungs-Name (`Grundtarif` → `Tarifart`). */
export const BUILTIN_ENUM_VALUE_TO_ENUM: ReadonlyMap<string, string> = (() => {
    const m = new Map<string, string>();
    for (const e of BUILTIN_ENUM_DEFS) {
        for (const v of e.values) m.set(v, e.name);
    }
    return m;
})();

/**
 * Alle eingebauten Namen: primitive Typen, Aufzählungs-Typen,
 * Aufzählungs-Werte und Builtin-Funktionen. Genutzt für die Diagnose
 * "X ist eingebaut und kann nicht importiert werden".
 */
export const BUILTIN_NAMES: ReadonlySet<string> = (() => {
    const s = new Set<string>(BUILTIN_PRIMITIVE_TYPES);
    for (const e of BUILTIN_ENUM_DEFS) {
        s.add(e.name);
        for (const v of e.values) s.add(v);
    }
    for (const f of BUILTIN_FUNCTION_DEFS) s.add(f.name);
    return s;
})();

export function isBuiltinName(name: string): boolean {
    return BUILTIN_NAMES.has(name);
}
