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
import {
    existsSync, mkdtempSync, copyFileSync, mkdirSync, readdirSync,
    readFileSync, rmSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
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

// --- Phase 1+2: je Modul generieren → gegen Runtime kompilieren → Treiber ---
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
const fixtures = join(repoRoot, 'packages', 'core', 'test', 'codegen', 'fixtures');
// ADR8: codegen erwartet ein Basisverzeichnis. `examples/kst` enthält
// nur kst.findsl direkt → unbenanntes Package → <work>/Kst.java
// (kst.test.findsl wird übersprungen → JUnit, Inkrement 3). Treiber
// liegen daher ebenfalls im unbenannten Package (Aufruf ohne Präfix).
const MODULE = [
    { dir: 'examples/kst', cls: 'Kst', driver: 'KstDifferential.java', phase: '1 (kst)' },
    { dir: 'examples/est', cls: 'Est', driver: 'EstDifferential.java', phase: '2 (est)' },
];

for (const m of MODULE) {
    console.log(`▶  Phase ${m.phase}: ${m.dir} → Java + Differential…`);
    const work = mkdtempSync(join(tmpdir(), 'findsl-difftest-'));
    run('node', [cli, 'codegen', join(repoRoot, m.dir), '-l', 'java', '-o', work],
        {}, `${m.cls}-Codegen`);
    copyFileSync(join(fixtures, m.driver), join(work, m.driver));
    const cp = isWin ? `${work};${rtClasses}` : `${work}:${rtClasses}`;
    // Pro Modul ZWEI generierte Dateien (Interface + `…Impl`) + Treiber.
    // Die ebenfalls erzeugte JUnit-Klasse `<Name>Test.java` (–t fällt
    // auf –o zurück) wird hier ausgeschlossen — sie braucht JUnit im
    // Klassenpfad und wird separat (Phase 3) verifiziert.
    const javaSrcs = readdirSync(work)
        .filter((f) => f.endsWith('.java') && !f.endsWith('Test.java'))
        .map((f) => join(work, f));
    run('javac', ['-encoding', 'UTF-8', '-cp', rtClasses, '-d', work,
        ...javaSrcs], {}, `javac ${m.cls}`);
    const status = run('java', ['-cp', cp,
        m.driver.replace('.java', '')],
        {}, `Differential ${m.cls}`);
    if (status !== 0) process.exit(status);
}

// --- Phase 3 (kraftst): Cross-Modul → generiertes JUnit5 = Orakel ---
//
// kraftst (3×`verwende`) → Java + `KraftstTest` aus `kraftst.test.findsl`.
// Soll-Verhalten = `findsl test` (runPruefeDecl). Statt Hand-Treiber wird
// das GENERIERTE JUnit gegen die Runtime ausgeführt; grün ⇔ bit-genau.
// JUnit-Platform-Console-Standalone gepinnt (Version+SHA-256), Bezug aus
// scripts/lib/ (offline) oder Maven Central (curl/wget); fehlt beides →
// nur Phase 3 überspringen (ADR10-Stil), Phase 0–2 bleiben Gate.

const JUNIT_VER = '1.11.4';
const JUNIT_SHA256 =
    'b016ef6b1c3454d6d7c2c88ce081dabf289699686af6622d6e4e2e1b54b4a2fc';
const libDir = join(repoRoot, 'scripts', 'lib');
const jpcs = join(libDir, `junit-platform-console-standalone-${JUNIT_VER}.jar`);

function sha256(file) {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function ensureJunitJar() {
    if (existsSync(jpcs) && sha256(jpcs) === JUNIT_SHA256) return jpcs;
    mkdirSync(libDir, { recursive: true });
    const url = 'https://repo1.maven.org/maven2/org/junit/platform/'
        + `junit-platform-console-standalone/${JUNIT_VER}/`
        + `junit-platform-console-standalone-${JUNIT_VER}.jar`;
    const tools = [
        ['curl', ['-fsSL', '-o', jpcs, url]],
        ['wget', ['-qO', jpcs, url]],
    ];
    for (const [cmd, args] of tools) {
        const probe = spawnSync(cmd, ['--version'], { stdio: 'ignore' });
        if (probe.error || probe.status !== 0) continue;
        const r = spawnSync(cmd, args, { stdio: 'ignore', timeout: FIVE_MIN });
        if (r.error || r.status !== 0 || !existsSync(jpcs)) continue;
        if (sha256(jpcs) === JUNIT_SHA256) return jpcs;
        // SHA-Mismatch = potenziell manipuliertes Artefakt: bewusst ALLE
        // Download-Versuche abbrechen (kein wget-Fallback nach einem
        // verdächtigen Treffer), Datei verwerfen, Phase 3 überspringen.
        console.error(`✗ JUnit-JAR SHA-256-Mismatch (${JUNIT_VER}) — verworfen.`);
        rmSync(jpcs, { force: true });
        return null;
    }
    return null;
}

const jpcsPath = ensureJunitJar();
if (!jpcsPath) {
    console.log('⏭  Phase 3 (kraftst prüfe→JUnit) übersprungen — '
        + 'JUnit-Console-Standalone weder in scripts/lib/ noch via '
        + 'curl/wget beziehbar (offline). Phase 0–2 grün.');
    process.exit(0);
}

console.log('▶  Phase 3 (kraftst): examples/kraftst → Java + generiertes JUnit…');
const wm = mkdtempSync(join(tmpdir(), 'findsl-difftest-km-'));
const wt = mkdtempSync(join(tmpdir(), 'findsl-difftest-kt-'));
const wc = mkdtempSync(join(tmpdir(), 'findsl-difftest-kc-'));
// examples/kraftst als Basis ⇒ alle Dateien direkt darin ⇒ unbenanntes
// Package; KraftstTest ohne Paket-Präfix selektieren.
run('node', [cli, 'codegen', join(repoRoot, 'examples', 'kraftst'),
    '-l', 'java', '-o', wm, '-t', wt], {}, 'kraftst-Codegen');
const sut = readdirSync(wm).filter((f) => f.endsWith('.java')).map((f) => join(wm, f));
const testSrc = join(wt, 'KraftstTest.java');
if (!existsSync(testSrc)) {
    console.error('✗ KraftstTest.java nicht generiert (Phase 3).');
    process.exit(1);
}
const cpJoin = (parts) => parts.join(isWin ? ';' : ':');
run('javac', ['-encoding', 'UTF-8', '-cp', cpJoin([rtClasses, jpcsPath]),
    '-d', wc, ...sut, testSrc], {}, 'javac kraftst + KraftstTest');
const stK = run('java', ['-jar', jpcsPath, 'execute',
    '-cp', cpJoin([wc, rtClasses]), '-c', 'KraftstTest',
    '--disable-banner', '--fail-if-no-tests'], {}, 'JUnit kraftst');
if (stK !== 0) process.exit(stK);
console.log('✓ Phase 3 (kraftst): generiertes JUnit = Interpreter-Orakel (bit-genau).');
process.exit(0);
