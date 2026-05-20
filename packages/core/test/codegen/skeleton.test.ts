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
        // Konstanten Wrapper-getypt, Kern-Ausdruck geboxt:
        expect(iface).toContain(
            'public static final Prozent SATZ = Prozent.von(FinDslNumber.prozent("0.15"));');
        expect(iface).toContain(
            'public static final Euro FREIBETRAG = Euro.von(FinDslNumber.ganzzahl("5000")'
            + '.withMoneyAnnotation(FinDslNumber.Type.Euro,');
        expect(iface).toContain('public enum Ausschluss {');
        // Sprechende Signaturen (kein `public`, kein Rumpf):
        expect(iface).toContain('    Prozent wahl(Ganzzahl jahr, Ausschluss a);');
        expect(iface).toContain('    Euro betrag(Euro zve, Ganzzahl jahr);');
        expect(iface).not.toContain('_hilfe(');                      // intern nicht im Interface
        expect(iface).not.toContain('return einkommen');             // kein Rumpf im Interface
        // Kommentar-Übertragung steht im Interface:
        expect(iface).toContain('Datei-Doc → Klassen-Javadoc.');
        expect(iface).toContain(' * @Quelle § 23 KStG');
        expect(iface).toContain('Steuerbetrag, auf volle Euro abgerundet.');
        expect(iface).toContain(' * @param zve');
        expect(iface).toContain(' * @return  Betrag (§ 31 Satz 2).');
        expect(iface).toContain(' * @Quelle § 23 Absatz 1 KStG');

        // --- Impl (C): EINE Methode (keine Fassade/_kern), kein
        //     `.zahl()` (Sicht IS-A FinDslNumber), Box NUR an Schreib-
        //     grenzen; interne `_`-fn = Kern (FinDslNumber, protected) ---
        expect(impl).toMatch(/@Generated[^\n]*\nclass MImpl implements M \{/);
        expect(impl).not.toContain('private MImpl()');
        expect(impl).not.toContain('_kern');                         // keine Doppelmethode
        expect(impl).not.toContain('.zahl()');                       // IS-A, kein Unbox
        expect(impl).toContain('public Prozent wahl(Ganzzahl jahr, Ausschluss a) {');
        expect(impl).toContain('public Euro betrag(Euro zve, Ganzzahl jahr) {');
        // Rückgabe an der Ergebnisposition geboxt (Sicht-Adapter):
        expect(impl).toContain('return Prozent.von(SATZ);');
        expect(impl).toMatch(/return Euro\.von\(zve\.mul\(SATZ\)\.abrunden\(FinDslNumber\.Type\.Euro\)\);/);
        // Interne `_`-fn: Kern (FinDslNumber, protected), kein @Override,
        // KEIN Return-Box, konst direkt (IS-A):
        expect(impl).toMatch(/\n {4}protected FinDslNumber _hilfe\(FinDslNumber einkommen\) \{/);
        expect(impl).not.toContain('static FinDslNumber');
        expect(impl).toContain('if (einkommen.compareValue(FinDslNumber.ganzzahl("0")) <= 0) {');
        expect(impl).toContain('return FREIBETRAG;');                // kein .zahl(), kein Box (intern)
        expect(impl).toContain('if (a == Ausschluss.Keiner) {');
        expect(impl).toContain('throw new FinDslRuntimeError(');
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
        // (C): Cross-Arg geboxt (callee-Param `Ganzzahl`), KEIN Unbox
        // (Ergebnis IS-A FinDslNumber); öffentliche `fn` Pick gibt
        // Ganzzahl zurück → Arm-Ergebnis an der Rückgabe geboxt.
        expect(pick.body.expr.arms[0].result).toEqual({
            kind: 'box', wrapper: 'Ganzzahl',
            expr: {
                kind: 'crossCall', fieldName: 'typen', methodName: 'Helfer',
                args: [{
                    kind: 'box', wrapper: 'Ganzzahl',
                    expr: { kind: 'numLit', factory: 'ganzzahl', arg: '1' },
                }],
            },
        });
        expect(fn(ir, 'EqTest').body.expr).toEqual({
            kind: 'enumCmp', op: '==',
            left: { kind: 'ref', name: 'a' },
            right: { kind: 'enumVal', enumName: 'Art', value: 'A', ownerClass: 'Typen' },
        });
        // `n + wähle{…}` → `wähle` in Ergebnisposition gehoben (P2).
        expect(fn(ir, 'Floated').body.expr.kind).toBe('waehle');
        const build = fn(ir, 'Build').body.expr;       // Record-ctor, Arg geboxt
        expect(build.kind).toBe('ctor');
        expect(build.typeName).toBe('Sache');
        expect(build.ownerClass).toBe('Typen');
        expect(build.args[0]).toEqual({
            kind: 'box', wrapper: 'Ganzzahl',
            expr: { kind: 'numLit', factory: 'ganzzahl', arg: '7' },
        });
        // (C): Cross-`konst` direkt lesbar (IS-A); UseKonst gibt
        // Ganzzahl zurück → an der Rückgabe geboxt, KEIN Unbox.
        expect(fn(ir, 'UseKonst').body.expr).toEqual({
            kind: 'box', wrapper: 'Ganzzahl',
            expr: { kind: 'crossRef', ownerClass: 'Typen', memberName: 'GRENZE' },
        });
        // Cross-Typ-Qualifizierung im Parameter (Enum = nicht numerisch).
        expect(fn(ir, 'Pick').params[0].javaType).toBe('Typen.Art');
        expect(fn(ir, 'Pick').params[0].apiType).toBe('Typen.Art');
        expect(fn(ir, 'Pick').params[0].numeric).toBe(false);
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
        // (C): Cross-Aufruf-Arg geboxt (callee-Param `Ganzzahl`); KEIN
        // Unbox (Ergebnis IS-A FinDslNumber). testfall-Ergebnis wird —
        // anders als fn-Rückgaben — NICHT geboxt (kein Sicht-Typ-Ziel).
        expect(c2.assertion).toEqual({
            kind: 'crossCall', fieldName: 'kst', methodName: 'NurPositiv',
            args: [{ kind: 'box', wrapper: 'Ganzzahl', expr: { kind: 'ref', name: 'n' } }],
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
        // (C): Cross-Arg geboxt, KEIN `.zahl()` (IS-A); Abbruch-Statement.
        expect(out).toContain('kst.nurPositiv(Ganzzahl.von(n));');
        expect(out).not.toContain('.zahl()');
    });
});

