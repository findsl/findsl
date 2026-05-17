/**
 * Eingebaute Funktionen, die in jedem FinDSL-Programm sichtbar sind.
 *
 * Geld-Rundung (SPEC § 3.2.2, PAP-Konvention „ab" = Richtung −∞ / Floor,
 * „auf" = Richtung +∞ / Ceil): `abrundenEuro`/`aufrundenEuro` →
 * ganzzahliger `Euro`; `abrundenCent`/`aufrundenCent` → ganzzahliger
 * `Cent` (auf 2 Euro-Nachkommastellen = volle Cent). Alle arbeiten auf
 * dem Euro-kanonischen Wert (`NumericValue.value`).
 *
 * Generische Zahl-Rundung (SPEC § 11): `aufrunden`/`abrunden` runden
 * eine beliebige Zahl auf eine `Ganzzahl` (Richtung +∞ bzw. −∞) — für
 * „je angefangene Einheit"-Tarife (KraftStG § 9).
 *
 * Weitere Kandidaten: `kaufmännischRunden`, `max`, `min` — ergänzt,
 * sobald reale Beispiele sie nachfragen.
 */

import { Decimal } from 'decimal.js';
import {
    BuiltinValue,
    InterpretError,
    NumericValue,
    valueToString,
    type Value,
} from './values.js';

function expectNumeric(name: string, v: Value): NumericValue {
    if (v.kind !== 'numeric') {
        throw new InterpretError(
            `${name}: erwarte numerischen Wert, erhalten: ${valueToString(v)} (${v.kind}).`,
        );
    }
    return v;
}

/**
 * Erzeugt eine einstellige Rundungs-Builtin. `nachkomma` = Anzahl
 * Euro-Nachkommastellen des Ergebnisses (0 → volle Euro, 2 → volle
 * Cent); `make` taggt das gerundete (Euro-kanonische) Resultat.
 * `ab` rundet Richtung −∞ (Floor), `auf` Richtung +∞ (Ceil) — gemäß
 * PAP-Konvention (§ 32a EStG, PAP UPTAB25).
 */
function rundung(
    name: string,
    nachkomma: number,
    modus: Decimal.Rounding,
    make: (euroWert: Decimal) => NumericValue,
): (args: ReadonlyArray<Value>) => Value {
    return (args) => {
        if (args.length !== 1) {
            throw new InterpretError(`${name}: erwarte 1 Argument, erhalten ${args.length}.`);
        }
        const n = expectNumeric(name, args[0]);
        return make(n.value.toDecimalPlaces(nachkomma, modus));
    };
}

export function registerBuiltins(define: (name: string, value: Value) => void): void {
    const fns: ReadonlyArray<readonly [string, number, Decimal.Rounding, (d: Decimal) => NumericValue]> = [
        ['abrundenEuro', 0, Decimal.ROUND_FLOOR, NumericValue.euro],
        ['aufrundenEuro', 0, Decimal.ROUND_CEIL, NumericValue.euro],
        ['abrundenCent', 2, Decimal.ROUND_FLOOR, NumericValue.cent],
        ['aufrundenCent', 2, Decimal.ROUND_CEIL, NumericValue.cent],
        // Generische Zahl-Rundung → Ganzzahl (SPEC § 11): „je angefangene
        // Einheit"-Tarife (KraftStG § 9: je 100 cm³ Hubraum o. Teil davon).
        ['aufrunden', 0, Decimal.ROUND_CEIL, NumericValue.ganzzahl],
        ['abrunden', 0, Decimal.ROUND_FLOOR, NumericValue.ganzzahl],
    ];
    for (const [name, nk, modus, make] of fns) {
        define(name, new BuiltinValue(name, rundung(name, nk, modus, make)));
    }
}
