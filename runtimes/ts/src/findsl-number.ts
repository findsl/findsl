// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

import { Decimal } from 'decimal.js';

/**
 * Bit-genaue TypeScript-Spiegelung des Euro-kanonischen Zahlmodells des
 * FinDSL-Interpreters (Semantik-Orakel: `interpret/values.ts NumericValue`
 * + `interpret/interpreter.ts combineAddSub/Mul/Div`, `castNumeric`,
 * `applyMoneyAnnotation`, `scalarRoundingValue`). 1:1-Port der Java-Runtime
 * `org.findsl.runtime.FinDslNumber` — derselbe decimal.js-Stack wie der
 * Interpreter (kein Drift, Issue #41/#99).
 *
 * Unveränderlicher Wertetyp: `value` (immer Euro-kanonisch, 1 ct = 0,01 €)
 * + ein `type`-Tag. Die sechs sprechenden Sicht-Wrapper (Euro/EuroCent/
 * Cent/Prozent/Ganzzahl/Dezimal) sind reine nominale Sichten ohne Eigen-
 * verhalten — die gesamte combine-, cast- und Rundungs-Semantik bleibt
 * HIER zentral.
 *
 * Gate 0: Der Interpreter nutzt decimal.js mit dessen Default precision 20
 * / ROUND_HALF_UP. Jede Division spiegelt das mit {@link Mc}. +/-/* sind
 * exakt (decimal.js ist dort unbegrenzt).
 */

export type FinDslNumberType =
    | 'Ganzzahl' | 'Dezimal' | 'Prozent' | 'Euro' | 'EuroCent' | 'Cent';

/**
 * Division-Kontext: precision 20, ROUND_HALF_UP — exakt der decimal.js-
 * Default des Interpreters, hier explizit isoliert, damit das Generat
 * robust gegen eine fremde globale `Decimal`-Konfiguration ist.
 */
const Mc = Decimal.clone({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

const HUNDERT = new Mc(100);

export class FinDslRuntimeError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FinDslRuntimeError';
    }
}

export class FinDslNumber {
    readonly value: Decimal;
    readonly type: FinDslNumberType;

    constructor(value: Decimal, type: FinDslNumberType) {
        this.value = value;
        this.type = type;
    }

    // --- Factories (Werte Euro-kanonisch, wie values.ts) ------------------

    static ganzzahl(n: string): FinDslNumber { return new FinDslNumber(new Mc(n), 'Ganzzahl'); }
    static dezimal(n: string): FinDslNumber { return new FinDslNumber(new Mc(n), 'Dezimal'); }
    static euro(n: string): FinDslNumber { return new FinDslNumber(new Mc(n), 'Euro'); }
    static euroCent(euroValue: string): FinDslNumber { return new FinDslNumber(new Mc(euroValue), 'EuroCent'); }
    static cent(euroValue: string): FinDslNumber { return new FinDslNumber(new Mc(euroValue), 'Cent'); }
    static prozent(fraction: string): FinDslNumber { return new FinDslNumber(new Mc(fraction), 'Prozent'); }

    // --- Typ-Lattice (interpreter.ts:427-433) -----------------------------

    private static isMoney(t: FinDslNumberType): boolean {
        return t === 'Euro' || t === 'EuroCent' || t === 'Cent';
    }

    private static moneyRank(t: FinDslNumberType): number {
        switch (t) {
            case 'Euro': return 0;
            case 'EuroCent': return 1;
            case 'Cent': return 2;
            default: throw new FinDslRuntimeError('moneyRank auf Nicht-Geld: ' + t);
        }
    }

    /** SPEC § 3.2.3 / § 3.4 — combineAddSub (interpreter.ts:513). */
    static combineAddSub(a: FinDslNumberType, b: FinDslNumberType): FinDslNumberType {
        if (FinDslNumber.isMoney(a) && FinDslNumber.isMoney(b)) {
            return FinDslNumber.moneyRank(a) >= FinDslNumber.moneyRank(b) ? a : b;
        }
        if (FinDslNumber.isMoney(a)) return a;
        if (FinDslNumber.isMoney(b)) return b;
        if (a === 'Prozent' && b === 'Prozent') return 'Prozent';
        if (a === 'Ganzzahl' && b === 'Ganzzahl') return 'Ganzzahl';
        return 'Dezimal';
    }

