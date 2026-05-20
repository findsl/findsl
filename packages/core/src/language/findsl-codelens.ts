/**
 * CodeLens-Provider für FinDSL.
 *
 * Setzt über jeden `prüfe`-Block einen klickbaren `▶ N Testfälle
 * ausführen`-Link. Der Klick löst das Server-Kommando
 * `findsl.pruefe.run` aus (siehe findsl-commands.ts), das den
 * Interpreter über genau diesen Block laufen lässt und das Ergebnis
 * als Notification meldet. Macht den fertigen Tree-Walker direkt im
 * Editor sichtbar — ohne CLI.
 *
 * **Initial-Race (Issue #79):** beim ersten Öffnen einer Datei fragt
 * VS Code `textDocument/codeLens` an, bevor der Langium-DocumentBuilder
 * den Parse abgeschlossen hat — `document.parseResult` wäre `undefined`
 * und der Provider lieferte ohne weiteres Zutun eine leere Liste, die
 * VS Code cached. Wir warten daher in `provideCodeLens` aktiv auf den
 * `DocumentState.Validated`-State (über den DocumentBuilder), bevor wir
 * die Lenses berechnen.
 */

import {
    DocumentState,
    type DocumentBuilder,
    type LangiumDocument,
} from 'langium';
import type { CodeLensProvider, LangiumSharedServices } from 'langium/lsp';
import {
    CodeLensRefreshRequest,
    type CancellationToken,
    type CodeLens,
    type CodeLensParams,
    Range,
} from 'vscode-languageserver';
import type { FindslServices } from './findsl-module.js';
import { isPruefeDecl, type Program } from './generated/ast.js';

/**
 * Server-Kommando (LSP `workspace/executeCommand`): führt einen
 * `prüfe`-Block aus und liefert den Report. Backend für ALLE Lauf-Pfade.
 */
export const RUN_PRUEFE_COMMAND = 'findsl.pruefe.run';

/**
 * Client-Kommando, auf das der CodeLens zeigt. Es fährt den
 * VS-Code-Test-Controller (der ruft intern wiederum `RUN_PRUEFE_COMMAND`)
 * — so sind Editor-Klick und Test-Explorer EIN Pfad und bleiben
 * synchron. Registriert in der Extension (`extension/main.ts`).
 */
export const LENS_RUN_COMMAND = 'findsl.pruefe.runFromLens';

/**
 * Registriert den `workspace/codeLens/refresh`-Trigger eager beim
 * Server-Start (Issue #79).
 *
 * **Warum nicht im Provider-Constructor:** Langium instantiiert die LSP-
 * Provider **lazy** beim ersten Request. Bei Initial-Open-Szenarien
 * würde der `onDocumentPhase`-Listener also erst NACH dem ersten Build-
 * Pass registriert — zu spät für den allerersten Refresh. Indem wir den
 * Listener direkt nach `createFindslServices` registrieren, garantieren
 * wir, dass JEDER `Parsed`-Event ein Refresh-Signal an den Client schickt.
 *
 * **Warum `onDocumentPhase`, nicht `onBuildPhase`:** `onBuildPhase`
 * triggert nicht bei gecancelten Builds (häufig beim Initial-Open);
 * `onDocumentPhase` feuert pro Document zuverlässig.
 *
 * **Warum `Parsed`, nicht `Validated`:** der spätere State kann durch
 * Cross-Modul-Resolution-Probleme blockiert sein; CodeLens braucht nur
 * AST-`decls`, also reicht `Parsed`.
 */
export function registerCodeLensRefreshTrigger(shared: LangiumSharedServices): void {
    const conn = shared.lsp.Connection;
    if (!conn) return;          // Test-Pfad ohne LSP-Connection
    shared.workspace.DocumentBuilder.onDocumentPhase(
        DocumentState.Parsed,
        async () => {
            try {
                await conn.sendRequest(CodeLensRefreshRequest.type);
            } catch {
                // Client unterstützt Refresh nicht oder Verbindung weg —
                // tolerant. Der Client-Side-Provider in der VS-Code-
                // Extension (apps/vscode/src/main.ts) ist der primäre Pfad.
            }
        },
    );
}

export class FindslCodeLensProvider implements CodeLensProvider {

    private readonly documentBuilder: DocumentBuilder;

    constructor(services: FindslServices) {
        this.documentBuilder = services.shared.workspace.DocumentBuilder;
    }

    async provideCodeLens(
        document: LangiumDocument,
        _params: CodeLensParams,
        cancelToken?: CancellationToken,
    ): Promise<CodeLens[] | undefined> {
        // Issue #79: VS Code fragt CodeLens beim Datei-Öffnen sofort an —
        // ohne dieses Wait wäre `parseResult` noch leer und die Antwort
        // (= keine Lenses) würde clientseitig gecached. `Parsed` reicht,
        // weil wir nur die AST-`decls` brauchen, nicht das volle
        // Type-Check-Ergebnis. So bleibt der Wait auch in Test-Pfaden
        // mit `validation: false` korrekt — diese Pfade durchlaufen
        // `Parsed`, aber nie `Validated`.
        await this.documentBuilder.waitUntil(
            DocumentState.Parsed, document.uri, cancelToken,
        );
        const program = document.parseResult?.value as Program | undefined;
        if (!program) return undefined;

        const lenses: CodeLens[] = [];
        let index = 0;
        for (const decl of program.decls) {
            if (!isPruefeDecl(decl)) continue;
            const cst = decl.$cstNode;
            const pruefeIndex = index++;
            if (!cst) continue;
            const anchor = Range.create(cst.range.start, cst.range.start);
            const n = decl.beispiele.length;
            const titel = n === 1 ? '▶ 1 Testfall ausführen' : `▶ ${n} Testfälle ausführen`;
            lenses.push({
                range: anchor,
                command: {
                    title: titel,
                    command: LENS_RUN_COMMAND,
                    arguments: [document.textDocument.uri, pruefeIndex],
                },
            });
        }
        return lenses;
    }
}
