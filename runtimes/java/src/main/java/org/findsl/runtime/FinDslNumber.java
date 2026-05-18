// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.util.Objects;

/**
 * Bit-genaue Java-Spiegelung des Euro-kanonischen Zahlmodells des
 * FinDSL-Interpreters (Semantik-Orakel: {@code interpret/values.ts}
 * {@code NumericValue} + {@code interpret/interpreter.ts}
 * {@code combineAddSub/Mul/Div}, {@code castNumeric},
 * {@code applyMoneyAnnotation}, {@code scalarRoundingValue}).
 *
 * <p>Unveränderlicher Wertetyp als {@code record} (Java 16+):
 * {@code value} (immer Euro-kanonisch, 1 ct = 0,01 €) + ein {@link Type}.
 * <b>Ein</b> Java-Typ für alle sechs FinDSL-Zahlarten (die sechs
 * {@link Type}-Konstanten) — wie der Interpreter, KEIN Typ pro Geldart,
 * sonst divergieren die {@code combine*}-Regeln.
 *
 * <p>Die Factory- und Rundungs-Methodennamen ({@code euro}, {@code cent},
 * {@code abrunden}, {@code aufrunden}, …) behalten bewusst die
 * FinDSL-Oberflächen-Bezeichner: das Phase-1-Lowering bildet
 * FinDSL-Typen/§-11.1-Stdlib-Methoden 1:1 darauf ab (Audit-Treue).
 *
 * <p><b>Gleichheit:</b> FinDSL-Wertgleichheit ist
 * {@link #equalsValue(FinDslNumber)} (Euro-kanonisch, skalen-unabhängig
 * über {@code compareTo}, ignoriert den {@code type} — exakt
 * {@code values.ts valuesEqual}). Das vom {@code record} erzeugte
 * {@link #equals(Object)} ist komponentenbasiert (BigDecimal-{@code equals}
 * ist skalen-sensitiv) und für FinDSL-{@code ==} <b>nicht</b> maßgeblich.
 *
 * <p><b>Gate 0 (verbindlich):</b> Der Interpreter nutzt {@code decimal.js}
 * mit dessen Default {@code precision: 20} / {@code ROUND_HALF_UP} (nie
 * per {@code Decimal.set} überschrieben). Jede Division spiegelt das mit
 * {@link #MC_DIV}. {@code +}/{@code -}/{@code *}/Negation sind exakt (kein
 * MathContext) — {@code decimal.js} ist dort unbegrenzt. „Bit-genau"
 * heißt: bit-genau zum Interpreter, nicht zur SPEC (die SPEC-Korrektur
 * „≥ 50 Stellen" ist ein separates Doku-Ticket).
 */
public record FinDslNumber(BigDecimal value, Type type) {

    /**
     * Die Art einer {@link FinDslNumber} — exakt die sechs Tags des
     * Interpreters ({@code values.ts NumericTag}). Geldwerte sind
     * Euro-kanonisch (der Betrag wird immer in Euro gespeichert); der
     * {@code type} trägt den statischen FinDSL-Typ und steuert
     * {@code combine*} und die Darstellung.
     *
     * <p>Die Konstantennamen ({@code Ganzzahl}, {@code Dezimal},
     * {@code Prozent}, …) sind die FinDSL-Sprach-Typbezeichner und werden
     * bewusst verbatim beibehalten (1:1-Abbildung auf die FinDSL-
     * Oberfläche — Audit-Treue).
     */
    public enum Type {
        Ganzzahl,
        Dezimal,
        Prozent,
        Euro,
        EuroCent,
        Cent
    }

    /**
     * Spiegelung des {@code decimal.js}-Defaults: 20 signifikante Stellen,
     * Rundung HALF_UP. Gilt für JEDE Division ({@code numericDiv},
     * {@code castNumeric} ÷100, Prozent-Literal/-Cast).
     */
    public static final MathContext MC_DIV = new MathContext(20, RoundingMode.HALF_UP);