    /** SPEC § 3.2.3 / § 3.4 — combineMul (interpreter.ts:531). */
    static combineMul(a: FinDslNumberType, b: FinDslNumberType): FinDslNumberType {
        const aM = FinDslNumber.isMoney(a), bM = FinDslNumber.isMoney(b);
        if (aM && bM) return 'EuroCent';                 // statisch verboten
        if (aM || bM) {
            const other = aM ? b : a;
            const money = aM ? a : b;
            if (other === 'Ganzzahl') return money;      // Geld * Ganzzahl
            return 'EuroCent';                            // Geld * Dezimal/Prozent
        }
        if ((a === 'Prozent' && b === 'Ganzzahl') || (a === 'Ganzzahl' && b === 'Prozent')) {
            return 'Prozent';
        }
        if (a === 'Prozent' && b === 'Prozent') return 'Dezimal';
        if (a === 'Ganzzahl' && b === 'Ganzzahl') return 'Ganzzahl';
        return 'Dezimal';
    }

    /** SPEC § 3.2.3 / § 3.4 — combineDiv (interpreter.ts:558). */
    static combineDiv(a: FinDslNumberType, b: FinDslNumberType): FinDslNumberType {
        if (FinDslNumber.isMoney(a)) return 'Dezimal';
        if (a === 'Prozent' && b === 'Ganzzahl') return 'Prozent';
        return 'Dezimal';
    }

    // --- Arithmetik (interpreter.ts:400-562) ------------------------------

    add(b: FinDslNumber): FinDslNumber {
        return new FinDslNumber(this.value.plus(b.value), FinDslNumber.combineAddSub(this.type, b.type));
    }
    sub(b: FinDslNumber): FinDslNumber {
        return new FinDslNumber(this.value.minus(b.value), FinDslNumber.combineAddSub(this.type, b.type));
    }
    mul(b: FinDslNumber): FinDslNumber {
        return new FinDslNumber(this.value.times(b.value), FinDslNumber.combineMul(this.type, b.type));
    }
    div(b: FinDslNumber): FinDslNumber {
        if (b.value.isZero()) throw new FinDslRuntimeError('Division durch Null.');
        return new FinDslNumber(this.value.div(b.value), FinDslNumber.combineDiv(this.type, b.type));
    }
    neg(): FinDslNumber {
        return new FinDslNumber(this.value.neg(), this.type);
    }

    // --- Vergleich (values.ts:311-359) — skalen-unabhängig, art-agnostisch.

    compareValue(b: FinDslNumber): number { return this.value.cmp(b.value); }
    equalsValue(b: FinDslNumber): boolean { return this.value.cmp(b.value) === 0; }

    // --- Cast (interpreter.ts:443-459) ------------------------------------

    cast(target: FinDslNumberType): FinDslNumber {
        switch (target) {
            case 'Euro':
            case 'EuroCent':
            case 'Cent': {
                if (FinDslNumber.isMoney(this.type)) {
                    return new FinDslNumber(this.value, target);   // reiner Typ-Wechsel
                }
                const euroValue = target === 'Cent' ? this.value.div(HUNDERT) : this.value;
                return new FinDslNumber(euroValue, target);
            }
            case 'Prozent': {
                const fraction = this.type === 'Prozent' ? this.value : this.value.div(HUNDERT);
                return new FinDslNumber(fraction, 'Prozent');
            }
            case 'Ganzzahl':
            case 'Dezimal':
                return new FinDslNumber(this.value, target);
        }
    }

    private static isInteger(d: Decimal): boolean { return d.isInteger(); }

