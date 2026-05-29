/**
 * TDD-RED: Euro-kanonische Geldsemantik zur Laufzeit (SPEC § 3.2 / § 3.4).
 *
 * Soll-Modell: Jeder Geldwert speichert seine Zahl intern IMMER in Euro.
 *   - `als Euro`     → Wert unverändert,  Tag `Euro`
 *   - `als EuroCent` → Wert unverändert,  Tag `EuroCent`  (Euro-Skala)
 *   - `als Cent`     → Wert ÷ 100,        Tag `Cent`      (1 ct = 0,01 €)
 * Damit sind Vergleich/`+`/`-` rein wertbasiert AUTOMATISCH korrekt, und
 * die Invariante „ein `Euro`-getaggter Wert ist ganzzahlig" hält, weil
 * bruchproduzierende Operationen `EuroCent`/`Dezimal` ergeben (§ 3.2.3,
 * § 3.4): `Geld*Prozent`/`Geld*Dezimal → EuroCent`, `Geld/Ganzzahl →
 * Dezimal`, `Geld±Geld → präzisere Seite`.
 *
 * Diese Tests sind ABSICHTLICH ROT gegen den aktuellen Stand (Runtime
 * kennt kein Cent/EuroCent, Casts sind No-Ops, Vergleich ist einheiten-
 * blind). Phase 2 (GREEN) macht sie grün.
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { interpretProgram } from '../../src/interpret/interpreter.js';
import { InterpretError } from '../../src/interpret/values.js';
import type { NumericValue, Value } from '../../src/interpret/values.js';

/** Wertet `expr` als Modul-Konstante R aus und liefert den Laufzeitwert. */
async function evalR(expr: string): Promise<Value> {
    const program = await parseSource(`modul m\nkonst R: Dezimal = ${expr}\n`);
    const mod = interpretProgram(program);
    const v = mod.env.lookup('R');
    if (!v) throw new Error('R nicht definiert');
    return v;
}

async function num(expr: string): Promise<NumericValue> {
    const v = await evalR(expr);
    if (v.kind !== 'numeric') throw new Error(`erwartet numeric, war ${v.kind}`);
    return v;
}

async function boolOf(expr: string): Promise<boolean> {
    const v = await evalR(expr);
    if (v.kind !== 'bool') throw new Error(`erwartet bool, war ${v.kind}`);
    return v.value;
}

/** Wertet `expr` als `konst R: <annot>` aus — die Geld-Annotation greift. */
async function evalAnnotated(annot: string, expr: string): Promise<NumericValue> {
    const program = await parseSource(`modul m\nkonst R: ${annot} = ${expr}\n`);
    const mod = interpretProgram(program);
    const v = mod.env.lookup('R');
    if (!v || v.kind !== 'numeric') throw new Error('R nicht numerisch');
    return v;
}

/** Erwartet, dass die Geld-Annotation `annot` den Wert von `expr` ablehnt. */
async function expectAnnotationRejects(annot: string, expr: string): Promise<void> {
    const program = await parseSource(`modul m\nkonst R: ${annot} = ${expr}\n`);
    expect(() => interpretProgram(program)).toThrow(InterpretError);
}

describe('Geld — Cast skaliert & taggt (Euro-kanonisch)', () => {
    it('`1 als Euro` → Tag Euro, Wert 1', async () => {
        const v = await num('1 als Euro');
        expect(v.tag).toBe('Euro');
        expect(v.value.toString()).toBe('1');
    });

    it('`1 als Cent` → Tag Cent, Wert 0.01 (1 ct = 0,01 €)', async () => {
        const v = await num('1 als Cent');
        expect(v.tag).toBe('Cent');
        expect(v.value.toString()).toBe('0.01');
    });

    it('`250 als Cent` → Tag Cent, Wert 2.5', async () => {
        const v = await num('250 als Cent');
        expect(v.tag).toBe('Cent');
        expect(v.value.toString()).toBe('2.5');
    });

    it('`42.42 als EuroCent` → Tag EuroCent, Wert 42.42', async () => {
        const v = await num('42,42 als EuroCent');
        expect(v.tag).toBe('EuroCent');
        expect(v.value.toString()).toBe('42.42');
    });
});

