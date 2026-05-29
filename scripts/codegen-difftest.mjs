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
 * ADR10-Regel: Fehlt eine JDK-Toolchain, wird **lokal** sauber
 * übersprungen (klare Meldung, Exit 0) — kein Fail beim Entwickeln ohne
 * JDK. Der eigenständige JDK-21-CI-Job macht `./gradlew check` zum harten
 * Gate. In CI (`process.env.CI`) ist eine fehlende Toolchain hingegen ein
 * **harter Fehler** (Exit 1, Issue #213): JDK 21 ist dort Pflicht (ADR9);
 * ein stiller Exit 0 würde eine Java-Codegen-Regression maskieren, falls
 * dieses Skript je in einen Node-only-Job verdrahtet wird.
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
    if (process.env.CI) {
        console.error('✗ codegen:difftest abgebrochen — keine JDK-Toolchain '
            + '(javac) gefunden. In CI ist JDK 21 Pflicht (ADR9); der Java-'
            + 'Codegen-Gate darf nicht still übersprungen werden (Issue #213). '
            + 'JDK bereitstellen (siehe .github/workflows/ci.yml, Job „java").');
        process.exit(1);
    }
    console.log('⏭  codegen:difftest übersprungen — keine JDK-Toolchain '
        + 'gefunden (ADR10: lokal kein Fail). Mit JDK 21 ausführen für den '
        + 'vollen Codegen-Gate; in CI erzwingt ihn der separate JDK-Job.');
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
// Defense-in-Depth (Issue #73): `shell: true` würde auf Windows die
// Argumente durch `cmd.exe` interpretieren — Shell-Metacharacters
// könnten dann bei künftigen variablen Args expandieren. Wir starten
// `gradlew.bat` stattdessen explizit über `cmd /c` und lassen `shell:
// false`. Aktuelle Args sind alle hardcoded; das ist reine Vorsorge
// gegen spätere Erweiterungen.
const [bin, baseArgs] = isWin
    ? ['cmd.exe', ['/c', 'gradlew.bat']]
    : [gradlew, []];
const r = spawnSync(bin, [...baseArgs, 'check', '--console=plain'], {
    cwd: runtimeDir, stdio: 'inherit', shell: false, timeout: TEN_MIN,
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
