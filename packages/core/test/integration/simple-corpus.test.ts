// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integrationstest für das `examples/simple/`-Korpus (Issue #43).
 *
 * Iteriert dynamisch über alle `simple-*.findsl`-Dateien und prüft:
 *  1. Parse + Validation ohne Errors (Langium-Services).
 *  2. Cross-Modul-Auflösung (`verwende`) via `loadModuleGraph` —
 *     genau das, was der CLI/Interpreter/Codegen am Korpus tut.
 *  3. Codegen-Lowering (Aufruf des CLI als Subprocess) + Determinismus:
 *     zwei Codegen-Läufe → bit-identische Java-Generate.
 *
 * Dynamische Iteration via `readdirSync` — wer eine neue
 * `simple-foo.findsl` anlegt, wird automatisch mitgeprüft, ohne dass
 * der Test angefasst werden muss.
 *
 * Hinweise zur aktuellen Reichweite:
 *  - Der Codegen hat dokumentierte Lücken (Issue #44 — `Range`,
 *    `nichts`, Elvis-`oder`, Lambda, `wenn`, `.enthält`, `als`, `!!`,
 *    String-Interpolation, Text-`konst`, Default-Param-Expansion,
 *    Cross-Modul-Enum-Werte in Tests). Solche Konstrukte stehen
 *    aktuell nicht im Korpus — sie würden den Sweep abbrechen lassen.
 *    Sobald #44 geschlossen ist, wird der Korpus die volle SPEC-Breite
 *    decken (siehe `examples/simple/README.md`).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createFindslServices } from '../../src/language/findsl-module.js';
import {
    loadModuleGraph,
    type ParseFile,
} from '../../src/interpret/module-loader.js';
import type { Program } from '../../src/language/generated/ast.js';

const REPO_ROOT = resolve(__dirname, '../../../..');
const SIMPLE_DIR = join(REPO_ROOT, 'examples', 'simple');
const CLI = join(REPO_ROOT, 'packages', 'cli', 'out', 'main.js');

interface SimpleFile {
    readonly fileName: string;
    readonly absPath: string;
    readonly isTest: boolean;
}

function discoverSimpleFiles(): readonly SimpleFile[] {
    return readdirSync(SIMPLE_DIR)
        .filter((f) => f.startsWith('simple-') && f.endsWith('.findsl'))
        .sort()                                          // deterministisch
        .map((fileName) => ({
            fileName,
            absPath: join(SIMPLE_DIR, fileName),
            isTest: fileName.endsWith('.test.findsl'),
        }));
}

function buildParser(): ParseFile {
    const services = createFindslServices(NodeFileSystem).Findsl;
    return async (absPath) => {
        const content = readFileSync(absPath, 'utf-8');
        const document = services.shared.workspace.LangiumDocumentFactory.fromString(
            content,
            URI.file(absPath),
        );
        await services.shared.workspace.DocumentBuilder.build(
            [document],
            { validation: true },
        );
        return document.parseResult.value as Program;
    };
}