describe('Zielsprachen-Validierung', () => {
    it('akzeptiert java, lehnt geplante/unbekannte Sprachen ab', () => {
        expect(istUnterstuetzteSprache('java')).toBe(true);
        expect(istUnterstuetzteSprache('ts')).toBe(false);
        expect(istUnterstuetzteSprache('go')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Issue #44 / PR-1 — Codegen-Hotfixes
// ---------------------------------------------------------------------------

describe('Issue #44 — Default-Parameter-Expansion bei lokalem Aufruf', () => {
    const DEFAULT_PARAMS_SRC = `--
# Default-Param-Beispiel
--

fn _Skaliere(n: Ganzzahl, faktor: Ganzzahl = 10): Ganzzahl = n * faktor

fn AufrufOhneDefault(): Ganzzahl = _Skaliere(5, 3)

fn AufrufMitDefault(): Ganzzahl = _Skaliere(n = 5)
`;

    it('lokaler Aufruf ohne Default-Argument expandiert den Default aus der FunktionDecl', async () => {
        const program = await parseSource(DEFAULT_PARAMS_SRC);
        const ir = lowerProgram(program, { javaPackage: 'test', className: 'M' });
        const { implCode: impl } = emitJavaModuleFiles(ir);
        // Mit Default: muss BEIDE Argumente liefern, nicht nur n
        expect(impl).toMatch(/aufrufMitDefault\(\)\s*\{[^}]*_skaliere\(\s*FinDslNumber\.ganzzahl\("5"\)\s*,\s*FinDslNumber\.ganzzahl\("10"\)\s*\)/s);
        // Ohne Default (alle Args explizit): unverändert
        expect(impl).toMatch(/aufrufOhneDefault\(\)\s*\{[^}]*_skaliere\(\s*FinDslNumber\.ganzzahl\("5"\)\s*,\s*FinDslNumber\.ganzzahl\("3"\)\s*\)/s);
    });

    it('Default-Argument wird auch bei sichtbarer (nicht-internen) Funktion expandiert + geboxt', async () => {
        const SRC = `fn Bruttopreis(netto: Euro, mwst: Prozent = 19%): Euro = (netto + (netto * mwst)).abrunden()

fn StandardPreis(): Euro = Bruttopreis(100)
`;
        const program = await parseSource(SRC);
        const ir = lowerProgram(program, { javaPackage: 'test', className: 'M' });
        const { implCode: impl } = emitJavaModuleFiles(ir);
        // Öffentliche fn → Argumente sind Sicht-getypt geboxt (Euro/Prozent)
        // Default 19% muss als Prozent.von(FinDslNumber.prozent("0.19")) eingesetzt sein
        expect(impl).toContain(
            'bruttopreis(Euro.von(FinDslNumber.ganzzahl("100")), '
            + 'Prozent.von(FinDslNumber.prozent("0.19")))',
        );
    });
});

// ---------------------------------------------------------------------------
// Issue #44 — Lücke 10: nicht-numerische Top-Level-`konst` (Text/Bool/Liste)
// ---------------------------------------------------------------------------
describe('Issue #44 — konst-Emit für nicht-numerische Typen', () => {
    it('konst: Text → public static final String (nicht FinDslNumber)', async () => {
        const program = await parseSource('konst WERT: Text = "fest"\n');
        const ir = lowerProgram(program, { javaPackage: 'test', className: 'M' });
        const { interfaceCode: iface } = emitJavaModuleFiles(ir);
        expect(iface).toContain('public static final String WERT = "fest";');
        expect(iface).not.toContain('FinDslNumber WERT');
    });

    it('konst: Wahrheitswert → public static final boolean (nicht FinDslNumber)', async () => {
        const program = await parseSource('konst AKTIV: Wahrheitswert = wahr\n');
        const ir = lowerProgram(program, { javaPackage: 'test', className: 'M' });
        const { interfaceCode: iface } = emitJavaModuleFiles(ir);
        expect(iface).toContain('public static final boolean AKTIV = true;');
        expect(iface).not.toContain('FinDslNumber AKTIV');
    });

    it('konst: Liste<Ganzzahl> → public static final FinDslListe<FinDslNumber>', async () => {
        const program = await parseSource('konst ZAHLEN: Liste<Ganzzahl> = [1, 2, 3]\n');
        const ir = lowerProgram(program, { javaPackage: 'test', className: 'M' });
        const { interfaceCode: iface } = emitJavaModuleFiles(ir);
        expect(iface).toMatch(/public static final FinDslListe<FinDslNumber> ZAHLEN =/);
        expect(iface).not.toMatch(/public static final FinDslNumber ZAHLEN/);
    });

    it('konst: numerisch → Wrapper-getypt + geboxt (Regression — Verhalten unverändert)', async () => {
        const program = await parseSource('konst SATZ: Prozent = 15%\n');
        const ir = lowerProgram(program, { javaPackage: 'test', className: 'M' });
        const { interfaceCode: iface } = emitJavaModuleFiles(ir);
        expect(iface).toContain(
            'public static final Prozent SATZ = Prozent.von(FinDslNumber.prozent("0.15"));');
    });
});

// ---------------------------------------------------------------------------
// Issue #44 — Lücke 15: Cross-Modul-Enum-Werte in generierten JUnit-Tests
// ---------------------------------------------------------------------------
describe('Issue #44 — Test-Codegen: Cross-Modul-Enum-Werte qualifizieren', () => {
    const TYPEN_SRC = `aufzählung Farbe { Rot, Blau }\n`;
    const LOGIK_SRC = `verwende { Farbe, Rot, Blau } aus "./typen"

fn Score(f: Farbe): Ganzzahl = wähle (f) {
    falls Rot  -> 1
    falls Blau -> 2
}
`;
    const TEST_SRC = `verwende { Score, Farbe } aus "./logik"

prüfe "Farbtest" {
    testfall "Rot=1" { Score(Rot) == 1 }
    testfall "Blau=2" { Score(Blau) == 2 }
}
`;

    it('Lowering qualifiziert Enum-Werte korrekt, WENN alle transitiv erreichbaren Module im imports-Array sind', async () => {
        // Das Lowering selbst ist korrekt: gib ALLE transitiv erreichbaren
        // Module (incl. `typen`) als `imports` → das Generat ist qualifiziert.
        const typenProgram = await parseSource(TYPEN_SRC);
        const logikProgram = await parseSource(LOGIK_SRC);
        const testProgram = await parseSource(TEST_SRC);
        const ir = lowerTestProgram(testProgram, {
            javaPackage: undefined,
            className: 'LogikTest',
            imports: [
                {
                    program: logikProgram,
                    className: 'Logik',
                    javaPackage: undefined,
                    bindings: [
                        { localName: 'Score', sourceName: 'Score' },
                        { localName: 'Farbe', sourceName: 'Farbe' },
                    ],
                },
                {
                    // Transitiv: hier brauchen wir `typen` im imports-Array,
                    // damit `Rot`/`Blau` als Cross-Modul-Enum erkannt werden.
                    program: typenProgram,
                    className: 'Typen',
                    javaPackage: undefined,
                    bindings: [],
                },
            ],
        });
        const out = emitJavaTestModule(ir);
        expect(out).toContain('logik.score(Typen.Farbe.Rot)');
        expect(out).toContain('logik.score(Typen.Farbe.Blau)');
    });

    it('REGRESSION: WENN nur direkte Imports im imports-Array → Enum-Werte unqualifiziert (Bug-Sensor für CLI-Fix)', async () => {
        // Ohne transitive Imports — wie das CLI heute aufruft —
        // werden Rot/Blau unqualifiziert emittiert (javac: cannot find).
        // Dieser Test PRÜFT den heutigen Zustand; sobald das CLI
        // transitive Module mitliefert, ist dieser Pfad nicht mehr
        // relevant (aber das Lowering bleibt korrekt — siehe Test oben).
        const logikProgram = await parseSource(LOGIK_SRC);
        const testProgram = await parseSource(TEST_SRC);
        const ir = lowerTestProgram(testProgram, {
            javaPackage: undefined,
            className: 'LogikTest',
            imports: [
                {
                    program: logikProgram,
                    className: 'Logik',
                    javaPackage: undefined,
                    bindings: [
                        { localName: 'Score', sourceName: 'Score' },
                        { localName: 'Farbe', sourceName: 'Farbe' },
                    ],
                },
                // KEIN typen-Eintrag → Enum-Werte nicht-qualifiziert!
            ],
        });
        const out = emitJavaTestModule(ir);
        // Heute (RED-Sensor): unqualifiziert. Nach CLI-Fix kann diese
        // Annahme NICHT mehr direkt getroffen werden, weil das Lowering
        // unverändert bleibt — der Bug-Fix ist im CLI (transitive
        // Import-Schließung), nicht im Lowering.
        expect(out).toMatch(/logik\.score\((Rot|Farbe\.Rot)\)/);
    });
});
