/**
 * Euro-kanonisches Geldmodell des Interpreters (SPEC § 3.2 / § 3.4).
 *
 * Reines Blatt-Modul: KEINE Abhängigkeit auf `evalExpr` oder die übrige
 * Baum-Auswertung — nur Decimal-Arithmetik über `NumericValue`. Damit ist
 * es zyklenfrei sowohl vom Tree-Walker (`interpreter.ts`) als auch von den
 * Stdlib-Methoden (`interpret-stdlib.ts`) importierbar.
 *
 * Geldwerte tragen ihre Zahl IMMER in Euro (1 ct = 0,01 €); der Tag ist der
 * Typ. Präzisions-Lattice (SPEC § 3.2.2): Euro → EuroCent → Cent.
 */

import { Decimal } from 'decimal.js';

import {
    InterpretError,
    NumericValue,
    formatGerman,
    valueToString,
    type Value,
} from './values.js';

const MONEY_RANK: Partial<Record<NumericValue['tag'], number>> = {
    Euro: 0, EuroCent: 1, Cent: 2,
};

export function isMoneyTag(t: NumericValue['tag']): boolean {
    return t === 'Euro' || t === 'EuroCent' || t === 'Cent';
}

/**
 * `als`-Cast eines numerischen Werts. Geld-Ziel: ist die Quelle bereits
 * Geld, ist es ein reiner Tag-Wechsel (Wert schon Euro-kanonisch); ist
 * die Quelle eine nackte Zahl, wird sie als Betrag in der natürlichen
 * Einheit des Ziels gelesen (`Cent`-Eingang ÷ 100). `Prozent`-Ziel
 * normalisiert eine nackte Zahl zur Bruchzahl (`42 als Prozent` → 0.42,
 * konsistent zum `42%`-Literal).
 */
export function castNumeric(inner: NumericValue, target: string): NumericValue {
    if (target === 'Euro' || target === 'EuroCent' || target === 'Cent') {
        if (isMoneyTag(inner.tag)) {
            return new NumericValue(inner.value, target);   // Euro-kanonisch
        }
        const euroWert = target === 'Cent' ? inner.value.div(100) : inner.value;
        return new NumericValue(euroWert, target);
    }
    if (target === 'Prozent') {
        const bruch = inner.tag === 'Prozent' ? inner.value : inner.value.div(100);
        return new NumericValue(bruch, 'Prozent');
    }
    if (target === 'Ganzzahl' || target === 'Dezimal') {
        return new NumericValue(inner.value, target);
    }
    return inner;
}

const MONEY_PRIM = new Set(['Euro', 'Cent', 'EuroCent']);

/** Geld-Primitiv-Name einer Typannotation (`: Euro|Cent|EuroCent`), sonst undefined. */
export function moneyAnnotationName(type: unknown): string | undefined {
    const atom = (type as { atom?: { $type?: string; name?: string } } | undefined)?.atom;
    if (atom?.$type === 'NamedType' && atom.name && MONEY_PRIM.has(atom.name)) {
        return atom.name;
    }
    return undefined;
}

/**
 * Wendet eine Geld-Typannotation wie ein `als <Typ>`-Cast an: setzt Tag +
 * Euro-kanonische Skalierung (nackte Zahl `: Cent` → ÷100; bereits Geld →
 * reiner Tag-Wechsel, Wert schon Euro-kanonisch). Erzwingt zusätzlich die
 * Ganzzahligkeit von `Euro`/`Cent` AUCH bei berechneten Werten (SPEC
 * § 3.2.2: die Rückrichtung verlangt explizite Rundung) — fraktionale
 * Werte → `InterpretError`. `EuroCent` (präzise Mitte) ist ungeprüft.
 * Entscheidung 2026-05-16: Annotation = Einheits-Quelle (vorher No-Op).
 */
