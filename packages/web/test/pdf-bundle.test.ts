// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * @findsl/web — Bundle-Smoke für `generate(pdf)` (Issue #136).
 *
 * Der `smoke.test.ts` führt `runGenerate(…, 'pdf')` gegen die TS-QUELLE in
 * Node aus — dort greift Node-NodeNext-CJS-Interop und MathJax lädt sauber,
 * der Browser-Bundle-Bug bleibt unentdeckt. Hier wird der pdf-Pfad daher
 * **mit esbuild browsertauglich gebündelt** (platform:browser, dieselbe
 * `browserAlias`-Map wie das Release-Bundle) und das Ergebnis ausgeführt —
 * exakt die Auflösung, unter der `liteAdaptor` zum Namespace statt zur
 * Funktion wurde („liteAdaptor is not a function").
 *
 * Deckt beide Regressionen ab:
 *  - formelfreies Modul → kein MathJax-Init (Fix B) → ok;
 *  - Modul mit Blockformel → MathJax-Init muss im Bundle funktionieren
 *    (Fix A, CJS-Interop) → echtes `<svg` in der Doc-Definition.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { browserAlias } from '../esbuild.shared.mjs';

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Inline-Entry: baut Langium-Dienste (EmptyFileSystem, wie im Worker) und
// ruft genau den pdf-Zweig von runGenerate auf. `./src/generate.js` löst
// esbuild beim Bündeln zur .ts-Quelle auf (wie der Worker-Build).
const ENTRY = `
import { EmptyFileSystem, URI } from 'langium';
import { createFindslServices } from '@findsl/core/language/findsl-module.js';
import { runGenerate } from './src/generate.js';
const URI_STR = 'inmemory://playground/main.findsl';
export async function genPdf(source) {
    const { shared } = createFindslServices(EmptyFileSystem);
    const doc = shared.workspace.LangiumDocumentFactory.fromString(source, URI.parse(URI_STR));
    shared.workspace.LangiumDocuments.addDocument(doc);
    await shared.workspace.DocumentBuilder.build([doc], { validation: false });
    return runGenerate(shared, URI_STR, 'pdf');
}
`;

const FORMULA_FREE = [
    '--',
    'Reines Modul ohne jede Mathematik.',
    '--',
    'fn Verdopple(x: Ganzzahl): Ganzzahl = x + x',
    '',
].join('\n');

const WITH_BLOCK_MATH = [
    '--',
    'Modul mit echter Blockformel:',
    '',
    '$$x^2 + 1$$',
    '',
    '--',
    'fn Quadrat(x: Ganzzahl): Ganzzahl = x * x',
    '',
].join('\n');

interface GenResult {
    ok: boolean;
    error?: string;
    artifact?: { text?: string };
}
type Bundle = { genPdf(source: string): Promise<GenResult> };

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'findsl-web-pdf-'));

/** Bündelt den Inline-Entry browsertauglich und lädt das Resultat. */
async function buildBundle(): Promise<Bundle> {
    await esbuild.build({
        stdin: { contents: ENTRY, resolveDir: WEB_DIR, loader: 'ts' },
        bundle: true,
        format: 'esm',
        platform: 'browser',
        target: 'es2022',
        splitting: true,          // lazy import() (mathjax) → Chunks, wie real
        outdir: outDir,
        alias: browserAlias(WEB_DIR),
        logLevel: 'silent',
    });
    // stdin-Entry → fester Output-Name `stdin.js`. (Nicht über das Metafile
    // nach `entryPoint` suchen: bei splitting tragen auch die lazy-Chunks —
    // mathjax-Handler, pdf-browser — ein `entryPoint`-Feld.)
    return import(pathToFileURL(path.join(outDir, 'stdin.js')).href) as Promise<Bundle>;
}

afterAll(() => {
    fs.rmSync(outDir, { recursive: true, force: true });
});

describe('@findsl/web — generate(pdf) im Browser-Bundle (#136)', () => {
    it('formelfreies Modul → ok, gültige pdfmake-Doc-Definition', async () => {
        const { genPdf } = await buildBundle();
        const r = await genPdf(FORMULA_FREE);
        expect(r.error).toBeUndefined();
        expect(r.ok).toBe(true);
        const doc = JSON.parse(r.artifact?.text ?? '{}');
        expect(Array.isArray(doc.content)).toBe(true);
        expect(doc.content.length).toBeGreaterThan(0);
    }, 120000);

    it('Modul mit Blockformel → MathJax-Init im Bundle ok, echtes SVG', async () => {
        const { genPdf } = await buildBundle();
        const r = await genPdf(WITH_BLOCK_MATH);
        // Regression Issue #136: vor dem Interop-Fix „liteAdaptor is not a function".
        expect(r.error).toBeUndefined();
        expect(r.ok).toBe(true);
        // Echtes MathJax-SVG (nicht der texToPlain-Fallback) ⇒ Interop ok.
        expect(r.artifact?.text ?? '').toContain('<svg');
    }, 120000);
});
