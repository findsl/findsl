// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

import java.util.ArrayList;
import java.util.List;
import java.util.Objects;

/**
 * Unveränderliche FinDSL-Liste als {@code record} (Spiegel
 * {@code values.ts ListValue} + {@code interpreter.ts listMethodValue}
 * § 11.2), konsistent zu {@link FinDslNumber}.
 *
 * <p>Phase 2 portiert genau die von {@code examples/est} genutzten
 * Methoden (KISS/YAGNI): {@code .länge} → {@link #laenge()},
 * {@code .summe()} → {@link #summe()}, {@code .zuordnen(fn)} →
 * {@link #zuordnen(FinDslLambda1)}. Weitere § 11.2-Methoden folgen
 * bedarfsgetrieben.
 *
 * <p>Eager links-nach-rechts (kein {@code Stream}) — deterministisch und
 * exakt wie der Interpreter ({@code els.map}). {@code .summe()} folgt der
 * Orakel-Entscheidung D1 (leere Liste → {@code Ganzzahl 0}).
 *
 * <p>Der kompakte Konstruktor erzwingt eine defensive, unveränderliche
 * Kopie ({@code List.copyOf}) → echte Wert-Semantik. Das record-erzeugte
 * {@link #equals(Object)} ist komponentenbasiert ({@code List.equals},
 * elementweise {@code equals}); FinDSL-Wertgleichheit von Listen
 * (rekursives {@code valuesEqual}) ist in Phase 2 nicht erforderlich
 * (est vergleicht keine Listen).
 *
 * @param <E>      Elementtyp ({@link FinDslNumber} oder ein Datensatz-Record).
 * @param elements unveränderliche Elementliste (defensive Kopie).
 */
public record FinDslListe<E>(List<E> elements) {

    /** Kanonisch: defensive, unveränderliche Kopie (fail-fast gegen null). */
    public FinDslListe {
        elements = List.copyOf(Objects.requireNonNull(elements, "elements"));
    }

    /**
     * Leere Liste (Spiegel {@code new ListValue([])}, interpreter.ts:319)
     * — Ziel von {@code []<T>}.
     *
     * @param <E> Elementtyp.
     * @return leere {@link FinDslListe}.
     */
    /**
     * {@code a bis b} bzw. {@code a bis unter b} bzw.
     * {@code a bis b schritt s} (SPEC § 4.16 / § 11.3) — eager
     * materialisierter Bereich als {@link FinDslListe}.
     *
     * <p><b>Designentscheidung (#44):</b> Bereiche werden in FinDSL
     * fast immer für kleine Wertebereiche genutzt (Steuerklassen,
     * Skalen) → eager als Liste ist KISS, alle § 11.2-Methoden
     * funktionieren ohne Spiegel-Pflege. Lazy {@code FinDslBereich}-
     * Klasse wäre Overkill.
     *
     * @param from      Startwert (inklusiv).
     * @param to        Endwert.
     * @param exklusiv  {@code true} → {@code to} NICHT enthalten
     *                  (`bis unter`-Variante).
     * @param schritt   Schrittweite ({@code null} = 1; bei Aufzählungen
     *                  steht Schrittweite v1.0-offen → hier numerisch).
     * @return materialisierte {@link FinDslListe} der Bereichswerte.
     */
    /**
     * Aufzählungs-Bereich `a bis b` über Enum-Werte (SPEC § 11.3,
     * #44 Aufzählungs-Bereich). Nutzt {@link Enum#ordinal()} zur
     * Reihenfolge — die Reihenfolge im FinDSL-`aufzählung`-Block
     * bestimmt also die Bereich-Iteration (Spiegel des Interpreter-
     * Verhaltens).
     *
     * @param <E>       Enum-Typ.
     * @param enumClass {@code Steuerklasse.class} o. ä.
     * @param from      Startwert (inklusiv).
     * @param to        Endwert.
     * @param exklusiv  `true` → `to` NICHT enthalten.
     * @param schritt   Schrittweite (Ganzzahl, `null` = 1).
     * @return materialisierte {@link FinDslListe} der Enum-Werte.
     */
    public static <E extends Enum<E>> FinDslListe<E> enumBereich(
            Class<E> enumClass, E from, E to, boolean exklusiv, FinDslNumber schritt) {
        int step = schritt != null ? Integer.parseInt(schritt.asText()) : 1;
        if (step <= 0) {
            throw new FinDslRuntimeError(
                "Bereich-Schritt muss positiv sein (SPEC § 4.16).");
        }
        E[] all = enumClass.getEnumConstants();
        List<E> out = new ArrayList<>();
        int cur = from.ordinal();
        int end = to.ordinal();
        while (exklusiv ? cur < end : cur <= end) {
            out.add(all[cur]);
            cur += step;
        }
        return new FinDslListe<>(out);
    }

