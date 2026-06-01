// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Test für das Checksums-Manifest der IntelliJ-Lazy-Download-Distribution (#244).
 * Das Format ist ein Vertrag mit dem späteren Download-Client (verifiziert die
 * heruntergeladenen Binaries dagegen), daher hier festgenagelt.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
// @ts-expect-error — reines JS-Skript ohne Typen, bewusst per relativem Pfad.
import { computeChecksums } from '../../../../scripts/gen-binary-checksums.mjs';

function sha256(s: string): string {
    return createHash('sha256').update(Buffer.from(s)).digest('hex');
}

describe('computeChecksums (#244 Lazy-Download-Manifest)', () => {
    it('hasht jede Datei (SHA-256) und nimmt Version + sortierte Namen auf', () => {
        const dir = mkdtempSync(join(tmpdir(), 'findsl-checksums-'));
        try {
            writeFileSync(join(dir, 'findsl-lsp-darwin-arm64'), 'LSP-BINARY');
            writeFileSync(join(dir, 'findsl-darwin-arm64'), 'CLI-BINARY');

            const manifest = computeChecksums(dir, '1.2.0');

            expect(manifest.version).toBe('1.2.0');
            expect(manifest.binaries['findsl-lsp-darwin-arm64']).toBe(sha256('LSP-BINARY'));
            expect(manifest.binaries['findsl-darwin-arm64']).toBe(sha256('CLI-BINARY'));
            // 64 hex-Zeichen je Hash.
            for (const h of Object.values(manifest.binaries)) {
                expect(h).toMatch(/^[0-9a-f]{64}$/);
            }
            // Deterministisch (sortiert).
            expect(Object.keys(manifest.binaries)).toEqual(
                ['findsl-darwin-arm64', 'findsl-lsp-darwin-arm64'],
            );
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('ist deterministisch (zwei Läufe → identisches Manifest)', () => {
        const dir = mkdtempSync(join(tmpdir(), 'findsl-checksums-'));
        try {
            writeFileSync(join(dir, 'findsl-linux-x64'), 'X');
            expect(computeChecksums(dir, '9.9.9')).toEqual(computeChecksums(dir, '9.9.9'));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
