/**
 * Phase-0-Smoke für den Java-Codegen (Issue #7) — Node-CI, kein JDK
 * (ADR10 Stufe 1: IR-/Java-Text-Determinismus).
 *
 * Sichert: der Pretty-Printer-Kern und der Java-Emitter sind reine,
 * **byte-deterministische** Funktionen (Risiko R9), die Phase-0-Pipe
 * parse→lower→emit liefert eine kompilierbare leere Klasse, und die
 * Zielsprachen-Validierung greift.
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import {
    render, concat, text, line, indent,
} from '../../src/codegen/emit/doc.js';
import { lowerProgram } from '../../src/codegen/lower/lower.js';
import { emitJavaModule } from '../../src/codegen/emit-java/emitter.js';
import { istUnterstuetzteSprache } from '../../src/codegen/index.js';

describe('Doc-Pretty-Printer (deterministisch)', () => {
    it('rendert Einrückung/Zeilen stabil und doppellauf-identisch', () => {
        const doc = concat(
            text('class A {'),
            indent(concat(line, text('int x;'))),
            line, text('}'),
        );
        const a = render(doc);
        const b = render(doc);
        expect(a).toBe(b);
        expect(a).toBe('class A {\n    int x;\n}');
    });

    it('respektiert eine andere Einrückungseinheit', () => {
        const doc = concat(text('{'), indent(concat(line, text('a'))), line, text('}'));
        expect(render(doc, { indentUnit: '  ' })).toBe('{\n  a\n}');
    });

    it('zwei unabhängig gebaute, strukturgleiche Docs rendern identisch', () => {
        const build = () => concat(
            text('class A {'),
            indent(concat(line, text('int x;'))),
            line, text('}'),
        );
        // Keine Referenzidentität, keine geteilte Instanz — sichert
        // Determinismus stärker ab als der Doppellauf auf demselben Objekt.
        expect(render(build())).toBe(render(build()));
    });
});

describe('Java-Emitter (Phase 0)', () => {
    it('emittiert eine kompilierbare leere final class, doppellauf-identisch', () => {
        const ir = { javaPackage: 'org.findsl.generated', className: 'Kst', decls: [] };
        const out1 = emitJavaModule(ir);
        const out2 = emitJavaModule(ir);
        expect(out1).toBe(out2);
        expect(out1).toContain('package org.findsl.generated;');
        expect(out1).toContain('public final class Kst {');
        expect(out1).toContain('private Kst() {}');
        // Strukturzusicherung: genau eine öffnende/schließende Klassenklammer.
        expect((out1.match(/\{/g) ?? []).length).toBe((out1.match(/\}/g) ?? []).length);
    });
});

describe('lowerProgram (Phase-0-Kontrakt)', () => {
    it('liefert ein Modulgerüst mit leerer Deklarationsliste', async () => {
        const program = await parseSource('konst X: Euro = 1\n');
        const ir = lowerProgram(program, {
            javaPackage: 'org.findsl.generated',
            className: 'M',
        });
        expect(ir.javaPackage).toBe('org.findsl.generated');
        expect(ir.className).toBe('M');
        expect(ir.decls).toEqual([]);
    });
});

describe('Zielsprachen-Validierung', () => {
    it('akzeptiert java, lehnt geplante/unbekannte Sprachen ab', () => {
        expect(istUnterstuetzteSprache('java')).toBe(true);
        expect(istUnterstuetzteSprache('ts')).toBe(false);
        expect(istUnterstuetzteSprache('js')).toBe(false);
        expect(istUnterstuetzteSprache('go')).toBe(false);
    });
});
