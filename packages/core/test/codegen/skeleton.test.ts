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
import { lowerProgram, lowerTestProgram } from '../../src/codegen/lower/lower.js';
import { emitJavaModuleFiles, emitJavaTestModule } from '../../src/codegen/emit-java/emitter.js';
import {
    istUnterstuetzteSprache,
    sanitizePackageSegment, derivePackage, deriveClassName, isTestFile,
} from '../../src/codegen/index.js';

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

    it('emittiert deterministisch Interface + Impl (Java-21)', async () => {
        const program = await parseSource(KST);
        const ctx = { javaPackage: 'com.x', className: 'M' };
        // Zweimal UNABHÄNGIG lowern+emittieren — deckt auch den
        // Registry-/Map-Aufbau im Lowering ab (echter Determinismus).
        const a = emitJavaModuleFiles(lowerProgram(program, ctx));
        const b = emitJavaModuleFiles(lowerProgram(await parseSource(KST), ctx));
        expect(a).toEqual(b);                                       // byte-deterministisch
        const { interfaceCode: iface, implCode: impl } = a;

        // --- Interface: Package, @Generated, newInstance, Konstanten,
        //     enum, öffentliche Signaturen (KEIN Rumpf), Javadoc ---
        expect(iface).toContain('package com.x;');
        expect(iface).toContain('import javax.annotation.processing.Generated;');
        expect(iface).toMatch(
            /@Generated\(value = "findsl\.Generator"\)\npublic interface M \{/,
        );
        expect(iface).toContain('static M newInstance() {');
        expect(iface).toContain('return new MImpl();');
        expect(iface).toContain('FinDslNumber.prozent("0.15")');     // konst SATZ
        expect(iface).toContain(
            'FinDslNumber.ganzzahl("5000").withMoneyAnnotation(FinDslNumber.Type.Euro,',
        );
        expect(iface).toContain('public enum Ausschluss {');
        expect(iface).toContain('    FinDslNumber wahl(');           // Signatur, kein public
        expect(iface).toContain('    FinDslNumber betrag(');
        expect(iface).not.toContain('protected FinDslNumber _hilfe('); // intern nicht im Interface
        expect(iface).not.toContain('return einkommen');             // kein Rumpf im Interface
        // Kommentar-Übertragung steht im Interface:
        expect(iface).toContain('Datei-Doc → Klassen-Javadoc.');
        expect(iface).toContain(' * @Quelle § 23 KStG');
        expect(iface).toContain('Steuerbetrag, auf volle Euro abgerundet.');
        expect(iface).toContain(' * @param zve');
        expect(iface).toContain(' * @return  Betrag (§ 31 Satz 2).');
        expect(iface).toContain(' * @Quelle § 23 Absatz 1 KStG');

        // --- Impl: paket-private Klasse, @Override, protected `_`,
        //     Rümpfe; KEINE Konstanten/Enums, kein privater Ctor ---
        expect(impl).toMatch(/@Generated[^\n]*\nclass MImpl implements M \{/);
        expect(impl).not.toContain('private MImpl()');
        expect(impl).toContain('@Override');
        expect(impl).toContain('public FinDslNumber wahl(');
        expect(impl).toContain('public FinDslNumber betrag(');
        expect(impl).toMatch(/\n {4}protected FinDslNumber _hilfe\(/);
        expect(impl).not.toContain('static FinDslNumber');
        expect(impl).toContain('if (einkommen.compareValue(FinDslNumber.ganzzahl("0")) <= 0) {');
        expect(impl).toContain('if (a == Ausschluss.Keiner) {');
        expect(impl).toContain('throw new FinDslRuntimeError(');
        expect(impl).toContain('.abrunden(FinDslNumber.Type.Euro)');
        expect(impl).not.toContain('public enum Ausschluss {');      // Typen nur im Interface

        for (const code of [iface, impl]) {
            expect((code.match(/\{/g) ?? []).length)
                .toBe((code.match(/\}/g) ?? []).length);
        }
    });
});

describe('Pfad → Java-Package/Klassenname (ADR8, Phase 3)', () => {
    it('deriveClassName: PascalCase, Trenner -/./_/Leerz., Ziffern-Schutz', () => {
        expect(deriveClassName('kst')).toBe('Kst');
        expect(deriveClassName('est')).toBe('Est');
        expect(deriveClassName('kraftst.test')).toBe('KraftstTest');
        expect(deriveClassName('kraftstg-tarif-leicht')).toBe('KraftstgTarifLeicht');
        expect(deriveClassName('9x')).toBe('_9x');
        expect(deriveClassName('   ')).toBe('_');
    });

    it('sanitizePackageSegment: invalide Zeichen→_, Ziffern-/Keyword-Schutz', () => {
        expect(sanitizePackageSegment('kraftstg-tarif')).toBe('kraftstg_tarif');
        expect(sanitizePackageSegment('2foo')).toBe('_2foo');
        expect(sanitizePackageSegment('class')).toBe('class_');
        expect(sanitizePackageSegment('a.b')).toBe('a_b');
        expect(sanitizePackageSegment('')).toBe('_');
    });

    it('derivePackage: Wurzel→undefined, Segmente saniert+punktiert', () => {
        expect(derivePackage('', '/')).toBeUndefined();
        expect(derivePackage('.', '/')).toBeUndefined();
        expect(derivePackage('sub', '/')).toBe('sub');
        expect(derivePackage('a/b-c', '/')).toBe('a.b_c');
        expect(derivePackage('a\\b', '\\')).toBe('a.b');         // Windows-sep
    });

    it('isTestFile erkennt prüfe-Testdateien', () => {
        expect(isTestFile('kst.test.findsl')).toBe(true);
        expect(isTestFile('kst.findsl')).toBe(false);
    });

    it('javaPackage=undefined → kein package-Statement (unbenanntes Package)', async () => {
        const program = await parseSource(KST);
        const { interfaceCode, implCode } = emitJavaModuleFiles(
            lowerProgram(program, { javaPackage: undefined, className: 'M' }));
        for (const code of [interfaceCode, implCode]) {
            expect(code).not.toMatch(/^package /m);
            expect(code.startsWith('import ')).toBe(true);
        }
    });
});

const X_TYPEN = `aufzählung Art { A, B }
datensatz Sache(x: Ganzzahl)
fn Helfer(n: Ganzzahl): Ganzzahl = n
konst GRENZE: Ganzzahl = 5
`;
const X_NUTZER = `fn Pick(a: Art): Ganzzahl = wähle (a) {
    falls A -> Helfer(1)
    falls B -> Helfer(2)
}
fn EqTest(a: Art): Wahrheitswert = a == A
fn Floated(n: Ganzzahl): Ganzzahl = n + wähle { falls n > 0 -> 1 sonst -> 0 }
fn Build(): Sache = Sache(7)
fn UseKonst(): Ganzzahl = GRENZE
`;

describe('Cross-Modul-Komposition (Phase 3, Inkrement 2)', () => {
    async function lowerNutzer() {
        const typenProg = await parseSource(X_TYPEN);
        const nutzerProg = await parseSource(X_NUTZER);
        const ctx = {
            javaPackage: 'pkg.nutzer',
            className: 'Nutzer',
            imports: [{
                program: typenProg,
                className: 'Typen',
                javaPackage: 'pkg.typen',
                bindings: ['Art', 'A', 'B', 'Sache', 'Helfer', 'GRENZE']
                    .map((n) => ({ localName: n, sourceName: n })),
            }],
        };
        return lowerProgram(nutzerProg, ctx);
    }
    const fn = (ir: ReturnType<typeof lowerProgram>, name: string) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (ir.decls.find((d) => d.kind === 'fn' && d.name === name) as any);

    it('lowert Cross-Symbole korrekt (crossCall/enumVal-owner/ctor/crossRef/enumCmp)', async () => {
        const ir = await lowerNutzer();
        expect(ir.composedModules).toEqual([
            { className: 'Typen', fieldName: 'typen', javaPackage: 'pkg.typen' },
        ]);
        const pick = fn(ir, 'Pick');
        expect(pick.body.expr.kind).toBe('waehle');
        expect(pick.body.expr.arms[0].patterns[0]).toEqual(
            { kind: 'enumVal', enumName: 'Art', value: 'A', ownerClass: 'Typen' });
        expect(pick.body.expr.arms[0].result).toEqual({
            kind: 'crossCall', fieldName: 'typen', methodName: 'Helfer',
            args: [{ kind: 'numLit', factory: 'ganzzahl', arg: '1' }],
        });
        expect(fn(ir, 'EqTest').body.expr).toEqual({
            kind: 'enumCmp', op: '==',
            left: { kind: 'ref', name: 'a' },
            right: { kind: 'enumVal', enumName: 'Art', value: 'A', ownerClass: 'Typen' },
        });
        // `n + wähle{…}` → `wähle` in Ergebnisposition gehoben (P2).
        expect(fn(ir, 'Floated').body.expr.kind).toBe('waehle');
        const build = fn(ir, 'Build').body.expr;
        expect(build.kind).toBe('ctor');
        expect(build.typeName).toBe('Sache');
        expect(build.ownerClass).toBe('Typen');
        expect(fn(ir, 'UseKonst').body.expr).toEqual(
            { kind: 'crossRef', ownerClass: 'Typen', memberName: 'GRENZE' });
        // Cross-Typ-Qualifizierung im Parameter.
        expect(fn(ir, 'Pick').params[0].javaType).toBe('Typen.Art');
    });

    it('emittiert Komposition + qualifizierte Cross-Referenzen + Cross-Package-Import', async () => {
        const { interfaceCode: iface, implCode: impl } =
            emitJavaModuleFiles(await lowerNutzer());
        // Cross-Package-Import in beiden Dateien:
        expect(iface).toContain('import pkg.typen.Typen;');
        expect(impl).toContain('import pkg.typen.Typen;');
        // Komposition hält das Interface, instanziiert via newInstance():
        expect(impl).toContain('private final Typen typen = Typen.newInstance();');
        expect(impl).toContain('typen.helfer(');                    // lowerCamel-Cross-Aufruf
        expect(impl).toContain('a == Typen.Art.A');                 // enumCmp + owner
        expect(impl).toContain('new Typen.Sache(');                 // nested-static ctor
        expect(impl).toContain('Typen.GRENZE');                     // static konst
        expect(impl).toContain('pick(Typen.Art a)');                // @Override-Impl
        expect(iface).toContain('pick(Typen.Art a)');               // qualifizierte Signatur
    });
});

const T_SUT = `fn Doppel(n: Ganzzahl): Ganzzahl = n + n
fn NurPositiv(n: Ganzzahl): Ganzzahl = wähle {
    falls n < 0 -> abbruch("negativ")
    sonst -> n
}
`;
const T_TEST = `prüfe "Doppel-Block" {
    testfall "2*3 → 6" { Doppel(3) == 6 }
    testfall "nicht-falsch ist wahr" { nicht falsch }
    testfall "negativ → abbruch" erwartet abbruch {
        var n: Ganzzahl = -1
        NurPositiv(n)
    }
}
`;

describe('prüfe → JUnit5 (Phase 3, Inkrement 3)', () => {
    async function lowerTest() {
        const sut = await parseSource(T_SUT);
        const test = await parseSource(T_TEST);
        return lowerTestProgram(test, {
            javaPackage: 'kst', className: 'KstTest',
            imports: [{
                program: sut, className: 'Kst', javaPackage: 'kst',
                bindings: ['Doppel', 'NurPositiv']
                    .map((n) => ({ localName: n, sourceName: n })),
            }],
        });
    }

    it('lowert prüfe/testfall (Spiegel runPruefeDecl) + bool/neg/not', async () => {
        const ir = await lowerTest();
        expect(ir.composedModules).toEqual([
            { className: 'Kst', fieldName: 'kst', javaPackage: 'kst' },
        ]);
        expect(ir.suites).toHaveLength(1);
        expect(ir.suites[0].suiteName).toBe('Doppel-Block');
        const [c0, c1, c2] = ir.suites[0].cases;
        expect(c0).toMatchObject({ label: '2*3 → 6', erwartetAbbruch: false, lets: [] });
        expect(c0.assertion.kind).toBe('cmp');
        expect(c1.assertion).toEqual({ kind: 'not', value: { kind: 'bool', value: false } });
        expect(c2.erwartetAbbruch).toBe(true);
        expect(c2.lets[0]).toEqual({
            name: 'n', javaType: 'FinDslNumber',
            expr: { kind: 'neg', value: { kind: 'numLit', factory: 'ganzzahl', arg: '1' } },
        });
        expect(c2.assertion).toEqual({
            kind: 'crossCall', fieldName: 'kst', methodName: 'NurPositiv',
            args: [{ kind: 'ref', name: 'n' }],
        });
    });

    it('emittiert @Nested/@Test/@DisplayName, assertTrue, assertThrows, Komposition', async () => {
        const out = emitJavaTestModule(await lowerTest());
        expect(out).toContain('package kst;');
        expect(out).toContain('import org.junit.jupiter.api.Test;');
        expect(out).toContain('import static org.junit.jupiter.api.Assertions.assertTrue;');
        expect(out).toContain('import static org.junit.jupiter.api.Assertions.assertThrows;');
        expect(out).toContain('private final Kst kst = Kst.newInstance();');
        expect(out).toContain('@Nested');
        expect(out).toContain('@DisplayName("Doppel-Block")');
        expect(out).toContain('@DisplayName("2*3 \\u2192 6")'.replace('\\u2192', '→'));
        expect(out).toContain('void testfall_0() {');
        expect(out).toContain('assertTrue(kst.doppel(');
        expect(out).toContain('assertTrue(!(false))');
        expect(out).toContain('assertThrows(FinDslAbort.class, () -> {');
        expect(out).toContain('final FinDslNumber n = FinDslNumber.ganzzahl("1").neg();');
        expect(out).toContain('kst.nurPositiv(n);');
    });
});

describe('Zielsprachen-Validierung', () => {
    it('akzeptiert java, lehnt geplante/unbekannte Sprachen ab', () => {
        expect(istUnterstuetzteSprache('java')).toBe(true);
        expect(istUnterstuetzteSprache('ts')).toBe(false);
        expect(istUnterstuetzteSprache('go')).toBe(false);
    });
});
