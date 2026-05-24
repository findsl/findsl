#!/usr/bin/env node
// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * `findsl-editor-copy-worker [zielverzeichnis]`
 *
 * Kopiert das vorgebaute `@findsl/web`-Bundle (LSP-Worker + Lazy-Chunks +
 * Grammatik/Config-Assets) als statisches Asset in das Zielverzeichnis
 * (Default: `public/findsl-web`, relativ zum aktuellen Verzeichnis). Der
 * Konsument hostet den Worker selbst (kein Re-Bundling des ~2-MB-Pre-Builds);
 * `mountFindslEditor` lädt ihn über `workerUrl` (Default `findsl-web/worker.js`).
 *
 * Typisch als `prebuild`/`predev`-Schritt:
 *   "predev":   "findsl-editor-copy-worker",
 *   "prebuild": "findsl-editor-copy-worker"
 */

import { cp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';

const cwd = process.cwd();
const dest = resolve(cwd, process.argv[2] ?? 'public/findsl-web');

// Guard: `dest` MUSS ein echtes Unterverzeichnis von cwd sein. Dies ist ein
// publiziertes `bin` (prebuild/predev); ein `rm -rf` auf einem ungeprüften
// Argument wäre destruktiv — `findsl-editor-copy-worker public` (plausibel,
// da Default `public/findsl-web`) würde sonst `public/` tilgen, `.`/`..` den
// Projektbaum.
if (dest === cwd || !dest.startsWith(cwd + sep)) {
    console.error(`[findsl-editor] Zielverzeichnis muss UNTER ${cwd} liegen: ${dest}`);
    process.exit(1);
}

// `@findsl/web` aus Sicht des aufrufenden Projekts auflösen (dort installiert).
const require = createRequire(join(cwd, 'package.json'));
let webDist;
try {
    webDist = dirname(require.resolve('@findsl/web'));
} catch {
    console.error('[findsl-editor] @findsl/web nicht auflösbar — als (peer)dependency installieren.');
    process.exit(1);
}
if (!existsSync(webDist)) {
    console.error(`[findsl-editor] @findsl/web-Bundle nicht gefunden: ${webDist}`);
    process.exit(1);
}

console.log(`[findsl-editor] ${webDist} → ${dest}`);
try {
    // Kein `force` beim rm — echte Fehler (Permission) sichtbar lassen; den
    // „existiert noch nicht"-Fall via existsSync abfangen (kein ENOENT-Wurf).
    if (existsSync(dest)) await rm(dest, { recursive: true });
    await mkdir(dest, { recursive: true });
    await cp(webDist, dest, { recursive: true });
} catch (err) {
    console.error(`[findsl-editor] Kopieren fehlgeschlagen (Ziel evtl. unvollständig): ${dest}`, err);
    process.exit(1);
}

// Post-Copy-Sentinel: der Worker muss angekommen sein (robust gegen künftige
// `@findsl/web`-Dist-Umstrukturierung — sonst erst ein 404 im Browser).
if (!existsSync(join(dest, 'worker.js'))) {
    console.error(`[findsl-editor] worker.js fehlt nach dem Kopieren: ${join(dest, 'worker.js')}`);
    process.exit(1);
}
console.log('[findsl-editor] ok — worker.js vorhanden.');
