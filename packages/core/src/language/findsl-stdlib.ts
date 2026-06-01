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

/**
 * Doku-Karten für die primitiven Typen — Hover-Inhalt, wenn der Cursor auf
 * `Euro` / `Cent` / … in einer Typ-Annotation steht. Bewusst als TS-Konstante
 * (nicht in `builtins.json`), weil mehrzeilige Markdown-Doc in JSON
 * unergonomisch wäre und kein Konsument außerhalb des LSPs sie braucht
 * (TextMate liest nur Namen aus der JSON).
 */
export interface BuiltinPrimitiveDoc {
    readonly doc:     string;
    readonly quelle?: string;
}

export const BUILTIN_PRIMITIVE_DOCS: ReadonlyMap<string, BuiltinPrimitiveDoc> = new Map([
    ['Euro', {
        doc: 'Geldbetrag in **vollen Euro** (keine Nachkommastellen). Geldtyp; '
            + '`Euro − Euro` ⇒ Euro, `Euro * Ganzzahl` ⇒ Euro, `Euro * Prozent` ⇒ EuroCent.',
        quelle: 'SPEC § 3.2',
    }],
    ['Cent', {
        doc: 'Geldbetrag in **vollen Cent** (1/100 €). Geldtyp; Euro-kanonisch '
            + 'gespeichert. `Cent − Euro` ⇒ Cent.',
        quelle: 'SPEC § 3.2',
    }],
    ['EuroCent', {
        doc: 'Geldbetrag mit **Cent-Genauigkeit** (bis zu 2 Nachkommastellen). '
            + 'Geldtyp, Standard für Tarifrechnung. Ergebnis nicht-ganzzahliger '
            + 'Operationen → `.abrunden()` / `.aufrunden()` mit Euro/Cent-Kontext.',
        quelle: 'SPEC § 3.2',
    }],
    ['Ganzzahl', {
        doc: 'Ganze Zahl ohne Nachkommastellen (Index, Anzahl, Stufen).',
        quelle: 'SPEC § 3.2',
    }],
    ['Dezimal', {
        doc: 'Dezimalzahl mit Nachkommastellen für **Zwischenrechnungen**. '
            + 'Vor dem Binden an Geld auf eine Geld-Einheit casten oder '
            + '`.abrunden()` mit Kontext.',
        quelle: 'SPEC § 3.2',
    }],
    ['Prozent', {
        doc: 'Prozentwert. Literal mit Suffix `%` (z. B. `5,5%`). '
            + 'Multiplikation `Prozent * Geld` ⇒ EuroCent. `.abrunden()` / '
            + '`.aufrunden()` auf volle Prozent.',
        quelle: 'SPEC § 3.2',
    }],
    ['Wahrheit', {
        doc: 'Wahrheitswert (`wahr` / `falsch`). Alias zu **Wahrheitswert**.',
        quelle: 'SPEC § 3.3',
    }],
    ['Wahrheitswert', {
        doc: 'Wahrheitswert (`wahr` / `falsch`).',
        quelle: 'SPEC § 3.3',
    }],
    ['Text', {
        doc: 'Zeichenkette. Konkatenation mit `+`, Interpolation `"…${ausdruck}…"`. '
            + 'Methoden in SPEC § 11.5 (`.länge`, `.beginntMit`, `.geteiltAn`, …).',
        quelle: 'SPEC § 3.6',
    }],
    ['Liste', {
        doc: 'Generische, **immutable** Liste `Liste<T>`. Literal `[a, b, c]`; '
            + 'Methoden in SPEC § 11.2 (`.länge`, `.zuordnen`, `.filtern`, `.summe`, …).',
        quelle: 'SPEC § 3.5',
    }],
    ['Bereich', {
        doc: 'Numerischer oder Aufzählungs-Bereich `a bis b [unter] [schritt s]`. '
            + 'Materialisiert wie `Liste<T>` (alle § 11.2-Methoden anwendbar).',
        quelle: 'SPEC § 11.3',
    }],
]);

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
    /** SPEC-Sektion (z. B. `'SPEC § 11.2'`). Wird vom Hover separat als
     *  `*Quelle:* …`-Zeile angezeigt; in Doc-Strings nicht dupliziert. */
    readonly quelle?:   string;
}

/** Versieht eine DEF-Liste mit einer gemeinsamen `quelle` (DRY). */
function withQuelle(
    defs: ReadonlyArray<Omit<BuiltinMethodDef, 'quelle'>>,
    quelle: string,
): ReadonlyArray<BuiltinMethodDef> {
    return defs.map((d) => ({ ...d, quelle }));
}

export const LIST_METHOD_DEFS: ReadonlyArray<BuiltinMethodDef> = withQuelle([
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
], 'SPEC § 11.2');

/**
 * Skalar-Rundungs-Methoden (SPEC § 11.1) auf `EuroCent`/`Dezimal`.
 * Reine LSP-Metadaten (Label/Signatur/Doc) für Completion & Hover; die
 * kontextgetriebene Zielauflösung (`EuroCent` → `Euro`/`Cent` aus dem
 * erwarteten Typ; `Dezimal` → `Ganzzahl`) lebt im Type-Checker
 * (`findsl-types.scalarRoundingMethod`). Dieser Katalog ist NUR die
 * Namens-/Doc-Quelle. */
/** § 11.1 Rundungs-Methoden — NUR auf Werten mit Nachkommastellen
 *  (`EuroCent`/`Dezimal`/`Prozent`); kontextgetriebene Zielauflösung. */
