/**
 * Server-Kommando-Handler für FinDSL.
 *
 * Aktuell ein Kommando: `findsl.pruefe.run` — ausgelöst vom CodeLens
 * über einem `prüfe`-Block. Lässt den Interpreter über genau diesen
 * Block laufen (Cross-Modul-`verwende` aus allen geparsten Workspace-
 * Programmen) und meldet das Ergebnis als VS-Code-Notification. Damit
 * ist die `prüfe`-Auswertung ohne CLI direkt im Editor nutzbar.
 */

import { URI } from 'langium';
import type { LangiumSharedServices } from 'langium/lsp';
import { AbstractExecuteCommandHandler, type ExecuteCommandAcceptor } from 'langium/lsp';
import {
    DiagnosticSeverity,
    type Diagnostic,
    type Range,
} from 'vscode-languageserver';
import { isPruefeDecl, type Program, type PruefeDecl } from './generated/ast.js';
import {
    runSinglePruefe,
    type TestfallReport,
    type PruefeReport,
} from '../interpret/pruefe.js';
import { buildDocModelFromProgram } from '../docgen/model.js';
import { renderMarkdown } from '../docgen/markdown.js';
import { renderHtml } from '../docgen/html.js';
import { deriveClassName } from '../codegen/path-naming.js';
import { RUN_PRUEFE_COMMAND } from './findsl-codelens.js';

/**
 * Server-Kommando (LSP `workspace/executeCommand`): rendert die Doku des
 * übergebenen Dokuments und liefert sie als String zurück; der Client öffnet
 * sie in einem ungespeicherten Editor. Rein in-process — kein Datei-I/O,
 * kein CLI. PDF bleibt der CLI/Website vorbehalten (Binär). Issue #95.
 */
export const GENERATE_DOKU_COMMAND = 'findsl.doku.generate';

/** Rückgabe von `findsl.doku.generate` (an den Extension-Host). */
export interface DokuResult {
    readonly format: 'markdown' | 'html';
    /** Vorschlag für den Editor-Titel (z. B. `Kraftstg.doc.md`). */
    readonly filename: string;
    readonly content: string;
}

export class FindslExecuteCommandHandler extends AbstractExecuteCommandHandler {

    private readonly shared: LangiumSharedServices;

    constructor(shared: LangiumSharedServices) {
        super();
        this.shared = shared;
    }

    registerCommands(accept: ExecuteCommandAcceptor): void {
        accept(RUN_PRUEFE_COMMAND, (args) => this.runPruefe(args));
        accept(GENERATE_DOKU_COMMAND, (args) => this.runDoku(args));
    }

    /**
     * args = [documentUri: string, pruefeIndex: number, testfallIndex?: number].
     * Liefert den `PruefeReport` zurück (für programmatische Aufrufer/Tests)
     * und zeigt parallel eine Notification. Wenn `testfallIndex` angegeben
     * ist, wird nur dieser einzelne `testfall` ausgeführt (Issue #79-
     * Folge: einzelne Gutter-Play-Pfeile sollen nicht den ganzen Block
     * runnen).
     */
    private async runPruefe(args: unknown[]): Promise<PruefeReport | undefined> {
        const uri = String(args?.[0] ?? '');
        const index = Number(args?.[1] ?? 0);
        const testfallIndex = args?.[2] === undefined || args?.[2] === null
            ? undefined
            : Number(args[2]);
        const connection = this.shared.lsp.Connection;

        const documents = this.shared.workspace.LangiumDocuments;
        const doc = documents.getDocument(URI.parse(uri));
        const entry = doc?.parseResult?.value as Program | undefined;
        if (!entry) {
            await connection?.window.showErrorMessage(
                'FinDSL: Dokument nicht geladen — bitte erneut öffnen.');
            return undefined;
        }

        const workspace: Program[] = [];
        for (const d of documents.all) {
            const p = d.parseResult?.value as Program | undefined;
            if (p) workspace.push(p);
        }

        const report = runSinglePruefe(workspace, entry, index, testfallIndex);

        // Inline-Diagnosen pro fehlgeschlagenem testfall. publishDiagnostics
        // ersetzt PRO URI komplett — daher die aktuellen Validierungs-
        // Diagnosen (doc.diagnostics) beibehalten und die Test-Diagnosen
        // anhängen. Sie bleiben sichtbar bis zur nächsten Validierung
        // (nächste Editor-Änderung) bzw. zum nächsten Lauf — bewusst
        // ephemer: ein Testergebnis ist eine Momentaufnahme.
        const pruefeDecls = entry.decls.filter(isPruefeDecl);
        const testDiags = buildPruefeDiagnostics(pruefeDecls[index], report, testfallIndex);
        const base = (doc?.diagnostics ?? []) as Diagnostic[];
        connection?.sendDiagnostics({
            uri,
            diagnostics: [...base, ...testDiags],
        });

        // WICHTIG: NICHT awaiten. `show*Message` sendet intern
        // `window/showMessageRequest` und löst erst auf, wenn der Nutzer
        // die Notification schließt (Fehler-Toasts sind klebrig). Ein
        // `await` hier blockiert die `executeCommand`-Antwort → der
        // Test-Explorer-Request liefe in den 20s-Timeout. Fire-and-forget;
        // der Report wird sofort zurückgegeben.
        const message = formatReport(report);
        if (report.failed + report.errored > 0) {
            void connection?.window.showErrorMessage(message);
        } else {
            void connection?.window.showInformationMessage(message);
        }
        return report;
    }

