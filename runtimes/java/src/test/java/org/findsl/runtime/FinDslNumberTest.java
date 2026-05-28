// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Phase-0-Gate: {@link FinDslNumber} ist bit-genau zum Interpreter
 * (Semantik-Orakel {@code interpret/values.ts} + {@code interpreter.ts}).
 * Die Sollwerte sind aus dem {@code decimal.js}-Verhalten (Default
 * {@code precision: 20} / {@code ROUND_HALF_UP}) handgerechnet.
 */
class FinDslNumberTest {

    private static void assertValue(FinDslNumber z, String expectedPlain, FinDslNumber.Type expectedType) {
        assertEquals(0, z.value().compareTo(new BigDecimal(expectedPlain)),
            "Wert: erwartet " + expectedPlain + ", war " + z.value().toPlainString());
        assertEquals(expectedType, z.type(), "Typ");
    }

    @Nested
    @DisplayName("Divisions-Bit-Genauigkeit (Gate 0 / Risiko R1)")
    class Division {
        @Test
        @DisplayName("10/3 → 20 signifikante Stellen, HALF_UP")
        void tenThirds() {
            FinDslNumber z = FinDslNumber.dezimal("10").div(FinDslNumber.dezimal("3"));
            // decimal.js precision:20 → exakt diese 20 Stellen.
            assertEquals("3.3333333333333333333", z.value().toPlainString());
            assertEquals(FinDslNumber.Type.Dezimal, z.type());
        }

        @Test
        @DisplayName("2/3 → letzte Stelle HALF_UP aufgerundet")
        void twoThirds() {
            FinDslNumber z = FinDslNumber.dezimal("2").div(FinDslNumber.dezimal("3"));
            assertEquals("0.66666666666666666667", z.value().toPlainString());
        }

        @Test
        @DisplayName("Geld/Ganzzahl → Dezimal, exakt terminierend")
        void moneyByGanzzahl() {
            FinDslNumber z = FinDslNumber.euro("10").div(FinDslNumber.ganzzahl("4"));
            assertValue(z, "2.5", FinDslNumber.Type.Dezimal);
        }

        @Test
        @DisplayName("Division durch Null → FinDslRuntimeError")
        void byZero() {
            assertThrows(FinDslRuntimeError.class,
                () -> FinDslNumber.dezimal("1").div(FinDslNumber.ganzzahl("0")));
        }
    }

    @Nested
    @DisplayName("Typ-Kombination (SPEC § 3.2.3/§ 3.4)")
    class TypeCombination {
        @Test
        @DisplayName("Euro + Cent → präzisere Seite (Cent), Euro-kanonisch")
        void euroPlusCent() {
            // x: Euro = 2; y: Cent = 20 (= 0,20 € kanonisch); x + y → Cent.
            FinDslNumber z = FinDslNumber.euro("2").add(FinDslNumber.cent("0.2"));
            assertValue(z, "2.2", FinDslNumber.Type.Cent);
            assertEquals("220", z.asText());
        }

        @Test
        @DisplayName("Euro * Dezimal → EuroCent")
        void euroTimesDezimal() {
            FinDslNumber z = FinDslNumber.euro("100").mul(FinDslNumber.dezimal("0.5"));
            assertValue(z, "50", FinDslNumber.Type.EuroCent);
            assertEquals("50,00", z.asText());
        }

        @Test
        @DisplayName("Euro * Ganzzahl → Euro")
        void euroTimesGanzzahl() {
            FinDslNumber z = FinDslNumber.euro("100").mul(FinDslNumber.ganzzahl("3"));
            assertValue(z, "300", FinDslNumber.Type.Euro);
        }

        @Test
        @DisplayName("Prozent * Euro → EuroCent (42 % von 1.000 = 420)")
        void prozentTimesEuro() {
            FinDslNumber z = FinDslNumber.prozent("0.42").mul(FinDslNumber.euro("1000"));
            assertValue(z, "420", FinDslNumber.Type.EuroCent);
        }

        @Test
        @DisplayName("Ganzzahl + Ganzzahl → Ganzzahl")
        void ganzzahlPlus() {
            assertValue(FinDslNumber.ganzzahl("5").add(FinDslNumber.ganzzahl("7")),
                "12", FinDslNumber.Type.Ganzzahl);
        }
    }

