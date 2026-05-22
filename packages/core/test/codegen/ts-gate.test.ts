// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * TS/JS-Codegen-Differential-Gate (Issue #41/#99 + #100 + #101) — der
 * scharfe Drift-Schutz beider Script-Targets. Reiner Node-Lauf (kein JDK),
 * hängt am bestehenden `build`-Job (CI: `npm run build` → `npm test`),
 * wird dort NIE geskippt (anders als das Java-`codegen:difftest` ohne JDK).
 *
 * Beweist die Akzeptanzkriterien über ALLE vier Beispielmodule, je Target
 * (`ts` und `js`), in getrennten `it`s für klare Per-Schritt-Diagnostik:
 *
 *   AK1  (nur TS) `tsc --noEmit` über das Generat ist grün. Für JS entfällt
 *        der Typecheck (typenlos) — der Vitest-Lauf beweist die ESM-
 *        Ausführbarkeit (#101: „ausführbarer ESM-JS-Code, Node ≥ 22").
 *   AK2  Die generierten `prüfe`→Vitest-Items laufen grün gegen das
 *   AK3  Interpreter-Orakel (bit-genau; §7, Listen, Lambda, Interpolation)
 *        → Vitest-Subprozess liefert Exit 0 + ≥ `minTests` Tests.
 *   AK4  Deterministisch: zwei `codegen`-Läufe → byte-identisch (für JS
 *        zugleich der Beweis, dass der Typ-Strip deterministisch ist).
 *
 * `kraftst` ist mehrdateilig (Intra-Package-ESM-Imports), `gewst` deckt
 * String-Interpolation, `est` Listen + Lambda ab.
 *
 * Voraussetzung (wie `korpus.test.ts`): das CLI-Bundle unter
 * `packages/cli/out/main.js` (aus `npm run build`). Fehlt es, skippt nur
 * DIESE Datei. Erzeugt wird REPO-INTERN (node_modules-Auflösung für
 * `decimal.js`/`vitest`/`typescript`).
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

/** Minimal-`tsconfig` für den isolierten Typecheck des TS-Generats (AK1). */
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
 * (= Anzahl `testfall` in der jeweiligen `*.test.findsl`).
 */
const MODULES: ReadonlyArray<{ dir: string; minTests: number; note: string }> = [
    { dir: 'kst',     minTests: 23, note: 'Basis: konst/fn/wähle/Rundung/§7' },
    { dir: 'kraftst', minTests: 34, note: 'mehrdateilig: Intra-Package-ESM-Imports' },
    { dir: 'gewst',   minTests: 43, note: 'String-Interpolation' },
    { dir: 'est',     minTests: 22, note: 'Listen + Lambda (.zuordnen/.summe)' },
];

/** Die beiden Script-Targets; `tsc=true` → AK1-Typecheck (nur TS). */
const TARGETS: ReadonlyArray<{ lang: 'ts' | 'js'; tsc: boolean; note: string }> = [
    { lang: 'ts', tsc: true,  note: 'TypeScript (tsc + Vitest)' },
    { lang: 'js', tsc: false, note: 'JavaScript (ESM-Typ-Strip, Vitest)' },
];

const cliBuilt = existsSync(CLI);

/** REPO-internes Temp-Verzeichnis (für node_modules-Auflösung). */
function makeTmp(tag: string): string {
    return mkdtempSync(join(REPO_ROOT, `.ts-gate-${tag}-`));
}

/** `findsl codegen examples/<dir> -l <lang> -o <out>`. */
function runCodegen(dir: string, lang: string, outDir: string): ReturnType<typeof spawnSync> {
    return spawnSync(
        'node',
        [CLI, 'codegen', join(REPO_ROOT, 'examples', dir), '-l', lang, '-o', outDir],
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

describe('TS/JS-Codegen-Differential-Gate (Issue #100/#101)', () => {
    beforeAll(() => {
        if (!cliBuilt) {
            console.warn(`SKIP: CLI nicht gebaut (${CLI}). Vorher `
                + '`npm run build` ausführen (im CI-build-Job immer vorhanden).');
        }
    });

    describe.each(TARGETS)('Target $lang ($note)', ({ lang, tsc }) => {
        describe.each(MODULES)('Modul $dir ($note)', ({ dir, minTests }) => {
            // Ein Codegen-Lauf je (Target, Modul), geteilt von AK1 + AK2/3.
            let gen = '';
            beforeAll(() => {
                if (!cliBuilt) return;
                gen = makeTmp(`${lang}-${dir}`);
                expectSpawnOk(runCodegen(dir, lang, gen), `codegen ${lang} ${dir}`);
                if (tsc) writeFileSync(join(gen, 'tsconfig.json'), GEN_TSCONFIG);
            });
            afterAll(() => {
                if (gen) rmSync(gen, { recursive: true, force: true });
            });

            it.skipIf(!cliBuilt || !tsc)('AK1: tsc --noEmit typecheckt das Generat', () => {
                expect(existsSync(join(gen, 'runtime', 'index.ts')),
                    'TS-Runtime nicht mit-ausgeliefert').toBe(true);
                const r = spawnSync('node', [TSC_BIN, '-p', join(gen, 'tsconfig.json')], {
                    encoding: 'utf-8', cwd: gen, timeout: FIVE_MIN,
                });
                expectSpawnOk(r, `tsc ${dir}`);
            }, FIVE_MIN);

            it.skipIf(!cliBuilt)('AK2/AK3: prüfe→Vitest grün, bit-genau (≥ minTests)', () => {
                // Beweist für JS zugleich AK1 (das gestrippte ESM ist
                // ausführbar — Vitest lädt es als echtes Node-ESM).
                expect(existsSync(join(gen, 'runtime', `index.${lang}`)),
                    `Runtime nicht als .${lang} ausgeliefert`).toBe(true);
                const vt = spawnSync(
                    'node',
                    [VITEST_BIN, 'run', '--root', gen, '--reporter=dot', '--no-color'],
                    { encoding: 'utf-8', cwd: REPO_ROOT, timeout: FIVE_MIN },
                );
                const out = `${vt.stdout}\n${vt.stderr}`;
                expect(vt.error, `Vitest-Start fehlgeschlagen: ${vt.error?.message}`).toBeUndefined();
                expect(vt.status, `Vitest rot über ${lang}-Generat:\n${out}`).toBe(0);
                expect(out).not.toMatch(/\bfailed\b/i);
                const passed = out.match(/\bTests\s+(\d+)\s+passed/);
                expect(passed, `kein Tests-Pass-Count im Vitest-Output:\n${out}`).not.toBeNull();
                expect(Number(passed![1])).toBeGreaterThanOrEqual(minTests);
            }, FIVE_MIN);

            it.skipIf(!cliBuilt)('AK4: zwei codegen-Läufe → byte-identisch', () => {
                const a = makeTmp(`${lang}-${dir}-a`);
                const b = makeTmp(`${lang}-${dir}-b`);
                try {
                    expectSpawnOk(runCodegen(dir, lang, a), `codegen A ${lang} ${dir}`);
                    expectSpawnOk(runCodegen(dir, lang, b), `codegen B ${lang} ${dir}`);
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
});
