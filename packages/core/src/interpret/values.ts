/**
 * FinDSL-Wert-System für den Tree-Walking-Interpreter.
 *
 * Pragmatische Skelett-Variante:
 *   - Alle numerischen Tags (Euro, EuroCent, Cent, Prozent, Dezimal,
 *     Ganzzahl) teilen sich eine gemeinsame Klasse `NumericValue` mit
 *     einem `tag`-Feld. Die Arithmetik-Ergebnis-Tags folgen SPEC § 3.2.3
 *     / § 3.4 (siehe `interpreter.ts`).
 *   - **Euro-kanonisch:** Geldwerte (`Euro`/`EuroCent`/`Cent`) speichern
 *     ihre Zahl IMMER in der Einheit Euro. `1 Cent` ist intern `0.01`,
 *     `250 Cent` ist `2.5`. Dadurch sind Vergleich/`+`/`-` rein
 *     wertbasiert automatisch einheitenkorrekt, und die Invariante
 *     „ein `Euro`-getaggter Wert ist ganzzahlig" hält (§ 3.2).
 *   - `Prozent` wird intern als Bruchzahl gespeichert (42% → 0.42).
 *   - `Symbol` ist der Aufzählungs-artige Wert (`Grundtarif`, `Splitting`,
 *     `I`, `II`, …). Strukturelle Gleichheit per Name. Hält uns funktional
 *     bis Aufzählungs-Deklarationen und der Modul-Auflöser stehen.
 *   - Records sind unveränderlich; Feld-Zugriffe geben den hinterlegten Wert
 *     zurück, fehlende Felder lösen eine `InterpretError` aus.
 */

import { Decimal } from 'decimal.js';

export type NumericTag =
    | 'Ganzzahl' | 'Dezimal' | 'Prozent'
    | 'Euro' | 'EuroCent' | 'Cent';

export type Value =
    | NumericValue
    | BoolValue
    | StringValue
    | NullValue
    | RecordValue
    | SymbolValue
    | FunctionValue
    | BuiltinValue
    | RecordConstructorValue
    | ListValue;

export class InterpretError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InterpretError';
    }
}

/**
 * Kontroll-Signal des `abbruch`-Ausdrucks (SPEC § 4.19). KEINE
 * Fehlerbedingung im üblichen Sinn, sondern ein begründeter, **nicht
 * abfangbarer** Lauf-Abbruch: kein `evalExpr`-Pfad fängt es, es
 * propagiert bis zur Lauf-Grenze (`runPruefe`), wo es strukturiert
 * ausgewertet wird. Erbt von `Error`, damit bestehende
 * `instanceof Error`-Catches nicht brechen — Erkennung erfolgt jedoch
 * stets vorrangig über `instanceof AbbruchSignal`.
 */
export class AbbruchSignal extends Error {
    constructor(readonly grund: string) {
        super(`abbruch: ${grund}`);
        this.name = 'AbbruchSignal';
    }
}

export class NumericValue {
    readonly kind = 'numeric' as const;
    constructor(readonly value: Decimal, readonly tag: NumericTag) {}

    static ganzzahl(n: Decimal | number | string): NumericValue {
        return new NumericValue(new Decimal(n), 'Ganzzahl');
    }
    static dezimal(n: Decimal | number | string): NumericValue {
        return new NumericValue(new Decimal(n), 'Dezimal');
    }
    static euro(n: Decimal | number | string): NumericValue {
        return new NumericValue(new Decimal(n), 'Euro');
    }
    /** Erwartet den Wert bereits in Euro-Skala (Euro-kanonisch). */
    static euroCent(euroWert: Decimal | number | string): NumericValue {
        return new NumericValue(new Decimal(euroWert), 'EuroCent');
    }
    /** Erwartet den Wert bereits in Euro-Skala (1 ct = 0,01 €). */
    static cent(euroWert: Decimal | number | string): NumericValue {
        return new NumericValue(new Decimal(euroWert), 'Cent');
    }
    static prozent(bruch: Decimal | number | string): NumericValue {
        return new NumericValue(new Decimal(bruch), 'Prozent');
    }
}

