// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * CLI-Integrationstest für `findsl test --reporter=teamcity` (#256, Akzeptanz).
 *
 * Startet das gebaute CLI als Subprozess gegen ein echtes Beispielmodul und
 * prüft, dass valide, balancierte TeamCity-Service-Messages herauskommen — die
 * Grundlage dafür, dass IntelliJs Test-Runner-Fenster daraus einen Test-Baum
 * rendert. Der human-Default darf KEINE solchen Messages enthalten.
 */

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const REPO_ROOT = resolve(__dirname, '../../../..');
const CLI = join(REPO_ROOT, 'packages', 'cli', 'out', 'main.js');
const TEST_FILE = join(REPO_ROOT, 'examples', 'kst', 'kst.test.findsl');

function cliExists(): boolean {
    try {
        readFileSync(CLI);
        return true;
    } catch {
        return false;
    }
}

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync('node', [CLI, ...args], { encoding: 'utf-8' });
    return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

describe('CLI: findsl test --reporter=teamcity (#256)', () => {
    it('gibt valide, balancierte TeamCity-Service-Messages aus', () => {
        if (!cliExists()) {
            console.warn(`SKIP: CLI nicht gebaut (${CLI}). Vorher \`npm run build\` ausführen.`);
            return;
        }
        const r = runCli(['test', TEST_FILE, '--reporter=teamcity']);
        expect(r.status, `Run rot: ${r.stderr}`).toBe(0); // kst-Tests bestehen

        const lines = r.stdout.split('\n').filter((l) => l.trim().length > 0);
        // Jede stdout-Zeile ist eine TeamCity-Message — kein human-Rauschen,
        // das IntelliJs Message-Parser stören würde.
        expect(lines.every((l) => l.startsWith('##teamcity['))).toBe(true);

        // Datei-Suite + mind. eine prüfe-Suite; Suite-Tags balanciert.
        const suiteStarted = lines.filter((l) => l.includes('testSuiteStarted')).length;
        const suiteFinished = lines.filter((l) => l.includes('testSuiteFinished')).length;
        expect(suiteStarted).toBe(suiteFinished);
        expect(suiteStarted).toBeGreaterThanOrEqual(2);

        // Jeder testStarted hat ein testFinished.
        const started = lines.filter((l) => l.includes('testStarted name=')).length;
        const finished = lines.filter((l) => l.includes('testFinished name=')).length;
        expect(started).toBe(finished);
        expect(started).toBeGreaterThan(0);
    });

    it('human-Reporter (Default) gibt KEINE TeamCity-Messages aus', () => {
        if (!cliExists()) return;
        const r = runCli(['test', TEST_FILE]);
        expect(r.stdout).not.toContain('##teamcity[');
    });

    it('unbekannter --reporter bricht mit Exit-Code 2 ab', () => {
        if (!cliExists()) return;
        const r = runCli(['test', TEST_FILE, '--reporter=junit']);
        expect(r.status).toBe(2);
        expect(r.stderr).toContain('Unbekannter --reporter');
    });
});