    /**
     * args = [documentUri: string, format?: 'markdown' | 'html'].
     * Rendert die Doku des Dokuments rein in-process (buildDocModelFromProgram
     * + renderMarkdown/renderHtml) und liefert sie als `DokuResult` zurück;
     * der Extension-Host öffnet den Inhalt in einem ungespeicherten Editor.
     * Der Modulname folgt derselben `deriveClassName`-Regel wie CLI/Web.
     */
    private async runDoku(args: unknown[]): Promise<DokuResult | undefined> {
        const uri = String(args?.[0] ?? '');
        const format: 'markdown' | 'html' =
            String(args?.[1] ?? 'markdown') === 'html' ? 'html' : 'markdown';

        const doc = this.shared.workspace.LangiumDocuments.getDocument(URI.parse(uri));
        const program = doc?.parseResult?.value as Program | undefined;
        // Kein Dokument/Program → `undefined`; die Nutzer-Rückmeldung übernimmt
        // der Extension-Host (direkter vscode-Zugriff). Das vermeidet den
        // klebrigen `await show*Message`-Pfad (blockierte sonst die
        // executeCommand-Antwort, vgl. runPruefe-Kommentar) und doppelte Toasts.
        if (!doc || !program) return undefined;

        const baseName = uri.split('/').pop() ?? 'Modul';
        return renderDoku(program, doc.textDocument.getText(), baseName, format);
    }
}

/**
 * Reine Doku-Render-Funktion (testbar ohne LSP-Services): Modulname via
 * `deriveClassName` (gleiche Regel wie CLI/Web), dann DocModel → Markdown/HTML.
 */
export function renderDoku(
    program: Program,
    source: string,
    baseName: string,
    format: 'markdown' | 'html',
): DokuResult {
    const name = deriveClassName(baseName.replace(/\.findsl$/i, ''));
    const model = buildDocModelFromProgram(program, source, name);
    const content = format === 'html' ? renderHtml(model) : renderMarkdown(model);
    return { format, filename: `${name}.doc.${format === 'html' ? 'html' : 'md'}`, content };
}

const ZERO_RANGE: Range = {
    start: { line: 0, character: 0 },
    end:   { line: 0, character: 0 },
};

/**
 * Erzeugt eine Diagnose pro NICHT bestandenem testfall. Die Ergebnis-
 * Reihenfolge entspricht `decl.testfaelle` (beide iterieren in Deklarations-
 * Reihenfolge) → Index-Zuordnung ist exakt, kein Label-Matching nötig.
 * Bei Modul-Initialisierungsfehler (synthetischer Einzel-Report ohne
 * passende Testfälle) hängt die Diagnose am `prüfe`-Block.
 *
 * Wenn der Report aus einem Einzel-Testfall-Lauf stammt (Issue #79-
 * Folge: `testfallIndex` gesetzt), liegt das Ergebnis bei `report.results[0]`,
 * gehört aber zu `decl.testfaelle[testfallIndex]` — `offset` korrigiert
 * das.
 */
export function buildPruefeDiagnostics(
    decl: PruefeDecl | undefined, report: PruefeReport, testfallIndex?: number,
): Diagnostic[] {
    const out: Diagnostic[] = [];
    const offset = testfallIndex ?? 0;
    report.results.forEach((r, i) => {
        if (r.status === 'pass') return;
        const testfall = decl?.testfaelle[offset + i];
        const range =
            testfall?.body?.result?.$cstNode?.range
            ?? testfall?.$cstNode?.range
            ?? decl?.$cstNode?.range
            ?? ZERO_RANGE;
        const istFehler = r.status === 'error';
        out.push({
            range,
            severity: DiagnosticSeverity.Error,
            source: 'findsl prüfe',
            code: istFehler ? 'findsl.testfall-fehler' : 'findsl.testfall-fehlgeschlagen',
            message: `Testfall „${r.testfallLabel}" `
                + `${istFehler ? 'Laufzeitfehler' : 'fehlgeschlagen'}: ${r.detail}`,
        });
    });
    return out;
}

const ICON: Record<TestfallReport['status'], string> = {
    pass: '✓', fail: '✗', error: '⚠',
};

function formatReport(report: PruefeReport): string {
    const name = report.results[0]?.pruefeName || 'prüfe';
    const head = `${name}: ${report.passed}/${report.total} bestanden`
        + (report.failed ? `, ${report.failed} fehlgeschlagen` : '')
        + (report.errored ? `, ${report.errored} Fehler` : '');
    const problems = report.results
        .filter((r) => r.status !== 'pass')
        .slice(0, 10)
        .map((r) => `${ICON[r.status]} "${r.testfallLabel}": ${r.detail}`);
    return problems.length ? `${head}\n${problems.join('\n')}` : head;
}
