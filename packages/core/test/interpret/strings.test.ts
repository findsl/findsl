/**
 * Tests für Multi-Line-Strings und Interpolation:
 *   - `parseStringLiteral` (Tokenwert-Zerlegung in parts/slots)
 *   - `parseSlotPath` (CallChain-artige Slot-Form)
 *   - Interpreter-Eval mit Single-Line + Multi-Line + Slots
 *   - Type-Checker-Diagnosen für Slot-Probleme
 */

import { describe, it, expect } from 'vitest';
import { parseSlotPath, parseStringLiteral } from '../../src/interpret/values.js';
import { interpretProgram } from '../../src/interpret/interpreter.js';
import { typeCheckProgram } from '../../src/language/findsl-types.js';
import { parseSource } from '../helpers/parse.js';
import type { StringValue } from '../../src/interpret/values.js';

describe('parseStringLiteral', () => {
    it('Single-Line ohne Slots', () => {
        const { parts, slots } = parseStringLiteral('hallo');
        expect(parts).toEqual(['hallo']);
        expect(slots).toEqual([]);
    });

    it('Single-Line mit einem Slot', () => {
        const { parts, slots } = parseStringLiteral('Hallo ${name}!');
        expect(parts).toEqual(['Hallo ', '!']);
        expect(slots).toEqual(['name']);
    });

    it('Multi-Line erkennt die doppelten Quotes', () => {
        // Langium liefert """drei""" als ""drei""
        const { parts, slots } = parseStringLiteral('""drei\nzeilen""');
        expect(parts).toEqual(['drei\nzeilen']);
        expect(slots).toEqual([]);
    });

    it('Multi-Line mit Slot', () => {
        const { parts, slots } = parseStringLiteral('""Hi ${a}\nund ${b}""');
        expect(parts).toEqual(['Hi ', '\nund ', '']);
        expect(slots).toEqual(['a', 'b']);
    });

    it('Mehrere Slots ergänzen sich zu parts.length === slots.length + 1', () => {
        const { parts, slots } = parseStringLiteral('${a}+${b}+${c}');
        expect(slots).toEqual(['a', 'b', 'c']);
        expect(parts).toEqual(['', '+', '+', '']);
    });

    it('Nicht geschlossener Slot bleibt Literal-Text', () => {
        const { parts, slots } = parseStringLiteral('abc ${unclosed');
        expect(slots).toEqual([]);
        expect(parts[0]).toContain('${unclosed');
    });
});

describe('parseSlotPath', () => {
    it('Einfacher Identifier', () => {
        expect(parseSlotPath('name')).toEqual(['name']);
    });

    it('Field-Chain mit Whitespace', () => {
        expect(parseSlotPath(' person . adresse . straße ')).toEqual(['person', 'adresse', 'straße']);
    });

    it('Wirft bei Operatoren im Slot', () => {
        expect(() => parseSlotPath('a + b')).toThrow(/nur einfache Identifier/);
    });

    it('Wirft bei Funktions-Aufruf', () => {
        expect(() => parseSlotPath('f(x)')).toThrow(/nur einfache Identifier/);
    });
});

