// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Integrationstest für das `examples/korpus/`-Korpus (Issue #43).
 *
 * Iteriert dynamisch über alle `korpus-*.findsl`-Dateien und prüft:
 *  1. Parse + Validation ohne Errors (Langium-Services).
 *  2. Cross-Modul-Auflösung (`verwende`) via `loadModuleGraph` —
 *     genau das, was der CLI/Interpreter/Codegen am Korpus tut.
 *  3. Codegen-Lowering (Aufruf des CLI als Subprocess) + Determinismus:
 *     zwei Codegen-Läufe → bit-identische Java-Generate.
 *
 * Dynamische Iteration via `readdirSync` — wer eine neue
 * `korpus-foo.findsl` anlegt, wird automatisch mitgeprüft, ohne dass
 * der Test angefasst werden muss.
 *
 * Reichweite: nach Abschluss von Issue #44 deckt der Korpus die volle
 * SPEC § 2-§ 11-Breite ab — siehe `examples/korpus/README.md`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
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
const KORPUS_DIR = join(REPO_ROOT, 'examples/korpus');
const CLI = join(REPO_ROOT, 'packages', 'cli', 'out', 'main.js');

interface KorpusFile {
    readonly fileName: string;
    readonly absPath: string;
    readonly isTest: boolean;
}

function discoverKorpusFiles(): readonly KorpusFile[] {
    return readdirSync(KORPUS_DIR)
        .filter((f) => f.startsWith("korpus-") && f.endsWith('.findsl'))
        .sort()                                          // deterministisch
        .map((fileName) => ({
            fileName,
            absPath: join(KORPUS_DIR, fileName),
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

describe('examples/korpus/-Korpus — SPEC-Konstrukt-Vollständigkeit', () => {
    let korpusFiles: readonly KorpusFile[];

    beforeAll(() => {
        korpusFiles = discoverKorpusFiles();
    });

    it('mindestens 10 korpus-*.findsl-Dateien (5 Sach + 5 Tests)', () => {
        expect(korpusFiles.length).toBeGreaterThanOrEqual(10);
    });

    describe('Parse + Validation pro Datei', () => {
        it('jede korpus-*.findsl parst und validiert fehlerfrei', async () => {
            const parser = buildParser();
            const services = createFindslServices(NodeFileSystem).Findsl;
            for (const f of discoverKorpusFiles()) {
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
        it('korpus-ausdruecke.test.findsl als Entry → topologische Ordnung enthält korpus-typen + korpus-ausdruecke', async () => {
            const entry = join(KORPUS_DIR, 'korpus-ausdruecke.test.findsl');
            const order = await loadModuleGraph(entry, buildParser());
            const names = order.map((m) => basename(m.filePath));
            // Foundation muss VOR ihrem Konsumenten geladen werden:
            expect(names.indexOf('korpus-typen.findsl'))
                .toBeLessThan(names.indexOf('korpus-ausdruecke.findsl'));
            expect(names.indexOf('korpus-ausdruecke.findsl'))
                .toBeLessThan(names.indexOf('korpus-ausdruecke.test.findsl'));
        });

        it('korpus-funktionen.test.findsl löst seine Imports auf', async () => {
            const entry = join(KORPUS_DIR, 'korpus-funktionen.test.findsl');
            const order = await loadModuleGraph(entry, buildParser());
            const names = order.map((m) => basename(m.filePath));
            expect(names).toContain('korpus-typen.findsl');
            expect(names).toContain('korpus-funktionen.findsl');
            expect(names).toContain('korpus-funktionen.test.findsl');
        });
    });

    describe('Codegen — Determinismus über das gesamte korpus-Verzeichnis', () => {
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
            const outA = mkdtempSync(join(tmpdir(), 'korpus-gen-a-'));
            const tstA = mkdtempSync(join(tmpdir(), 'korpus-gen-at-'));
            const outB = mkdtempSync(join(tmpdir(), 'korpus-gen-b-'));
            const tstB = mkdtempSync(join(tmpdir(), 'korpus-gen-bt-'));
            try {
                const run = (out: string, tst: string) => {
                    const r = spawnSync(
                        'node',
                        [CLI, 'codegen', KORPUS_DIR, '-l', 'java', '-o', out, '-t', tst],
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
                expect(collect(outA).length).toBeGreaterThanOrEqual(10);  // 3 Interface + 3 Impl
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