describe('examples/simple/-Korpus — SPEC-Konstrukt-Vollständigkeit', () => {
    let simpleFiles: readonly SimpleFile[];

    beforeAll(() => {
        simpleFiles = discoverSimpleFiles();
    });

    it('mindestens 6 simple-*.findsl-Dateien (3 Sach + 3 Tests)', () => {
        expect(simpleFiles.length).toBeGreaterThanOrEqual(6);
    });

    describe('Parse + Validation pro Datei', () => {
        it('jede simple-*.findsl parst und validiert fehlerfrei', async () => {
            const parser = buildParser();
            const services = createFindslServices(NodeFileSystem).Findsl;
            for (const f of discoverSimpleFiles()) {
                const content = readFileSync(f.absPath, 'utf-8');
                const document = services.shared.workspace.LangiumDocumentFactory
                    .fromString(content, URI.file(f.absPath));
                await services.shared.workspace.DocumentBuilder.build(
                    [document],
                    { validation: true },
                );
                const errors = (document.diagnostics ?? [])
                    .filter((d) => d.severity === 1);    // 1 = Error
                expect(
                    errors,
                    `${f.fileName}: ${errors.map((e) => e.message).join('; ')}`,
                ).toEqual([]);
                // `parser` als Type-Check-Helfer
                expect(await parser(f.absPath)).toBeDefined();
            }
        });
    });

    describe('Cross-Modul-Auflösung (`verwende`)', () => {
        it('simple-ausdruecke.test.findsl als Entry → topologische Ordnung enthält simple-typen + simple-ausdruecke', async () => {
            const entry = join(SIMPLE_DIR, 'simple-ausdruecke.test.findsl');
            const order = await loadModuleGraph(entry, buildParser());
            const names = order.map((m) => basename(m.filePath));
            // Foundation muss VOR ihrem Konsumenten geladen werden:
            expect(names.indexOf('simple-typen.findsl'))
                .toBeLessThan(names.indexOf('simple-ausdruecke.findsl'));
            expect(names.indexOf('simple-ausdruecke.findsl'))
                .toBeLessThan(names.indexOf('simple-ausdruecke.test.findsl'));
        });

        it('simple-funktionen.test.findsl löst seine Imports auf', async () => {
            const entry = join(SIMPLE_DIR, 'simple-funktionen.test.findsl');
            const order = await loadModuleGraph(entry, buildParser());
            const names = order.map((m) => basename(m.filePath));
            expect(names).toContain('simple-typen.findsl');
            expect(names).toContain('simple-funktionen.findsl');
            expect(names).toContain('simple-funktionen.test.findsl');
        });
    });

    describe('Codegen — Determinismus über das gesamte simple-Verzeichnis', () => {
        it('zwei aufeinanderfolgende `codegen`-Läufe liefern bit-identische Generate', () => {
            // Voraussetzung: `npm run build` lief — sonst kein CLI.
            const cliExists = (() => {
                try {
                    readFileSync(CLI);
                    return true;
                } catch {
                    return false;
                }
            })();
            if (!cliExists) {
                // Im typischen Vitest-Lauf (nach `npm run build && npm test`)
                // ist das CLI da. Falls jemand isoliert testet: Skip.
                console.warn(`SKIP: CLI nicht gebaut (${CLI}). Vorher \`npm run build\` ausführen.`);
                return;
            }
            const outA = mkdtempSync(join(tmpdir(), 'simple-gen-a-'));
            const tstA = mkdtempSync(join(tmpdir(), 'simple-gen-at-'));
            const outB = mkdtempSync(join(tmpdir(), 'simple-gen-b-'));
            const tstB = mkdtempSync(join(tmpdir(), 'simple-gen-bt-'));
            try {
                const run = (out: string, tst: string) => {
                    const r = spawnSync(
                        'node',
                        [CLI, 'codegen', SIMPLE_DIR, '-l', 'java', '-o', out, '-t', tst],
                        { encoding: 'utf-8' },
                    );
                    expect(r.status, `codegen-Run rot: ${r.stderr}`).toBe(0);
                };
                run(outA, tstA);
                run(outB, tstB);
                const collect = (dir: string) =>
                    readdirSync(dir).sort()
                        .filter((f) => f.endsWith('.java'))
                        .map((f) => [f, readFileSync(join(dir, f), 'utf-8')] as const);
                expect(collect(outA)).toEqual(collect(outB));
                expect(collect(tstA)).toEqual(collect(tstB));
                // Mindestumfang sichern — wer einen Cluster löscht,
                // soll diesen Test rotgehen lassen (Regressions-Sensor).
                expect(collect(outA).length).toBeGreaterThanOrEqual(6);  // 3 Interface + 3 Impl
                expect(collect(tstA).length).toBeGreaterThanOrEqual(3);  // 3 JUnit-Klassen
            } finally {
                rmSync(outA, { recursive: true, force: true });
                rmSync(tstA, { recursive: true, force: true });
                rmSync(outB, { recursive: true, force: true });
                rmSync(tstB, { recursive: true, force: true });
            }
        });
    });
});