    /** applyMoneyAnnotation (interpreter.ts:481). */
    withMoneyAnnotation(name: FinDslNumberType, what: string): FinDslNumber {
        if (name !== 'Euro' && name !== 'Cent' && name !== 'EuroCent') return this;
        const c = this.cast(name);
        if (name === 'Euro' && !FinDslNumber.isInteger(c.value)) {
            throw new FinDslRuntimeError(`${what}: Euro-Wert "${germanFormat(c.value, null)}" ist nicht `
                + 'ganzzahlig — explizite Rundung nötig (.abrunden()/.aufrunden(), SPEC § 11.1).');
        }
        if (name === 'Cent' && !FinDslNumber.isInteger(c.value.times(HUNDERT))) {
            throw new FinDslRuntimeError(`${what}: Cent-Wert "${germanFormat(c.value.times(HUNDERT), null)}" ist nicht `
                + 'ganzzahlig — explizite Rundung nötig (.abrunden()/.aufrunden(), SPEC § 11.1).');
        }
        return c;
    }

    // --- Skalar-Rundung (interpreter.ts:956-990) --------------------------
    // abrunden=ROUND_FLOOR, aufrunden=ROUND_CEIL (gegen -∞ / +∞).

    abrunden(target: FinDslNumberType): FinDslNumber { return this.round(target, Decimal.ROUND_FLOOR); }
    aufrunden(target: FinDslNumberType): FinDslNumber { return this.round(target, Decimal.ROUND_CEIL); }

    private round(target: FinDslNumberType, mode: Decimal.Rounding): FinDslNumber {
        switch (target) {
            case 'Prozent':
                return new FinDslNumber(
                    this.value.times(HUNDERT).toDecimalPlaces(0, mode).div(HUNDERT), 'Prozent');
            case 'Cent':
                return new FinDslNumber(this.value.toDecimalPlaces(2, mode), 'Cent');
            case 'Euro':
                return new FinDslNumber(this.value.toDecimalPlaces(0, mode), 'Euro');
            case 'Ganzzahl':
                return new FinDslNumber(this.value.toDecimalPlaces(0, mode), 'Ganzzahl');
            default:
                throw new FinDslRuntimeError('Rundung: unzulässiges Ziel ' + target);
        }
    }

    // --- Deutsche Darstellung (values.ts:297-371) -------------------------

    asText(): string {
        switch (this.type) {
            case 'Prozent': return germanFormat(this.value.times(HUNDERT), null) + ' %';
            case 'Cent': return germanFormat(this.value.times(HUNDERT), null);
            case 'EuroCent': return germanFormat(this.value, 2);
            case 'Euro':
            case 'Ganzzahl':
            case 'Dezimal': return germanFormat(this.value, null);
        }
    }
}

/**
 * Deutsche Zahldarstellung (Spiegel `values.ts formatGerman`): `.` als
 * Tausender-, `,` als Dezimaltrenner. `fractionDigits` = feste Nachkomma-
 * stellen oder null = natürliche (trailing zeros entfernt).
 */
export function germanFormat(v: Decimal, fractionDigits: number | null): string {
    const neg = v.isNegative();
    const abs = v.abs();
    // toFixed gibt nie Exponential — wie BigDecimal.toPlainString.
    const fixed = fractionDigits === null
        ? stripTrailingZeros(abs)
        : abs.toFixed(fractionDigits, Decimal.ROUND_HALF_UP);
    const dot = fixed.indexOf('.');
    const intPart = dot < 0 ? fixed : fixed.substring(0, dot);
    const fracPart = dot < 0 ? '' : fixed.substring(dot + 1);
    const grouped = groupThousands(intPart);
    const body = fracPart === '' ? grouped : grouped + ',' + fracPart;
    return neg ? '-' + body : body;
}

/** Plain-String ohne überflüssige Nachkomma-Nullen (BigDecimal.stripTrailingZeros). */
function stripTrailingZeros(abs: Decimal): string {
    const s = abs.toFixed();
    if (s.indexOf('.') < 0) return s;
    return s.replace(/0+$/, '').replace(/\.$/, '');
}

/** Gruppiert den Ganzteil zu Dreiergruppen mit `.` (deterministisch). */
function groupThousands(intPart: string): string {
    let sb = '';
    const n = intPart.length;
    for (let i = 0; i < n; i++) {
        if (i > 0 && (n - i) % 3 === 0) sb += '.';
        sb += intPart.charAt(i);
    }
    return sb;
}