    @Nested
    @DisplayName("Euro-kanonische Gleichheit (values.ts compareTo)")
    class Equality {
        @Test
        @DisplayName("1 € == 100 ct (Euro-kanonisch gleich)")
        void oneEuroEqualsHundredCent() {
            // cent("1") ist Euro-kanonisch 1,00 € (= 100 ct).
            assertTrue(FinDslNumber.euro("1").equalsValue(FinDslNumber.cent("1")));
        }

        @Test
        @DisplayName("42 EuroCent == 42 Euro")
        void euroCentEqualsEuro() {
            assertTrue(FinDslNumber.euroCent("42").equalsValue(FinDslNumber.euro("42")));
        }

        @Test
        @DisplayName("1 € ≠ 1 ct")
        void oneEuroNotEqualsOneCent() {
            assertFalse(FinDslNumber.euro("1").equalsValue(FinDslNumber.cent("0.01")));
        }

        @Test
        @DisplayName("compareValue: Ordnung < / = / > (Spiegel valuesCompare)")
        void compareValueOrdnung() {
            assertTrue(FinDslNumber.euro("1").compareValue(FinDslNumber.euro("2")) < 0);
            assertTrue(FinDslNumber.euro("2").compareValue(FinDslNumber.euro("1")) > 0);
            assertEquals(0, FinDslNumber.euro("3").compareValue(FinDslNumber.euro("3")));
        }

        @Test
        @DisplayName("compareValue: art-agnostisch, Euro-kanonisch (1 € = 100 ct)")
        void compareValueArtAgnostisch() {
            assertEquals(0, FinDslNumber.euro("1").compareValue(FinDslNumber.cent("1")));
            assertTrue(FinDslNumber.cent("0.01").compareValue(FinDslNumber.euro("1")) < 0);
        }
    }

    @Nested
    @DisplayName("Skalar-Rundung (interpreter.ts:956-990)")
    class Rounding {
        @Test
        @DisplayName("EuroCent abrunden/aufrunden → Euro")
        void euroCentToEuro() {
            assertValue(FinDslNumber.euroCent("12.34").abrunden(FinDslNumber.Type.Euro), "12", FinDslNumber.Type.Euro);
            assertValue(FinDslNumber.euroCent("12.34").aufrunden(FinDslNumber.Type.Euro), "13", FinDslNumber.Type.Euro);
        }

        @Test
        @DisplayName("EuroCent abrunden → Cent (2 Nachkommastellen)")
        void euroCentToCent() {
            assertValue(FinDslNumber.euroCent("12.349").abrunden(FinDslNumber.Type.Cent), "12.34", FinDslNumber.Type.Cent);
        }

        @Test
        @DisplayName("negativ: FLOOR/CEILING Richtung −∞/+∞ (Risiko R2)")
        void negativeDirection() {
            assertValue(FinDslNumber.euroCent("-12.34").abrunden(FinDslNumber.Type.Euro), "-13", FinDslNumber.Type.Euro);
            assertValue(FinDslNumber.euroCent("-12.34").aufrunden(FinDslNumber.Type.Euro), "-12", FinDslNumber.Type.Euro);
        }

        @Test
        @DisplayName("Prozent: 42,7 % abrunden → 42 %")
        void prozentRounding() {
            FinDslNumber z = FinDslNumber.prozent("0.427").abrunden(FinDslNumber.Type.Prozent);
            assertEquals(FinDslNumber.Type.Prozent, z.type());
            assertEquals("42 %", z.asText());
        }

        @Test
        @DisplayName("Dezimal-Empfänger → Ganzzahl")
        void dezimalToGanzzahl() {
            assertValue(FinDslNumber.dezimal("12.34").abrunden(FinDslNumber.Type.Ganzzahl),
                "12", FinDslNumber.Type.Ganzzahl);
        }
    }

