// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

import { FinDslNumber, FinDslRuntimeError } from './findsl-number.js';

/**
 * Unveränderliche FinDSL-Liste (Spiegel `values.ts ListValue` +
 * `interpreter.ts listMethodValue` § 11.2), 1:1-Port von
 * `org.findsl.runtime.FinDslListe`. Bit-genau zum Interpreter-Orakel —
 * eager links-nach-rechts, deterministisch (kein Lazy/Stream).
 *
 * Lambdas sind native TS-Funktionstypen (`(e: E) => R`) statt einer
 * nominalen `FinDslLambda1/2`-Klasse — TS-Funktionstypen sind strukturell,
 * der Emitter reicht native Pfeilfunktionen durch (idiomatisch, kein
 * Wrapper). `enumBereich` braucht keine Reflexion: generierte
 * `enum X { A, B }` haben Wert == Ordinalzahl.
 *
 * `.summe()` folgt der Orakel-Entscheidung D1 (leere Liste → Ganzzahl 0).
 * Defensive Kopie + `Object.freeze` erzwingen echte Wert-Semantik.
 */
export class FinDslListe<E> {
    readonly elements: ReadonlyArray<E>;

    constructor(elements: ReadonlyArray<E>) {
        if (elements === null || elements === undefined) {
            throw new FinDslRuntimeError('FinDslListe: elements ist null.');
        }
        this.elements = Object.freeze([...elements]);
    }

    // --- Konstruktoren / Bereiche -----------------------------------------

    /** Leere Liste (Ziel von `[]<T>`). */
    static empty<E>(): FinDslListe<E> {
        return new FinDslListe<E>([]);
    }

    /** Liste aus den gegebenen Elementen (Ziel von `[e1, e2, …]`). */
    static of<E>(elements: ReadonlyArray<E>): FinDslListe<E> {
        return new FinDslListe<E>(elements);
    }

    /**
     * `a bis b` / `a bis unter b` / `a bis b schritt s` (SPEC § 4.16 /
     * § 11.3) — eager materialisiert. Schritt `null` = 1; Schritt ≤ 0
     * wird abgewiesen (SPEC offen, konservativ wie das Orakel).
     */
    static bereich(
        from: FinDslNumber, to: FinDslNumber, exklusiv: boolean,
        schritt: FinDslNumber | null,
    ): FinDslListe<FinDslNumber> {
        const step = schritt ?? FinDslNumber.ganzzahl('1');
        if (step.compareValue(FinDslNumber.ganzzahl('0')) <= 0) {
            throw new FinDslRuntimeError('Bereich-Schritt muss positiv sein (SPEC § 4.16).');
        }
        const out: FinDslNumber[] = [];
        let cur = from;
        for (;;) {
            const cmp = cur.compareValue(to);
            if (exklusiv ? cmp >= 0 : cmp > 0) break;
            out.push(cur);
            cur = cur.add(step);
        }
        return new FinDslListe(out);
    }

    /**
     * Aufzählungs-Bereich `a bis b` über Enum-Werte (SPEC § 11.3). Bei
     * generierten `enum`-Typen ist der numerische Wert die Ordinalzahl —
     * daher genügt die numerische Iteration ohne Enum-Objekt.
     */
    static enumBereich<E extends number>(
        from: E, to: E, exklusiv: boolean, schritt: FinDslNumber | null,
    ): FinDslListe<E> {
        const step = schritt !== null ? Number(schritt.value) : 1;
        if (step <= 0) {
            throw new FinDslRuntimeError('Bereich-Schritt muss positiv sein (SPEC § 4.16).');
        }
        const out: E[] = [];
        let cur = from as number;
        const end = to as number;
        while (exklusiv ? cur < end : cur <= end) {
            out.push(cur as E);
            cur += step;
        }
        return new FinDslListe<E>(out);
    }

    // --- § 11.2-Methoden ohne Argument ------------------------------------

    /** `.länge` — Elementanzahl als Ganzzahl. */
    laenge(): FinDslNumber {
        return FinDslNumber.ganzzahl(String(this.elements.length));
    }

    /** `.zähle()` — funktional identisch zu `.länge` (Symmetrie zu zaehleMit). */
    zaehle(): FinDslNumber {
        return this.laenge();
    }

    /** `.leer` — true wenn keine Elemente. */
    leer(): boolean {
        return this.elements.length === 0;
    }

    /** `.summe()` — D1: leere Liste → Ganzzahl 0; sonst Reduktion per add. */
    summe(): FinDslNumber {
        if (this.elements.length === 0) {
            return FinDslNumber.ganzzahl('0');                  // D1
        }
        let acc = FinDslListe.alsZahl(this.elements[0]);
        for (let i = 1; i < this.elements.length; i++) {
            acc = acc.add(FinDslListe.alsZahl(this.elements[i]));
        }
        return acc;
    }

