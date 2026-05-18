/**
 * Codegen-Tests (Issue #7) — Node-CI, kein JDK (ADR10 Stufe 1:
 * IR-/Java-Text-Determinismus + Lowering-Korrektheit).
 *
 * Phase 0: Pretty-Printer-Determinismus + Sprach-Validierung.
 * Phase 1: AST→IR-Lowering + Java-Emission für den kst-Konstruktsatz —
 * Objekt-Form (Instanzmethoden), `_`→protected, lowerCamel-Methoden,
 * FinDSL-Doc/`@Quelle`→Javadoc, byte-deterministisch. Bit-Genauigkeit
 * gegen das Orakel sichert separat `codegen:difftest` (JDK).
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
        expect(render(doc)).toBe(render(doc));
        expect(render(doc)).toBe('class A {\n    int x;\n}');
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
        expect(render(build())).toBe(render(build()));
    });
});

const KST = `--
# Test-Modul

Datei-Doc → Klassen-Javadoc.
--

-- Steuersatz (§ 23 Abs. 1). --
@Quelle("§ 23 KStG")
konst SATZ: Prozent = 15%

konst FREIBETRAG: Euro = 5.000

aufzählung Ausschluss { Keiner, Nr1 }

fn _Hilfe(einkommen: Euro): Euro = wähle {
    falls einkommen <= 0 -> 0
    sonst -> FREIBETRAG
}

fn Wahl(jahr: Ganzzahl, a: Ausschluss): Prozent = wähle (a) {
    falls Keiner -> SATZ
    falls Nr1 -> SATZ
}

--
Steuerbetrag, auf volle Euro abgerundet.

@param zve   Bemessungsgrundlage.
@rückgabe  Betrag (§ 31 Satz 2).
--
@Quelle("§ 23 Absatz 1 KStG")
fn Betrag(zve: Euro, jahr: Ganzzahl): Euro = wähle {
    falls zve <= 0 -> 0
    sonst -> (zve * SATZ).abrunden()
}
`;

describe('Lowering + Java-Emission (Phase 1, kst-Konstruktsatz)', () => {
    it('lowert konst/aufzählung/fn in Quellreihenfolge', async () => {
        const program = await parseSource(KST);
        const ir = lowerProgram(program, { javaPackage: 'com.x', className: 'M' });
        expect(ir.decls.map((d) => d.kind)).toEqual(
            ['konst', 'konst', 'enum', 'fn', 'fn', 'fn'],
        );
    });

    it('emittiert deterministisch korrektes Java-21 (Objekt-Form)', async () => {
        const program = await parseSource(KST);
        const ctx = { javaPackage: 'com.x', className: 'M' };
        // Zweimal UNABHÄNGIG lowern+emittieren — deckt auch den
        // Registry-/Map-Aufbau im Lowering ab (echter Determinismus).
        const out1 = emitJavaModule(lowerProgram(program, ctx));
        const out2 = emitJavaModule(lowerProgram(await parseSource(KST), ctx));
        expect(out1).toBe(out2);                                    // byte-deterministisch

        expect(out1).toContain('package com.x;');                   // --package
        // @Generated-Markierung jeder generierten Klasse:
        expect(out1).toContain('import javax.annotation.processing.Generated;');
        expect(out1).toMatch(
            /@Generated\(value = "findsl\.Generator"\)\npublic final class M \{/,
        );
        // Objekt-Form: instanziierbar, KEIN privater Konstruktor.
        expect(out1).not.toContain(`private M()`);
        expect(out1).toContain('public final class M {');
        // Prozent-/Euro-Literal + applyMoneyAnnotation-Delegation:
        expect(out1).toContain('FinDslNumber.prozent("0.15")');
        expect(out1).toContain(
            'FinDslNumber.ganzzahl("5000").withMoneyAnnotation(FinDslNumber.Type.Euro,',
        );
        expect(out1).toContain('public enum Ausschluss {');
        // `_`-intern → protected, Methodenname lowerCamel, KEIN static:
        expect(out1).toMatch(/\n {4}protected FinDslNumber _hilfe\(/);
        expect(out1).not.toContain('static FinDslNumber');
        // Java-Namenskonvention: erster Buchstabe klein.
        expect(out1).toContain('public FinDslNumber wahl(');
        expect(out1).toContain('public FinDslNumber betrag(');
        // wähle → if/return, Enum-`==`, Endwurf, governingMoneyTarget:
        expect(out1).toContain('if (einkommen.compareValue(FinDslNumber.ganzzahl("0")) <= 0) {');
        expect(out1).toContain('if (a == Ausschluss.Keiner) {');
        expect(out1).toContain('throw new FinDslRuntimeError(');
        expect(out1).toContain('.abrunden(FinDslNumber.Type.Euro)');
        // Kommentar-Übertragung: Datei-Doc → Klassen-Javadoc;
        // Decl-Doc + @rückgabe→@return + @Quelle → Member-Javadoc.
        expect(out1).toContain('Datei-Doc → Klassen-Javadoc.');
        expect(out1).toContain(' * @Quelle § 23 KStG');
        expect(out1).toContain('Steuerbetrag, auf volle Euro abgerundet.');
        expect(out1).toContain(' * @param zve');
        expect(out1).toContain(' * @return  Betrag (§ 31 Satz 2).');
        expect(out1).toContain(' * @Quelle § 23 Absatz 1 KStG');
        expect((out1.match(/\{/g) ?? []).length).toBe((out1.match(/\}/g) ?? []).length);
    });
});

describe('Zielsprachen-Validierung', () => {
    it('akzeptiert java, lehnt geplante/unbekannte Sprachen ab', () => {
        expect(istUnterstuetzteSprache('java')).toBe(true);
        expect(istUnterstuetzteSprache('ts')).toBe(false);
        expect(istUnterstuetzteSprache('go')).toBe(false);
    });
});