    public static FinDslListe<FinDslNumber> bereich(
            FinDslNumber from, FinDslNumber to, boolean exklusiv, FinDslNumber schritt) {
        FinDslNumber step = schritt != null ? schritt : FinDslNumber.ganzzahl("1");
        List<FinDslNumber> out = new ArrayList<>();
        FinDslNumber cur = from;
        // Spiegel des Interpreter-Verhaltens: Lauf solange cur <= to
        // (bzw. cur < to bei exklusiv). Negative Schritte würden nie
        // terminieren → SPEC offen, hier konservativ: Schritt > 0.
        if (step.compareValue(FinDslNumber.ganzzahl("0")) <= 0) {
            throw new FinDslRuntimeError(
                "Bereich-Schritt muss positiv sein (SPEC § 4.16).");
        }
        while (true) {
            int cmp = cur.compareValue(to);
            if (exklusiv ? cmp >= 0 : cmp > 0) {
                break;
            }
            out.add(cur);
            cur = cur.add(step);
        }
        return new FinDslListe<>(out);
    }

    public static <E> FinDslListe<E> empty() {
        return new FinDslListe<>(List.of());
    }

    /**
     * Liste aus den gegebenen Elementen (Spiegel {@code new
     * ListValue(items)}) — Ziel von {@code [e1, e2, …]}.
     *
     * @param <E>      Elementtyp.
     * @param elements Elemente in Quellreihenfolge.
     * @return {@link FinDslListe} mit diesen Elementen.
     */
    public static <E> FinDslListe<E> of(List<E> elements) {
        return new FinDslListe<>(elements);
    }

    /**
     * {@code .länge} (SPEC § 11.2, interpreter.ts:893): Elementanzahl als
     * {@code Ganzzahl}.
     *
     * @return Anzahl der Elemente als {@link FinDslNumber} ({@code Ganzzahl}).
     */
    public FinDslNumber laenge() {
        return FinDslNumber.ganzzahl(String.valueOf(elements.size()));
    }

    /**
     * {@code .zuordnen(fn)} (SPEC § 11.2, interpreter.ts:906-908): wendet
     * {@code fn} eager links-nach-rechts auf jedes Element an.
     *
     * @param <R> Ergebnis-Elementtyp.
     * @param fn  Abbildungs-Lambda (Closure).
     * @return neue {@link FinDslListe} der Ergebnisse (gleiche Reihenfolge).
     */
    public <R> FinDslListe<R> zuordnen(FinDslLambda1<E, R> fn) {
        List<R> out = new ArrayList<>(elements.size());
        for (E e : elements) {
            out.add(fn.apply(e));
        }
        return new FinDslListe<>(out);
    }

    /**
     * {@code .summe()} (SPEC § 11.2, interpreter.ts:922-926): Summe aller
     * Elemente. <b>D1:</b> leere Liste → {@code Ganzzahl 0} (NICHT
     * {@code Euro 0}); sonst Reduktion per {@link FinDslNumber#add}
     * (Ergebnis-Art = {@code combineAddSub}, exakt wie {@code numericArith}).
     *
     * <p>Nur für {@code FinDslListe<FinDslNumber>} sinnvoll; ein nicht-
     * numerisches Element löst — wie das Orakel — einen
     * {@link FinDslRuntimeError} aus.
     *
     * @return Summe als {@link FinDslNumber}.
     */
    public FinDslNumber summe() {
        if (elements.isEmpty()) {
            return FinDslNumber.ganzzahl("0");                  // D1
        }
        FinDslNumber acc = alsZahl(elements.get(0));
        for (int i = 1; i < elements.size(); i++) {
            acc = acc.add(alsZahl(elements.get(i)));
        }
        return acc;
    }