export class BoolValue {
    readonly kind = 'bool' as const;
    constructor(readonly value: boolean) {}
}

export class StringValue {
    readonly kind = 'string' as const;
    constructor(readonly value: string) {}
}

export class NullValue {
    readonly kind = 'null' as const;
}

export const NICHTS = new NullValue();
export const WAHR = new BoolValue(true);
export const FALSCH = new BoolValue(false);

export class RecordValue {
    readonly kind = 'record' as const;
    constructor(
        readonly typeName: string,
        readonly fields: ReadonlyMap<string, Value>,
    ) {}
}

export class SymbolValue {
    readonly kind = 'symbol' as const;
    constructor(readonly name: string) {}
}

export interface FunctionParam {
    readonly name: string;
    readonly defaultExpr?: unknown;     // Expr — zyklischen Import vermeiden; Interpreter castet selbst
    readonly typeAnnotation?: unknown;  // Type — dito; für Geld-Einheits-Tagging beim Binden
}

export class FunctionValue {
    readonly kind = 'function' as const;
    constructor(
        readonly name: string,
        readonly params: ReadonlyArray<FunctionParam>,
        readonly body: unknown, // FunktionBody | Lambda — gleicher Grund
        readonly captured: unknown, // Environment — gleicher Grund
    ) {}

    /**
     * Factory für ein parametrisches Lambda als Closure: `body` ist der
     * Lambda-AST-Knoten, `captured` das lexikalisch eingefangene
     * Environment. Eigene Factory statt Inline-Konstruktor (Lesbarkeit;
     * der Interpreter unterscheidet beim Aufruf `body` per `isLambda`).
     */
    static lambda(
        params: ReadonlyArray<FunctionParam>,
        body: unknown,
        captured: unknown,
    ): FunctionValue {
        return new this('<lambda>', params, body, captured);
    }
}

export type BuiltinImpl = (args: ReadonlyArray<Value>) => Value;

export class BuiltinValue {
    readonly kind = 'builtin' as const;
    constructor(
        readonly name: string,
        readonly impl: BuiltinImpl,
    ) {}
}

/**
 * Wert für einen Datensatz-Konstruktor — der bei einem Aufruf eine
 * RecordValue-Instanz erzeugt. Der Interpreter materialisiert das selbst,
 * weil er auf den AST der DatensatzDecl (Felder + Defaults) zugreifen
 * muss; daher hier nur ein opaker Slot.
 */
export class RecordConstructorValue {
    readonly kind = 'record-constructor' as const;
    constructor(
        readonly typeName: string,
        readonly decl: unknown,  // DatensatzDecl — vermeiden zyklischer Import
    ) {}
}

/**
 * Unveränderliche Liste (SPEC § 3.10). `Bereich<T>` (§ 3.11) hat keinen
 * eigenen Laufzeitwert — ein Bereich-Ausdruck wird vom Interpreter
 * direkt zu einer (materialisierten) `ListValue` ausgewertet; das ist
 * SPEC-konform (der Nutzer materialisiert nie *explizit*) und hält
 * Wertmodell/Methoden-Dispatch einfach. Steuer-Bereiche sind beschränkt
 * (z. B. Lohnsteuer-Tabelle), Materialisierung daher unkritisch.
 */
export class ListValue {
    readonly kind = 'list' as const;
    constructor(readonly elements: ReadonlyArray<Value>) {}
}

// ---------------------------------------------------------------------------
// Konstruktion aus Literalen
// ---------------------------------------------------------------------------

