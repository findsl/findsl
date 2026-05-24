// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Mocking-Naht für das TS-/JS-Generat (Issue #142) — Folge zu #141 (Java-DI).
 *
 * #141 stellt den **Java**-Codegen auf Konstruktor-Injektion + Factory um,
 * weil Mockito einen Injektionspunkt braucht. Für **TS/ESM** ist das
 * idiomatische Äquivalent **Modul-Mocking** (`vi.mock('./Dep.js')`): die
 * generierten Module sind reine, zustandslose Top-Level-Funktionen, und der
 * EINZIGE Cross-Modul-Kopplungspunkt ist der Namespace-Import
 * (`import * as Owner` + `Owner.methode(…)`, `emit-ts/emitter.ts`). Genau
 * diese Kante ist die Mocking-Naht — eine **bewusste, dokumentierte**
 * strukturelle Asymmetrie zu #141 (kein Klassen-/Factory-Umbau).
 *
 * Dieser Test SICHERT die Naht ab (statt das Generat umzubauen):
 *   1. **Regressionsschutz:** alle Cross-Modul-`fn`-Aufrufe laufen NUR über
 *      die Namespace-Import-Naht — kein direkter, nicht-mockbarer Named-Import.
 *   2. **Mock greift (TS + JS):** ein per `vi.mock` gestubbtes Sub-Modul
 *      verändert das Ergebnis des komponierenden Moduls nachweisbar.
 *
 * JS = deterministischer Typ-Strip des TS (`emit-js/strip.ts`) → erbt die
 * Naht automatisch; der `js`-Lauf beweist das.
 *
 * Muster wie `ts-gate.test.ts`: CLI → Repo-internes Temp (node_modules-
 * Auflösung), Vitest im Subprozess. Fehlt das CLI-Bundle, skippt nur DIESE
 * Datei.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const CLI = join(REPO_ROOT, 'packages', 'cli', 'out', 'main.js');
const VITEST_BIN = join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs');
const FIVE_MIN = 5 * 60 * 1000;
const cliBuilt = existsSync(CLI);

function makeTmp(tag: string): string {
    return mkdtempSync(join(REPO_ROOT, `.ts-mock-${tag}-`));
}

function runCodegen(lang: 'ts' | 'js', outDir: string): ReturnType<typeof spawnSync> {
    return spawnSync(
        'node',
        [CLI, 'codegen', join(REPO_ROOT, 'examples', 'kraftst'), '-l', lang, '-o', outDir],
        { encoding: 'utf-8', timeout: FIVE_MIN },
    );
}

function expectSpawnOk(r: ReturnType<typeof spawnSync>, label: string): void {
    expect(r.error, `${label}: Subprozess-Start fehlgeschlagen — ${r.error?.message}`)
        .toBeUndefined();
    expect(r.status, `${label} rot (exit ${String(r.status)}):\n${r.stdout ?? ''}\n${r.stderr ?? ''}`)
        .toBe(0);
}

/**
 * Die in die Gen-Dir gelegte Mock-Fixture. Stubbt `KraftstgTarifLeicht`
 * komplett (`vi.mock`) und lässt `steuerPkw` einen Sentinel-Betrag liefern;
 * `tarifNach9Abs1` muss diesen Stub durchreichen (`EuroCent.von(steuerPkw(f))`)
 * — der echte Tarif-Pfad wird dabei NICHT betreten. Funktioniert für `.ts`
 * (Specifier `./X.js` → `.ts`) wie für `.js` (direkt) gleichermaßen.
 */
const MOCK_FIXTURE = `import { vi, it, expect } from 'vitest';
import * as Tarif from './KraftstgTarifLeicht.js';
import { tarifNach9Abs1 } from './Kraftst.js';
import * as Typen from './KraftstgTypen.js';
import { EuroCent, FinDslNumber } from './runtime/index.js';

vi.mock('./KraftstgTarifLeicht.js');

it('gestubbte steuerPkw verändert das Ergebnis von tarifNach9Abs1', () => {
    // Sentinel-Betrag, der mit hoher Sicherheit ungleich dem echten Tarif ist.
    vi.mocked(Tarif.steuerPkw).mockReturnValue(EuroCent.von(FinDslNumber.dezimal('123.45')));
    // Minimal-Input: tarifNach9Abs1 liest vor dem Pkw-Zweig nur f.art; der
    // gemockte steuerPkw ignoriert f → kein vollständiger Fahrzeug-Record nötig.
    const f = { art: Typen.Fahrzeugart.Pkw } as Typen.Fahrzeug;
    const result = tarifNach9Abs1(f);
    expect(Tarif.steuerPkw).toHaveBeenCalled();
    // Ergebnis = EuroCent.von(Stub) → trägt den Sentinel-Wert, NICHT den Tarif.
    expect(result.equalsValue(FinDslNumber.dezimal('123.45'))).toBe(true);
});
`;

describe('TS/JS-Mocking-Naht für das Generat (Issue #142)', () => {
    it.skipIf(!cliBuilt)('Cross-Modul-Aufrufe laufen NUR über die Namespace-Naht (kein Named-Import)', () => {
        const gen = makeTmp('seam');
        try {
            expectSpawnOk(runCodegen('ts', gen), 'codegen ts kraftst');
            const main = readFileSync(join(gen, 'Kraftst.ts'), 'utf-8');
            // (a) Namespace-Import-Naht vorhanden …
            expect(main).toMatch(/import \* as KraftstgTarifLeicht from '\.\/KraftstgTarifLeicht\.js';/);
            // (b) … und Cross-Calls sind namespace-qualifiziert (mockbar).
            expect(main).toMatch(/KraftstgTarifLeicht\.steuerPkw\(/);
            // (c) KEIN direkter Named-Import aus einem Sibling-Modul (das wäre
            //     der nicht-mockbare Pfad). Runtime-Named-Imports (./runtime)
            //     sind erlaubt und hier bewusst nicht erfasst.
            expect(main).not.toMatch(/import \{[^}]*\} from '\.\/Kraftstg[A-Za-z]*\.js'/);
        } finally {
            rmSync(gen, { recursive: true, force: true });
        }
    });

    describe.each(['ts', 'js'] as const)('Target %s: vi.mock ersetzt das Sub-Modul', (lang) => {
        it.skipIf(!cliBuilt)('gemocktes Sub-Modul verändert das komponierende Modul', () => {
            const gen = makeTmp(`mock-${lang}`);
            try {
                expectSpawnOk(runCodegen(lang, gen), `codegen ${lang} kraftst`);
                writeFileSync(join(gen, 'seam.mock.test.ts'), MOCK_FIXTURE, 'utf-8');
                const vt = spawnSync(
                    'node',
                    [VITEST_BIN, 'run', '--root', gen, 'seam.mock.test.ts', '--reporter=dot', '--no-color'],
                    { encoding: 'utf-8', cwd: REPO_ROOT, timeout: FIVE_MIN },
                );
                const out = `${vt.stdout}\n${vt.stderr}`;
                expect(vt.error, `Vitest-Start fehlgeschlagen: ${vt.error?.message}`).toBeUndefined();
                expect(vt.status, `Mock-Smoke rot über ${lang}-Generat:\n${out}`).toBe(0);
                expect(out).not.toMatch(/\bfailed\b/i);
                expect(out).toMatch(/\b1 passed\b/);
            } finally {
                rmSync(gen, { recursive: true, force: true });
            }
        }, FIVE_MIN);
    });
});
