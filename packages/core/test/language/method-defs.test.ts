/**
 * Tests für den zentralen Builtin-Methoden-Dispatch-Helper. Beide
 * Funktionen werden von Completion / Hover / Signature-Help / Inlay-Hints
 * geteilt — eine Duplikation der „Welche Methoden gelten auf welchem
 * Empfänger?"-Logik wäre genau die Drift-Quelle, die dieser Helper
 * vermeidet.
 */

import { describe, it, expect } from 'vitest';
import {
    getMethodDefs,
    findMethodDef,
    paramNamesFromSignature,
} from '../../src/language/findsl-method-defs.js';
import {
    TEuro, TCent, TEuroCent,
    TGanzzahl, TDezimal, TProzent,
    TText, TWahrheit, TUnknown,
    TNull,
    type Type,
} from '../../src/language/findsl-types.js';

const TListe = (elem: Type): Type => ({ kind: 'list', element: elem });

describe('getMethodDefs — Dispatch nach Empfängertyp', () => {
    it('EuroCent → § 11.1 Rundung + § 11.6 Grenzwert/Stufen (alle 6 Methoden)', () => {
        const names = getMethodDefs(TEuroCent).map((m) => m.name);
        expect(names).toEqual([
            'abrunden', 'aufrunden',
            'höchstens', 'mindestens',
            'abrundenAuf', 'aufrundenAuf',
        ]);
    });

    it('Dezimal → wie EuroCent (Werte mit Nachkommastellen)', () => {
        expect(getMethodDefs(TDezimal).map((m) => m.name)).toEqual([
            'abrunden', 'aufrunden',
            'höchstens', 'mindestens',
            'abrundenAuf', 'aufrundenAuf',
        ]);
    });

    it('Prozent → wie EuroCent', () => {
        expect(getMethodDefs(TProzent).map((m) => m.name))
            .toContain('abrunden');
    });

    it('Euro → nur § 11.6 (keine Rundung — Euro hat keine Nachkommastellen)', () => {
        const names = getMethodDefs(TEuro).map((m) => m.name);
        expect(names).toEqual(['höchstens', 'mindestens', 'abrundenAuf', 'aufrundenAuf']);
        expect(names).not.toContain('abrunden');
    });

    it('Cent → nur § 11.6 (ganzzahlige Cent)', () => {
        const names = getMethodDefs(TCent).map((m) => m.name);
        expect(names).toEqual(['höchstens', 'mindestens', 'abrundenAuf', 'aufrundenAuf']);
    });

    it('Ganzzahl → nur § 11.6', () => {
        const names = getMethodDefs(TGanzzahl).map((m) => m.name);
        expect(names).toEqual(['höchstens', 'mindestens', 'abrundenAuf', 'aufrundenAuf']);
    });

    it('Liste<Ganzzahl> → § 11.2 Listen-Methoden', () => {
        const names = getMethodDefs(TListe(TGanzzahl)).map((m) => m.name);
        expect(names).toContain('länge');
        expect(names).toContain('zuordnen');
        expect(names).toContain('summe');
    });

    it('Text → § 11.5 Text-Methoden', () => {
        const names = getMethodDefs(TText).map((m) => m.name);
        expect(names).toContain('beginntMit');
        expect(names).toContain('geteiltAn');
        expect(names).toContain('alsGroßbuchstaben');
    });

    it('Nullable-Empfänger wird transparent unwrapped (Liste<T>? → § 11.2)', () => {
        const names = getMethodDefs(TNull(TListe(TGanzzahl))).map((m) => m.name);
        expect(names).toContain('länge');
    });

    it('Wahrheitswert → leer (keine Builtin-Methoden)', () => {
        expect(getMethodDefs(TWahrheit)).toEqual([]);
    });

    it('unknown → leer (kein Hover-Rauschen bei Teil-Parse)', () => {
        expect(getMethodDefs(TUnknown)).toEqual([]);
    });
});

describe('findMethodDef — Convenience-Lookup', () => {
    it('findet bekannte Methode', () => {
        const def = findMethodDef(TEuro, 'höchstens');
        expect(def?.name).toBe('höchstens');
        expect(def?.signature).toMatch(/grenze/);
    });

    it('liefert undefined für unbekannte Methode auf passendem Typ', () => {
        expect(findMethodDef(TEuro, 'wasAuchImmer')).toBeUndefined();
    });

    it('liefert undefined für Methode, die auf dem Typ nicht gilt', () => {
        // `.abrunden` gibt es nicht auf Euro (keine Nachkommastellen)
        expect(findMethodDef(TEuro, 'abrunden')).toBeUndefined();
    });

    it('Liste-Methode findet sich auf Liste<T>', () => {
        expect(findMethodDef(TListe(TGanzzahl), 'zuordnen')?.name).toBe('zuordnen');
    });
});

describe('paramNamesFromSignature — Signatur-String → Parameter-Namen', () => {
    it('einfaches einstelliges Argument', () => {
        expect(paramNamesFromSignature('(grenze: T) -> T')).toEqual(['grenze']);
    });

    it('zweistellig (Fold) — Lambda-Argument mit eingebetteten Kommata', () => {
        // `zusammenfassen(start: A, f: (A, T) -> A) -> A` darf NICHT
        // an dem inneren `(A, T)`-Komma splitten.
        expect(paramNamesFromSignature('(start: A, f: (A, T) -> A) -> A'))
            .toEqual(['start', 'f']);
    });

    it('optionaler Parameter (Listen-`zähle`)', () => {
        expect(paramNamesFromSignature('([p: (T) -> Wahrheitswert]) -> Ganzzahl'))
            .toEqual(['p']);
    });

    it('leere Argumentliste', () => {
        expect(paramNamesFromSignature('() -> T')).toEqual([]);
    });

    it('Property-Signatur ohne Klammern → leer', () => {
        expect(paramNamesFromSignature('Ganzzahl')).toEqual([]);
    });

    it('Liste<T>-Resultat bricht den Parameter-Parser nicht', () => {
        expect(paramNamesFromSignature('(trenner: Text) -> Liste<Text>'))
            .toEqual(['trenner']);
    });
});
