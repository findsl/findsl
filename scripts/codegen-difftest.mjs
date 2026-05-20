// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Differential-Test-Gate für den Java-Codegen (Issue #7, ADR10) —
 * **schlanker Delegator** an das Gradle-Gate.
 *
 * Die gesamte Logik (FinDSL → Java generieren, gegen die Runtime
 * kompilieren, das generierte `prüfe`→JUnit ausführen = bit-genaues
 * Interpreter-Orakel, plus die JavaParser-Struktur-Invarianten) lebt
 * jetzt deklarativ in `runtimes/java/build.gradle.kts` und hängt an
 * `check`:
 *   • `generateFindslJava` — Node-Codegen-CLI → generated/{,-test}
 *   • `generatedTest`      — generiertes prüfe→JUnit (bit-genau)
 *   • `structureTest`      — Form-Invarianten via JavaParser
 *   • `test`               — nur Hand-Runtime (JDK-only, node-frei)
 *
 * Dieses Skript orchestriert nichts mehr selbst (kein tmpdir/javac/
 * junit-console-standalone) — es delegiert an `./gradlew check`. So
 * gibt es genau EINE Wahrheit; `npm run codegen:difftest` bleibt als
 * Einstieg erhalten.
 *
 * Voraussetzung: `npm run build` lief (CLI unter packages/cli/out/);
 * fehlt es, scheitert der Gradle-Task `generateFindslJava` mit klarer
 * Meldung (NICHT still grün).
 *
 * ADR10-Regel: Fehlt eine JDK-Toolchain (Node-only-CI), wird sauber
 * **übersprungen** mit klarer Meldung und Exit 0 — kein CI-Fail im
 * Node-Job. Der eigenständige JDK-21-CI-Job macht `./gradlew check`
 * dann zum harten Gate.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = join(repoRoot, 'runtimes', 'java');
const isWin = process.platform === 'win32';
const TEN_MIN = 10 * 60 * 1000;

function hasJdk() {
    // `javac` (nicht nur `java`) — die Gradle-Toolchain kompiliert; eine
    // reine JRE würde sonst erst spät scheitern.
    const r = spawnSync('javac', ['-version'], { stdio: 'ignore' });
    return r.status === 0 && !r.error;
}

if (!hasJdk()) {
    console.log('⏭  codegen:difftest übersprungen — keine JDK-Toolchain '
        + 'gefunden (ADR10: kein Fail im Node-Job). Lokal mit JDK 21 '
        + 'ausführen oder via separatem JDK-CI-Job.');
    process.exit(0);
}

const gradlew = isWin ? 'gradlew.bat' : './gradlew';
if (!existsSync(join(runtimeDir, isWin ? 'gradlew.bat' : 'gradlew'))) {
    console.error('✗ runtimes/java/gradlew fehlt — Gradle-Wrapper nicht eingerichtet.');
    process.exit(1);
}

// Volles Gate: Codegen → Compile → generiertes prüfe→JUnit (bit-genau)
// + JavaParser-Struktur-Invarianten + Hand-Runtime-JUnit. Eine Wahrheit.
console.log('▶  findsl-runtime: ./gradlew check (Codegen-Gate, Issue #7)…');
const r = spawnSync(gradlew, ['check', '--console=plain'], {
    cwd: runtimeDir, stdio: 'inherit', shell: isWin, timeout: TEN_MIN,
});
if (r.signal === 'SIGTERM') {
    console.error('✗ codegen:difftest abgebrochen — Zeitlimit (Gradle, 10 min).');
    process.exit(1);
}
if (r.error) {
    console.error(`✗ Gradle-Start fehlgeschlagen: ${r.error.message}`);
    process.exit(1);
}
process.exit(r.status ?? 1);