    private static final BigDecimal HUNDERT = new BigDecimal("100");

    /** Kanonischer Konstruktor: Fail-fast gegen {@code null}-Komponenten. */
    public FinDslNumber {
        Objects.requireNonNull(value, "value");
        Objects.requireNonNull(type, "type");
    }

    // --- Factories (Werte Euro-kanonisch, wie values.ts) ------------------
    // Namen spiegeln die FinDSL-Typbezeichner (verbatim — siehe Klassen-Doc).

    public static FinDslNumber ganzzahl(String n) { return new FinDslNumber(new BigDecimal(n), Type.Ganzzahl); }
    public static FinDslNumber dezimal(String n)  { return new FinDslNumber(new BigDecimal(n), Type.Dezimal); }
    public static FinDslNumber euro(String n)     { return new FinDslNumber(new BigDecimal(n), Type.Euro); }
    /** Erwartet den Wert bereits in Euro-Skala (Euro-kanonisch). */
    public static FinDslNumber euroCent(String euroValue) { return new FinDslNumber(new BigDecimal(euroValue), Type.EuroCent); }
    /** Erwartet den Wert bereits in Euro-Skala (1 ct = 0,01 €). */
    public static FinDslNumber cent(String euroValue)     { return new FinDslNumber(new BigDecimal(euroValue), Type.Cent); }
    /** Erwartet die Bruchzahl (42 % → "0.42"), wie {@code values.ts}. */
    public static FinDslNumber prozent(String fraction)   { return new FinDslNumber(new BigDecimal(fraction), Type.Prozent); }

    // --- Typ-Lattice (interpreter.ts:427-433) -----------------------------

    private static boolean isMoneyType(Type t) {
        return t == Type.Euro || t == Type.EuroCent || t == Type.Cent;
    }

    /** Präzisions-Rang Euro &lt; EuroCent &lt; Cent (interpreter.ts:427). */
    private static int moneyRank(Type t) {
        return switch (t) {
            case Euro -> 0;
            case EuroCent -> 1;
            case Cent -> 2;
            default -> throw new FinDslRuntimeError("moneyRank auf Nicht-Geld: " + t);
        };
    }

    /** SPEC § 3.2.3 / § 3.4 — {@code combineAddSub} (interpreter.ts:513). */
    static Type combineAddSub(Type a, Type b) {
        if (isMoneyType(a) && isMoneyType(b)) {
            return moneyRank(a) >= moneyRank(b) ? a : b;
        }
        if (isMoneyType(a)) return a;
        if (isMoneyType(b)) return b;
        if (a == Type.Prozent && b == Type.Prozent)   return Type.Prozent;
        if (a == Type.Ganzzahl && b == Type.Ganzzahl) return Type.Ganzzahl;
        return Type.Dezimal;
    }

    /** SPEC § 3.2.3 / § 3.4 — {@code combineMul} (interpreter.ts:531). */
    static Type combineMul(Type a, Type b) {
        boolean aM = isMoneyType(a), bM = isMoneyType(b);
        if (aM && bM) return Type.EuroCent;             // statisch verboten
        if (aM || bM) {
            Type other = aM ? b : a;
            Type money = aM ? a : b;
            if (other == Type.Ganzzahl) return money;   // Geld * Ganzzahl
            return Type.EuroCent;                        // Geld * Dezimal/Prozent
        }
        if ((a == Type.Prozent && b == Type.Ganzzahl)
                || (a == Type.Ganzzahl && b == Type.Prozent)) {
            return Type.Prozent;
        }
        if (a == Type.Prozent && b == Type.Prozent)   return Type.Dezimal;
        if (a == Type.Ganzzahl && b == Type.Ganzzahl) return Type.Ganzzahl;
        return Type.Dezimal;
    }

    /** SPEC § 3.2.3 / § 3.4 — {@code combineDiv} (interpreter.ts:558). */
    static Type combineDiv(Type a, Type b) {
        if (isMoneyType(a)) return Type.Dezimal;
        if (a == Type.Prozent && b == Type.Ganzzahl) return Type.Prozent;
        return Type.Dezimal;
    }