describe('Geld — einheitenbewusster Vergleich', () => {
    it('(1 als Euro) == (1 als Cent) → falsch (1 € ≠ 1 ct)', async () => {
        expect(await boolOf('(1 als Euro) == (1 als Cent)')).toBe(false);
    });

    it('(100 als Cent) == (1 als Euro) → wahr (100 ct = 1 €)', async () => {
        expect(await boolOf('(100 als Cent) == (1 als Euro)')).toBe(true);
    });

    it('(42 als EuroCent) == (42 als Euro) → wahr (§ 3.2.2 implizite Konversion)', async () => {
        expect(await boolOf('(42 als EuroCent) == (42 als Euro)')).toBe(true);
    });

    it('(150 als Cent) == (1.5 als EuroCent) → wahr', async () => {
        expect(await boolOf('(150 als Cent) == (1,5 als EuroCent)')).toBe(true);
    });
});

describe('Geld — Arithmetik-Ergebnis-Tags (SPEC § 3.2.3 / § 3.4)', () => {
    it('Geld * Prozent → EuroCent (Wert in Euro korrekt)', async () => {
        const v = await num('(100 als Euro) * 42%');
        expect(v.tag).toBe('EuroCent');
        expect(v.value.toString()).toBe('42');
    });

    it('Geld * Dezimal → EuroCent', async () => {
        const v = await num('(100 als Euro) * 1,5');
        expect(v.tag).toBe('EuroCent');
        expect(v.value.toString()).toBe('150');
    });

    it('Geld / Ganzzahl → Dezimal', async () => {
        const v = await num('(100 als Euro) / 4');
        expect(v.tag).toBe('Dezimal');
        expect(v.value.toString()).toBe('25');
    });

    it('Euro + Euro → Euro (ganzzahlig)', async () => {
        const v = await num('(40 als Euro) + (2 als Euro)');
        expect(v.tag).toBe('Euro');
        expect(v.value.toString()).toBe('42');
    });

    it('Euro + Cent → präzisere Seite = Cent, Wert 1.5 €', async () => {
        const v = await num('(1 als Euro) + (50 als Cent)');
        expect(v.tag).toBe('Cent');
        expect(v.value.toString()).toBe('1.5');
    });
});

describe('Geld — Euro-Ganzzahligkeits-Invariante', () => {
    it('Prozent * Euro mit Bruch ⇒ Tag EuroCent (NICHT Euro mit 42.42)', async () => {
        const v = await num('42% * (101 als Euro)');
        expect(v.tag).toBe('EuroCent');
        expect(v.value.toString()).toBe('42.42');
    });

    it('kein Euro-getaggter Wert trägt Nachkommastellen', async () => {
        const v = await num('42% * (101 als Euro)');
        if (v.tag === 'Euro') {
            expect(v.value.isInteger()).toBe(true);
        }
        expect(v.tag).not.toBe('Euro');
    });
});

describe('Geld — Annotation erzwingt Euro/Cent-Ganzzahligkeit, EuroCent ungeprüft', () => {
    // → EuroCent 0,0425 (Sub-Cent-Präzision: weder ganzer Euro noch ganzer Cent).
    const subCent = '(1 als Euro) * 4,25%';

    it('`: EuroCent` akzeptiert fraktionalen Wert ungeprüft (präzise Mitte)', async () => {
        const v = await evalAnnotated('EuroCent', subCent);
        expect(v.tag).toBe('EuroCent');
        expect(v.value.toString()).toBe('0.0425');
    });

    it('`: Euro` lehnt nicht-ganzzahligen Euro-Wert ab (explizite Rundung nötig)', async () => {
        await expectAnnotationRejects('Euro', subCent);
    });

    it('`: Cent` lehnt Sub-Cent-Wert ab (×100 nicht ganzzahlig)', async () => {
        await expectAnnotationRejects('Cent', subCent);
    });

    it('`: Euro` akzeptiert ganzzahligen Euro-Wert', async () => {
        const v = await evalAnnotated('Euro', '(40 als Euro) + (2 als Euro)');
        expect(v.tag).toBe('Euro');
        expect(v.value.toString()).toBe('42');
    });

    it('`: Cent` akzeptiert ganz-Cent-Wert (50 ct)', async () => {
        const v = await evalAnnotated('Cent', '(1 als Euro) * 50%');
        expect(v.tag).toBe('Cent');
        expect(v.value.toString()).toBe('0.5');
    });
});
