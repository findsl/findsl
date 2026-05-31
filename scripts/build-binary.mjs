/**
 * Baut **native, Node-freie** Binaries aus den self-contained esbuild-
 * Bundles via **Node SEA** (Single Executable Applications) + `postject`.
 *
 * Targets (Argument `node scripts/build-binary.mjs [cli|lsp|all]`,
 * Default `cli` — rückwärtskompatibel):
 *   - cli → packages/cli/dist/findsl[.exe]      (aus findsl.cjs; CLI parse/test/docgen)
 *   - lsp → packages/lsp/dist/findsl-lsp[.exe]  (aus findsl-lsp.cjs; host-neutraler
 *           LSP-Server für andere Editoren, z. B. IntelliJ via LSP4IJ, #237/#239)
 *
 * Voraussetzung: `npm run bundle` (erzeugt beide `.cjs`-Bundles).
 * Die 14 pdfkit-AFM-Metriken sind seit Issue #121 ins CLI-Bundle eingebettet
 * → das CLI-Binary ist echt self-contained, KEIN sibling `data/` nötig. Der
 * LSP-Server rendert kein PDF und braucht ohnehin kein `data/`.
 *
 * Node SEA kann NICHT cross-kompilieren — es entsteht je ein Binary für die
 * **Host-Plattform** des Build-Rechners. Andere Plattformen brauchen je einen
 * CI-Runner mit gleichem Schritt (#244).
 *
 * Ablauf je Target: sea-config → `node --experimental-sea-config` → Blob →
 * Node-Binär kopieren → (macOS: Signatur entfernen) → `postject` injiziert
 * den Blob → (macOS: ad-hoc neu signieren).
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
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

/** Target-Definitionen: je ein self-contained Bundle → natives Binary. */
const TARGETS = {
    cli: { distDir: path.join(root, 'packages', 'cli', 'dist'), bundleName: 'findsl.cjs',     exeBase: 'findsl' },
    lsp: { distDir: path.join(root, 'packages', 'lsp', 'dist'), bundleName: 'findsl-lsp.cjs', exeBase: 'findsl-lsp' },
};

const arg = process.argv[2] ?? 'cli';
if (!['cli', 'lsp', 'all'].includes(arg)) {
    console.error(`✗ Unbekanntes Target „${arg}" — erlaubt: cli | lsp | all (Default: cli).`);
    process.exit(1);
}
const selected = arg === 'all' ? ['cli', 'lsp'] : [arg];

// postject-CLI einmal auflösen (devDependency).
const require = createRequire(import.meta.url);
let postjectBin;
try {
    postjectBin = require.resolve('postject/dist/cli.js');
} catch {
    console.error('✗ `postject` nicht installiert (npm i -D postject).');
    process.exit(1);
}

// SEA-Sentinel-Fuse einmal aus dem Node-Binär lesen. NICHT hartkodieren —
// Node ändert ihn zwischen Major-Versionen (z. B. v24:
// NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2), während das veröffentlichte
// postject@1.0.0-alpha.6 noch den alten Default hat.
const nodeBuf = fs.readFileSync(process.execPath).toString('latin1');
const fuseMatch = nodeBuf.match(/NODE_SEA_FUSE_[0-9a-fA-F]+/);
if (!fuseMatch) {
    console.error('✗ SEA-Sentinel-Fuse nicht im Node-Binär gefunden — '
        + 'dieser Node-Build unterstützt keine SEA-Injektion.');
    process.exit(1);
}
const fuse = fuseMatch[0];

const run = (cmd, args, opts = {}) =>
    execFileSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });

/** Baut ein einzelnes Target (Bundle → SEA-Blob → injiziertes Node-Binär). */
function buildTarget(key) {
    const { distDir, bundleName, exeBase } = TARGETS[key];
    const bundle = path.join(distDir, bundleName);
    const blob = path.join(distDir, 'sea-prep.blob');
    const seaConfig = path.join(distDir, 'sea-config.json');
    const exeName = isWin ? `${exeBase}.exe` : exeBase;
    const exe = path.join(distDir, exeName);

    if (!fs.existsSync(bundle)) {
        console.error(`✗ ${path.relative(root, bundle)} fehlt — zuerst \`npm run bundle\`.`);
        process.exit(1);
    }

    // 1. SEA-Konfiguration + Blob.
    fs.writeFileSync(seaConfig, JSON.stringify({
        main: bundle,
        output: blob,
        disableExperimentalSEAWarning: true,
    }, null, 2));
    console.log(`[sea:${key}] erzeuge Blob …`);
    run(process.execPath, ['--experimental-sea-config', seaConfig]);

    // 2. Node-Binär als Basis kopieren.
    fs.copyFileSync(process.execPath, exe);
    fs.chmodSync(exe, 0o755);

    // 3. macOS: vorhandene Signatur entfernen (Injektion macht sie ungültig).
    if (isMac) {
        try { run('codesign', ['--remove-signature', exe]); } catch { /* unsigniert */ }
    }

    // 4. Blob injizieren (Fuse oben aus dem Node-Binär gelesen).
    console.log(`[sea:${key}] injiziere Blob via postject (Fuse: ${fuse}) …`);
    const postjectArgs = [
        postjectBin, exeName, 'NODE_SEA_BLOB', path.basename(blob),
        '--sentinel-fuse', fuse,
    ];
    if (isMac) postjectArgs.push('--macho-segment-name', 'NODE_SEA');
    run(process.execPath, postjectArgs, { cwd: distDir });

    // 5. macOS: ad-hoc neu signieren (auf Apple Silicon Pflicht).
    if (isMac) run('codesign', ['--sign', '-', exe]);

    // 6. Aufräumen.
    fs.rmSync(blob, { force: true });
    fs.rmSync(seaConfig, { force: true });

    const mb = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
    console.log(`[sea:${key}] fertig: ${path.relative(root, exe)} (${mb} MB, ${process.platform}-${process.arch})`);
}

for (const key of selected) buildTarget(key);

if (selected.includes('cli')) {
    console.log('[sea] CLI self-contained — AFM-Metriken eingebettet, kein sibling `data/` nötig (Issue #121).');
}