    // --- Arithmetik (interpreter.ts:400-562) ------------------------------

    /** {@code +} — exakt, type = combineAddSub. */
    public FinDslNumber add(FinDslNumber b) {
        return new FinDslNumber(value.add(b.value), combineAddSub(type, b.type));
    }

    /** {@code -} — exakt, type = combineAddSub. */
    public FinDslNumber sub(FinDslNumber b) {
        return new FinDslNumber(value.subtract(b.value), combineAddSub(type, b.type));
    }

    /** {@code *} — exakt, type = combineMul. */
    public FinDslNumber mul(FinDslNumber b) {
        return new FinDslNumber(value.multiply(b.value), combineMul(type, b.type));
    }

    /** {@code /} — {@link #MC_DIV} (Gate 0), type = combineDiv. */
    public FinDslNumber div(FinDslNumber b) {
        if (b.value.signum() == 0) {
            throw new FinDslRuntimeError("Division durch Null.");
        }
        return new FinDslNumber(value.divide(b.value, MC_DIV), combineDiv(type, b.type));
    }

    /** Unäres {@code -} — exakt, type unverändert. */
    public FinDslNumber neg() {
        return new FinDslNumber(value.negate(), type);
    }

    // --- Vergleich (values.ts:311-359) ------------------------------------
    // valuesCompare: a.value.cmp(b.value); valuesEqual numerisch: .eq.
    // BigDecimal.compareTo (NICHT equals — equals ist skalen-sensitiv).

    public int cmp(FinDslNumber b)              { return value.compareTo(b.value); }
    public boolean equalsValue(FinDslNumber b)  { return value.compareTo(b.value) == 0; }

    // --- Cast (interpreter.ts:443-459) ------------------------------------

    /** {@code als <Ziel>}-Cast, Euro-kanonisch (castNumeric). */
    public FinDslNumber cast(Type target) {
        return switch (target) {
            case Euro, EuroCent, Cent -> {
                if (isMoneyType(type)) {
                    yield new FinDslNumber(value, target);     // reiner Typ-Wechsel
                }
                BigDecimal euroValue = target == Type.Cent
                    ? value.divide(HUNDERT, MC_DIV) : value;
                yield new FinDslNumber(euroValue, target);
            }
            case Prozent -> {
                BigDecimal fraction = type == Type.Prozent
                    ? value : value.divide(HUNDERT, MC_DIV);
                yield new FinDslNumber(fraction, Type.Prozent);
            }
            case Ganzzahl, Dezimal -> new FinDslNumber(value, target);
        };
    }

    private static boolean isInteger(BigDecimal d) {
        return d.stripTrailingZeros().scale() <= 0;
    }

    /**
     * Wendet eine Geld-Typannotation an (applyMoneyAnnotation,
     * interpreter.ts:481): Typ + Euro-kanonische Skalierung; erzwingt die
     * Ganzzahligkeit von {@code Euro}/{@code Cent} auch bei berechneten
     * Werten (fraktional → {@link FinDslRuntimeError}); {@code EuroCent}
     * ungeprüft.
     */
    public FinDslNumber withMoneyAnnotation(Type name, String what) {
        if (name != Type.Euro && name != Type.Cent && name != Type.EuroCent) {
            return this;
        }
        FinDslNumber c = cast(name);
        if (name == Type.Euro && !isInteger(c.value)) {
            throw new FinDslRuntimeError(what + ": Euro-Wert \""
                + germanFormat(c.value, null) + "\" ist nicht ganzzahlig — "
                + "explizite Rundung nötig (.abrunden()/.aufrunden(), SPEC § 11.1).");
        }
        if (name == Type.Cent && !isInteger(c.value.multiply(HUNDERT))) {
            throw new FinDslRuntimeError(what + ": Cent-Wert \""
                + germanFormat(c.value.multiply(HUNDERT), null) + "\" ist nicht "
                + "ganzzahlig — explizite Rundung nötig (.abrunden()/.aufrunden(), SPEC § 11.1).");
        }
        return c;
    }