    /**
     * {@code .leer} (SPEC § 11.2): true wenn die Liste keine Elemente hat.
     *
     * @return {@code true} bei leerer Liste, sonst {@code false}.
     */
    public boolean leer() {
        return elements.isEmpty();
    }

    /**
     * {@code .enthält(x)} (SPEC § 11.2): true wenn {@code x} als
     * Element vorkommt. Vergleich per {@link FinDslNumber#equalsValue}
     * für numerische Elemente (bit-genau zum Interpreter), sonst per
     * {@link java.util.Objects#equals}.
     *
     * @param x das zu suchende Element.
     * @return {@code true} bei Treffer, sonst {@code false}.
     */
    public boolean enthaelt(E x) {
        for (E e : elements) {
            if (e instanceof FinDslNumber n && x instanceof FinDslNumber xn) {
                if (n.equalsValue(xn)) {
                    return true;
                }
            } else if (java.util.Objects.equals(e, x)) {
                return true;
            }
        }
        return false;
    }

    /**
     * {@code .filtern(p)} (SPEC § 11.2, interpreter.ts §11.2): liefert
     * eine neue Liste mit allen Elementen, für die {@code p} {@code true}
     * zurückgibt (Reihenfolge bewahrt, eager).
     *
     * @param p Prädikat-Lambda; muss {@link Boolean} zurückgeben.
     * @return neue gefilterte {@link FinDslListe}.
     */
    public FinDslListe<E> filtern(FinDslLambda1<E, Boolean> p) {
        List<E> out = new ArrayList<>(elements.size());
        for (E e : elements) {
            if (Boolean.TRUE.equals(p.apply(e))) {
                out.add(e);
            }
        }
        return new FinDslListe<>(out);
    }

    /**
     * {@code .größtes()} (SPEC § 11.2): Maximum aller Elemente per
     * {@link FinDslNumber#compareValue}. Wirft bei leerer Liste oder
     * nicht-numerischen Elementen (wie das Orakel).
     *
     * @return größtes Element als {@link FinDslNumber}.
     */
    public FinDslNumber groesstes() {
        if (elements.isEmpty()) {
            throw new FinDslRuntimeError(
                "Liste.größtes auf leerer Liste (SPEC § 11.2).");
        }
        FinDslNumber best = alsZahl(elements.get(0));
        for (int i = 1; i < elements.size(); i++) {
            FinDslNumber n = alsZahl(elements.get(i));
            if (n.compareValue(best) > 0) {
                best = n;
            }
        }
        return best;
    }

    /**
     * {@code .kleinstes()} (SPEC § 11.2): Minimum aller Elemente per
     * {@link FinDslNumber#compareValue}. Wirft bei leerer Liste oder
     * nicht-numerischen Elementen (wie das Orakel).
     *
     * @return kleinstes Element als {@link FinDslNumber}.
     */
    public FinDslNumber kleinstes() {
        if (elements.isEmpty()) {
            throw new FinDslRuntimeError(
                "Liste.kleinstes auf leerer Liste (SPEC § 11.2).");
        }
        FinDslNumber best = alsZahl(elements.get(0));
        for (int i = 1; i < elements.size(); i++) {
            FinDslNumber n = alsZahl(elements.get(i));
            if (n.compareValue(best) < 0) {
                best = n;
            }
        }
        return best;
    }

    /**
     * {@code .kopf} (SPEC § 11.2): erstes Element. Wirft bei leerer
     * Liste (wie das Orakel).
     *
     * @return erstes Element.
     * @throws FinDslRuntimeError bei leerer Liste.
     */
    public E kopf() {
        if (elements.isEmpty()) {
            throw new FinDslRuntimeError(
                "Liste.kopf auf leerer Liste (SPEC § 11.2).");
        }
        return elements.get(0);
    }

