// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * In-Process-Unit-Tests für den TypeScript-Emitter (`emit-ts/emitter.ts`).
 *
 * Anlass (QA/Coverage): die TS-Emission wurde bislang nur über das
 * Subprozess-Gate (`ts-gate.test.ts`, `node CLI codegen`) ausgeübt — solche
 * Subprozess-Läufe entgehen der Coverage-Instrumentierung des Eltern-
 * Prozesses, daher erschien `emit-ts/emitter.ts` als ~0 % gedeckt, obwohl
 * funktional getestet. Diese Datei testet den Emitter IN-PROCESS (parse →
 * `lowerProgram` → `emitTsModule`) — schnell, punktgenau, coverage-wirksam.
 * Spiegel zu `skeleton.test.ts` (Java-Emitter), gleiches Lower-/Parse-Muster.
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { lowerProgram, lowerTestProgram } from '../../src/codegen/lower/lower.js';
import { emitTsModule, emitTsTestModule, irTypeToTs } from '../../src/codegen/emit-ts/emitter.js';
import type { IrType } from '../../src/codegen/ir/nodes.js';

/** Whitespace-insensitiver Substring-Test (Formatierung ist nicht das Ziel). */
const flat = (s: string): string => s.replace(/\s+/g, '');
const hasFlat = (hay: string, needle: string): boolean => flat(hay).includes(flat(needle));

// ---------------------------------------------------------------------------
// irTypeToTs — reines Typ-Mapping (Deklarationsgrenze)
// ---------------------------------------------------------------------------

describe('irTypeToTs', () => {
    it('skalare Kern-/Wrapper-/bool-/text-Typen', () => {
        expect(irTypeToTs({ kind: 'number' })).toBe('FinDslNumber');
        expect(irTypeToTs({ kind: 'number', wrapper: 'Euro' })).toBe('Euro');
        expect(irTypeToTs({ kind: 'bool' })).toBe('boolean');
        expect(irTypeToTs({ kind: 'text' })).toBe('string');
    });

    it('Liste rendert den Kern-Elementtyp (Wrapper → FinDslNumber)', () => {
        const t: IrType = { kind: 'list', elem: { kind: 'number', wrapper: 'Euro' } };
        expect(irTypeToTs(t)).toBe('FinDslListe<FinDslNumber>');
    });

    it('lambda → native Pfeil-Signatur mit Kern-Typen', () => {
        const t: IrType = {
            kind: 'lambda',
            params: [{ kind: 'number', wrapper: 'Euro' }],
            ret: { kind: 'bool' },
        };
        expect(irTypeToTs(t)).toBe('(a0: FinDslNumber) => boolean');
    });

    it('named: lokal vs. cross-Modul (owner-qualifiziert)', () => {
        expect(irTypeToTs({ kind: 'named', name: 'Farbe' })).toBe('Farbe');
        expect(irTypeToTs({ kind: 'named', name: 'Farbe', owner: 'Typen' })).toBe('Typen.Farbe');
    });

    it('nullable hängt " | null" an den Basistyp', () => {
        expect(irTypeToTs({ kind: 'number', wrapper: 'Euro', nullable: true })).toBe('Euro | null');
        expect(irTypeToTs({ kind: 'text', nullable: true })).toBe('string | null');
        expect(irTypeToTs({ kind: 'named', name: 'Farbe', nullable: true })).toBe('Farbe | null');
    });
});

// ---------------------------------------------------------------------------
// emitTsModule — Einzelmodul (konst/enum/datensatz/fn/wähle/cast/§7)
// ---------------------------------------------------------------------------

const M_BASIS = `--
# Basis-Modul

Datei-Doc → Modul-JSDoc.
--

-- Steuersatz. --
@Quelle("§ 23 KStG")
konst SATZ: Prozent = 15%

konst FREIBETRAG: Euro = 5.000

aufzählung Ausschluss { Keiner, Nr1 }

datensatz Fall(betrag: Euro)

fn _Hilfe(e: Euro): Euro = wähle {
    falls e <= 0 -> 0
    sonst -> FREIBETRAG
}

fn Betrag(zve: Euro): Euro = wähle {
    falls zve <= 0 -> 0
    sonst -> (zve * SATZ).abrunden()
}

fn Mach(): Fall = Fall(betrag: 5.000)
`;

