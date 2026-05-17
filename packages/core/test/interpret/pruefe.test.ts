/**
 * Smoke-Tests: die `prüfe`-Blöcke liegen in separaten
 * `<basisname>.test.findsl`-Dateien, die via `verwende {…} aus "./<rel>"`
 * die Quelldatei(en) relativ importieren. Sichert das Regressionsziel:
 * der Tree-Walker führt alle Akzeptanztests der verbliebenen
 * Beispielmodule (kst, kraftst, gewst) aus — inklusive transitiver
 * Relativimporte (kraftst ist mehrdateilig).
 *
 * Die Datei-Identität ist der absolute Dateipfad
 * (`LoadedModule.filePath`).
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createFindslServices } from '../../src/language/findsl-module.js';
import { loadModuleGraph, type ParseFile } from '../../src/interpret/module-loader.js';
import { runPruefe } from '../../src/interpret/pruefe.js';
import type { Program } from '../../src/language/generated/ast.js';

const __filename = fileURLToPath(import.meta.url);
const examplesDir = path.resolve(path.dirname(__filename), '../../../../examples');

function buildParseFile() {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const cache = new Map<string, Program>();
    const parse: ParseFile = async (absPath) => {
        const hit = cache.get(absPath);
        if (hit) return hit;
        const content = await fs.readFile(absPath, 'utf-8');
        const document = services.shared.workspace.LangiumDocumentFactory.fromString(
            content,
            URI.file(absPath),
        );
        await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
        const errors = (document.diagnostics ?? []).filter((d) => d.severity === 1);
        if (errors.length > 0) {
            throw new Error(`${absPath}: ${errors.length} Parse-Fehler — ${errors[0].message}`);
        }
        const program = document.parseResult.value as Program;
        cache.set(absPath, program);
        return program;
    };
    return parse;
}

const basenames = (modules: ReadonlyArray<{ filePath: string }>): string[] =>
    modules.map((m) => path.basename(m.filePath));

// Exakte Soll-Zählwerte = Regressionswächter (fängt versehentlich
// verlorene/zusätzliche Testfälle ab). Bei bewusster Änderung der
// Beispiele hier mitziehen.
const EXAMPLE_SUITES: ReadonlyArray<{
    name: string;
    entry: string;
    passed: number;
}> = [
    {
        name: 'kst — Körperschaftsteuer',
        entry: 'kst/kst.test.findsl',
        passed: 23,
    },
    {
        name: 'kraftst — Kfz-Steuer (mehrdateilig, transitive Importe)',
        entry: 'kraftst/kraftst.test.findsl',
        passed: 34,
    },
    {
        name: 'gewst — Gewerbesteuer',
        entry: 'gewst/gewst.test.findsl',
        passed: 43,
    },
    {
        name: 'est — Einkommensteuer § 2 Schema + § 32a Tarif (VZ 2026)',
        entry: 'est/est.test.findsl',
        passed: 22,
    },
];

describe('prüfe-Blöcke der Beispieldateien', () => {
    for (const suite of EXAMPLE_SUITES) {
        it(`${suite.name}: ${suite.passed}/${suite.passed} Beispiele bestehen`, async () => {
            const parse = buildParseFile();
            const entry = path.join(examplesDir, suite.entry);
            const modules = await loadModuleGraph(entry, parse);
            // .test-Datei importiert die Quelldatei(en) relativ; sie ist
            // der Einstieg und steht daher zuletzt im Graphen.
            expect(modules[modules.length - 1].filePath).toBe(path.normalize(entry));

            const report = runPruefe(modules);
            expect(report.failed).toBe(0);
            expect(report.errored).toBe(0);
            expect(report.total).toBe(suite.passed);
            expect(report.passed).toBe(suite.passed);
        });
    }

    it('kraftst: transitiver Cross-Datei-Import (typen → tarif-* → steuer → .test)', async () => {
        const parse = buildParseFile();
        const entry = path.join(examplesDir, 'kraftst/kraftst.test.findsl');
        const modules = await loadModuleGraph(entry, parse);
        const names = basenames(modules);

        for (const n of [
            'kraftstg-typen.findsl',
            'kraftstg-tarif-leicht.findsl',
            'kraftstg-tarif-nutzfahrzeug.findsl',
            'kraftst.findsl',
        ]) {
            expect(names).toContain(n);
        }
        expect(modules[modules.length - 1].filePath).toBe(path.normalize(entry));
        // Blätter vor Abhängigen: typen vor tarif-* vor steuer (Orchestrator).
        expect(names.indexOf('kraftstg-typen.findsl'))
            .toBeLessThan(names.indexOf('kraftstg-tarif-leicht.findsl'));
        expect(names.indexOf('kraftstg-tarif-leicht.findsl'))
            .toBeLessThan(names.indexOf('kraftst.findsl'));
    });
});
