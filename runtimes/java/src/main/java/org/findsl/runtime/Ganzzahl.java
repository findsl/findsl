// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

import java.math.BigDecimal;

/**
 * Sprechender Domänen-Sicht-Typ `Ganzzahl` — eine {@link FinDslNumber}
 * (IS-A: erbt die gesamte bit-genaue Arithmetik/Cast/Rundung/Text-
 * Semantik). KEIN Eigenverhalten, KEIN eigenes Tag: der TATSÄCHLICHE
 * Laufzeit-Tag bleibt im geerbten {@code type}-Feld; {@code Ganzzahl} ist
 * nur die an Deklarationsgrenzen (fn-Param/-Rückgabe, {@code record}-
 * Feld, {@code konst}) sichtbare Sicht. Arithmetik auf einem {@code Ganzzahl}
 * liefert wieder eine {@link FinDslNumber} (Obertyp) — Boxing zurück
 * zur Sicht erfolgt ausschließlich an Schreibgrenzen via {@link #von}.
 */
public final class Ganzzahl extends FinDslNumber {

    /** Paket-privat: Instanzen entstehen über {@link #von}. */
    Ganzzahl(BigDecimal value, Type type) {
        super(value, type);
    }

    /**
     * Typ-System-Adapter an einer Schreibgrenze (fn-Rückgabe/{@code
     * record}-Feld/{@code konst}/geld-getyptes Aufruf-Argument):
     * materialisiert aus einem berechneten Obertyp-Wert eine als
     * {@code Ganzzahl} <b>getypte</b> Instanz.
     *
     * <p><b>Etikettiert nur — konvertiert NICHT.</b> Wert UND der
     * TATSÄCHLICHE Laufzeit-Tag des Kerns bleiben unverändert (z. B.
     * bleibt das Tag {@code Cent} nach {@code Euro − Cent} erhalten,
     * auch wenn die Sicht {@code Ganzzahl} ist). Die Methode prüft den Tag
     * NICHT und wirft NICHT.
     *
     * <p>Die etwaige echte Zahlart-Konvertierung (Skalierung/Tag-
     * Wechsel/Geld-Validierung) steht — orakel-treu — bereits im
     * <i>übergebenen Ausdruck</i> ({@code .cast(Type.Ganzzahl)} /
     * {@code .withMoneyAnnotation(Type.Ganzzahl,…)} /
     * {@code .abrunden(Type.Ganzzahl)}), 1:1 gespiegelt vom Interpreter
     * ({@code castNumeric}/{@code applyMoneyAnnotation}). Eine
     * konvertierende {@code von} würde vom Interpreter abweichen, der
     * eine fn-Rückgabe NICHT zwangskonvertiert (Bit-Genauigkeit).
     *
     * <p>Konsequenz: der Java-Typ {@code Ganzzahl} ist ein API-Sicht-Etikett
     * für Lesbarkeit/Audit, KEINE Laufzeit-Garantie über das Tag.
     * Tag-tragende Semantik ({@code asText}, weitere {@code combine*},
     * {@link FinDslNumber#equalsValue}) nutzt stets den bewahrten
     * echten Tag → identisch zum Interpreter.
     *
     * @param kern der zu etikettierende Rechenwert (nie {@code null}).
     * @return die {@code Ganzzahl}-Sicht desselben Werts/Tags.
     */
    public static Ganzzahl von(FinDslNumber kern) {
        return new Ganzzahl(kern.value(), kern.type());
    }

    /**
     * Sprechender Konstruktions-Helfer — delegiert an die bit-genaue
     * Factory {@link FinDslNumber#ganzzahl(String)} (Tag {@link Type#Ganzzahl}).
     * Im Unterschied zu {@link #von(FinDslNumber)} <i>erzeugt</i> dies
     * einen Wert (mit Tag {@link Type#Ganzzahl}), statt einen vorhandenen
     * nur zu etikettieren.
     *
     * @param wert Dezimalstring (Punkt als Dezimaltrenner).
     * @return ein {@code Ganzzahl} mit dem geparsten Wert.
     */
    public static Ganzzahl von(String wert) {
        return von(FinDslNumber.ganzzahl(wert));
    }
}