describe('emitTsModule — Einzelmodul', () => {
    const ctx = { javaPackage: 'pkg', className: 'Basis' };

    it('emittiert Top-Level export-Deklarationen in TDZ-sicherer Reihenfolge', async () => {
        const ir = lowerProgram(await parseSource(M_BASIS), ctx);
        const { code } = emitTsModule(ir);

        expect(code).toContain('export enum Ausschluss');
        expect(code).toContain('export class Fall');
        expect(code).toContain('export const SATZ');
        expect(code).toContain('export const FREIBETRAG');
        expect(code).toContain('export function betrag(');      // tsFnName: Betrag → betrag
        // _Hilfe → _hilfe: führendes `_` BLEIBT (modul-intern), nur der erste
        // Buchstabe wird klein; modul-interne Decls werden NICHT exportiert.
        expect(code).toContain('function _hilfe(');
        expect(code).not.toContain('export function _hilfe(');
        // Reihenfolge: enum/class vor const vor function.
        expect(code.indexOf('export enum')).toBeLessThan(code.indexOf('export const'));
        expect(code.indexOf('export const')).toBeLessThan(code.indexOf('export function'));
    });

    it('rendert §7-Money-Literale, Cast-Boxing und Methodenaufruf', async () => {
        const ir = lowerProgram(await parseSource(M_BASIS), ctx);
        const { code } = emitTsModule(ir);
        expect(code).toMatch(/FinDslNumber\.(dezimal|prozent|ganzzahl)\(/);
        expect(code).toContain('.abrunden(');
        // Record-Konstruktor mit Argument (benanntes Feld → geboxt).
        expect(code).toContain('new Fall(');
        expect(code).not.toContain('new Fall()');
    });

    it('überträgt Datei-Doc + @Quelle in JSDoc', async () => {
        const ir = lowerProgram(await parseSource(M_BASIS), ctx);
        const { code } = emitTsModule(ir);
        expect(code).toContain('/**');
        expect(code).toContain('§ 23 KStG');
    });

    it('ist byte-deterministisch (zwei unabhängige Läufe identisch)', async () => {
        const a = emitTsModule(lowerProgram(await parseSource(M_BASIS), ctx));
        const b = emitTsModule(lowerProgram(await parseSource(M_BASIS), ctx));
        expect(a).toEqual(b);
        expect(a.fileName).toBe('Basis.ts');
    });
});

// ---------------------------------------------------------------------------
// emitTsModule — Cross-Modul (Namespace-Import, crossCall, crossRef, Enum)
// ---------------------------------------------------------------------------

const C_TYPEN = `aufzählung Art { A, B }
konst GRENZE: Ganzzahl = 10
fn Helfer(n: Ganzzahl): Ganzzahl = n
`;
const C_NUTZER = `verwende { Art, GRENZE, Helfer } aus "./typen"
fn UseKonst(): Ganzzahl = GRENZE
fn Call(): Ganzzahl = Helfer(1)
fn Pick(a: Art): Ganzzahl = wähle (a) {
    falls A -> 1
    falls B -> 2
}
`;

describe('emitTsModule — Cross-Modul-Naht', () => {
    async function lowerNutzer() {
        const typenProg = await parseSource(C_TYPEN);
        const nutzerProg = await parseSource(C_NUTZER);
        return lowerProgram(nutzerProg, {
            javaPackage: 'pkg',
            className: 'Nutzer',
            imports: [{
                program: typenProg,
                className: 'Typen',
                javaPackage: 'pkg',
                bindings: ['Art', 'A', 'B', 'GRENZE', 'Helfer']
                    .map((n) => ({ localName: n, sourceName: n })),
            }],
        });
    }

    it('rendert Namespace-Import + qualifizierte Cross-Referenzen', async () => {
        const { code } = emitTsModule(await lowerNutzer());
        expect(code).toMatch(/import \* as Typen from '\.\/Typen\.js';/);
        expect(code).toContain('Typen.helfer(');     // crossCall (tsFnName)
        expect(code).toContain('Typen.GRENZE');       // crossRef (konst)
        expect(code).toContain('Typen.Art');          // cross-Enum-Typ/-Vergleich
    });
});

// ---------------------------------------------------------------------------
// emitTsTestModule — prüfe/testfall → describe/it/expect
// ---------------------------------------------------------------------------

const T_SUT = `fn Doppel(n: Ganzzahl): Ganzzahl = n + n
`;
const T_TEST = `prüfe "Doppel" {
    testfall "2*3 → 6" { Doppel(3) == 6 }
}
`;

describe('emitTsTestModule — Vitest-Spec', () => {
    it('emittiert describe/it/expect + ruft die SUT über die Namespace-Naht', async () => {
        const sutProg = await parseSource(T_SUT);
        const testProg = await parseSource(T_TEST);
        const testIr = lowerTestProgram(testProg, {
            javaPackage: 'pkg',
            className: 'SutTest',
            imports: [{
                program: sutProg,
                className: 'Sut',
                javaPackage: 'pkg',
                bindings: [{ localName: 'Doppel', sourceName: 'Doppel' }],
            }],
        });
        const { code } = emitTsTestModule(testIr);
        expect(code).toContain('describe(');
        expect(code).toContain('it(');
        expect(code).toContain('expect(');
        expect(code).toContain('Sut.doppel(');       // Cross-Aufruf in die SUT
    });
});
