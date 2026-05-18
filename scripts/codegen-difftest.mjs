// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Differential-Test-Gate für den Java-Codegen (Issue #7, ADR10).
 *
 * Phase 0: verifiziert die `findsl-runtime` (Gradle-Wrapper-Build +
 * JUnit). Phase 1: generiert `examples/kst` → Java, kompiliert es gegen
 * die Runtime und führt den handgeschriebenen Differential-Treiber
 * (`fixtures/KstDifferential.java`) mit den exakten kst.test-Eingaben/
 * Orakel-Sollwerten aus. Phase 3 ersetzt den Treiber durch
 * `prüfe`→JUnit + `runPruefe`-Klassifikationsvergleich.
 *
 * Voraussetzung: `npm run build` lief (CLI unter packages/cli/out/).
 *
 * ADR10-Regel: Fehlt eine JDK-Toolchain (Node-only-CI), wird sauber
 * **übersprungen** mit klarer Meldung und Exit 0 — kein CI-Fail im
 * Node-Job. Der eigenständige JDK-21-CI-Job (Folge-Ticket) macht dies
 * dann zum harten Gate.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = join(repoRoot, 'runtimes', 'java');
const isWin = process.platform === 'win32';
const FIVE_MIN = 5 * 60 * 1000;

/** spawnSync mit Timeout/Fehler-Diagnose; bricht das Gate bei Problemen ab. */
function run(cmd, args, opts, was) {
    const r = spawnSync(cmd, args, { stdio: 'inherit', timeout: FIVE_MIN, ...opts });
    if (r.signal === 'SIGTERM') {
        console.error(`✗ codegen:difftest abgebrochen — Zeitlimit bei: ${was}.`);
        process.exit(1);
    }
    if (r.error) {
        console.error(`✗ codegen:difftest: ${was} fehlgeschlagen: ${r.error.message}`);
        process.exit(1);
    }
    return r.status ?? 1;
}

function hasJdk() {
    // `javac` (nicht nur `java`) — der Differential kompiliert; eine
    // reine JRE würde sonst erst spät mit ENOENT scheitern.
    const r = spawnSync('javac', ['-version'], { stdio: 'ignore' });
    return r.status === 0 && !r.error;
}

if (!hasJdk()) {
    console.log('⏭  codegen:difftest übersprungen — keine JDK-Toolchain '
        + 'gefunden (ADR10: kein Fail im Node-Job). Lokal mit JDK 21 '
        + 'ausführen oder via separatem JDK-CI-Job (Folge-Ticket).');
    process.exit(0);
}

const gradlew = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
if (!existsSync(join(runtimeDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'))) {
    console.error('✗ runtimes/java/gradlew fehlt — Gradle-Wrapper nicht eingerichtet.');
    process.exit(1);
}

// --- Phase 0: Runtime-Build + JUnit (kompiliert zugleich main-Klassen) ---
console.log('▶  findsl-runtime: Gradle-Wrapper-Build + JUnit (Phase 0)…');
const gradleStatus = spawnSync(gradlew, ['test', '--console=plain'], {
    cwd: runtimeDir, stdio: 'inherit', shell: isWin, timeout: 10 * 60 * 1000,
});
if (gradleStatus.signal === 'SIGTERM') {
    console.error('✗ codegen:difftest abgebrochen — Zeitlimit (Gradle, 10 min).');
    process.exit(1);
}
if (gradleStatus.error) {
    console.error(`✗ Gradle-Start fehlgeschlagen: ${gradleStatus.error.message}`);
    process.exit(1);
}
if ((gradleStatus.status ?? 1) !== 0) process.exit(gradleStatus.status ?? 1);

// --- Phase 1: kst → Java generieren, gegen Runtime kompilieren, Treiber ---
const cli = join(repoRoot, 'packages', 'cli', 'out', 'main.js');
if (!existsSync(cli)) {
    console.error('✗ packages/cli/out/main.js fehlt — vorher `npm run build`.');
    process.exit(1);
}
const rtClasses = join(runtimeDir, 'build', 'classes', 'java', 'main');
if (!existsSync(rtClasses)) {
    console.error('✗ Runtime-Klassen fehlen (Gradle-Build unvollständig).');
    process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), 'findsl-difftest-'));
const driver = join(repoRoot, 'packages', 'core', 'test', 'codegen',
    'fixtures', 'KstDifferential.java');

console.log('▶  Phase 1: examples/kst → Java + Differential…');
run('node', [cli, 'codegen', join(repoRoot, 'examples', 'kst', 'kst.findsl'),
    '-l', 'java', '-o', work], {}, 'kst-Codegen');
copyFileSync(driver, join(work, 'KstDifferential.java'));
const cp = isWin ? `${work};${rtClasses}` : `${work}:${rtClasses}`;
run('javac', ['-encoding', 'UTF-8', '-cp', rtClasses, '-d', work,
    join(work, 'Kst.java'), join(work, 'KstDifferential.java')], {}, 'javac');
const diff = run('java', ['-cp', cp, 'org.findsl.generated.KstDifferential'],
    {}, 'Differential-Treiber');
process.exit(diff);
