// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * TS-Codegen-Differential-Gate (Issue #41/#99 + #100) — der scharfe
 * Drift-Schutz des TS-Targets. Reiner Node-Lauf (kein JDK), hängt am
 * bestehenden `build`-Job (CI: `npm run build` → `npm test`), wird dort
 * NIE geskippt (anders als das Java-`codegen:difftest` ohne JDK).
 *
 * Beweist die vier Akzeptanzkriterien über ALLE vier Beispielmodule
 * (#100 — voller Korpus, nicht nur das `kst`-Skelett), je in getrennten
 * `it`s für klare Per-Schritt-Diagnostik (#109-Review MEDIUM-2):
 *
 *   AK1  `tsc --noEmit` über das Generat ist grün.
 *   AK2  Die generierten `prüfe`→Vitest-Items laufen grün gegen das
 *   AK3  Interpreter-Orakel (bit-genau; §7, Listen, Lambda, Interpolation)
 *        → Vitest-Subprozess liefert Exit 0 + ≥ `minTests` Tests.
 *   AK4  Deterministisch: zwei `codegen`-Läufe → byte-identisch.
 *
 * `kraftst` ist mehrdateilig (4 Module in einem Package) → deckt die
 * Intra-Package-ESM-Imports (`./Foo.js`) ab; `gewst` die String-
 * Interpolation; `est` Listen + Lambda (`.zuordnen`/`.summe()`).
 *
 * Voraussetzung (wie `korpus.test.ts`): das CLI-Bundle unter
 * `packages/cli/out/main.js` (aus `npm run build`). Fehlt es (isolierter
 * Vitest-Lauf ohne Build), skippt nur DIESE Datei — im CI-„build"-Job
 * ist es immer vorhanden.
 *
 * Erzeugt wird in ein REPO-INTERNES Temp-Verzeichnis: nur dort lösen
 * `decimal.js` (Runtime) und `vitest`/`typescript` (Toolchain) über das
 * Repo-`node_modules` auf — `os.tmpdir()` läge außerhalb.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
    mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync,
    existsSync, statSync,
} from 'node:fs';
import { resolve, join, relative } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const CLI = join(REPO_ROOT, 'packages', 'cli', 'out', 'main.js');
const VITEST_BIN = join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const TSC_BIN = join(REPO_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const FIVE_MIN = 5 * 60 * 1000;

/** Minimal-`tsconfig` für den isolierten Typecheck des Generats (AK1). */
const GEN_TSCONFIG = JSON.stringify({
    compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        lib: ['ES2022'],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        types: [],
    },
    include: ['**/*.ts'],
}, null, 2);

/**
 * Die vier verifizierten Beispielmodule + ihr Anti-Degenerations-Floor
 * (= Anzahl `testfall` in der jeweiligen `*.test.findsl`; ein degeneriertes
 * Generat mit weniger Tests bricht das Gate).
 */
const MODULES: ReadonlyArray<{ dir: string; minTests: number; note: string }> = [
    { dir: 'kst',     minTests: 23, note: 'Basis: konst/fn/wähle/Rundung/§7' },
    { dir: 'kraftst', minTests: 34, note: 'mehrdateilig: Intra-Package-ESM-Imports' },
    { dir: 'gewst',   minTests: 43, note: 'String-Interpolation' },
    { dir: 'est',     minTests: 22, note: 'Listen + Lambda (.zuordnen/.summe)' },
];

const cliBuilt = existsSync(CLI);

/** REPO-internes Temp-Verzeichnis (für node_modules-Auflösung). */
function makeTmp(tag: string): string {
    return mkdtempSync(join(REPO_ROOT, `.ts-gate-${tag}-`));
}

/** `findsl codegen examples/<dir> -l ts -o <out>` (Module + Tests + Runtime). */
function runCodegen(dir: string, outDir: string): ReturnType<typeof spawnSync> {
    return spawnSync(
        'node',
        [CLI, 'codegen', join(REPO_ROOT, 'examples', dir), '-l', 'ts', '-o', outDir],
        { encoding: 'utf-8', timeout: FIVE_MIN },
    );
}

/** Subprozess sauber gestartet (kein ENOENT o.ä.) UND Exit 0. */
function expectSpawnOk(r: ReturnType<typeof spawnSync>, label: string): void {
    expect(r.error, `${label}: Subprozess-Start fehlgeschlagen — ${r.error?.message}`)
        .toBeUndefined();
    expect(r.status, `${label} rot (exit ${String(r.status)}):\n${r.stdout ?? ''}\n${r.stderr ?? ''}`)
        .toBe(0);
}

/** Alle Dateien eines Baums als sortierte [relPath, content]-Paare. */
function collectFiles(dir: string): ReadonlyArray<readonly [string, string]> {
    const out: Array<readonly [string, string]> = [];
    const walk = (d: string): void => {
        for (const name of readdirSync(d).sort()) {
            const abs = join(d, name);
            if (statSync(abs).isDirectory()) walk(abs);
            else out.push([relative(dir, abs), readFileSync(abs, 'utf-8')]);
        }
    };
    walk(dir);
    return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

describe('TS-Codegen-Differential-Gate (Issue #100 — voller Korpus)', () => {
    beforeAll(() => {
        if (!cliBuilt) {
            console.warn(`SKIP: CLI nicht gebaut (${CLI}). Vorher `
                + '`npm run build` ausführen (im CI-build-Job immer vorhanden).');
        }
    });

    describe.each(MODULES)('Modul $dir ($note)', ({ dir, minTests }) => {
        // Ein Codegen-Lauf je Modul, geteilt von AK1 + AK2/3 (AK4 erzeugt
        // eigene Läufe für den Determinismus-Vergleich).
        let gen = '';
        beforeAll(() => {
            if (!cliBuilt) return;
            gen = makeTmp(dir);
            expectSpawnOk(runCodegen(dir, gen), `codegen ${dir}`);
            writeFileSync(join(gen, 'tsconfig.json'), GEN_TSCONFIG);
        });
        afterAll(() => {
            if (gen) rmSync(gen, { recursive: true, force: true });
        });

        it.skipIf(!cliBuilt)('AK1: tsc --noEmit typecheckt das Generat', () => {
            expect(existsSync(join(gen, 'runtime', 'index.ts')),
                'TS-Runtime nicht mit-ausgeliefert').toBe(true);
            const tsc = spawnSync('node', [TSC_BIN, '-p', join(gen, 'tsconfig.json')], {
                encoding: 'utf-8', cwd: gen, timeout: FIVE_MIN,
            });
            expectSpawnOk(tsc, `tsc ${dir}`);
        }, FIVE_MIN);

        it.skipIf(!cliBuilt)('AK2/AK3: prüfe→Vitest grün, bit-genau (≥ minTests)', () => {
            const vt = spawnSync(
                'node',
                [VITEST_BIN, 'run', '--root', gen, '--reporter=dot', '--no-color'],
                { encoding: 'utf-8', cwd: REPO_ROOT, timeout: FIVE_MIN },
            );
            const out = `${vt.stdout}\n${vt.stderr}`;
            expect(vt.error, `Vitest-Start fehlgeschlagen: ${vt.error?.message}`).toBeUndefined();
            expect(vt.status, `Vitest rot über Generat:\n${out}`).toBe(0);
            expect(out).not.toMatch(/\bfailed\b/i);
            // Anti-Degenerations-Sensor: `Tests`-Summenzeile (nicht `Test Files`).
            const passed = out.match(/\bTests\s+(\d+)\s+passed/);
            expect(passed, `kein Tests-Pass-Count im Vitest-Output:\n${out}`).not.toBeNull();
            expect(Number(passed![1])).toBeGreaterThanOrEqual(minTests);
        }, FIVE_MIN);

        it.skipIf(!cliBuilt)('AK4: zwei codegen-Läufe → byte-identisch', () => {
            const a = makeTmp(`${dir}-a`);
            const b = makeTmp(`${dir}-b`);
            try {
                expectSpawnOk(runCodegen(dir, a), `codegen A ${dir}`);
                expectSpawnOk(runCodegen(dir, b), `codegen B ${dir}`);
                const fa = collectFiles(a);
                expect(fa).toEqual(collectFiles(b));
                expect(fa.length).toBeGreaterThanOrEqual(8);
            } finally {
                rmSync(a, { recursive: true, force: true });
                rmSync(b, { recursive: true, force: true });
            }
        }, FIVE_MIN);
    });
});
