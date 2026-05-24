// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * @findsl/web — Node-Smoke der Worker-API (check/generate). Prüft, dass die
 * Logik LÄUFT (nicht nur bündelt): parse → check → generate je Target gegen
 * ein self-contained Single-File-Modul (EmptyFileSystem, wie im Browser).
 * Der Browser-Pfad (node:-Shims) wird separat über esbuild-Guard verifiziert.
 */

import { describe, it, expect } from 'vitest';
import { EmptyFileSystem, URI } from 'langium';
import { createFindslServices } from '@findsl/core/language/findsl-module.js';
import { runCheck } from '../src/check.js';
import { runGenerate } from '../src/generate.js';
import type { Target } from '../src/types.js';

const SOURCE = [
    '--',
    'Demo-Modul mit Formel $$2x$$.',
    '--',
    'fn Verdopple(x: Ganzzahl): Ganzzahl = x + x',
    '',
    'prüfe "Verdopple" {',
    '    testfall "Verdopple(3) = 6" {',
    '        Verdopple(3) == 6',
    '    }',
    '}',
    '',
].join('\n');

const URI_STR = 'inmemory://playground/main.findsl';

async function setup(): Promise<{
    shared: ReturnType<typeof createFindslServices>['shared'];
    uri: string;
}> {
    const { shared } = createFindslServices(EmptyFileSystem);
    const doc = shared.workspace.LangiumDocumentFactory.fromString(SOURCE, URI.parse(URI_STR));
    shared.workspace.LangiumDocuments.addDocument(doc);
    await shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return { shared, uri: URI_STR };
}

describe('@findsl/web — Worker-API (Node-Smoke)', () => {
    it('findsl/check führt die prüfe-Fälle aus (bit-genau)', async () => {
        const { shared, uri } = await setup();
        const r = await runCheck(shared, uri);
        expect(r.total).toBe(1);
        expect(r.passed).toBe(1);
        expect(r.cases[0].status).toBe('pass');
    });

    const targets: Target[] = ['java', 'ts', 'js', 'pap', 'markdown', 'html', 'pdf'];
    it.each(targets)('findsl/generate %s liefert ein Artefakt', async (target) => {
        const { shared, uri } = await setup();
        const r = await runGenerate(shared, uri, target);
        expect(r.ok).toBe(true);
        expect(r.artifact?.text ?? r.artifact?.mermaid).toBeTruthy();
    });

    it('generate: führende Ziffer im Dateinamen → gültiger Identifier', async () => {
        const { shared } = createFindslServices(EmptyFileSystem);
        const u = 'inmemory://playground/2024-reform.findsl';
        const doc = shared.workspace.LangiumDocumentFactory.fromString(
            'fn F(x: Ganzzahl): Ganzzahl = x\n', URI.parse(u),
        );
        shared.workspace.LangiumDocuments.addDocument(doc);
        await shared.workspace.DocumentBuilder.build([doc], { validation: false });

        const r = await runGenerate(shared, u, 'ts');
        expect(r.ok).toBe(true);
        expect(r.artifact?.filename).toMatch(/^M2024/);   // Präfix gegen Leading-Digit
        expect(/\b(class|function|const)\s+[0-9]/.test(r.artifact?.text ?? '')).toBe(false);
    });

    it('generate: expliziter className → sprechender Java-Name (#157)', async () => {
        const { shared, uri } = await setup();
        const r = await runGenerate(shared, uri, 'java', { className: 'Einkommensteuer' });
        expect(r.ok).toBe(true);
        // interface Einkommensteuer + class EinkommensteuerImpl, Datei danach.
        expect(r.artifact?.filename).toMatch(/^Einkommensteuer/);
        expect(r.artifact?.text).toContain('Einkommensteuer');
        // NICHT der URI-Fallback (Main…) — der className hat Vorrang.
        expect(r.artifact?.text ?? '').not.toContain('Main');
    });

    it('generate: className läuft durch deriveClassName-Sanitisierung (#157)', async () => {
        const { shared, uri } = await setup();
        const r = await runGenerate(shared, uri, 'ts', { className: 'mein-modul' });
        expect(r.ok).toBe(true);
        // PascalCase-Wortsplit (geteilte CLI-Regel): mein-modul → MeinModul.
        expect(`${r.artifact?.filename}${r.artifact?.text}`).toContain('MeinModul');
    });

    it('check: nicht offenes Dokument → error (nicht {passed:0,total:0})', async () => {
        const { shared } = createFindslServices(EmptyFileSystem);
        const r = await runCheck(shared, 'inmemory://playground/nichtda.findsl');
        expect(r.error).toBeTruthy();
        expect(r.total).toBe(0);
    });
});