export const ROUNDING_METHOD_DEFS: ReadonlyArray<BuiltinMethodDef> = withQuelle([
    { name: 'abrunden',    signature: '() -> Euro|Cent|Ganzzahl',     property: false, doc: 'Rundet **ab** (Richtung −∞). Nur auf `EuroCent` (Ziel `Euro`/`Cent` aus dem Kontext) oder `Dezimal` (→ `Ganzzahl`).' },
    { name: 'aufrunden',   signature: '() -> Euro|Cent|Ganzzahl',     property: false, doc: 'Rundet **auf** (Richtung +∞). Nur auf `EuroCent` (Ziel `Euro`/`Cent` aus dem Kontext) oder `Dezimal` (→ `Ganzzahl`); „je angefangene Einheit"-Tarife.' },
], 'SPEC § 11.1');

/** § 11.6 Grenzwert-/Stufen-Methoden — auf ALLEN numerischen Typen
 *  (`Euro`/`Cent`/`EuroCent`/`Ganzzahl`/`Dezimal`/`Prozent`); typ-erhaltend,
 *  kontextfrei. */
export const LIMIT_STEP_METHOD_DEFS: ReadonlyArray<BuiltinMethodDef> = withQuelle([
    { name: 'höchstens',   signature: '(grenze: T) -> T',             property: false, doc: 'Obergrenze: das **Minimum** aus Wert und `grenze` (für „höchstens jedoch …"). Typ-erhaltend, auf allen numerischen Typen.' },
    { name: 'mindestens',  signature: '(grenze: T) -> T',             property: false, doc: 'Untergrenze: das **Maximum** aus Wert und `grenze` (für „mindestens jedoch …"; `.mindestens(0,00)` kappt Negatives). Typ-erhaltend.' },
    { name: 'abrundenAuf', signature: '(vielfaches: T) -> T',         property: false, doc: 'Rundet **ab** auf das nächstkleinere Vielfache von `vielfaches` (z. B. § 11 GewStG: auf volle 100 €). Typ-erhaltend, `vielfaches` > 0.' },
    { name: 'aufrundenAuf',signature: '(vielfaches: T) -> T',         property: false, doc: 'Rundet **auf** auf das nächstgrößere Vielfache von `vielfaches`. Typ-erhaltend, `vielfaches` > 0.' },
], 'SPEC § 11.6');

/** § 11.7 Umwandlungs-Methoden — Methoden-Form des `als`-Casts (§ 4.8) für die
 *  häufige Zahl↔Prozent-Konvertierung. **Receiver-beschränkt** (anders als
 *  § 11.1/§ 11.6): `.alsProzent()` nur auf `Ganzzahl`/`Dezimal`, `.alsDezimal()`
 *  nur auf `Prozent`. Deshalb je ein eigener Katalog statt eines gemeinsamen.
 *  Typ-Logik in `findsl-method-inference.conversionMethod`. */
export const ALS_PROZENT_METHOD_DEFS: ReadonlyArray<BuiltinMethodDef> = withQuelle([
    { name: 'alsProzent', signature: '() -> Prozent', property: false, doc: 'Liest die Zahl als Prozentangabe → `Prozent` (`9,3.alsProzent()` = `9,3 %`). Nur auf `Ganzzahl`/`Dezimal`. Methoden-Form von `… als Prozent` (§ 4.8).' },
], 'SPEC § 11.7');

export const ALS_DEZIMAL_METHOD_DEFS: ReadonlyArray<BuiltinMethodDef> = withQuelle([
    { name: 'alsDezimal', signature: '() -> Dezimal', property: false, doc: 'Liefert den Bruchwert des Prozentsatzes als `Dezimal` (`9,3%.alsDezimal()` = `0,093`). Nur auf `Prozent`. Methoden-Form von `… als Dezimal` (§ 4.8).' },
], 'SPEC § 11.7');

/** Beide § 11.7-Umwandlungs-Methoden (Doku/Vollständigkeit). Für den
 *  receiver-präzisen Dispatch nutzt `getMethodDefs` die beiden Einzel-Kataloge
 *  `ALS_PROZENT_METHOD_DEFS`/`ALS_DEZIMAL_METHOD_DEFS`. */
export const CONVERSION_METHOD_DEFS: ReadonlyArray<BuiltinMethodDef> = [
    ...ALS_PROZENT_METHOD_DEFS,
    ...ALS_DEZIMAL_METHOD_DEFS,
];

/** Skalar-Methoden für Empfänger **mit Nachkommastellen** (`EuroCent`/`Dezimal`/
 *  `Prozent`): § 11.1 Rundung + § 11.6 Grenzwert/Stufen. Die receiver-beschränkten
 *  § 11.7-Umwandlungen kommen NICHT hier rein — `getMethodDefs` hängt sie pro
 *  Empfängertyp an (Zahl → `.alsProzent()`, Prozent → `.alsDezimal()`). */
export const SCALAR_METHOD_DEFS: ReadonlyArray<BuiltinMethodDef> = [
    ...ROUNDING_METHOD_DEFS,
    ...LIMIT_STEP_METHOD_DEFS,
];

/** Text-Methoden (SPEC § 11.5). Properties (`länge`/`leer`/`alsText`)
 *  ohne `()`, sonst Aufruf-Methoden. Typ-Logik in
 *  `findsl-types.textMethod`. Die `.alsText(format = …)`-Variante ist in
 *  v1.0 NICHT enthalten (SPEC § 11.5 Status). */
export const TEXT_METHOD_DEFS: ReadonlyArray<BuiltinMethodDef> = withQuelle([
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
], 'SPEC § 11.5');

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
