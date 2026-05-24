// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * In-Process-Unit-Tests für den JS-Emitter (`emit-js/strip.ts`).
 *
 * Das JS-Target ist ein deterministischer Typ-Strip des TS-Generats
 * (#101) — kein zweiter Emitter. Wie bei `emit-ts.test.ts` lief die
 * Ausübung bisher nur über das Subprozess-Gate; hier wird der Strip
 * IN-PROCESS getestet (coverage-wirksam): `tsZuJs` direkt sowie
 * `emitJsModule` über die `parse → lower → emit`-Kette.
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { lowerProgram } from '../../src/codegen/lower/lower.js';
import { tsZuJs, emitJsModule } from '../../src/codegen/emit-js/strip.js';

describe('tsZuJs — TS → ESM-JS (Typ-Strip)', () => {
    it('entfernt Typannotationen, behält Laufzeit-Code', () => {
        const js = tsZuJs(
            'export const x: number = 1;\n'
            + 'export function f(a: string): boolean { return a.length > 0; }\n',
        );
        expect(js).not.toContain(': number');
        expect(js).not.toContain(': string');
        expect(js).not.toContain(': boolean');
        expect(js).toContain('export const x = 1');
        expect(js).toContain('return a.length > 0');
    });

    it('transformiert enum zu lauffähigem JS (kein enum-Schlüsselwort)', () => {
        const js = tsZuJs('export enum E { A, B }\n');
        expect(js).not.toMatch(/\benum\b/);
        expect(js).toContain('A');
        expect(js).toContain('B');
    });

    it('ist deterministisch', () => {
        const src = 'export const y: Euro = z;\n';
        expect(tsZuJs(src)).toBe(tsZuJs(src));
    });
});

describe('emitJsModule — IR → gestripptes .js', () => {
    it('liefert eine .js-Datei ohne Typannotationen', async () => {
        const program = await parseSource(
            'konst K: Ganzzahl = 10\nfn F(n: Ganzzahl): Ganzzahl = n + K\n',
        );
        const { fileName, code } = emitJsModule(lowerProgram(program, {
            javaPackage: 'pkg', className: 'M',
        }));
        expect(fileName).toBe('M.js');
        expect(code).toContain('export function f(');
        expect(code).toContain('export const K');
        // Param-/Rückgabe-Typannotationen sind gestrippt.
        expect(code).not.toMatch(/:\s*(Ganzzahl|FinDslNumber)\b/);
    });
});