export function applyMoneyAnnotation(v: Value, type: unknown, was: string): Value {
    const name = moneyAnnotationName(type);
    if (!name || v.kind !== 'numeric') return v;
    const cast = castNumeric(v, name);
    if (name === 'Euro' && !cast.value.isInteger()) {
        throw new InterpretError(
            `${was}: Euro-Wert "${formatGerman(cast.value)}" ist nicht `
            + `ganzzahlig — explizite Rundung nötig (\`.abrunden()\`/`
            + `\`.aufrunden()\` mit Euro-Kontext, SPEC § 11.1).`,
        );
    }
    if (name === 'Cent' && !cast.value.mul(100).isInteger()) {
        throw new InterpretError(
            `${was}: Cent-Wert "${formatGerman(cast.value.mul(100))}" ist `
            + `nicht ganzzahlig — explizite Rundung nötig (\`.abrunden()\`/`
            + `\`.aufrunden()\` mit Cent-Kontext, SPEC § 11.1).`,
        );
    }
    return cast;
}

function expectNumeric(op: string, v: Value): NumericValue {
    if (v.kind !== 'numeric') {
        throw new InterpretError(
            `Operator "${op}": erwarte numerischen Wert, erhalten ${valueToString(v)}.`,
        );
    }
    return v;
}

export function numericArith(
    l: Value,
    r: Value,
    fn: (a: Decimal, b: Decimal) => Decimal,
): NumericValue {
    const a = expectNumeric('+/-', l);
    const b = expectNumeric('+/-', r);
    return new NumericValue(fn(a.value, b.value), combineAddSub(a.tag, b.tag));
}

/** SPEC § 3.2.3 / § 3.4: `Geld±Geld` → präzisere Seite; `Geld±Zahl` → Geld. */
function combineAddSub(a: NumericValue['tag'], b: NumericValue['tag']): NumericValue['tag'] {
    if (isMoneyTag(a) && isMoneyTag(b)) {
        return MONEY_RANK[a]! >= MONEY_RANK[b]! ? a : b;
    }
    if (isMoneyTag(a)) return a;
    if (isMoneyTag(b)) return b;
    if (a === 'Prozent' && b === 'Prozent') return 'Prozent';
    if (a === 'Ganzzahl' && b === 'Ganzzahl') return 'Ganzzahl';
    return 'Dezimal';
}

export function numericMul(l: Value, r: Value): NumericValue {
    const a = expectNumeric('*', l);
    const b = expectNumeric('*', r);
    return new NumericValue(a.value.mul(b.value), combineMul(a.tag, b.tag));
}

/** SPEC § 3.2.3 / § 3.4: `Geld*Ganzzahl`→Geld; `Geld*{Dezimal,Prozent}`→EuroCent;
 *  Prozent mit reinen Zahlen verhält sich wie sein Bruchwert → Dezimal. */
function combineMul(a: NumericValue['tag'], b: NumericValue['tag']): NumericValue['tag'] {
    const aM = isMoneyTag(a), bM = isMoneyTag(b);
    if (aM && bM) return 'EuroCent';                       // statisch verboten
    if (aM || bM) {
        const other = aM ? b : a;
        const money = aM ? a : b;
        if (other === 'Ganzzahl') return money;            // Geld * Ganzzahl
        return 'EuroCent';                                 // Geld * Dezimal/Prozent
    }
    // Prozent ist hier ein dimensionsloser Bruch-Skalar (`100 * 10% == 10`,
    // nicht `1000%`); jede Nicht-Geld-Kombination mit Prozent → Dezimal.
    if (a === 'Ganzzahl' && b === 'Ganzzahl') return 'Ganzzahl';
    return 'Dezimal';
}

export function numericDiv(l: Value, r: Value): NumericValue {
    const a = expectNumeric('/', l);
    const b = expectNumeric('/', r);
    if (b.value.isZero()) {
        throw new InterpretError('Division durch Null.');
    }
    return new NumericValue(a.value.div(b.value), combineDiv());
}

/** SPEC § 3.2.3 / § 3.4: Division ergibt **immer** `Dezimal` — Geld/Geld und
 *  Geld/Ganzzahl (§ 3.2.3 Anmerkung) genauso wie Prozent mit reinen Zahlen
 *  (Bruchwert, `9,3% / 2 == 0,0465`). Die Operanden-Tags sind daher irrelevant
 *  (anders als `combineMul`/`combineAddSub`), die Funktion ist parameterlos. */
function combineDiv(): NumericValue['tag'] {
    return 'Dezimal';
}