    /**
     * {@code .rest} (SPEC § 11.2): neue Liste ohne das erste Element.
     * Total — auf leerer Liste die leere Liste (orakel-treu: der
     * Interpreter liefert {@code [].slice(1) === []}, kein Wurf; § 11.2
     * nennt für {@code .rest} — anders als {@code .kopf} — keinen Fehlerfall).
     *
     * @return Liste ohne erstes Element (leer → leer).
     */
    public FinDslListe<E> rest() {
        if (elements.isEmpty()) {
            return new FinDslListe<>(new ArrayList<>());
        }
        return new FinDslListe<>(new ArrayList<>(elements.subList(1, elements.size())));
    }

    /**
     * {@code .bei(i)} bzw. {@code [i]} (SPEC § 11.2): Element bei
     * 0-basiertem Index. Index wird als {@link FinDslNumber} übergeben
     * (Spiegel des Interpreter-Verhaltens — Ganzzahl, exakt). Wirft
     * bei Index out of range.
     *
     * @param i 0-basierter Index.
     * @return Element bei Position {@code i}.
     * @throws FinDslRuntimeError bei ungültigem Index.
     */
    public E bei(FinDslNumber i) {
        int idx = Integer.parseInt(i.asText());
        if (idx < 0 || idx >= elements.size()) {
            throw new FinDslRuntimeError(
                "Liste.bei: Index " + idx + " außerhalb [0, " + elements.size() + ").");
        }
        return elements.get(idx);
    }

    /**
     * {@code .zähle()} (SPEC § 11.2): Anzahl aller Elemente. Funktional
     * identisch zu {@link #laenge()}, aber als eigene Methode für die
     * Symmetrie zur Predikat-Form {@link #zaehleMit}.
     *
     * @return Anzahl als {@link FinDslNumber} ({@code Ganzzahl}).
     */
    public FinDslNumber zaehle() {
        return laenge();
    }

    /**
     * {@code .zähle(p)} (SPEC § 11.2): Anzahl der Elemente, für die
     * {@code p} {@code true} zurückgibt.
     *
     * @param p Prädikat-Lambda.
     * @return Anzahl Treffer als {@link FinDslNumber} ({@code Ganzzahl}).
     */
    public FinDslNumber zaehleMit(FinDslLambda1<E, Boolean> p) {
        long count = 0;
        for (E e : elements) {
            if (Boolean.TRUE.equals(p.apply(e))) {
                count++;
            }
        }
        return FinDslNumber.ganzzahl(String.valueOf(count));
    }

    /**
     * {@code .zusammenfassen(start, fn)} (SPEC § 11.2 — Fold/Reduce):
     * läuft eager links-nach-rechts über die Elemente und akkumuliert
     * mit der zweistelligen Reduktionsfunktion. Bit-genauer Spiegel
     * des Interpreters.
     *
     * @param <A>   Akkumulator-Typ.
     * @param start Startwert.
     * @param fn    Reduktionsfunktion {@code (akku, element) -> neuer akku}.
     * @return Endakkumulator.
     */
    public <A> A zusammenfassen(A start, FinDslLambda2<A, E, A> fn) {
        A acc = start;
        for (E e : elements) {
            acc = fn.apply(acc, e);
        }
        return acc;
    }

    /**
     * Castet ein Element zu {@link FinDslNumber} oder wirft (wie das
     * Orakel bei nicht-numerischer Liste).
     *
     * @param e Listenelement.
     * @return das Element als {@link FinDslNumber}.
     * @throws FinDslRuntimeError bei nicht-numerischem Element.
     */
    private static FinDslNumber alsZahl(Object e) {
        if (e instanceof FinDslNumber n) {
            return n;
        }
        throw new FinDslRuntimeError(
            "Liste.summe auf nicht-numerischer Liste (SPEC § 11.2).");
    }

    /**
     * Technische Darstellung für Logging/Diagnose.
     *
     * @return {@code FinDslListe[…]} mit den Elementen.
     */
    @Override
    public String toString() {
        return "FinDslListe" + elements;
    }
}
