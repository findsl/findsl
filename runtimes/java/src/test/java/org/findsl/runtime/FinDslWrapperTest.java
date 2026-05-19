// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * M1-Gate (Variante C): die sprechenden Sicht-Subtypen ({@link Euro}…)
 * sind {@link FinDslNumber} (IS-A, kein Auspacken). {@code von(…)} ist
 * eine REINE Sicht — Wert UND tatsächlicher Tag bleiben unverändert
 * (Bit-Genauigkeit); die gesamte Arithmetik/Vergleich/Text-Semantik
 * wird vom Obertyp geerbt und ist unangetastet.
 */
class FinDslWrapperTest {

    @Nested
    @DisplayName("Sicht-Subtyp IST-EIN FinDslNumber (kein Unboxing)")
    class IstEin {

        @Test
        @DisplayName("von(kern) bewahrt Wert UND tatsächlichen Tag")
        void vonBewahrtWertUndTag() {
            // Tag Cent (z. B. Ergebnis von Euro − Cent), Sicht Euro:
            FinDslNumber kern = FinDslNumber.cent("2");
            Euro e = Euro.von(kern);
            assertEquals(0, e.value().compareTo(kern.value()));
            assertEquals(FinDslNumber.Type.Cent, e.type());     // NICHT auf Euro gezwungen
            assertTrue(e instanceof FinDslNumber);
        }

        @Test
        @DisplayName("Arithmetik direkt auf der Sicht (geerbt), liefert Obertyp")
        void arithmetikGeerbt() {
            Euro a = Euro.von(FinDslNumber.euro("100"));
            FinDslNumber summe = a.add(FinDslNumber.cent("0.50"));   // kein .zahl()
            assertEquals(0, summe.value().compareTo(new java.math.BigDecimal("100.5")));
            assertEquals(FinDslNumber.Type.Cent, summe.type());      // combineAddSub
        }

        @Test
        @DisplayName("von(String) delegiert an die bit-genaue Factory")
        void vonStringFactory() {
            assertEquals(FinDslNumber.prozent("0.15"), Prozent.von("0.15"));
            assertEquals(FinDslNumber.Type.Euro, Euro.von("5000").type());
        }

        @Test
        @DisplayName("null-Kern → fail-fast")
        void nullKernWirft() {
            assertThrows(NullPointerException.class,
                    () -> Euro.von((FinDslNumber) null));
        }

        @Test
        @DisplayName("asText() wird tag-korrekt vom Obertyp geerbt")
        void asTextGeerbt() {
            FinDslNumber k = FinDslNumber.cent("2");        // 200 ct
            assertEquals(k.asText(), Cent.von(k).asText());
            assertEquals("200", Cent.von(k).asText());
        }
    }

    @Nested
    @DisplayName("Gleichheit: FinDSL-== via equalsValue (tag-agnostisch)")
    class Gleichheit {

        @Test
        @DisplayName("2 € == 200 ct (equalsValue, skalen-/tag-unabhängig)")
        void zweiEuroGleichZweihundertCent() {
            assertTrue(Euro.von(FinDslNumber.euro("2"))
                    .equalsValue(Cent.von(FinDslNumber.cent("2"))));
        }

        @Test
        @DisplayName("equals (Wert+Tag, skalen-sensitiv) wie früher record")
        void equalsKomponentenbasiert() {
            // equalsValue ist die FinDSL-Gleichheit; .equals ist Wert+Tag.
            assertEquals(FinDslNumber.euro("2"), FinDslNumber.euro("2"));
            assertNotEquals(FinDslNumber.euro("2"), FinDslNumber.cent("2"));
            assertTrue(FinDslNumber.euro("2").equalsValue(FinDslNumber.cent("2")));
        }
    }
}
