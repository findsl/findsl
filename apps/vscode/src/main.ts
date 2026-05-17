// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * VS-Code-Extension Entry-Point.
 *
 * Zwei Aufgaben:
 *   1. FinDSL Language Server als Node-Subprozess starten (LSP-Client).
 *   2. Einen Test-Controller registrieren, der `prüfe`-Blöcke als
 *      Test-Items zeigt (grünes Häkchen / rotes Kreuz im Gutter,
 *      Run-Buttons, Test-Explorer). Der Controller ist eine reine
 *      Präsentationsschicht: zum Ausführen ruft er das bestehende
 *      Server-Kommando `findsl.pruefe.run` und mappt den zurückgegebenen
 *      `PruefeReport` auf Test-Zustände. Keine Logik-Duplikation.
 *      `.findsl`-Dateien OHNE jeden `prüfe`-Block werden gar nicht erst
 *      als Datei-Item angezeigt (inhaltsbasiert über die Document-
 *      Symbols, nicht über den Dateinamen).
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import {
    LanguageClient,
    type LanguageClientOptions,
    type ServerOptions,
    TransportKind,
} from 'vscode-languageclient/node.js';

let client: LanguageClient;
/** Auflöst, sobald der Language-Server bereit ist (nach `client.start()`). */
let clientStartup: Promise<void> | undefined;

/** Form des vom Server zurückgegebenen Reports (JSON-serialisiert). */
interface BeispielResult {
    pruefeName: string;
    beispielLabel: string;
    status: 'pass' | 'fail' | 'error';
    detail: string;
}
interface PruefeReport {
    total: number;
    passed: number;
    failed: number;
    errored: number;
    results: BeispielResult[];
    ausgaben?: string[];
}

export function activate(context: vscode.ExtensionContext): void {
    const serverModule = context.asAbsolutePath(path.join('out', 'language', 'main.cjs'));

    const debugOptions = { execArgv: ['--nolazy', '--inspect=6009'] };
    const serverOptions: ServerOptions = {
        run: { module: serverModule, transport: TransportKind.ipc },
        debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
    };
    const clientOptions: LanguageClientOptions = {
        documentSelector: [{ scheme: 'file', language: 'findsl' }],
    };

    client = new LanguageClient(
        'findsl', 'FinDSL Language Server', serverOptions, clientOptions,
    );
    // start() resolved, sobald der Server bereit ist — vor dem ersten
    // executeCommand abwarten, sonst hängt der Request.
    clientStartup = client.start();

    registerTestController(context);
}

export function deactivate(): Thenable<void> | undefined {
    return client?.stop();
}

// ---------------------------------------------------------------------------
// Test-Controller
// ---------------------------------------------------------------------------

const RUN_PRUEFE_COMMAND = 'findsl.pruefe.run';
/** Muss mit LENS_RUN_COMMAND in findsl-codelens.ts übereinstimmen. */
const LENS_RUN_COMMAND = 'findsl.pruefe.runFromLens';