    /** `.größtes()` — Maximum per compareValue (wirft bei leerer Liste). */
    groesstes(): FinDslNumber {
        if (this.elements.length === 0) {
            throw new FinDslRuntimeError('Liste.größtes auf leerer Liste (SPEC § 11.2).');
        }
        let best = FinDslListe.alsZahl(this.elements[0]);
        for (let i = 1; i < this.elements.length; i++) {
            const n = FinDslListe.alsZahl(this.elements[i]);
            if (n.compareValue(best) > 0) best = n;
        }
        return best;
    }

    /** `.kleinstes()` — Minimum per compareValue (wirft bei leerer Liste). */
    kleinstes(): FinDslNumber {
        if (this.elements.length === 0) {
            throw new FinDslRuntimeError('Liste.kleinstes auf leerer Liste (SPEC § 11.2).');
        }
        let best = FinDslListe.alsZahl(this.elements[0]);
        for (let i = 1; i < this.elements.length; i++) {
            const n = FinDslListe.alsZahl(this.elements[i]);
            if (n.compareValue(best) < 0) best = n;
        }
        return best;
    }

    /** `.kopf` — erstes Element (wirft bei leerer Liste). */
    kopf(): E {
        if (this.elements.length === 0) {
            throw new FinDslRuntimeError('Liste.kopf auf leerer Liste (SPEC § 11.2).');
        }
        return this.elements[0];
    }

    /**
     * `.rest` — neue Liste ohne das erste Element. TOTAL: leere Liste →
     * leere Liste (KEIN Wurf). Orakel-treu zu `interpreter.ts`
     * (`new ListValue(els.slice(1))`, `[].slice(1) === []`); der
     * Interpreter führt bewusst nur `kopf`/`größtes`/`kleinstes` als
     * werfende Methoden — `rest` ist absichtlich total. (Die Java-Runtime
     * wirft hier abweichend → separater Java↔Orakel-Klärungspunkt.)
     */
    rest(): FinDslListe<E> {
        return new FinDslListe<E>(this.elements.slice(1));
    }

    // --- § 11.2-Methoden mit Argument -------------------------------------

    /** `.enthält(x)` — numerisch per equalsValue, sonst Identität. */
    enthaelt(x: E): boolean {
        for (const e of this.elements) {
            if (e instanceof FinDslNumber && x instanceof FinDslNumber) {
                if (e.equalsValue(x)) return true;
            } else if (e === x) {
                return true;
            }
        }
        return false;
    }

    /** `.bei(i)` / `[i]` — Element bei 0-basiertem Index (wirft out-of-range). */
    bei(i: FinDslNumber): E {
        const idx = Number(i.value);
        if (idx < 0 || idx >= this.elements.length) {
            throw new FinDslRuntimeError(
                `Liste.bei: Index ${idx} außerhalb [0, ${this.elements.length}).`);
        }
        return this.elements[idx];
    }

    /** `.zuordnen(fn)` — eager links-nach-rechts (gleiche Reihenfolge). */
    zuordnen<R>(fn: (e: E) => R): FinDslListe<R> {
        const out: R[] = [];
        for (const e of this.elements) out.push(fn(e));
        return new FinDslListe<R>(out);
    }

    /** `.filtern(p)` — Reihenfolge bewahrt, eager. */
    filtern(p: (e: E) => boolean): FinDslListe<E> {
        const out: E[] = [];
        for (const e of this.elements) {
            if (p(e) === true) out.push(e);
        }
        return new FinDslListe<E>(out);
    }

    /** `.zähle(p)` — Anzahl der Elemente, für die `p` true liefert. */
    zaehleMit(p: (e: E) => boolean): FinDslNumber {
        let count = 0;
        for (const e of this.elements) {
            if (p(e) === true) count++;
        }
        return FinDslNumber.ganzzahl(String(count));
    }

    /** `.zusammenfassen(start, fn)` — Fold/Reduce links-nach-rechts. */
    zusammenfassen<A>(start: A, fn: (akku: A, element: E) => A): A {
        let acc = start;
        for (const e of this.elements) acc = fn(acc, e);
        return acc;
    }

    // --- intern ------------------------------------------------------------

    /** Castet ein Element zu FinDslNumber oder wirft (wie das Orakel). */
    private static alsZahl(e: unknown): FinDslNumber {
        if (e instanceof FinDslNumber) return e;
        throw new FinDslRuntimeError('Liste-Operation auf nicht-numerischer Liste (SPEC § 11.2).');
    }

    /** Technische Darstellung für Logging/Diagnose. */
    toString(): string {
        return `FinDslListe[${this.elements.join(', ')}]`;
    }
}
