/**
 * Quick-Fix-Provider für FinDSL (LSP `textDocument/codeAction`).
 *
 * Macht die Diagnose-Schicht aktionierbar: jede der häufigsten
 * Diagnosen bekommt einen Ein-Klick-Fix. Zuordnung erfolgt über den
 * stabilen `diagnostic.code` (NICHT über fragile Message-Strings) —
 * die Codes werden im Validator gesetzt:
 *
 *   findsl.fehlende-quelle        → `@Quelle("…")` über der Konstante einfügen
 *   findsl.builtin-import         → Symbol aus `verwende {…}` entfernen
 *   findsl.symbol-nicht-exportiert→ Symbol aus `verwende {…}` entfernen
 *
 * Alle Fixes liefern ein `WorkspaceEdit`; nichts wird automatisch
 * angewandt — der Nutzer wählt im Lampen-Menü.
 */

import {
    type LangiumDocument,
    type MaybePromise,
    type AstNode,
    CstUtils,
} from 'langium';
import type { CodeActionProvider } from 'langium/lsp';
import {
    CodeActionKind,
    type CodeAction,
    type CodeActionParams,
    type Command,
    type Diagnostic,
    type Range,
    type TextEdit,
} from 'vscode-languageserver';
import {
    isImportDecl,
    type Program,
} from './generated/ast.js';

export class FindslCodeActionProvider implements CodeActionProvider {

    getCodeActions(
        document: LangiumDocument, params: CodeActionParams,
    ): MaybePromise<Array<Command | CodeAction> | undefined> {
        const actions: CodeAction[] = [];
        for (const diag of params.context.diagnostics) {
            const code = typeof diag.code === 'string' ? diag.code : undefined;
            if (!code) continue;
            switch (code) {
                case 'findsl.fehlende-quelle': {
                    const a = this.fixAddQuelle(document, diag);
                    if (a) actions.push(a);
                    break;
                }
                case 'findsl.builtin-import':
                case 'findsl.symbol-nicht-exportiert': {
                    const a = this.fixRemoveImportSymbol(document, diag, code);
                    if (a) actions.push(a);
                    break;
                }
            }
        }
        return actions;
    }

    // --- Fix: @Quelle("") einfügen ---------------------------------------

    private fixAddQuelle(
        document: LangiumDocument, diag: Diagnostic,
    ): CodeAction | undefined {
        // Diagnostic hängt am Konst-Namen → enclosing KonstDecl finden.
        const decl = this.astNodeAt(document, diag.range);
        const konst = decl && this.enclosingKonst(decl);
        if (!konst?.$cstNode) return undefined;

        // Einfügeposition: Anfang der `konst`-Keyword-Zeile, gleiche Einrückung.
        const konstLeaf = CstUtils.flattenCst(konst.$cstNode)
            .find((l) => l.text === 'konst');
        if (!konstLeaf) return undefined;
        const line = konstLeaf.range.start.line;
        const indent = ' '.repeat(konstLeaf.range.start.character);

        const insert: TextEdit = {
            range: { start: { line, character: 0 }, end: { line, character: 0 } },
            newText: `${indent}@Quelle("Quelle angeben")\n`,
        };
        return {
            title: '@Quelle-Annotation hinzufügen',
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            isPreferred: true,
            edit: { changes: { [document.uri.toString()]: [insert] } },
        };
    }

    private enclosingKonst(node: AstNode): (AstNode & { name?: string }) | undefined {
        let n: AstNode | undefined = node;
        while (n) {
            if (n.$type === 'KonstDecl') return n as AstNode & { name?: string };
            n = n.$container as AstNode | undefined;
        }
        return undefined;
    }

    // --- Fix: Symbol aus verwende-Import entfernen -----------------------

    private fixRemoveImportSymbol(
        document: LangiumDocument, diag: Diagnostic, code: string,
    ): CodeAction | undefined {
        const data = diag.data as { sourceName?: string } | undefined;
        const sourceName = data?.sourceName;
        if (!sourceName) return undefined;

        const node = this.astNodeAt(document, diag.range);
        const multi = node && this.enclosingImportDecl(node);
        if (!multi?.$cstNode) return undefined;

        const remaining = multi.items
            .filter((it) => it.name !== sourceName)
            .map((it) => (it.alias ? `${it.name} als ${it.alias}` : it.name));

        const declRange = multi.$cstNode.range;
        let edit: TextEdit;
        if (remaining.length === 0) {
            // Einziges Symbol → ganze verwende-Zeile inkl. Zeilenumbruch tilgen.
            const startLine = declRange.start.line;
            edit = {
                range: {
                    start: { line: startLine, character: 0 },
                    end:   { line: startLine + 1, character: 0 },
                },
                newText: '',
            };
        } else {
            edit = {
                range: declRange,
                newText: `verwende { ${remaining.join(', ')} } aus "${multi.source}"`,
            };
        }

        const label = code === 'findsl.builtin-import'
            ? `Eingebautes "${sourceName}" aus Import entfernen`
            : `Nicht-exportiertes "${sourceName}" aus Import entfernen`;
        return {
            title: label,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            isPreferred: true,
            edit: { changes: { [document.uri.toString()]: [edit] } },
        };
    }

    private enclosingImportDecl(
        node: AstNode,
    ): (AstNode & { items: ReadonlyArray<{ name: string; alias?: string }>; source?: string }) | undefined {
        let n: AstNode | undefined = node;
        while (n) {
            if (isImportDecl(n)) return n;
            n = n.$container as AstNode | undefined;
        }
        return undefined;
    }

    // --- Helfer ----------------------------------------------------------

    private astNodeAt(document: LangiumDocument, range: Range): AstNode | undefined {
        const root = document.parseResult?.value?.$cstNode;
        if (!root) return undefined;
        const offset = document.textDocument.offsetAt(range.start);
        const leaf = CstUtils.findLeafNodeAtOffset(root, offset);
        return leaf?.astNode;
    }
}
