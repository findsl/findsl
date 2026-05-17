/**
 * TDD-RED → GREEN: Typannotationen setzen zur Laufzeit die Geld-Einheit
 * (wie ein `als <Typ>`-Cast). Entscheidung 2026-05-16 (Nutzer): kehrt die
 * frühere „Annotation taggt nicht"-Konvention um.
 *
 * Soll (SPEC § 3.2 / § 3.4, P3):
 *   - `var x: Euro = 2`  → Euro, kanonisch 2.0
 *   - `var y: Cent = 20` → Cent, kanonisch 0.20  (20 ct = 0,20 €)
 *   - `x + y`            → präzisere Seite Cent, kanonisch 2.20 → „220"
 *   - Euro/Cent-getypte Bindung mit nicht-ganzzahligem Ergebnis → Fehler
 *     (explizite Rundung nötig, SPEC § 3.2.2).
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { interpretProgram } from '../../src/interpret/interpreter.js';
import { valueToString, type NumericValue } from '../../src/interpret/values.js';
import { InterpretError } from '../../src/interpret/values.js';

/** Wertet die Top-Level-Konstante `R` aus und liefert den Laufzeitwert. */
async function evalR(source: string): Promise<NumericValue> {
    const program = await parseSource(source);
    const mod = interpretProgram(program);
    const v = mod.env.lookup('R');
    if (!v) throw new Error('R nicht definiert');
    if (v.kind !== 'numeric') throw new Error(`erwartet numeric, war ${v.kind}`);
    return v as NumericValue;
}

/** Deutsche Ausgabe des Werts gemäß seinem Geld-Tag. */
function shown(v: NumericValue): string {
    return valueToString(v);
}

describe('Geld: Typannotation setzt Einheit (Bug-1-Fix)', () => {
    it('var: Euro + Cent → einheitenkorrekt 220 ct (nicht 22)', async () => {
        const v = await evalR(
            '--\nx\n--\n'
            + 'fn demo(): Cent {\n'
            + '  var x: Euro = 2\n'
            + '  var y: Cent = 20\n'
            + '  var z: Cent = x + y\n'
            + '  z\n'
            + '}\n'
            + '@Quelle("t")\nkonst R: Cent = demo()\n',
        );
        expect(v.tag).toBe('Cent');
        expect(v.value.toString()).toBe('2.2');     // Euro-kanonisch
        expect(shown(v)).toBe('220');               // 2 € + 20 ct = 220 ct
    });

    it('konst: Euro + Cent ebenso einheitenkorrekt', async () => {
        const v = await evalR(
            '--\nx\n--\n'
            + '@Quelle("a")\nkonst A: Euro = 2\n'
            + '@Quelle("b")\nkonst B: Cent = 20\n'
            + '@Quelle("r")\nkonst R: Cent = A + B\n',
        );
        expect(shown(v)).toBe('220');
    });

    it('Parameter-Annotation taggt: g(20) mit p: Cent → 20 ct', async () => {
        const v = await evalR(
            '--\nx\n--\n'
            + 'fn g(p: Cent): Cent = p\n'
            + '@Quelle("r")\nkonst R: Cent = g(20)\n',
        );
        expect(v.tag).toBe('Cent');
        expect(v.value.toString()).toBe('0.2');     // 20 ct = 0,20 €
        expect(shown(v)).toBe('20');
    });

    it('reiner Euro-Betrag bleibt ganzzahlig und korrekt', async () => {
        const v = await evalR(
            '--\nx\n--\n'
            + '@Quelle("a")\nkonst A: Euro = 2\n'
            + '@Quelle("r")\nkonst R: Euro = A + 3\n',
        );
        expect(v.tag).toBe('Euro');
        expect(shown(v)).toBe('5');                 // 2 € + 3 = 5 €
    });
});

describe('Geld: Euro/Cent-Ganzzahligkeit auch bei berechneten Werten (Bug-2-Fix)', () => {
    it('fraktionaler Cent aus Division → Laufzeitfehler', async () => {
        await expect(evalR(
            '--\nx\n--\n'
            + '@Quelle("r")\nkonst R: Cent = 5 / 2\n',
        )).rejects.toThrow(InterpretError);
    });

    it('ganzzahliger berechneter Cent bleibt erlaubt', async () => {
        const v = await evalR(
            '--\nx\n--\n'
            + '@Quelle("a")\nkonst A: Cent = 100\n'
            + '@Quelle("b")\nkonst B: Cent = 120\n'
            + '@Quelle("r")\nkonst R: Cent = A + B\n',
        );
        expect(shown(v)).toBe('220');
    });
});