function registerTestController(context: vscode.ExtensionContext): void {
    const ctrl = vscode.tests.createTestController('findsl', 'FinDSL Prüfe');
    context.subscriptions.push(ctrl);

    // Lazy-Discovery: ohne Item → alle .findsl-Dateien; mit Datei-Item →
    // dessen prüfe-Blöcke + Testfälle aus den Document-Symbols.
    ctrl.resolveHandler = async (item) => {
        if (!item) {
            await discoverAllFiles(ctrl);
        } else if (item.uri && !item.id.includes('::')) {
            await resolveFile(ctrl, item);
        }
    };

    ctrl.createRunProfile(
        'Testfälle ausführen', vscode.TestRunProfileKind.Run,
        (request, token) => runHandler(ctrl, request, token),
        true,
    );

    // CodeLens „▶ Testfälle ausführen" zeigt auf DIESES Client-Kommando
    // (nicht direkt aufs Server-Kommando), damit der Editor-Klick ÜBER den
    // Test-Controller läuft → Gutter-Icons + Explorer + Inline-Diagnosen +
    // Notification bleiben synchron, ein einziger Lauf-Pfad.
    context.subscriptions.push(
        vscode.commands.registerCommand(
            LENS_RUN_COMMAND,
            async (uriStr: string, index: number) => {
                const uri = vscode.Uri.parse(uriStr);
                const fileItem = ensureFileItem(ctrl, uri);
                try {
                    await resolveFile(ctrl, fileItem);
                } catch { /* notfalls mit vorhandenen Kindern weiter */ }
                const block = fileItem.children.get(
                    `${uri.toString()}::pruefe::${index}`,
                );
                const request = new vscode.TestRunRequest(
                    block ? [block] : [fileItem],
                );
                const cts = new vscode.CancellationTokenSource();
                try {
                    await runHandler(ctrl, request, cts.token);
                } finally {
                    cts.dispose();
                }
            },
        ),
    );

    // Aktives, entprelltes Neu-Auflösen — NICHT nur Kinder löschen und auf
    // resolveHandler hoffen (der wird nur beim Aufklappen aufgerufen, die
    // Tests verschwänden sonst dauerhaft).
    const debounce = new Map<string, NodeJS.Timeout>();
    const scheduleRefresh = (uri: vscode.Uri): void => {
        const key = uri.toString();
        const existing = ctrl.items.get(key);

        // SOFORT (nicht entprellt, vor jedem Item-Neuaufbau) die bisherigen
        // Pass/Fail-Ergebnisse dieser Datei als veraltet markieren — sonst
        // adoptieren die neu erzeugten Items das persistierte Ergebnis per
        // ID wieder und das alte Häkchen „klebt". VS Code zeigt veraltete
        // Ergebnisse ausgegraut/deprioritisiert (es entfernt sie API-bedingt
        // NICHT komplett — bis zum nächsten Lauf). NUR wenn es das Item
        // schon gibt — für eine (noch) prüfe-lose Datei hier KEIN Item
        // vorab anlegen, sonst flackerte es bei jedem Tastendruck in den
        // Explorer und wieder raus.
        if (existing) ctrl.invalidateTestResults?.(existing);

        const prev = debounce.get(key);
        if (prev) clearTimeout(prev);
        debounce.set(key, setTimeout(async () => {
            debounce.delete(key);
            // Item erst jetzt anlegen; resolveFile entfernt es sofort
            // wieder, falls die Datei keinen prüfe-Block enthält. Hat der
            // Nutzer gerade einen prüfe-Block ergänzt, erscheint die Datei.
            const item = ensureFileItem(ctrl, uri);
            try {
                await resolveFile(ctrl, item);
                if (ctrl.items.get(key)) ctrl.invalidateTestResults?.(item);
            } catch {
                /* Symbol-Provider transient nicht bereit — nächster
                   Edit löst erneut aus. */
            }
        }, 250));
    };

    // Beim Tippen aktualisieren (Document-Symbols sehen auch ungespeicherte
    // Änderungen) — nicht erst beim Speichern.
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((e) => {
            if (e.document.languageId === 'findsl') scheduleRefresh(e.document.uri);
        }),
    );

    const watcher = vscode.workspace.createFileSystemWatcher('**/*.findsl');
    context.subscriptions.push(watcher);
    watcher.onDidCreate((uri) => scheduleRefresh(uri));
    watcher.onDidChange((uri) => scheduleRefresh(uri));
    watcher.onDidDelete((uri) => {
        const t = debounce.get(uri.toString());
        if (t) { clearTimeout(t); debounce.delete(uri.toString()); }
        ctrl.items.delete(uri.toString());
    });
}