/**
 * Zerlegt einen String-Literal-Wert in Plain-Text-Teile und Interpolations-
 * Slots. Eingabe ist der String, **wie Langium ihn liefert** — der Default-
 * Value-Converter strippt genau ein Quote-Zeichen an jedem Ende:
 *
 *   "hallo"         → `hallo`             (Single-Line, schon entquoted)
 *   """multi"""     → `""multi""`         (Multi-Line, zwei Quotes übrig)
 *
 * Wir erkennen Multi-Line anhand der verbliebenen Doppel-Quotes und
 * strippen sie hier. Anschließend wird der Body nach `${...}`-Slots
 * abgesucht: jedes Vorkommen wird ein Slot, alle Zwischenstücke landen in
 * `parts`. Es gilt: `parts.length === slots.length + 1`.
 *
 * Slot-Inhalt ist hier nicht weiter geparst — der Interpreter / Type-Checker
 * verarbeiten den Roh-Text als eingeschränkte CallChain-Form (`name`,
 * `name.feld`, `name.feld.unterfeld`).
 *
 * Ein nicht geschlossener `${`-Slot (`"abc${def"`) wird als Literal-Text
 * mitgeführt — das verhindert Datenverlust und überlässt dem Lint die
 * Diagnose.
 */
export function parseStringLiteral(raw: string): { parts: string[]; slots: string[] } {
    const body = (raw.startsWith('""') && raw.endsWith('""'))
        ? raw.slice(2, -2)
        : raw;

    const parts: string[] = [];
    const slots: string[] = [];
    let i = 0;
    while (i <= body.length) {
        const start = body.indexOf('${', i);
        if (start < 0) {
            parts.push(body.slice(i));
            break;
        }
        const end = body.indexOf('}', start + 2);
        if (end < 0) {
            parts.push(body.slice(i));
            break;
        }
        parts.push(body.slice(i, start));
        slots.push(body.slice(start + 2, end));
        i = end + 1;
    }
    return { parts, slots };
}

/**
 * Slot-Pfad-Regex: `name` oder `name.field` oder `name.field.subfield`.
 * Whitespace um die Punkte ist erlaubt. Beliebig komplexere Ausdrücke
 * (`a + b`, `f(x)`) sind im Skelett bewusst nicht unterstützt — der
 * Interpreter wirft dann eine `InterpretError`.
 */
const SLOT_PATH_REGEX = /^\s*([a-zA-ZäöüÄÖÜß_][a-zA-Z0-9äöüÄÖÜß_]*)(?:\s*\.\s*([a-zA-ZäöüÄÖÜß_][a-zA-Z0-9äöüÄÖÜß_]*))*\s*$/;

/**
 * Zerlegt einen Slot-Text in eine Identifier-Kette. Wirft, wenn der Slot
 * nicht der einfachen Form entspricht.
 */
export function parseSlotPath(slotText: string): string[] {
    if (!SLOT_PATH_REGEX.test(slotText)) {
        throw new InterpretError(
            `Slot "${slotText}": im Skelett sind nur einfache Identifier-Ketten `
            + `erlaubt (z. B. "name" oder "person.adresse.straße"). `
            + `Komplexere Ausdrücke folgen mit der vollen Lexer-Mode-Unterstützung.`,
        );
    }
    return slotText.split('.').map((s) => s.trim());
}

/**
 * Stringifier für Interpolations-Slots. Anders als `valueToString` werden
 * Strings nicht in Anführungszeichen gefasst — der Slot soll in den Body
 * eingebettet werden, nicht als JSON-Literal erscheinen.
 */
export function valueToInterpolatedString(v: Value): string {
    if (v.kind === 'string') return v.value;
    return valueToString(v);
}

/**
 * Parst die rohe Zeichenkette eines NumberLiteral und liefert den passenden
 * NumericValue mit Tag. Unterstriche werden entfernt; `%`-Suffix erzeugt
 * einen Prozent-Wert (intern als Bruchzahl: 42% → 0.42). Dezimalpunkt ohne
 * `%` ergibt `Dezimal`, sonst `Ganzzahl`.
 */
export function parseNumberLiteral(raw: string): NumericValue {
    const hasPercent = raw.endsWith('%');
    const body = hasPercent ? raw.slice(0, -1) : raw;
    // Deutsche Notation: `.` = Tausender-Trenner (entfernen), `,` =
    // Dezimaltrenner (→ `.` für Decimal-Parsing).
    const normalized = body.replace(/\./g, '').replace(',', '.');
    if (hasPercent) {
        return NumericValue.prozent(new Decimal(normalized).div(100));
    }
    if (body.includes(',')) {
        return NumericValue.dezimal(normalized);
    }
    return NumericValue.ganzzahl(normalized);
}

