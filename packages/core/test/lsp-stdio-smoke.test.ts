/**
 * CI-Gate: stdio-Handshake-Smoke für das host-neutrale LSP-Bundle (#238).
 *
 * Hintergrund: Das vscode-`language`-Bundle wird vom Extension-Host über
 * IPC gestartet (siehe `bundle-smoke.test.ts`, das es per `require()` lädt).
 * Andere Editoren — allen voran IntelliJ via LSP4IJ (#237) — starten den
 * Server stattdessen als eigenen Prozess und sprechen LSP über **stdio**.
 *
 * Dieser Test baut die Bundles frisch (esbuild kompiliert TS selbst, kein
 * vorheriges `tsc` nötig), startet `packages/lsp/dist/findsl-lsp.cjs` als
 * Subprozess mit `--stdio` und führt einen echten LSP-`initialize`-Handshake
 * über das Content-Length-Wire-Format. Geprüft wird, dass der Server über
 * stdio antwortet und die für die Editor-Integration zentralen Capabilities
 * meldet (CodeLens, Semantic Tokens, ExecuteCommand mit beiden FinDSL-
 * Kommandos). Bricht der Prozess vorher ab, schlägt der Test mit dem
 * gesammelten stderr fehl — ein stiller stdio-Totalausfall wäre sonst von
 * den IPC-/`require()`-Tests nicht abgedeckt.
 *
 * #239: Wurde zusätzlich das native SEA-Binary gebaut (`npm run binary:lsp`),
 * läuft derselbe Handshake gegen `findsl-lsp` selbst — ohne installiertes
 * Node. Da Node-SEA nicht cross-kompiliert, existiert das Binary nur auf dem
 * Build-Rechner bzw. im jeweiligen CI-Runner; sonst überspringt der Block.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/core/test → Workspace-Wurzel (drei Ebenen hoch).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lspBundle = path.join(repoRoot, 'packages', 'lsp', 'dist', 'findsl-lsp.cjs');
const lspBinary = path.join(
    repoRoot, 'packages', 'lsp', 'dist',
    process.platform === 'win32' ? 'findsl-lsp.exe' : 'findsl-lsp',
);

beforeAll(() => {
    // esbuild kompiliert die TS-Entrypoints direkt — frisches, deterministisches
    // Bundle, unabhängig vom tsc-Output-Stand (identisch zu bundle-smoke.test.ts).
    execFileSync('node', ['esbuild.mjs'], { cwd: repoRoot, stdio: 'pipe' });
}, 30_000);

interface ServerCapabilities {
    codeLensProvider?: unknown;
    semanticTokensProvider?: unknown;
    executeCommandProvider?: { commands?: string[] };
    [key: string]: unknown;
}

/**
 * Startet `command` mit `args` (Bundle: `node …/findsl-lsp.cjs --stdio`
 * ODER das native Binary direkt: `findsl-lsp --stdio`), sendet einen
 * `initialize`-Request im LSP-Wire-Format (`Content-Length`-Framing) und löst
 * mit den gemeldeten ServerCapabilities auf. Verwirft, wenn der Prozess vor
 * der Antwort endet (mit gesammeltem stderr) oder das Zeitlimit überschreitet.
 */
