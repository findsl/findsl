// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Differential-Test-Gate für den Java-Codegen (Issue #7, ADR10).
 *
 * Phase 0: verifiziert die `findsl-runtime` (Gradle-Wrapper-Build +
 * JUnit). Phase 3+ erweitert dies um den Interpreter↔Java-Vergleich
 * (`runPruefe`-Klassifikation == JUnit-Klassifikation) über die
 * Beispielmodule.
 *
 * ADR10-Regel: Fehlt eine JDK-Toolchain (Node-only-CI), wird sauber
 * **übersprungen** mit klarer Meldung und Exit 0 — kein CI-Fail im
 * Node-Job. Der eigenständige JDK-21-CI-Job (Folge-Ticket) macht dies
 * dann zum harten Gate.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = join(repoRoot, 'runtimes', 'java');

function hasJdk() {
    const r = spawnSync('java', ['-version'], { stdio: 'ignore' });
    return r.status === 0;
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

console.log('▶  findsl-runtime: Gradle-Wrapper-Build + JUnit (Phase 0)…');
const isWin = process.platform === 'win32';
const res = spawnSync(gradlew, ['test', '--console=plain'], {
    cwd: runtimeDir,
    stdio: 'inherit',
    // Windows kann `gradlew.bat` nur über die Shell starten (sonst ENOENT).
    shell: isWin,
    // Hängender Gradle-Daemon/Dependency-Download darf das Gate nicht
    // unbegrenzt einfrieren.
    timeout: 10 * 60 * 1000,
});
if (res.signal === 'SIGTERM') {
    console.error('✗ codegen:difftest abgebrochen — Zeitlimit (10 min) überschritten.');
    process.exit(1);
}
if (res.error) {
    console.error(`✗ codegen:difftest konnte Gradle nicht starten: ${res.error.message}`);
    process.exit(1);
}
process.exit(res.status ?? 1);
