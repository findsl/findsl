#!/usr/bin/env node
/**
 * Single Source of Truth: `VERSION` an der Repo-Wurzel.
 * Propagiert in alle versionsführenden Stellen:
 *   • root `package.json` + alle Workspaces (`packages/*`, `apps/*`)
 *   • die hartcodierte CLI-Version (`commander .version('…')` in
 *     `packages/cli/src/main.ts`) — sonst meldete `findsl --version` nach
 *     einem Release weiter die alte Nummer (das gebündelte Binary kann die
 *     package.json zur Laufzeit nicht zuverlässig lesen).
 *   • `pluginVersion` des IntelliJ-Plugins (`apps/intellij/gradle.properties`)
 *     — `apps/intellij` ist ein Gradle-Modul (kein npm-Workspace) und wird
 *     daher separat über die `.properties`-Datei gepflegt.
 *
 * `runtimes/java/build.gradle.kts` liest direkt aus dieser Datei via
 * `rootDir.parentFile.parentFile.resolve("VERSION")` — kein zweiter Schreibort.
 *
 * Verwendung:
 *   node scripts/sync-version.mjs              # propagiert VERSION → überall
 *   node scripts/sync-version.mjs --check      # verifiziert Gleichstand (Exit 1 sonst)
 *   node scripts/sync-version.mjs --set X.Y.Z  # schreibt VERSION, dann propagiert
 *
 * Lockstep-Garantie: alle Artefakte (npm, vsix, jar, binary) tragen dieselbe Version.
 * Wird von `.github/workflows/release.yml` als erste Stufe ausgeführt; das Skript
 * exit-1t, falls die Tag-Version nicht zur Datei passt.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const versionFile = path.join(repoRoot, 'VERSION');

// SemVer mit optionalem Pre-Release-Tag (z. B. `1.0.0-rc.1`, `1.0.0-SNAPSHOT`).
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const setIdx = args.indexOf('--set');
const setVersion = setIdx >= 0 ? args[setIdx + 1] : null;

if (setVersion) {
    if (!SEMVER.test(setVersion)) {
        console.error(`✗ Ungültige SemVer: ${setVersion}`);
        process.exit(1);
    }
    fs.writeFileSync(versionFile, setVersion + '\n');
    console.log(`[sync-version] VERSION → ${setVersion}`);
}

const version = fs.readFileSync(versionFile, 'utf8').trim();
if (!SEMVER.test(version)) {
    console.error(`✗ VERSION (${version}) ist keine gültige SemVer.`);
    process.exit(1);
}

const targets = [
    path.join(repoRoot, 'package.json'),
    ...listPackageJsons(path.join(repoRoot, 'packages')),
    ...listPackageJsons(path.join(repoRoot, 'apps')),
];

let mismatches = 0;
for (const file of targets) {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
    const expectedDeps = collectInternalDeps(pkg, version);
    const drift = pkg.version !== version || expectedDeps.length > 0;
    if (!drift) continue;
    if (checkOnly) {
        if (pkg.version !== version) {
            console.error(`✗ ${rel(file)}: version ${pkg.version} ≠ ${version}`);
        }
        for (const { group, name, current } of expectedDeps) {
            console.error(`✗ ${rel(file)}: ${group}.${name} = ${current} ≠ ${version}`);
        }
        mismatches += 1 + expectedDeps.length;
        continue;
    }
    pkg.version = version;
    for (const { group, name } of expectedDeps) {
        pkg[group][name] = version;
    }
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
    console.log(`[sync-version] ${rel(file)} → ${version}`);
}

// Hartcodierte CLI-Version (kein package.json, aber dieselbe Lockstep-Quelle).
mismatches += syncCliVersion(
    path.join(repoRoot, 'packages', 'cli', 'src', 'main.ts'), version, checkOnly);

// IntelliJ-Plugin (Gradle-Modul, kein package.json): `pluginVersion`-Property.
mismatches += syncGradleProperty(
    path.join(repoRoot, 'apps', 'intellij', 'gradle.properties'),
    'pluginVersion', version, checkOnly);

if (checkOnly && mismatches > 0) {
    console.error(`\n✗ ${mismatches} Version(en) divergieren von ${version}. ` +
        `Lauf \`node scripts/sync-version.mjs\` ohne --check.`);
    process.exit(1);
}

if (checkOnly) {
    console.log(`✓ Alle Versionen synchron auf ${version}.`);
}

// Listet `@findsl/*`-Einträge in dependencies/devDependencies/peerDependencies,
// deren Range nicht exakt der Lockstep-Version entspricht. Sammelt alle
// Drifts — wichtig für `--check`, damit ein einzelner Lauf alle Probleme
// meldet statt nach dem ersten Fehler abzubrechen.
function collectInternalDeps(pkg, version) {
    const groups = ['dependencies', 'devDependencies', 'peerDependencies'];
    const out = [];
    for (const group of groups) {
        const deps = pkg[group];
        if (!deps) continue;
        for (const [name, current] of Object.entries(deps)) {
            if (!name.startsWith('@findsl/')) continue;
            if (current !== version) out.push({ group, name, current });
        }
    }
    return out;
}

/**
 * Synchronisiert die hartcodierte `commander`-`.version('X')` einer
 * TS-Quelldatei mit der Lockstep-Version. Liefert die Anzahl der Drifts
 * (0 oder 1) für den `--check`-Summenzähler. Fehlt das Muster (z. B. weil
 * die CLI später aus der package.json liest), wird mit Hinweis übersprungen
 * — kein harter Fehler, damit ein künftiges Refactoring nicht bricht.
 */