function lspInitialize(command: string, args: string[], timeoutMs = 15_000): Promise<ServerCapabilities> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: repoRoot });
        let buffer = Buffer.alloc(0);
        let stderr = '';
        let settled = false;

        const finish = (fn: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            child.kill();
            fn();
        };

        const timer = setTimeout(
            () => finish(() => reject(new Error(`LSP-Handshake-Zeitüberschreitung (${timeoutMs} ms). stderr: ${stderr}`))),
            timeoutMs,
        );

        child.stdout.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            // Vollständige Content-Length-Frames aus dem Puffer extrahieren.
            for (;;) {
                const headerEnd = buffer.indexOf('\r\n\r\n');
                if (headerEnd === -1) break;
                const header = buffer.subarray(0, headerEnd).toString('ascii');
                const match = /Content-Length:\s*(\d+)/i.exec(header);
                if (!match) {
                    finish(() => reject(new Error(`LSP-Antwort ohne Content-Length-Header: ${header}`)));
                    return;
                }
                const len = Number(match[1]);
                const bodyStart = headerEnd + 4;
                if (buffer.length < bodyStart + len) break;   // Body noch unvollständig
                const body = buffer.subarray(bodyStart, bodyStart + len).toString('utf8');
                buffer = buffer.subarray(bodyStart + len);
                const msg = JSON.parse(body) as { id?: number; result?: { capabilities?: ServerCapabilities } };
                // Notifications (z. B. window/logMessage) haben keine id → ignorieren.
                if (msg.id === 1 && msg.result) {
                    finish(() => resolve(msg.result?.capabilities ?? {}));
                    return;
                }
            }
        });
        child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        child.on('error', (e) => finish(() => reject(e)));
        child.on('exit', (code) =>
            finish(() => reject(new Error(`LSP-Server endete vor der Antwort (Code ${code}). stderr: ${stderr}`))),
        );

        const req = JSON.stringify({
            jsonrpc: '2.0', id: 1, method: 'initialize',
            params: { processId: null, rootUri: null, capabilities: {} },
        });
        child.stdin.write(`Content-Length: ${Buffer.byteLength(req, 'utf8')}\r\n\r\n${req}`);
    });
}

/**
 * Capabilities, die jeder Editor (VS Code, IntelliJ) braucht — für Bundle
 * und natives Binary identisch geprüft.
 */
function expectEditorCapabilities(caps: ServerCapabilities): void {
    // CodeLens (▶ Testfälle ausführen) und Semantic Tokens (Highlighting).
    expect(caps.codeLensProvider).toBeDefined();
    expect(caps.semanticTokensProvider).toBeDefined();
    // Die beiden Server-Kommandos sind die Naht für prüfe-Lauf und Doku
    // (von der IntelliJ-Integration via workspace/executeCommand genutzt).
    expect(caps.executeCommandProvider?.commands).toContain('findsl.pruefe.run');
    expect(caps.executeCommandProvider?.commands).toContain('findsl.doku.generate');
}

describe('LSP-stdio-Smoke (host-neutrales Bundle, CI-Gate)', () => {
    it('host-neutrales Bundle existiert und ist nicht leer', () => {
        expect(fs.existsSync(lspBundle)).toBe(true);
        expect(fs.statSync(lspBundle).size).toBeGreaterThan(1_000_000);
    });

    it('Regression: kein nacktes `import.meta.url` im CJS-Bundle', () => {
        // Gleiche Falle wie beim vscode-language-Bundle: ein rohes
        // `import.meta.url` evaluiert im CJS-Bundle zu `undefined` und legt
        // den Server still lahm. esbuild shimt korrekte Nutzungen.
        const src = fs.readFileSync(lspBundle, 'utf-8');
        expect(src.includes('import.meta.url')).toBe(false);
    });

    it('antwortet über --stdio auf initialize mit den Editor-Capabilities', async () => {
        expectEditorCapabilities(await lspInitialize(process.execPath, [lspBundle, '--stdio']));
    }, 20_000);
});

/**
 * Binary-Smoke (#239): nur wenn das native SEA-Binary vorab gebaut wurde
 * (`npm run binary:lsp`). Node-SEA kann nicht cross-kompilieren → das Binary
 * existiert nur auf dem Build-Rechner bzw. im jeweiligen CI-Runner; die
 * normale `npm test`-Suite überspringt diesen Block. Beweist den
 * Akzeptanzpunkt von #239: `findsl-lsp --stdio` spricht LSP OHNE Node.
 */
describe.skipIf(!fs.existsSync(lspBinary))('LSP-Binary-stdio-Smoke (nur wenn gebaut)', () => {
    it('natives Binary antwortet über --stdio ohne installiertes Node', async () => {
        // Das Binary IST die Executable — direkt starten, kein node-Vorspann.
        expectEditorCapabilities(await lspInitialize(lspBinary, ['--stdio']));
    }, 20_000);
});
