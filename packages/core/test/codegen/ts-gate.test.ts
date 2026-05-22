// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * TS-Codegen-Differential-Gate (Issue #41/#99) — der scharfe Drift-Schutz
 * des TS-Targets. Reiner Node-Lauf (kein JDK), hängt am bestehenden
 * `build`-Job (CI: `npm run build` → `npm test`), wird dort NIE geskippt
 * (anders als das Java-`codegen:difftest`, das ohne JDK aussetzt).
 *
 * Beweist alle vier Akzeptanzkriterien von #99 am `examples/kst`-Modul:
 *
 *   AK1  `findsl codegen examples/kst -l ts` erzeugt typecheckenden Code
 *        → `tsc --noEmit` über das Generat ist grün.
 *   AK2  Die generierten `prüfe`→Vitest-Items laufen grün gegen das
 *   AK3  Interpreter-Orakel (bit-genau; box/unbox/moneyAnno §7 korrekt)
 *        → ein Vitest-Subprozess über das Generat liefert Exit 0.
 *   AK4  Deterministisch: zwei `codegen`-Läufe → byte-identisch.
 *
 * Voraussetzung (wie `korpus.test.ts`): das CLI-Bundle unter
 * `packages/cli/out/main.js` (aus `npm run build`). Fehlt es (isolierter
 * Vitest-Lauf ohne Build), skippt nur DIESE Datei mit klarer Meldung —
 * im CI-„build"-Job ist es immer vorhanden.
 *
 * Erzeugt wird in ein REPO-INTERNES Temp-Verzeichnis: nur dort lösen
 * `decimal.js` (Runtime) und `vitest`/`typescript` (Toolchain) über das
 * Repo-`node_modules` auf — `os.tmpdir()` läge außerhalb.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
    mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync,
    existsSync, statSync,
} from 'node:fs';
import { resolve, join, relative } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const CLI = join(REPO_ROOT, 'packages', 'cli', 'out', 'main.js');
const KST_DIR = join(REPO_ROOT, 'examples', 'kst');
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

const cliBuilt = existsSync(CLI);

/** REPO-internes Temp-Verzeichnis (für node_modules-Auflösung). */
function makeTmp(tag: string): string {
    return mkdtempSync(join(REPO_ROOT, `.ts-gate-${tag}-`));
}

/** `findsl codegen <KST_DIR> -l ts -o <dir>` (Module + Tests + Runtime). */
function runCodegen(outDir: string): ReturnType<typeof spawnSync> {
    return spawnSync(
        'node',
        [CLI, 'codegen', KST_DIR, '-l', 'ts', '-o', outDir],
        { encoding: 'utf-8', timeout: FIVE_MIN },
    );
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

describe('TS-Codegen-Gate — examples/kst (Issue #99)', () => {
    beforeAll(() => {
        if (!cliBuilt) {
            console.warn(`SKIP: CLI nicht gebaut (${CLI}). Vorher `
                + '`npm run build` ausführen (im CI-build-Job immer vorhanden).');
        }
    });

    // `skipIf` meldet einen echten SKIP-Status (nicht PASS) bei ungebautem
    // CLI — im CI-build-Job ist `cliBuilt` immer true, das Gate läuft.
    it.skipIf(!cliBuilt)('AK1: `findsl codegen -l ts` erzeugt typecheckenden TS-Code', () => {
        const gen = makeTmp('tsc');
        try {
            const r = runCodegen(gen);
            expect(r.status, `codegen rot: ${r.stderr}`).toBe(0);
            // Generat-Umfang sichern (Modul + Test + 6 Runtime-Dateien).
            expect(existsSync(join(gen, 'Kst.ts'))).toBe(true);
            expect(existsSync(join(gen, 'KstTest.test.ts'))).toBe(true);
            expect(existsSync(join(gen, 'runtime', 'index.ts'))).toBe(true);

            writeFileSync(join(gen, 'tsconfig.json'), GEN_TSCONFIG);
            const tsc = spawnSync('node', [TSC_BIN, '-p', join(gen, 'tsconfig.json')], {
                encoding: 'utf-8', cwd: gen, timeout: FIVE_MIN,
            });
            expect(
                tsc.status,
                `tsc rot über Generat:\n${tsc.stdout}\n${tsc.stderr}`,
            ).toBe(0);
        } finally {
            rmSync(gen, { recursive: true, force: true });
        }
    }, FIVE_MIN);

    it.skipIf(!cliBuilt)('AK2/AK3: generierte prüfe-Items laufen als Vitest grün (bit-genau)', () => {
        const gen = makeTmp('vitest');
        try {
            const r = runCodegen(gen);
            expect(r.status, `codegen rot: ${r.stderr}`).toBe(0);

            // Vitest-Subprozess mit eigenem `--root` über das Generat:
            // findet `KstTest.test.ts`, löst `vitest`/`decimal.js` über das
            // Repo-`node_modules` auf. Exit 0 ⇔ alle prüfe-Items grün.
            const vt = spawnSync(
                'node',
                [VITEST_BIN, 'run', '--root', gen, '--reporter=dot', '--no-color'],
                { encoding: 'utf-8', cwd: REPO_ROOT, timeout: FIVE_MIN },
            );
            const out = `${vt.stdout}\n${vt.stderr}`;
            expect(vt.status, `Vitest rot über Generat:\n${out}`).toBe(0);
            expect(out).not.toMatch(/\bfailed\b/i);
            // Regressions-Sensor: ein degeneriertes (leeres) Generat würde
            // mit 0 Tests ebenfalls Exit 0 liefern — Mindestumfang sichern
            // (offene Untergrenze: wächst mit künftigen kst-Testfällen mit).
            // Auf die `Tests`-Summenzeile ankern (NICHT die `Test Files`-
            // Zeile, die ebenfalls „N passed" enthält).
            const passed = out.match(/\bTests\s+(\d+)\s+passed/);
            expect(passed, `kein Tests-Pass-Count im Vitest-Output:\n${out}`).not.toBeNull();
            expect(Number(passed![1])).toBeGreaterThanOrEqual(20);
        } finally {
            rmSync(gen, { recursive: true, force: true });
        }
    }, FIVE_MIN);

    it.skipIf(!cliBuilt)('AK4: zwei codegen-Läufe → byte-identisch (Determinismus)', () => {
        const a = makeTmp('det-a');
        const b = makeTmp('det-b');
        try {
            expect(runCodegen(a).status, 'codegen A rot').toBe(0);
            expect(runCodegen(b).status, 'codegen B rot').toBe(0);
            const fa = collectFiles(a);
            const fb = collectFiles(b);
            expect(fa).toEqual(fb);
            // Mindestumfang: Modul + Test + 6 Runtime-Dateien.
            expect(fa.length).toBeGreaterThanOrEqual(8);
        } finally {
            rmSync(a, { recursive: true, force: true });
            rmSync(b, { recursive: true, force: true });
        }
    }, FIVE_MIN);
});