function syncCliVersion(file, version, checkOnly) {
    if (!fs.existsSync(file)) return 0;
    const src = fs.readFileSync(file, 'utf8');
    const re = /\.version\((['"])(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\1\)/;
    const m = src.match(re);
    if (!m) {
        console.log(`[sync-version] Hinweis: kein \`.version('…')\` in ${rel(file)} — übersprungen.`);
        return 0;
    }
    if (m[2] === version) return 0;
    if (checkOnly) {
        console.error(`✗ ${rel(file)}: .version() ${m[2]} ≠ ${version}`);
        return 1;
    }
    fs.writeFileSync(file, src.replace(re, (_full, q) => `.version(${q}${version}${q})`));
    console.log(`[sync-version] ${rel(file)} (.version) → ${version}`);
    return 0;
}

/**
 * Synchronisiert eine `key = X`-Zeile einer `.properties`-Datei (z. B.
 * `pluginVersion` in `apps/intellij/gradle.properties` — Gradle-Modul, kein
 * package.json) mit der Lockstep-Version. Liefert die Anzahl der Drifts (0
 * oder 1) für den `--check`-Summenzähler. Fehlt der Key, wird mit Hinweis
 * übersprungen — kein harter Fehler, damit ein künftiges Umbenennen nicht bricht.
 */
function syncGradleProperty(file, key, version, checkOnly) {
    if (!fs.existsSync(file)) return 0;
    const src = fs.readFileSync(file, 'utf8');
    const re = new RegExp(
        `^(\\s*${key}\\s*=\\s*)(\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?)\\s*$`, 'm');
    const m = src.match(re);
    if (!m) {
        console.log(`[sync-version] Hinweis: kein \`${key} = …\` in ${rel(file)} — übersprungen.`);
        return 0;
    }
    if (m[2] === version) return 0;
    if (checkOnly) {
        console.error(`✗ ${rel(file)}: ${key} ${m[2]} ≠ ${version}`);
        return 1;
    }
    fs.writeFileSync(file, src.replace(re, `$1${version}`));
    console.log(`[sync-version] ${rel(file)} (${key}) → ${version}`);
    return 0;
}

function listPackageJsons(dir) {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(dir, e.name, 'package.json'))
        .filter((p) => fs.existsSync(p));
}

function rel(p) {
    return path.relative(repoRoot, p);
}
