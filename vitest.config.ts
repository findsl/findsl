// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

import { defineConfig, configDefaults } from 'vitest/config';

/**
 * Root-Vitest-Konfiguration.
 *
 * 1. `test.exclude`: verschachtelte git-Worktrees unter `.claude/worktrees/`
 *    vom Test-Scan ausschließen. Ohne diesen Ausschluss scannt `vitest run`
 *    vom Repo-Root aus auch jede dort liegende Worktree-Kopie mit — das
 *    vervielfacht die Testanzahl und zieht veraltete Test-Stände als
 *    Phantom-`skipped`/Fehler mit herein.
 *
 * 2. `test.coverage` (v8): misst NUR echten, unit-testbaren Quellcode.
 *    Bewusst ausgeschlossen (kein Pseudo-Test sinnvoll):
 *      - Generiertes (`generated/`, `*.generated.ts`) und Typdeklarationen,
 *      - Entry-Points (CLI-/LSP-/Web-`main`, Web-Worker) — über Subprozess/
 *        Integration getestet, nicht in-process instrumentierbar,
 *      - Browser-Polyfills/Shims (`web/src/shims/`).
 */
export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, '**/.claude/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json-summary', 'html'],
            include: ['packages/*/src/**/*.ts'],
            exclude: [
                '**/generated/**',
                '**/*.generated.ts',
                '**/*.d.ts',
                'packages/cli/src/main.ts',
                'packages/lsp/src/main.ts',
                'packages/web/src/main.ts',
                'packages/web/src/worker.ts',
                'packages/web/src/shims/**',
            ],
        },
    },
});