describe('Interpreter: Strings', () => {
    it('Single-Line ohne Slots', async () => {
        const program = await parseSource('modul m\nkonst R: Text = "hallo"\n');
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as StringValue).value).toBe('hallo');
    });

    it('Single-Line mit Identifier-Slot', async () => {
        const program = await parseSource(`modul m
konst name: Text = "Anna"
konst R: Text = "Hallo \${name}!"
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as StringValue).value).toBe('Hallo Anna!');
    });

    it('Single-Line mit Field-Chain', async () => {
        const program = await parseSource(`modul m
datensatz Person(name: Text, alter: Ganzzahl)
konst P: Person = Person(name = "Bob", alter = 42)
konst R: Text = "\${P.name} (\${P.alter})"
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as StringValue).value).toBe('Bob (42)');
    });

    it('Verschachtelter Field-Zugriff', async () => {
        const program = await parseSource(`modul m
datensatz Adresse(stadt: Text)
datensatz Person(adresse: Adresse)
konst P: Person = Person(adresse = Adresse(stadt = "Berlin"))
konst R: Text = "Wohnt in \${P.adresse.stadt}."
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as StringValue).value).toBe('Wohnt in Berlin.');
    });

    it('Multi-Line bewahrt Zeilenumbrüche und interpoliert', async () => {
        const program = await parseSource(`modul m
konst name: Text = "Erna"
konst bescheid: Text = """
Sehr geehrte:r \${name},

Mit freundlichen Grüßen.
"""
`);
        const mod = interpretProgram(program);
        const v = (mod.env.lookup('bescheid') as StringValue).value;
        expect(v).toContain('Sehr geehrte:r Erna,');
        expect(v).toContain('\n\nMit freundlichen Grüßen.');
    });

    it('Numerische Werte werden stringifiziert (ohne JSON-Quotes)', async () => {
        const program = await parseSource(`modul m
konst x: Ganzzahl = 42
konst R: Text = "Wert: \${x}"
`);
        const mod = interpretProgram(program);
        expect((mod.env.lookup('R') as StringValue).value).toBe('Wert: 42');
    });

    it('Unbekannter Slot-Identifier wirft InterpretError', async () => {
        const program = await parseSource(`modul m
konst R: Text = "x = \${unbekannt}"
`);
        expect(() => interpretProgram(program)).toThrow(/Unbekannter Identifier "unbekannt"/);
    });

    it('Komplexer Slot wird abgelehnt', async () => {
        const program = await parseSource(`modul m
konst a: Ganzzahl = 1
konst b: Ganzzahl = 2
konst R: Text = "Summe \${a + b}"
`);
        expect(() => interpretProgram(program)).toThrow(/nur einfache Identifier-Ketten/);
    });
});

describe('Type-Checker: String-Slots', () => {
    async function typecheck(source: string): Promise<string[]> {
        const program = await parseSource(source);
        const msgs: string[] = [];
        typeCheckProgram(program, (_node, message) => msgs.push(message));
        return msgs;
    }

    it('Bekannter Identifier — keine Diagnose', async () => {
        const msgs = await typecheck(`modul m
konst name: Text = "Anna"
konst R: Text = "Hallo \${name}"
`);
        expect(msgs).toEqual([]);
    });

    it('Unbekannter Identifier — Diagnose', async () => {
        const msgs = await typecheck(`modul m
konst R: Text = "x=\${nichtDa}"
`);
        expect(msgs.some((m) => /Unbekannter Identifier "nichtDa"/.test(m))).toBe(true);
    });

    it('Feld nicht im Datensatz — Diagnose', async () => {
        const msgs = await typecheck(`modul m
datensatz Pt(x: Ganzzahl)
konst P: Pt = Pt(1)
konst R: Text = "\${P.unbekannt}"
`);
        expect(msgs.some((m) => /Feld "unbekannt" nicht in Datensatz Pt/.test(m))).toBe(true);
    });

    it('Field-Chain auf Nicht-Datensatz — Diagnose', async () => {
        const msgs = await typecheck(`modul m
konst zahl: Ganzzahl = 5
konst R: Text = "\${zahl.feld}"
`);
        expect(msgs.some((m) => /"zahl".*kein Datensatz/.test(m))).toBe(true);
    });

    it('Datensatz-Wert im Slot ohne Field-Zugriff — Diagnose', async () => {
        const msgs = await typecheck(`modul m
datensatz Pt(x: Ganzzahl)
konst P: Pt = Pt(1)
konst R: Text = "\${P}"
`);
        expect(msgs.some((m) => /Datensatz-Werte können nicht.*interpoliert/.test(m))).toBe(true);
    });

    it('Komplexer Slot — Diagnose', async () => {
        const msgs = await typecheck(`modul m
konst R: Text = "\${a + b}"
`);
        expect(msgs.some((m) => /nur einfache Identifier-Ketten/.test(m))).toBe(true);
    });
});