async function discoverAllFiles(ctrl: vscode.TestController): Promise<void> {
    // Der Symbol-Provider muss bereit sein, sonst liefert er für jede
    // Datei `undefined` und prüfe-lose wären nicht von prüfe-haltigen zu
    // unterscheiden.
    await clientStartup;
    const files = await vscode.workspace.findFiles('**/*.findsl');
    await Promise.all(files.map(async (uri) => {
        const key = uri.toString();
        const item = ensureFileItem(ctrl, uri);
        try {
            // resolveFile entfernt das Item selbst, wenn 0 prüfe-Blöcke
            // (Symbole definitiv aufgelöst).
            await resolveFile(ctrl, item);
        } catch {
            ctrl.items.delete(key);
            return;
        }
        // Provider transient nicht bereit → resolveFile ließ das frische,
        // kinderlose Item unberührt. Bei der Erst-Discovery wollen wir
        // prüfe-lose Dateien NICHT zeigen → leeres Item hier entfernen.
        if (ctrl.items.get(key) && item.children.size === 0) {
            ctrl.items.delete(key);
        }
    }));
}

function ensureFileItem(ctrl: vscode.TestController, uri: vscode.Uri): vscode.TestItem {
    const id = uri.toString();
    const existing = ctrl.items.get(id);
    if (existing) return existing;
    const item = ctrl.createTestItem(id, vscode.workspace.asRelativePath(uri), uri);
    item.canResolveChildren = true;
    ctrl.items.add(item);
    return item;
}

/**
 * Befüllt ein Datei-Item mit prüfe-Block- und Testfall-Items. Die
 * Reihenfolge der Namespace-Symbole (= `prüfe`) entspricht dem
 * `pruefeIndex`, den `findsl.pruefe.run` erwartet; die Method-Kinder
 * (= `testfall`) entsprechen den Report-Ergebnissen indexgleich.
 *
 * Enthält die Datei (definitiv, Symbole aufgelöst) KEINEN `prüfe`-Block,
 * wird das Datei-Item komplett aus dem Test-Explorer entfernt statt als
 * leerer Knoten angezeigt zu werden (Nutzer-Vorgabe: prüfe-lose Dateien
 * tauchen gar nicht erst auf).
 */
async function resolveFile(
    ctrl: vscode.TestController, fileItem: vscode.TestItem,
): Promise<void> {
    const uri = fileItem.uri!;
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[] | undefined>(
        'vscode.executeDocumentSymbolProvider', uri,
    );
    // `undefined` = Symbol-Provider (noch) nicht bereit / Parse-Fehler →
    // bestehende Kinder NICHT wegwerfen (sonst flackern/verschwinden die
    // Tests beim Tippen). Nur bei einem definitiven Ergebnis ersetzen.
    if (!symbols) return;

    const pruefeBlocks = symbols.filter((s) => s.kind === vscode.SymbolKind.Namespace);

    // Definitiv keine prüfe-Routine in dieser Datei → Item ausblenden.
    if (pruefeBlocks.length === 0) {
        ctrl.items.delete(fileItem.id);
        return;
    }

    const blockItems = pruefeBlocks.map((block, pruefeIndex) => {
        const blockId = `${uri.toString()}::pruefe::${pruefeIndex}`;
        const blockItem = ctrl.createTestItem(blockId, block.name, uri);
        blockItem.range = block.range;
        blockItem.children.replace(block.children.map((tf, tfIndex) => {
            const tfItem = ctrl.createTestItem(
                `${blockId}::${tfIndex}`, tf.name, uri,
            );
            tfItem.range = tf.selectionRange;
            return tfItem;
        }));
        return blockItem;
    });
    // Atomar ersetzen — kein Zwischenzustand „leer".
    fileItem.children.replace(blockItems);
}

/** Server-Request darf die Test-UI nicht unbegrenzt einfrieren. */
const RUN_TIMEOUT_MS = 20_000;

