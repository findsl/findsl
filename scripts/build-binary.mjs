/**
 * Baut ein **natives, Node-freies** `findsl`-Binary aus dem
 * self-contained CLI-Bundle via **Node SEA** (Single Executable
 * Applications) + `postject`.
 *
 * Voraussetzung: `npm run bundle` (erzeugt `packages/cli/dist/findsl.cjs`).
 * Die 14 pdfkit-AFM-Metriken sind seit Issue #121 ins Bundle eingebettet
 * → das Binary ist echt self-contained, KEIN sibling `data/` mehr nötig
 * (auch nicht für `docgen -f pdf`).
 *
 * Node SEA kann NICHT cross-kompilieren — es entsteht ein Binary für
 * die **Host-Plattform** (hier macOS/Linux/Windows des Build-Rechners).
 * Andere Plattformen brauchen je einen CI-Runner mit gleichem Schritt.
 *
 * Ablauf: sea-config → `node --experimental-sea-config` → Blob →
 * Node-Binär kopieren → (macOS: Signatur entfernen) → `postject`
 * injiziert den Blob → (macOS: ad-hoc neu signieren).
 *
 * AKZEPTIERTES RISIKO `postject@1.0.0-alpha.6` (Issue #216, Security-Review
 * 2026-05-29): `alpha.6` ist die einzige je veröffentlichte Version (kein
 * GA), daher kein Update möglich. Es ist Node.js' offizielles SEA-Tool und
 * läuft AUSSCHLIESSLICH build-zeitlich mit hardcodierten Argumenten (s. u.)
 * — kein verteiltes Artefakt enthält postject, kein Laufzeit-/Distributions-
 * Supply-Chain-Pfad. Bei GA-Release auf stabile Version heben + Lock-Hash
 * überwachen.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = process.cwd();
const distDir = path.join(root, 'packages', 'cli', 'dist');
const bundle = path.join(distDir, 'findsl.cjs');
const blob = path.join(distDir, 'sea-prep.blob');
const seaConfig = path.join(distDir, 'sea-config.json');
const exeName = process.platform === 'win32' ? 'findsl.exe' : 'findsl';
const exe = path.join(distDir, exeName);

if (!fs.existsSync(bundle)) {
    console.error(`✗ ${bundle} fehlt — zuerst \`npm run bundle\`.`);
    process.exit(1);
}

// postject-CLI auflösen (devDependency).
const require = createRequire(import.meta.url);
let postjectBin;
try {
    postjectBin = require.resolve('postject/dist/cli.js');
} catch {
    console.error('✗ `postject` nicht installiert (npm i -D postject).');
    process.exit(1);
}

const run = (cmd, args, opts = {}) =>
    execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

// 1. SEA-Konfiguration + Blob.
fs.writeFileSync(seaConfig, JSON.stringify({
    main: bundle,
    output: blob,
    disableExperimentalSEAWarning: true,
}, null, 2));
console.log('[sea] erzeuge Blob …');
run(process.execPath, ['--experimental-sea-config', seaConfig]);

// 2. Node-Binär als Basis kopieren.
fs.copyFileSync(process.execPath, exe);
fs.chmodSync(exe, 0o755);

// 3. macOS: vorhandene Signatur entfernen (Injektion macht sie ungültig).
const isMac = process.platform === 'darwin';
if (isMac) {
    try { run('codesign', ['--remove-signature', exe]); } catch { /* unsigniert */ }
}

// 4. Blob injizieren. Den Sentinel-Fuse NICHT hartkodieren — Node ändert
//    ihn zwischen Major-Versionen (z. B. v24:
//    NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2), während das
//    veröffentlichte post@1.0.0-alpha.6 noch den alten Default hat.
//    Daher den echten Fuse aus dem Node-Binär lesen.
const nodeBuf = fs.readFileSync(process.execPath).toString('latin1');
const fuseMatch = nodeBuf.match(/NODE_SEA_FUSE_[0-9a-fA-F]+/);
if (!fuseMatch) {
    console.error('✗ SEA-Sentinel-Fuse nicht im Node-Binär gefunden — '
        + 'dieser Node-Build unterstützt keine SEA-Injektion.');
    process.exit(1);
}
const fuse = fuseMatch[0];
console.log(`[sea] injiziere Blob via postject (Fuse: ${fuse}) …`);
const postjectArgs = [
    postjectBin, exeName, 'NODE_SEA_BLOB', path.basename(blob),
    '--sentinel-fuse', fuse,
];
if (isMac) postjectArgs.push('--macho-segment-name', 'NODE_SEA');
run(process.execPath, postjectArgs, { cwd: distDir });

// 5. macOS: ad-hoc neu signieren (auf Apple Silicon Pflicht).
if (isMac) run('codesign', ['--sign', '-', exe]);

// 6. Aufräumen; data/ liegt bereits in dist/ neben dem Binary.
fs.rmSync(blob, { force: true });
fs.rmSync(seaConfig, { force: true });

const mb = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
console.log(`[sea] fertig: ${path.relative(root, exe)} (${mb} MB, ${process.platform}-${process.arch})`);
console.log('[sea] self-contained — AFM-Metriken eingebettet, kein sibling `data/` nötig (Issue #121).');
