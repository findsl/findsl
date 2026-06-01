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
 * <p>Unveränderlicher Wertetyp als {@code sealed class}: {@code value}
 * (immer Euro-kanonisch, 1 ct = 0,01 €) + ein {@link Type} (= das
 * semantik-tragende Tag). Die sechs sprechenden Subtypen {@link Euro}/
 * {@link EuroCent}/{@link Cent}/{@link Prozent}/{@link Ganzzahl}/
 * {@link Dezimal} sind <b>reine nominale Sicht-Typen ohne Eigen-
 * verhalten</b>: sie tragen kein eigenes Tag und erzeugen keine eigene
 * Arithmetik — die gesamte {@code combine*}/{@code cast}/Rundungs-
 * Semantik bleibt HIER zentral (sonst divergieren die Regeln). Eine
 * {@code Euro}-Instanz behält den TATSÄCHLICHEN Lauf­zeit-Tag im
 * geerbten {@code type}-Feld (z. B. {@code Cent} nach
 * {@code Euro − Cent}); die Subklasse ist nur die deklarierte Sicht.
 * Arithmetik liefert stets Obertyp-Instanzen (kein Subtyp-Routing →
 * keine Tag-Reimplementierung, bit-genau zum Interpreter).
 *
 * <p>Die Factory- und Rundungs-Methodennamen ({@code euro}, {@code cent},
 * {@code abrunden}, {@code aufrunden}, …) behalten bewusst die
 * FinDSL-Oberflächen-Bezeichner: das Phase-1-Lowering bildet
 * FinDSL-Typen/§-11.1-Stdlib-Methoden 1:1 darauf ab (Audit-Treue).
 *
 * <p><b>Gleichheit:</b> FinDSL-Wertgleichheit ist
 * {@link #equalsValue(FinDslNumber)} (Euro-kanonisch, skalen-unabhängig
 * über {@code compareTo}, ignoriert den {@code type} — exakt
 * {@code values.ts valuesEqual}). {@link #equals(Object)} ist
 * komponentenbasiert ({@code value}+{@code type}, subklassen-agnostisch,
 * verhaltensidentisch zum früheren {@code record}-{@code equals}) und
 * für FinDSL-{@code ==} <b>nicht</b> maßgeblich.
 *
 * <p><b>Gate 0 (verbindlich):</b> Der Interpreter nutzt {@code decimal.js}
 * mit dessen Default {@code precision: 20} / {@code ROUND_HALF_UP} (nie
 * per {@code Decimal.set} überschrieben). Jede Division spiegelt das mit
 * {@link #MC_DIV}. {@code +}/{@code -}/{@code *}/Negation sind exakt (kein
 * MathContext) — {@code decimal.js} ist dort unbegrenzt. „Bit-genau"
 * heißt: bit-genau zum Interpreter, nicht zur SPEC (die SPEC-Korrektur
 * „≥ 50 Stellen" ist ein separates Doku-Ticket).
 */
public sealed class FinDslNumber
        permits Euro, EuroCent, Cent, Prozent, Ganzzahl, Dezimal {

    private final BigDecimal value;
    private final Type type;

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

    /**
     * Kanonischer Konstruktor: Fail-fast gegen {@code null}-Komponenten.
     * Paket-privat — Instanzen entstehen über die Factories bzw. die
     * Sicht-Subklassen ({@code Euro.von(…)} …).
     *
     * @param value Euro-kanonischer Betrag (nie {@code null}).
     * @param type  Zahl-Art (nie {@code null}).
     */
    FinDslNumber(BigDecimal value, Type type) {
        this.value = Objects.requireNonNull(value, "value");
        this.type = Objects.requireNonNull(type, "type");
    }

    /**
     * Euro-kanonischer Betrag.
     *
     * @return der Wert (skalen-sensitiv; FinDSL-Gleichheit via
     *         {@link #equalsValue(FinDslNumber)}).
     */
    public BigDecimal value() {
        return value;
    }

    /**
     * Zahl-Art (Tag) — das semantik-tragende Feld; bei Sicht-Subtypen
     * der TATSÄCHLICHE Laufzeit-Tag, nicht zwingend die deklarierte Sicht.
     *
     * @return die {@link Type}-Konstante.
     */
    public Type type() {
        return type;
    }

    /**
     * Komponentengleichheit ({@code value}+{@code type}, subklassen-
     * agnostisch) — verhaltensidentisch zum früheren {@code record}-
     * {@code equals}. Für FinDSL-{@code ==} ist
     * {@link #equalsValue(FinDslNumber)} maßgeblich, NICHT dies.
     *
     * @param o Vergleichsobjekt.
     * @return {@code true} gdw. gleicher Wert (skalen-sensitiv) und Tag.
     */
    @Override
    public boolean equals(Object o) {
        return o instanceof FinDslNumber f
                && type == f.type && value.equals(f.value);
    }

    /**
     * Konsistent zu {@link #equals(Object)} (Wert + Tag).
     *
     * @return Hashcode aus Wert und Art.
     */
    @Override
    public int hashCode() {
        return Objects.hash(value, type);
    }

    // --- Factories (Werte Euro-kanonisch, wie values.ts) ------------------
    // Namen spiegeln die FinDSL-Typbezeichner (verbatim — siehe Klassen-Doc).

    /**
     * Erzeugt eine {@code Ganzzahl} aus dem Dezimalstring {@code n}.
     *
     * @param n Dezimalstring (Punkt als Dezimaltrenner, wie BigDecimal).
     * @return {@link FinDslNumber} mit {@link Type#Ganzzahl}.
     */
    public static FinDslNumber ganzzahl(String n) {
        return new FinDslNumber(new BigDecimal(n), Type.Ganzzahl);
    }

    /**
     * Erzeugt eine {@code Dezimal}-Zahl aus dem Dezimalstring {@code n}.
     *
     * @param n Dezimalstring (Punkt als Dezimaltrenner, wie BigDecimal).
     * @return {@link FinDslNumber} mit {@link Type#Dezimal}.
     */
    public static FinDslNumber dezimal(String n) {
        return new FinDslNumber(new BigDecimal(n), Type.Dezimal);
    }

    /**
     * Erzeugt einen {@code Euro}-Betrag (bereits in Euro-Skala).
     *
     * @param n Betrag in Euro als Dezimalstring.
     * @return {@link FinDslNumber} mit {@link Type#Euro}.
     */
    public static FinDslNumber euro(String n) {
        return new FinDslNumber(new BigDecimal(n), Type.Euro);
    }

    /**
     * Erzeugt einen {@code EuroCent}-Betrag.
     *
     * @param euroValue Wert bereits in Euro-Skala (Euro-kanonisch).
     * @return {@link FinDslNumber} mit {@link Type#EuroCent}.
     */
    public static FinDslNumber euroCent(String euroValue) {
        return new FinDslNumber(new BigDecimal(euroValue), Type.EuroCent);
    }

    /**
     * Erzeugt einen {@code Cent}-Betrag.
     *
     * @param euroValue Wert bereits in Euro-Skala (1 ct = 0,01 €).
     * @return {@link FinDslNumber} mit {@link Type#Cent}.
     */
    public static FinDslNumber cent(String euroValue) {
        return new FinDslNumber(new BigDecimal(euroValue), Type.Cent);
    }

    /**
     * Erzeugt einen {@code Prozent}-Wert.
     *
     * @param fraction Bruchzahl (42 % → {@code "0.42"}), wie {@code values.ts}.
     * @return {@link FinDslNumber} mit {@link Type#Prozent}.
     */
    public static FinDslNumber prozent(String fraction) {
        return new FinDslNumber(new BigDecimal(fraction), Type.Prozent);
    }

    // --- Typ-Lattice (interpreter.ts:427-433) -----------------------------

    /**
     * Ob {@code t} eine Geld-Art ist ({@code Euro}/{@code EuroCent}/{@code Cent}).
     *
     * @param t zu prüfende Zahl-Art.
     * @return {@code true} gdw. {@code t} eine Geld-Art ist.
     */
    private static boolean isMoneyType(Type t) {
        return t == Type.Euro || t == Type.EuroCent || t == Type.Cent;
    }

    /**
     * Präzisions-Rang Euro &lt; EuroCent &lt; Cent (interpreter.ts:427).
     *
     * @param t Geld-Art.
     * @return Rang 0/1/2; wirft {@link FinDslRuntimeError} bei Nicht-Geld.
     */
    private static int moneyRank(Type t) {
        return switch (t) {
            case Euro -> 0;
            case EuroCent -> 1;
            case Cent -> 2;
            default -> throw new FinDslRuntimeError("moneyRank auf Nicht-Geld: " + t);
        };
    }

    /**
     * SPEC § 3.2.3 / § 3.4 — {@code combineAddSub} (interpreter.ts:513):
     * Ergebnis-Art von {@code +}/{@code -}.
     *
     * @param a Art des linken Operanden.
     * @param b Art des rechten Operanden.
     * @return die resultierende Zahl-Art.
     */
    static Type combineAddSub(Type a, Type b) {
        if (isMoneyType(a) && isMoneyType(b)) {
            return moneyRank(a) >= moneyRank(b) ? a : b;
        }
        if (isMoneyType(a)) return a;
        if (isMoneyType(b)) return b;
        if (a == Type.Prozent && b == Type.Prozent) return Type.Prozent;
        if (a == Type.Ganzzahl && b == Type.Ganzzahl) return Type.Ganzzahl;
        return Type.Dezimal;
    }

    /**
     * SPEC § 3.2.3 / § 3.4 — {@code combineMul} (interpreter.ts:531):
     * Ergebnis-Art von {@code *}.
     *
     * @param a Art des linken Operanden.
     * @param b Art des rechten Operanden.
     * @return die resultierende Zahl-Art.
     */
    static Type combineMul(Type a, Type b) {
        boolean aM = isMoneyType(a), bM = isMoneyType(b);
        if (aM && bM) return Type.EuroCent;             // statisch verboten
        if (aM || bM) {
            Type other = aM ? b : a;
            Type money = aM ? a : b;
            if (other == Type.Ganzzahl) return money;   // Geld * Ganzzahl
            return Type.EuroCent;                        // Geld * Dezimal/Prozent
        }
        // Prozent ist hier ein dimensionsloser Bruch-Skalar (SPEC § 3.4):
        // `100 * 10% == 10`, nicht `1000%`. Jede Nicht-Geld-Kombination mit
        // Prozent → Dezimal; nur Ganzzahl*Ganzzahl bleibt Ganzzahl.
        if (a == Type.Ganzzahl && b == Type.Ganzzahl) return Type.Ganzzahl;
        return Type.Dezimal;
    }

    /**
     * SPEC § 3.2.3 / § 3.4 — {@code combineDiv} (interpreter.ts:558):
     * Ergebnis-Art von {@code /}.
     *
     * @param a Art des Dividenden.
     * @param b Art des Divisors.
     * @return die resultierende Zahl-Art.
     */
    static Type combineDiv(Type a, Type b) {
        if (isMoneyType(a)) return Type.Dezimal;
        // Prozent / Zahl → Dezimal (Bruchwert, SPEC § 3.4): `9,3% / 2 == 0,0465`.
        return Type.Dezimal;
    }

    // --- Arithmetik (interpreter.ts:400-562) ------------------------------

    /**
     * Addition {@code +} — exakt; Ergebnis-Art = {@link #combineAddSub}.
     *
     * @param b Summand.
     * @return neue {@link FinDslNumber} (Wert exakt, kein MathContext).
     */
    public FinDslNumber add(FinDslNumber b) {
        return new FinDslNumber(value.add(b.value), combineAddSub(type, b.type));
    }

    /**
     * Subtraktion {@code -} — exakt; Ergebnis-Art = {@link #combineAddSub}.
     *
     * @param b Subtrahend.
     * @return neue {@link FinDslNumber} (Wert exakt, kein MathContext).
     */
    public FinDslNumber sub(FinDslNumber b) {
        return new FinDslNumber(value.subtract(b.value), combineAddSub(type, b.type));
    }

    /**
     * Multiplikation {@code *} — exakt; Ergebnis-Art = {@link #combineMul}.
     *
     * @param b Faktor.
     * @return neue {@link FinDslNumber} (Wert exakt, kein MathContext).
     */
    public FinDslNumber mul(FinDslNumber b) {
        return new FinDslNumber(value.multiply(b.value), combineMul(type, b.type));
    }

    /**
     * Division {@code /} mit {@link #MC_DIV} (Gate 0); Ergebnis-Art =
     * {@link #combineDiv}.
     *
     * @param b Divisor.
     * @return neue {@link FinDslNumber}.
     * @throws FinDslRuntimeError bei Division durch Null.
     */
    public FinDslNumber div(FinDslNumber b) {
        if (b.value.signum() == 0) {
            throw new FinDslRuntimeError("Division durch Null.");
        }
        return new FinDslNumber(value.divide(b.value, MC_DIV), combineDiv(type, b.type));
    }

    /**
     * Unäres Minus {@code -} — exakt; die Art bleibt unverändert.
     *
     * @return neue {@link FinDslNumber} mit negiertem Wert.
     */
    public FinDslNumber neg() {
        return new FinDslNumber(value.negate(), type);
    }

    // --- Vergleich (values.ts:311-359) ------------------------------------
    // valuesCompare: a.value.cmp(b.value); valuesEqual numerisch: .eq.
    // BigDecimal.compareTo (NICHT equals — equals ist skalen-sensitiv).

    /**
     * Wertvergleich (Spiegel {@code values.ts valuesCompare}):
     * skalen-unabhängig über {@code BigDecimal.compareTo}, die Art wird
     * — wie im Interpreter — ignoriert.
     *
     * @param b Vergleichswert.
     * @return negativ/0/positiv, falls dieser Wert kleiner/gleich/größer.
     */
    public int compareValue(FinDslNumber b) {
        return value.compareTo(b.value);
    }

    /**
     * FinDSL-Wertgleichheit {@code ==} (Spiegel {@code values.ts
     * valuesEqual}): Euro-kanonisch, skalen-unabhängig, art-agnostisch.
     *
     * @param b Vergleichswert.
     * @return {@code true} gdw. die Werte numerisch gleich sind.
     */
    public boolean equalsValue(FinDslNumber b) {
        return value.compareTo(b.value) == 0;
    }

    // --- Cast (interpreter.ts:443-459) ------------------------------------

    /**
     * {@code als <Ziel>}-Cast, Euro-kanonisch (Spiegel {@code castNumeric}).
     *
     * @param target Ziel-Art.
     * @return neue {@link FinDslNumber} in der Ziel-Art (Wert ggf. skaliert).
     */
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

    /**
     * Ob {@code d} ganzzahlig ist (skalen-unabhängig).
     *
     * @param d zu prüfender Wert.
     * @return {@code true} gdw. {@code d} keine Nachkommastellen hat.
     */
    private static boolean isInteger(BigDecimal d) {
        return d.stripTrailingZeros().scale() <= 0;
    }

    /**
     * Wendet eine Geld-Typannotation an (applyMoneyAnnotation,
     * interpreter.ts:481): Typ + Euro-kanonische Skalierung; erzwingt die
     * Ganzzahligkeit von {@code Euro}/{@code Cent} auch bei berechneten
     * Werten (fraktional → {@link FinDslRuntimeError}); {@code EuroCent}
     * ungeprüft.
     *
     * @param name Geld-Ziel-Art (Nicht-Geld → unverändert zurück).
     * @param what Kontextbeschreibung für die Fehlermeldung.
     * @return die annotierte {@link FinDslNumber}.
     * @throws FinDslRuntimeError bei fraktionalem {@code Euro}/{@code Cent}.
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

    /**
     * Abrunden (FinDSL {@code .abrunden()}, SPEC § 11.1) zur Ziel-Art —
     * Richtung {@code RoundingMode.FLOOR} (gegen −∞).
     *
     * @param target beim Lowering aufgelöstes Rundungsziel.
     * @return abgerundete {@link FinDslNumber} in der Ziel-Art.
     */
    public FinDslNumber abrunden(Type target) {
        return round(target, RoundingMode.FLOOR);
    }

    /**
     * Aufrunden (FinDSL {@code .aufrunden()}, SPEC § 11.1) zur Ziel-Art —
     * Richtung {@code RoundingMode.CEILING} (gegen +∞).
     *
     * @param target beim Lowering aufgelöstes Rundungsziel.
     * @return aufgerundete {@link FinDslNumber} in der Ziel-Art.
     */
    public FinDslNumber aufrunden(Type target) {
        return round(target, RoundingMode.CEILING);
    }

    /**
     * Gemeinsame Rundungsmechanik für {@link #abrunden}/{@link #aufrunden}
     * (Spiegel {@code scalarRoundingValue}).
     *
     * @param target Ziel-Art (Prozent/Cent/Euro/Ganzzahl).
     * @param mode   Rundungsrichtung (FLOOR/CEILING).
     * @return gerundete {@link FinDslNumber}; wirft bei unzulässigem Ziel.
     */
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
            case Cent -> new FinDslNumber(value.setScale(2, mode), Type.Cent);
            case Euro -> new FinDslNumber(value.setScale(0, mode), Type.Euro);
            case Ganzzahl -> new FinDslNumber(value.setScale(0, mode), Type.Ganzzahl);
            default -> throw new FinDslRuntimeError("Rundung: unzulässiges Ziel " + target);
        };
    }

    // --- Grenzwert-/Stufen-Methoden (interpreter.ts scalarLimitValue/
    //     scalarRoundToMultipleValue; SPEC § 11.6) -------------------------
    // Typ-erhaltend (Tag des Empfängers bleibt) und kontextfrei. Werte sind
    // Euro-kanonisch, daher direkt über `value` vergleichbar/teilbar.

    /**
     * Obergrenze (FinDSL {@code .höchstens(grenze)}, SPEC § 11.6) — das
     * Minimum aus Empfänger und {@code grenze}.
     *
     * @param grenze die Obergrenze.
     * @return der kleinere der beiden Werte, mit dem Empfänger-Tag.
     */
    public FinDslNumber hoechstens(FinDslNumber grenze) {
        BigDecimal chosen = value.compareTo(grenze.value) <= 0 ? value : grenze.value;
        return new FinDslNumber(chosen, type);
    }

    /**
     * Untergrenze (FinDSL {@code .mindestens(grenze)}, SPEC § 11.6) — das
     * Maximum aus Empfänger und {@code grenze}.
     *
     * @param grenze die Untergrenze.
     * @return der größere der beiden Werte, mit dem Empfänger-Tag.
     */
    public FinDslNumber mindestens(FinDslNumber grenze) {
        BigDecimal chosen = value.compareTo(grenze.value) >= 0 ? value : grenze.value;
        return new FinDslNumber(chosen, type);
    }

    /**
     * Abrunden auf ein Vielfaches (FinDSL {@code .abrundenAuf(vielfaches)},
     * SPEC § 11.6) — Richtung −∞.
     *
     * @param vielfaches Rundungsschritt (muss &gt; 0 sein).
     * @return das nächstkleinere Vielfache, mit dem Empfänger-Tag.
     */
    public FinDslNumber abrundenAuf(FinDslNumber vielfaches) {
        return roundToMultiple(vielfaches, RoundingMode.FLOOR);
    }

    /**
     * Aufrunden auf ein Vielfaches (FinDSL {@code .aufrundenAuf(vielfaches)},
     * SPEC § 11.6) — Richtung +∞.
     *
     * @param vielfaches Rundungsschritt (muss &gt; 0 sein).
     * @return das nächstgrößere Vielfache, mit dem Empfänger-Tag.
     */
    public FinDslNumber aufrundenAuf(FinDslNumber vielfaches) {
        return roundToMultiple(vielfaches, RoundingMode.CEILING);
    }

    /**
     * Gemeinsame Mechanik für {@link #abrundenAuf}/{@link #aufrundenAuf}
     * (Spiegel {@code scalarRoundToMultipleValue}): {@code stufen =
     * round(value / vielfaches)} mit anschließendem {@code stufen *
     * vielfaches}.
     *
     * <p>Die Division läuft zweistufig — {@code divide(divisor, MC_DIV)}
     * (Zwischenpräzision 20 signifikante Stellen, HALF_UP) gefolgt von
     * {@code setScale(0, mode)} — und spiegelt damit bit-genau die
     * decimal.js-Seite ({@code div(...).toDecimalPlaces(0, mode)}, precision
     * 20). Eine direkte {@code divide(divisor, 0, mode)} würde den exakten
     * Quotienten runden und bei Werten mit &gt; 20 signifikanten Stellen vom
     * Interpreter-Orakel abweichen (Issue #206).
     *
     * @param vielfaches Rundungsschritt (muss &gt; 0 sein).
     * @param mode       Rundungsrichtung (FLOOR/CEILING).
     * @return gerundetes Vielfaches mit dem Empfänger-Tag.
     * @throws FinDslRuntimeError wenn {@code vielfaches <= 0}.
     */
    private FinDslNumber roundToMultiple(FinDslNumber vielfaches, RoundingMode mode) {
        if (vielfaches.value.signum() <= 0) {
            throw new FinDslRuntimeError("Vielfaches muss größer als 0 sein, erhalten "
                    + germanFormat(vielfaches.value, null) + ".");
        }
        BigDecimal stufen = value.divide(vielfaches.value, MC_DIV).setScale(0, mode);
        return new FinDslNumber(stufen.multiply(vielfaches.value), type);
    }

    // --- Deutsche Darstellung (values.ts:297-371) -------------------------

    /**
     * Deutsche Zahldarstellung (Spiegel {@code formatGerman}): {@code .}
     * als Tausender-, {@code ,} als Dezimaltrenner.
     *
     * @param v              darzustellender Wert.
     * @param fractionDigits feste Nachkommastellen oder {@code null} =
     *                       natürliche (trailing zeros entfernt).
     * @return die formatierte Zeichenkette.
     */
    static String germanFormat(BigDecimal v, Integer fractionDigits) {
        boolean neg = v.signum() < 0;
        BigDecimal abs = v.abs();
        String fixed = fractionDigits == null
                ? abs.stripTrailingZeros().toPlainString()
                : abs.setScale(fractionDigits, RoundingMode.HALF_UP).toPlainString();
        int dot = fixed.indexOf('.');
        String intPart = dot < 0 ? fixed : fixed.substring(0, dot);
        String fracPart = dot < 0 ? "" : fixed.substring(dot + 1);
        String grouped = groupThousands(intPart);
        String body = fracPart.isEmpty() ? grouped : grouped + "," + fracPart;
        return neg ? "-" + body : body;
    }

    /**
     * Gruppiert den Ganzteil zu Dreiergruppen mit {@code .}
     * (deterministisch, kein Regex).
     *
     * @param intPart Ziffernfolge des Ganzteils (ohne Vorzeichen).
     * @return gruppierte Zeichenkette.
     */
    private static String groupThousands(String intPart) {
        StringBuilder sb = new StringBuilder();
        int n = intPart.length();
        for (int i = 0; i < n; i++) {
            if (i > 0 && (n - i) % 3 == 0) sb.append('.');
            sb.append(intPart.charAt(i));
        }
        return sb.toString();
    }

    /**
     * Textdarstellung für String-Interpolation (Spiegel
     * {@code values.ts valueToString}, 363-370) — art-abhängig.
     *
     * @return deutsche Darstellung inkl. {@code %} bei {@link Type#Prozent}.
     */
    public String asText() {
        return switch (type) {
            case Prozent -> germanFormat(value.multiply(HUNDERT), null) + " %";
            case Cent -> germanFormat(value.multiply(HUNDERT), null);
            case EuroCent -> germanFormat(value, 2);
            case Euro, Ganzzahl, Dezimal -> germanFormat(value, null);
        };
    }

    /**
     * Debug-Darstellung ({@code FinDslNumber(<wert>, <art>)}) — NICHT die
     * fachliche Darstellung (dafür {@link #asText()}).
     *
     * @return technische Zeichenkette für Logging/Diagnose.
     */
    @Override
    public String toString() {
        return "FinDslNumber(" + value.toPlainString() + ", " + type + ")";
    }
}
