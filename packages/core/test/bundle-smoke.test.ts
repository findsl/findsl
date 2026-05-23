/**
 * CI-Gate: Bundle-Smoke-Test.
 *
 * Hintergrund: vitest, tsc-CLI und das esbuild-CJS-Bundle sind DREI
 * verschiedene Laufzeiten. Ein Bug, der nur im CJS-Bundle auftritt (z. B.
 * `createRequire(import.meta.url)`, das dort zu `undefined` evaluiert),
 * bleibt von allen normalen Tests UNENTDECKT — sie laufen über `src/` bzw.
 * den tsc-Output. Der LSP-Server im VS-Code-Extension-Host lädt aber genau
 * dieses Bundle. Ein crashendes Bundle = stiller Totalausfall aller
 * LSP-Features (Diagnostics, Hover, Rename, …).
 *
 * Dieser Test baut die Bundles frisch (esbuild kompiliert TS selbst, kein
 * vorheriges `tsc` nötig) und lädt das Language-Server-Bundle wie der
 * Extension-Host es täte. Erwartet wird, dass ALLE Module fehlerfrei laden;
 * der einzige akzeptable "Fehler" ist die Connection-Initialisierung, die
 * ohne IPC/stdio-Transport erwartungsgemäß abbricht (= der Server kam bis
 * zum Connection-Setup, alle Module sind sauber geladen).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/core/test → Workspace-Wurzel (drei Ebenen hoch).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const projectRoot = repoRoot;
const languageBundle  = path.join(repoRoot, 'apps', 'vscode', 'out', 'language',  'main.cjs');
const extensionBundle = path.join(repoRoot, 'apps', 'vscode', 'out', 'extension', 'main.cjs');

beforeAll(() => {
    // esbuild kompiliert die TS-Entrypoints direkt — frisches, deterministisches
    // Bundle, unabhängig vom tsc-Output-Stand.
    execFileSync('node', ['esbuild.mjs'], { cwd: projectRoot, stdio: 'pipe' });
}, 30_000);

describe('Bundle-Smoke (CI-Gate)', () => {
    it('Language-Server-Bundle existiert und ist nicht leer', () => {
        expect(fs.existsSync(languageBundle)).toBe(true);
        expect(fs.statSync(languageBundle).size).toBeGreaterThan(100_000);
    });

    it('Extension-Bundle existiert und ist nicht leer', () => {
        expect(fs.existsSync(extensionBundle)).toBe(true);
        expect(fs.statSync(extensionBundle).size).toBeGreaterThan(500);
    });

    it('Language-Server-Bundle lädt ALLE Module ohne Crash', () => {
        const requireCjs = createRequire(import.meta.url);
        let loadError: Error | undefined;
        try {
            requireCjs(languageBundle);
        } catch (e) {
            loadError = e as Error;
        }

        // Akzeptabel: der Server kam bis zur Connection-Initialisierung und
        // bricht nur ab, weil kein --stdio/--node-ipc-Transport gesetzt ist.
        // Das beweist: alle Module (inkl. findsl-stdlib mit JSON-Import)
        // wurden erfolgreich geladen.
        const isExpectedConnectionAbort =
            loadError?.message.includes('Connection input stream is not set')
            || loadError?.message.includes('--stdio')
            || loadError?.message.includes('--node-ipc');

        if (loadError && !isExpectedConnectionAbort) {
            throw new Error(
                'LSP-Server-Bundle crasht beim Laden — alle LSP-Features '
                + `würden im Editor stumm ausfallen. Ursache: ${loadError.message}`,
            );
        }
        // Entweder kein Fehler ODER der erwartete Connection-Abbruch:
        expect(isExpectedConnectionAbort || loadError === undefined).toBe(true);
    });

    it('Regression: kein nacktes `import.meta.url` im CJS-Bundle', () => {
        // Genau dieser Konstrukt-Rest war die Ursache des stillen
        // LSP-Totalausfalls (createRequire(import.meta.url) → undefined im
        // CJS-Bundle). esbuild ersetzt korrekte import.meta-Nutzungen mit
        // einem Shim; ein ROHES `import.meta.url` darf nicht übrig sein.
        const src = fs.readFileSync(languageBundle, 'utf-8');
        expect(src.includes('import.meta.url')).toBe(false);
    });
});

/**
 * Self-contained CLI-Bundle (`packages/cli/dist/findsl.cjs`, EIN File):
 * exakt der Runtime, in dem die `pdfmake`/`createRequire`-§7-Divergenz
 * und die pdfkit-AFM-Metriken zuschlagen — von vitest/tsc NICHT abgedeckt.
 * Seit Issue #121 sind die 14 AFM-Metriken ins Bundle eingebettet (kein
 * sibling `data/` mehr). (Das native SEA-Binary ist ein separater
 * Release-Schritt, `npm run binary`; hier wird das Bundle als dessen
 * Grundlage geprüft.)
 */
describe('CLI-Bundle-Smoke (self-contained)', () => {
    const cliBundle = path.join(repoRoot, 'packages', 'cli', 'dist', 'findsl.cjs');
    const ex = (args: string[]): string =>
        execFileSync('node', [cliBundle, ...args], { cwd: os.tmpdir() }).toString();

    it('Bundle existiert + KEIN sibling data/ (AFM eingebettet, Issue #121)', () => {
        expect(fs.existsSync(cliBundle)).toBe(true);
        expect(fs.statSync(cliBundle).size).toBeGreaterThan(1_000_000);
        // #121: AFM-Metriken sind ins Bundle inlined → das früher daneben
        // kopierte `dist/data/` darf NICHT mehr existieren.
        expect(fs.existsSync(
            path.join(repoRoot, 'packages', 'cli', 'dist', 'data'),
        )).toBe(false);
    });

    it('test läuft self-contained (aus os.tmpdir, kein node_modules)', () => {
        const out = ex([
            'test',
            path.join(repoRoot, 'examples', 'kst', 'kst.test.findsl'),
        ]);
        expect(out).toContain('bestanden');
    });

    it('docgen -f pdf erzeugt valides PDF (§7-Divergenz + pdfkit-AFM)', () => {
        const outBase = path.join(os.tmpdir(), `findsl-cli-smoke-${process.pid}`);
        ex(['docgen', path.join(repoRoot, 'examples', 'kst'), '-f', 'pdf', '-o', outBase]);
        const pdf = `${outBase}.pdf`;
        try {
            expect(fs.existsSync(pdf)).toBe(true);
            expect(fs.readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-');
            expect(fs.statSync(pdf).size).toBeGreaterThan(10_000);
        } finally {
            fs.rmSync(pdf, { force: true });
        }
    });
});