    @Nested
    @DisplayName("Cast & Geld-Annotation (castNumeric / applyMoneyAnnotation)")
    class CastAnnotation {
        @Test
        @DisplayName("nackte Zahl als Cent → ÷100 (Euro-kanonisch)")
        void bareAsCent() {
            FinDslNumber z = FinDslNumber.ganzzahl("1230").cast(FinDslNumber.Type.Cent);
            assertValue(z, "12.3", FinDslNumber.Type.Cent);
            assertEquals("1.230", z.asText());
        }

        @Test
        @DisplayName("Geld → Geld = reiner Typ-Wechsel")
        void moneyToMoney() {
            assertValue(FinDslNumber.euro("5").cast(FinDslNumber.Type.Cent), "5", FinDslNumber.Type.Cent);
        }

        @Test
        @DisplayName("nackte Zahl als Prozent → Bruch (42 → 0,42)")
        void bareAsProzent() {
            assertValue(FinDslNumber.ganzzahl("42").cast(FinDslNumber.Type.Prozent), "0.42", FinDslNumber.Type.Prozent);
        }

        @Test
        @DisplayName("Euro-Annotation: fraktional → FinDslRuntimeError")
        void euroFractionalError() {
            assertThrows(FinDslRuntimeError.class,
                () -> FinDslNumber.euroCent("12.34").withMoneyAnnotation(FinDslNumber.Type.Euro, "x"));
        }

        @Test
        @DisplayName("Euro-Annotation: ganzzahlig → ok")
        void euroIntegralOk() {
            assertValue(FinDslNumber.euroCent("12").withMoneyAnnotation(FinDslNumber.Type.Euro, "x"),
                "12", FinDslNumber.Type.Euro);
        }

        @Test
        @DisplayName("Cent-Annotation: 20 (= 0,20 €) ganzzahlig in ct → ok")
        void centAnnotationOk() {
            FinDslNumber z = FinDslNumber.ganzzahl("20").withMoneyAnnotation(FinDslNumber.Type.Cent, "y");
            assertValue(z, "0.2", FinDslNumber.Type.Cent);
            assertEquals("20", z.asText());
        }
    }

    @Nested
    @DisplayName("Phase-1-Operationen (sub / neg)")
    class Phase1Operationen {
        @Test
        @DisplayName("sub: Euro − Cent → präzisere Seite (Cent)")
        void subTypKombination() {
            FinDslNumber z = FinDslNumber.euro("5").sub(FinDslNumber.cent("0.2"));
            assertValue(z, "4.8", FinDslNumber.Type.Cent);
            assertEquals("480", z.asText());
        }

        @Test
        @DisplayName("sub: Ganzzahl − Ganzzahl → Ganzzahl")
        void subGanzzahl() {
            assertValue(FinDslNumber.ganzzahl("7").sub(FinDslNumber.ganzzahl("2")),
                "5", FinDslNumber.Type.Ganzzahl);
        }

        @Test
        @DisplayName("neg: Vorzeichenwechsel, Typ unverändert")
        void negErhältTyp() {
            assertValue(FinDslNumber.euro("7").neg(), "-7", FinDslNumber.Type.Euro);
            assertValue(FinDslNumber.dezimal("1.5").neg(), "-1.5", FinDslNumber.Type.Dezimal);
            FinDslNumber p = FinDslNumber.prozent("0.42").neg();
            assertValue(p, "-0.42", FinDslNumber.Type.Prozent);
            assertEquals("-42 %", p.asText());
        }
    }

    @Nested
    @DisplayName("Darstellung asText (germanFormat / Tausender / negativ)")
    class Darstellung {
        @Test
        @DisplayName("Euro mit Tausender-Trenner")
        void euroTausender() {
            assertEquals("1.234", FinDslNumber.euro("1234").asText());
        }

        @Test
        @DisplayName("Ganzzahl, mehrere Dreiergruppen")
        void ganzzahlGruppen() {
            assertEquals("1.234.567", FinDslNumber.ganzzahl("1234567").asText());
        }

        @Test
        @DisplayName("Dezimal: Tausender + Dezimaltrenner")
        void dezimalDarstellung() {
            assertEquals("1.234,5", FinDslNumber.dezimal("1234.5").asText());
        }

        @Test
        @DisplayName("negativer Euro-Betrag")
        void negativerBetrag() {
            assertEquals("-1.234", FinDslNumber.euro("-1234").asText());
        }
    }

