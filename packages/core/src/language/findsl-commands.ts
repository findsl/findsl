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
    type BeispielReport,
    type PruefeReport,
} from '../interpret/pruefe.js';
import { RUN_PRUEFE_COMMAND } from './findsl-codelens.js';

export class FindslExecuteCommandHandler extends AbstractExecuteCommandHandler {

    private readonly shared: LangiumSharedServices;

    constructor(shared: LangiumSharedServices) {
        super();
        this.shared = shared;
    }

    registerCommands(accept: ExecuteCommandAcceptor): void {
        accept(RUN_PRUEFE_COMMAND, (args) => this.runPruefe(args));
    }

    /**
     * args = [documentUri: string, pruefeIndex: number]. Liefert den
     * `PruefeReport` zurück (für programmatische Aufrufer/Tests) und
     * zeigt parallel eine Notification.
     */
    private async runPruefe(args: unknown[]): Promise<PruefeReport | undefined> {
        const uri = String(args?.[0] ?? '');
        const index = Number(args?.[1] ?? 0);
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

        const report = runSinglePruefe(workspace, entry, index);

        // Inline-Diagnosen pro fehlgeschlagenem testfall. publishDiagnostics
        // ersetzt PRO URI komplett — daher die aktuellen Validierungs-
        // Diagnosen (doc.diagnostics) beibehalten und die Test-Diagnosen
        // anhängen. Sie bleiben sichtbar bis zur nächsten Validierung
        // (nächste Editor-Änderung) bzw. zum nächsten Lauf — bewusst
        // ephemer: ein Testergebnis ist eine Momentaufnahme.
        const pruefeDecls = entry.decls.filter(isPruefeDecl);
        const testDiags = buildPruefeDiagnostics(pruefeDecls[index], report);
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
}

const ZERO_RANGE: Range = {
    start: { line: 0, character: 0 },
    end:   { line: 0, character: 0 },
};

/**
 * Erzeugt eine Diagnose pro NICHT bestandenem testfall. Die Ergebnis-
 * Reihenfolge entspricht `decl.beispiele` (beide iterieren in Deklarations-
 * Reihenfolge) → Index-Zuordnung ist exakt, kein Label-Matching nötig.
 * Bei Modul-Initialisierungsfehler (synthetischer Einzel-Report ohne
 * passende Beispiele) hängt die Diagnose am `prüfe`-Block.
 */
export function buildPruefeDiagnostics(
    decl: PruefeDecl | undefined, report: PruefeReport,
): Diagnostic[] {
    const out: Diagnostic[] = [];
    report.results.forEach((r, i) => {
        if (r.status === 'pass') return;
        const beispiel = decl?.beispiele[i];
        const range =
            beispiel?.body?.result?.$cstNode?.range
            ?? beispiel?.$cstNode?.range
            ?? decl?.$cstNode?.range
            ?? ZERO_RANGE;
        const istFehler = r.status === 'error';
        out.push({
            range,
            severity: DiagnosticSeverity.Error,
            source: 'findsl prüfe',
            code: istFehler ? 'findsl.testfall-fehler' : 'findsl.testfall-fehlgeschlagen',
            message: `Testfall „${r.beispielLabel}" `
                + `${istFehler ? 'Laufzeitfehler' : 'fehlgeschlagen'}: ${r.detail}`,
        });
    });
    return out;
}

const ICON: Record<BeispielReport['status'], string> = {
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
        .map((r) => `${ICON[r.status]} "${r.beispielLabel}": ${r.detail}`);
    return problems.length ? `${head}\n${problems.join('\n')}` : head;
}