    // --- Skalar-Rundung (interpreter.ts:956-990) --------------------------
    // Die Auflösung WELCHES Ziel (governingMoneyTarget) ist Lowering-Sache
    // (Phase 1) — die Runtime bekommt das aufgelöste Ziel und führt die
    // invariante Rechnung aus. abrunden=ROUND_FLOOR, aufrunden=ROUND_CEIL.
    // Die Methodennamen spiegeln die FinDSL-§-11.1-Stdlib (verbatim).

    public FinDslNumber abrunden(Type target)  { return round(target, RoundingMode.FLOOR); }
    public FinDslNumber aufrunden(Type target) { return round(target, RoundingMode.CEILING); }

    private FinDslNumber round(Type target, RoundingMode mode) {
        return switch (target) {
            // recv.value.mul(100).toDecimalPlaces(0,mode).div(100).
            // Nach setScale(0,…) ist der Dividend ganzzahlig → ÷100
            // terminiert IMMER exakt mit ≤ 2 Nachkommastellen; MC_DIV(20)
            // schneidet hier nie ab (≤ ~20-stellige Ganzzahl / 100). Der
            // Divisor MC_DIV ist nur Robustheits-Spiegel zu decimal.js
            // (das hier ebenfalls exakt terminiert) — keine Divergenz.
            case Prozent -> new FinDslNumber(
                value.multiply(HUNDERT).setScale(0, mode).divide(HUNDERT, MC_DIV),
                Type.Prozent);
            case Cent     -> new FinDslNumber(value.setScale(2, mode), Type.Cent);
            case Euro     -> new FinDslNumber(value.setScale(0, mode), Type.Euro);
            case Ganzzahl -> new FinDslNumber(value.setScale(0, mode), Type.Ganzzahl);
            default -> throw new FinDslRuntimeError("Rundung: unzulässiges Ziel " + target);
        };
    }

    // --- Deutsche Darstellung (values.ts:297-371) -------------------------

    /** {@code formatGerman}: `.` Tausender, `,` Dezimaltrenner. */
    static String germanFormat(BigDecimal v, Integer fractionDigits) {
        boolean neg = v.signum() < 0;
        BigDecimal abs = v.abs();
        String fixed = fractionDigits == null
            ? abs.stripTrailingZeros().toPlainString()
            : abs.setScale(fractionDigits, RoundingMode.HALF_UP).toPlainString();
        int dot = fixed.indexOf('.');
        String intPart  = dot < 0 ? fixed : fixed.substring(0, dot);
        String fracPart = dot < 0 ? ""    : fixed.substring(dot + 1);
        String grouped = groupThousands(intPart);
        String body = fracPart.isEmpty() ? grouped : grouped + "," + fracPart;
        return neg ? "-" + body : body;
    }

    /** Ganzteil zu Dreiergruppen mit `.` (deterministisch, kein Regex). */
    private static String groupThousands(String intPart) {
        StringBuilder sb = new StringBuilder();
        int n = intPart.length();
        for (int i = 0; i < n; i++) {
            if (i > 0 && (n - i) % 3 == 0) sb.append('.');
            sb.append(intPart.charAt(i));
        }
        return sb.toString();
    }

    /** {@code valueToString} numerisch (values.ts:363-370) — für Interpolation. */
    public String asText() {
        return switch (type) {
            case Prozent  -> germanFormat(value.multiply(HUNDERT), null) + " %";
            case Cent     -> germanFormat(value.multiply(HUNDERT), null);
            case EuroCent -> germanFormat(value, 2);
            case Euro, Ganzzahl, Dezimal -> germanFormat(value, null);
        };
    }

    @Override
    public String toString() {
        return "FinDslNumber(" + value.toPlainString() + ", " + type + ")";
    }
}