    @Nested
    @DisplayName("§ 11.6 Grenzwert-/Stufen-Methoden")
    class GrenzwertUndStufen {
        @Test
        @DisplayName("höchstens kappt nach oben (min), Tag bleibt")
        void hoechstensKappt() {
            assertValue(FinDslNumber.euro("100").hoechstens(FinDslNumber.euro("80")),
                "80", FinDslNumber.Type.Euro);
        }

        @Test
        @DisplayName("höchstens lässt kleineren durch")
        void hoechstensDurch() {
            assertValue(FinDslNumber.euro("50").hoechstens(FinDslNumber.euro("80")),
                "50", FinDslNumber.Type.Euro);
        }

        @Test
        @DisplayName("höchstens mit negativen Werten")
        void hoechstensNegativ() {
            assertValue(FinDslNumber.euro("-5").hoechstens(FinDslNumber.euro("-3")),
                "-5", FinDslNumber.Type.Euro);
        }

        @Test
        @DisplayName("mindestens hebt auf Untergrenze (max), Tag EuroCent")
        void mindestensHebt() {
            assertValue(FinDslNumber.euroCent("2").mindestens(FinDslNumber.euroCent("5")),
                "5", FinDslNumber.Type.EuroCent);
        }

        @Test
        @DisplayName("mindestens lässt größeren durch")
        void mindestensDurch() {
            assertValue(FinDslNumber.euroCent("8").mindestens(FinDslNumber.euroCent("5")),
                "8", FinDslNumber.Type.EuroCent);
        }

        @Test
        @DisplayName("mindestens(0) kappt Negatives auf 0 (Nicht-Negativ)")
        void mindestensNichtNegativ() {
            assertValue(FinDslNumber.euro("-7").mindestens(FinDslNumber.euro("0")),
                "0", FinDslNumber.Type.Euro);
        }

        @Test
        @DisplayName("abrundenAuf volle 100, Tag bleibt")
        void abrundenAufVolle100() {
            assertValue(
                FinDslNumber.euroCent("12345.67").abrundenAuf(FinDslNumber.euroCent("100")),
                "12300", FinDslNumber.Type.EuroCent);
        }

        @Test
        @DisplayName("aufrundenAuf volle 100 Richtung +∞")
        void aufrundenAufVolle100() {
            assertValue(
                FinDslNumber.euroCent("12301").aufrundenAuf(FinDslNumber.euroCent("100")),
                "12400", FinDslNumber.Type.EuroCent);
        }

        @Test
        @DisplayName("exaktes Vielfaches bleibt unverändert (ab-/aufrunden)")
        void exaktesVielfaches() {
            assertValue(FinDslNumber.euro("1200").abrundenAuf(FinDslNumber.euro("100")),
                "1200", FinDslNumber.Type.Euro);
            assertValue(FinDslNumber.euro("1200").aufrundenAuf(FinDslNumber.euro("100")),
                "1200", FinDslNumber.Type.Euro);
        }

        @Test
        @DisplayName("negativer Empfänger: abrundenAuf rundet Richtung −∞")
        void abrundenAufNegativ() {
            // floor(-150/100) = floor(-1,5) = -2 → -200 (nicht -100).
            assertValue(FinDslNumber.dezimal("-150").abrundenAuf(FinDslNumber.dezimal("100")),
                "-200", FinDslNumber.Type.Dezimal);
        }

        @Test
        @DisplayName("negativer Empfänger: aufrundenAuf rundet Richtung +∞")
        void aufrundenAufNegativ() {
            // ceil(-150/100) = ceil(-1,5) = -1 → -100.
            assertValue(FinDslNumber.dezimal("-150").aufrundenAuf(FinDslNumber.dezimal("100")),
                "-100", FinDslNumber.Type.Dezimal);
        }

        @Test
        @DisplayName("vielfaches = 0 → FinDslRuntimeError")
        void vielfachesNull() {
            assertThrows(FinDslRuntimeError.class,
                () -> FinDslNumber.euro("100").abrundenAuf(FinDslNumber.euro("0")));
        }
    }
}