async function runHandler(
    ctrl: vscode.TestController,
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
): Promise<void> {
    const run = ctrl.createTestRun(request);
    try {
        // Erst wenn der Server bereit ist — sonst hängt sendRequest.
        await clientStartup;

        // Datei-Items vor dem Sammeln auflösen (Kinder können noch fehlen,
        // wenn der Nutzer „Run" auf einem Datei-/Wurzel-Knoten klickt).
        const roots = request.include
            ? [...request.include]
            : collectAll(ctrl);
        for (const r of roots) {
            if (r.uri && !r.id.includes('::') && r.children.size === 0) {
                await resolveFile(ctrl, r);
            }
        }

        const blocks = new Set<vscode.TestItem>();
        const collect = (item: vscode.TestItem): void => {
            if (/::pruefe::\d+$/.test(item.id)) { blocks.add(item); return; }
            if (item.parent && /::pruefe::\d+$/.test(item.parent.id)) {
                blocks.add(item.parent); return;
            }
            item.children.forEach(collect);
        };
        roots.forEach(collect);

        for (const block of blocks) {
            if (token.isCancellationRequested) break;
            const m = block.id.match(/^(.*)::pruefe::(\d+)$/);
            if (!m || !block.uri) continue;
            const pruefeIndex = Number(m[2]);

            const children = childItems(block);
            children.forEach((c) => run.started(c));
            run.started(block);

            let report: PruefeReport | null = null;
            try {
                report = await withTimeout(
                    client.sendRequest<PruefeReport | null>(
                        'workspace/executeCommand',
                        {
                            command: RUN_PRUEFE_COMMAND,
                            arguments: [block.uri.toString(), pruefeIndex],
                        },
                    ),
                    RUN_TIMEOUT_MS,
                );
            } catch (err) {
                const msg = new vscode.TestMessage(
                    err instanceof TimeoutError
                        ? `Zeitüberschreitung (${RUN_TIMEOUT_MS / 1000}s) — `
                          + `möglicherweise Endlos-Auswertung oder Server nicht aktuell.`
                        : `Ausführung fehlgeschlagen: `
                          + `${err instanceof Error ? err.message : String(err)}`,
                );
                run.errored(block, msg);
                children.forEach((c) => run.errored(c, msg));
                continue;
            }

            if (!report) {
                const msg = new vscode.TestMessage('Kein Ergebnis vom Server.');
                run.errored(block, msg);
                children.forEach((c) => run.errored(c, msg));
                continue;
            }

            // Gesammelte `ausgabe`-Zeilen ins Test-Output-Terminal
            // (SPEC § 5.4). Terminal-Renderer braucht CRLF.
            if (report.ausgaben && report.ausgaben.length > 0) {
                run.appendOutput(`— ausgabe (${block.label}) —\r\n`);
                for (const line of report.ausgaben) {
                    run.appendOutput(line.replace(/\n/g, '\r\n') + '\r\n');
                }
            }

            report.results.forEach((r, i) => {
                const item = children[i];
                if (!item) return;
                if (r.status === 'pass') {
                    run.passed(item);
                } else {
                    const message = new vscode.TestMessage(r.detail);
                    if (item.uri && item.range) {
                        message.location = new vscode.Location(item.uri, item.range);
                    }
                    if (r.status === 'error') run.errored(item, message);
                    else run.failed(item, message);
                }
            });
            if (report.failed + report.errored === 0) {
                run.passed(block);
            } else {
                run.failed(block, new vscode.TestMessage(
                    `${report.passed}/${report.total} bestanden, `
                    + `${report.failed} fehlgeschlagen, ${report.errored} Fehler`,
                ));
            }
        }
    } finally {
        // MUSS immer laufen — sonst drehen die Items endlos.
        run.end();
    }
}

function collectAll(ctrl: vscode.TestController): vscode.TestItem[] {
    const out: vscode.TestItem[] = [];
    ctrl.items.forEach((i) => out.push(i));
    return out;
}

function childItems(item: vscode.TestItem): vscode.TestItem[] {
    const out: vscode.TestItem[] = [];
    item.children.forEach((c) => out.push(c));
    return out;
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new TimeoutError()), ms);
        p.then(
            (v) => { clearTimeout(t); resolve(v); },
            (e) => { clearTimeout(t); reject(e); },
        );
    });
}