/**
 * Deutsche Zahl-Darstellung: Ganzteil mit `.` zu Dreiergruppen,
 * Dezimaltrenner `,`. `nachkomma` erzwingt exakt so viele
 * Nachkommastellen (für `EuroCent`); sonst natürliche Stellen.
 */
export function formatGerman(value: Decimal, nachkomma?: number): string {
    const neg = value.isNegative();
    const abs = value.abs();
    const fixed = nachkomma === undefined ? abs.toString() : abs.toFixed(nachkomma);
    const [intPart, fracPart] = fixed.split('.');
    const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const body = fracPart ? `${grouped},${fracPart}` : grouped;
    return neg ? `-${body}` : body;
}

// ---------------------------------------------------------------------------
// Gleichheits- und Anzeige-Helfer
// ---------------------------------------------------------------------------

export function valuesEqual(a: Value, b: Value): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
        case 'numeric':
            return (b as NumericValue).value.eq(a.value);
        case 'bool':
            return (b as BoolValue).value === a.value;
        case 'string':
            return (b as StringValue).value === a.value;
        case 'null':
            return true;
        case 'symbol':
            return (b as SymbolValue).name === a.name;
        case 'record': {
            const rb = b as RecordValue;
            if (rb.typeName !== a.typeName) return false;
            if (rb.fields.size !== a.fields.size) return false;
            for (const [k, v] of a.fields) {
                const ov = rb.fields.get(k);
                if (ov === undefined || !valuesEqual(v, ov)) return false;
            }
            return true;
        }
        case 'list': {
            const lb = b as ListValue;
            if (lb.elements.length !== a.elements.length) return false;
            for (let i = 0; i < a.elements.length; i++) {
                if (!valuesEqual(a.elements[i], lb.elements[i])) return false;
            }
            return true;
        }
        case 'function':
        case 'builtin':
        case 'record-constructor':
            return a === b;
    }
}

export function valuesCompare(a: Value, b: Value): number {
    if (a.kind === 'numeric' && b.kind === 'numeric') {
        return a.value.cmp(b.value);
    }
    if (a.kind === 'string' && b.kind === 'string') {
        return a.value.localeCompare(b.value);
    }
    throw new InterpretError(
        `Vergleich nicht definiert zwischen ${a.kind} und ${b.kind}.`,
    );
}

export function valueToString(v: Value): string {
    switch (v.kind) {
        case 'numeric': {
            switch (v.tag) {
                case 'Prozent':  return `${formatGerman(v.value.mul(100))} %`;
                case 'Euro':     return formatGerman(v.value);
                case 'Cent':     return formatGerman(v.value.mul(100));
                case 'EuroCent': return formatGerman(v.value, 2);
                default:         return formatGerman(v.value);
            }
        }
        case 'bool':    return v.value ? 'wahr' : 'falsch';
        case 'string':  return JSON.stringify(v.value);
        case 'null':    return 'nichts';
        case 'symbol':  return v.name;
        case 'record': {
            const parts: string[] = [];
            for (const [k, fv] of v.fields) parts.push(`${k} = ${valueToString(fv)}`);
            return `${v.typeName}(${parts.join(', ')})`;
        }
        case 'list':
            return `[${v.elements.map(valueToString).join(', ')}]`;
        case 'function':           return `<fn ${v.name}>`;
        case 'builtin':            return `<builtin ${v.name}>`;
        case 'record-constructor': return `<datensatz ${v.typeName}>`;
    }
}

export function isTruthy(v: Value): boolean {
    if (v.kind === 'bool') return v.value;
    throw new InterpretError(
        `Erwarte Wahrheitswert, erhalten: ${valueToString(v)} (${v.kind}).`,
    );
}
