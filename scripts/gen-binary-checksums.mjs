// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Erzeugt das Checksums-Manifest für die Lazy-Download-Distribution des
 * IntelliJ-Plugins (#244, ADR `apps/intellij/docs/binary-distribution.md`).
 *
 * Das Plugin lädt die nativen Binaries (`findsl-lsp-<os>-<arch>`,
 * `findsl-<os>-<arch>`) zur Laufzeit vom versions-gepinnten GitHub-Release und
 * verifiziert sie gegen dieses **zur Plugin-Build-Zeit eingebettete** Manifest
 * (`/binaries/checksums.json`). Ein manipuliertes Release-Asset wird so
 * abgelehnt.
 *
 * Hasht jede Datei im übergebenen Verzeichnis (= die rohen Release-Binaries):
 *
 *   { "version": "1.2.0", "binaries": { "findsl-lsp-darwin-arm64": "<sha256>", … } }
 *
 * Aufruf: node scripts/gen-binary-checksums.mjs <binaries-dir> <version> <out-json>
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Liest alle regulären Dateien aus `dir`, hasht sie (SHA-256, hex) und liefert
 * das Manifest-Objekt. Deterministische Reihenfolge (Dateiname-sortiert).
 */
export function computeChecksums(dir, version) {
    const names = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort();
    const binaries = {};
    for (const name of names) {
        const buf = fs.readFileSync(path.join(dir, name));
        binaries[name] = createHash('sha256').update(buf).digest('hex');
    }
    return { version, binaries };
}

/** CLI-Entry: nur ausführen, wenn direkt gestartet (nicht beim Test-Import). */
function isMain() {
    return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
}

if (isMain()) {
    const [dir, version, out] = process.argv.slice(2);
    if (!dir || !version || !out) {
        console.error('Usage: node scripts/gen-binary-checksums.mjs <binaries-dir> <version> <out-json>');
        process.exit(2);
    }
    const manifest = computeChecksums(dir, version);
    const count = Object.keys(manifest.binaries).length;
    if (count === 0) {
        console.error(`✗ Keine Binaries in ${dir} gefunden — Manifest wäre leer.`);
        process.exit(1);
    }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`[checksums] ${count} Binaries → ${out} (v${version})`);
}
