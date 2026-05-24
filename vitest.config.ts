// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

import { defineConfig, configDefaults } from 'vitest/config';

/**
 * Root-Vitest-Konfiguration.
 *
 * Einziger Zweck: verschachtelte git-Worktrees unter `.claude/worktrees/`
 * vom Test-Scan ausschließen. Ohne diesen Ausschluss scannt `vitest run`
 * vom Repo-Root aus auch jede dort liegende Worktree-Kopie mit — das
 * vervielfacht die Testanzahl und zieht veraltete Test-Stände (z. B. ein
 * noch nicht aktualisiertes `ts-gate.test.ts`) als Phantom-`skipped`/Fehler
 * mit herein. Die übrigen Vitest-Defaults bleiben unverändert.
 */
export default defineConfig({
    test: {
        exclude: [...configDefaults.exclude, '**/.claude/**'],
    },
});
