// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.math.BigDecimal;
import java.util.List;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Phase-2-Gate: {@link FinDslListe} ist bit-genau zum Interpreter
 * (Orakel {@code interpreter.ts listMethodValue} § 11.2). Sollwerte
 * handgerechnet aus der Orakel-Semantik.
 */
class FinDslListeTest {

    private static void assertValue(FinDslNumber z, String plain, FinDslNumber.Type typ) {
        assertEquals(0, z.value().compareTo(new BigDecimal(plain)),
            "Wert: erwartet " + plain + ", war " + z.value().toPlainString());
        assertEquals(typ, z.type(), "Typ");
    }

    @Nested
    @DisplayName("Konstruktion / länge")
    class Konstruktion {
        @Test
        @DisplayName("empty().länge → Ganzzahl 0")
        void leerLaenge() {
            assertValue(FinDslListe.<FinDslNumber>empty().laenge(), "0", FinDslNumber.Type.Ganzzahl);
        }

        @Test
        @DisplayName("of([…]).länge → Elementanzahl (Ganzzahl)")
        void laenge() {
            FinDslListe<FinDslNumber> l = FinDslListe.of(List.of(
                FinDslNumber.euro("1"), FinDslNumber.euro("2"), FinDslNumber.euro("3")));
            assertValue(l.laenge(), "3", FinDslNumber.Type.Ganzzahl);
        }

        @Test
        @DisplayName("unveränderlich — externe Listenänderung wirkt nicht")
        void unveraenderlich() {
            var src = new java.util.ArrayList<>(List.of(FinDslNumber.euro("1")));
            FinDslListe<FinDslNumber> l = new FinDslListe<>(src);
            src.add(FinDslNumber.euro("9"));
            assertValue(l.laenge(), "1", FinDslNumber.Type.Ganzzahl);
        }
    }

    @Nested
    @DisplayName("summe (D1 + combineAddSub)")
    class Summe {
        @Test
        @DisplayName("leere Liste → Ganzzahl 0 (D1, NICHT Euro)")
        void leerSummeIstGanzzahl() {
            assertValue(FinDslListe.<FinDslNumber>empty().summe(), "0", FinDslNumber.Type.Ganzzahl);
        }

        @Test
        @DisplayName("Euro + Euro → Euro")
        void summeEuro() {
            FinDslListe<FinDslNumber> l = FinDslListe.of(List.of(
                FinDslNumber.euro("2000"), FinDslNumber.euro("3000"), FinDslNumber.euro("500")));
            assertValue(l.summe(), "5500", FinDslNumber.Type.Euro);
        }

        @Test
        @DisplayName("EuroCent + EuroCent → EuroCent")
        void summeEuroCent() {
            FinDslListe<FinDslNumber> l = FinDslListe.of(List.of(
                FinDslNumber.euroCent("1.50"), FinDslNumber.euroCent("2.25")));
            assertValue(l.summe(), "3.75", FinDslNumber.Type.EuroCent);
        }

        @Test
        @DisplayName("nicht-numerische Liste → FinDslRuntimeError")
        void summeNichtNumerisch() {
            FinDslListe<String> l = FinDslListe.of(List.of("x", "y"));
            assertThrows(FinDslRuntimeError.class, l::summe);
        }
    }

    @Nested
    @DisplayName("zuordnen (eager map + Closure)")
    class Zuordnen {
        @Test
        @DisplayName("eager L→R; Euro * Prozent → EuroCent, dann summe")
        void zuordnenSumme() {
            FinDslListe<FinDslNumber> betraege = FinDslListe.of(List.of(
                FinDslNumber.euro("1000"), FinDslNumber.euro("2000")));
            FinDslNumber satz = FinDslNumber.prozent("0.5");          // Closure-Capture
            FinDslListe<FinDslNumber> anteile = betraege.zuordnen(b -> b.mul(satz));
            assertValue(anteile.laenge(), "2", FinDslNumber.Type.Ganzzahl);
            // 1000*50% + 2000*50% = 500 + 1000 = 1500, Art EuroCent
            assertValue(anteile.summe(), "1500", FinDslNumber.Type.EuroCent);
        }

        @Test
        @DisplayName("Reihenfolge bleibt erhalten")
        void reihenfolge() {
            FinDslListe<FinDslNumber> l = FinDslListe.of(List.of(
                FinDslNumber.ganzzahl("1"), FinDslNumber.ganzzahl("2"), FinDslNumber.ganzzahl("3")));
            FinDslListe<FinDslNumber> q = l.zuordnen(n -> n.mul(FinDslNumber.ganzzahl("10")));
            assertTrue(q.elements().get(0).equalsValue(FinDslNumber.ganzzahl("10")));
            assertTrue(q.elements().get(2).equalsValue(FinDslNumber.ganzzahl("30")));
        }
    }
}
