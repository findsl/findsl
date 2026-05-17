/**
 * CodeLens-Provider für FinDSL.
 *
 * Setzt über jeden `prüfe`-Block einen klickbaren `▶ N Testfälle
 * ausführen`-Link. Der Klick löst das Server-Kommando
 * `findsl.pruefe.run` aus (siehe findsl-commands.ts), das den
 * Interpreter über genau diesen Block laufen lässt und das Ergebnis
 * als Notification meldet. Macht den fertigen Tree-Walker direkt im
 * Editor sichtbar — ohne CLI.
 */

import {
    type LangiumDocument,
    type MaybePromise,
} from 'langium';
import type { CodeLensProvider } from 'langium/lsp';
import { type CodeLens, type CodeLensParams, Range } from 'vscode-languageserver';
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

export class FindslCodeLensProvider implements CodeLensProvider {

    provideCodeLens(
        document: LangiumDocument, _params: CodeLensParams,
    ): MaybePromise<CodeLens[] | undefined> {
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
