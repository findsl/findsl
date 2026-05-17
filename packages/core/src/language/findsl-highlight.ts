/**
 * Document-Highlight-Provider für FinDSL (LSP `textDocument/documentHighlight`).
 *
 * Wenn der Cursor auf einem Identifier steht, werden alle Vorkommen
 * desselben Symbols **im aktuellen Dokument** dezent hervorgehoben. Das ist
 * der Bruder von Find-All-References, aber:
 *   - dokumentlokal (kein Workspace-Walk)
 *   - liefert `DocumentHighlight[]` mit Read/Write-Kind statt Locations
 *
 * Die Decl-Stelle wird als `Write` markiert (Definition), Verwendungs-
 * Stellen als `Read`. VS Code rendert beide leicht unterschiedlich (Write
 * oft mit Unterstreichung). Liegt das Symbol in einem anderen Modul
 * (importiert), erscheint hier nur das Import-Item plus die lokalen
 * Verwendungen — die Decl im Fremd-Dokument gehört nicht in dieses.
 */

import {
    type AstNode,
    type LangiumDocument,
    type LangiumDocuments,
    type MaybePromise,
    AstUtils,
    CstUtils,
    type GrammarConfig,
} from 'langium';
import type { DocumentHighlightProvider } from 'langium/lsp';
import {
    DocumentHighlightKind,
    type DocumentHighlight,
    type DocumentHighlightParams,
} from 'vscode-languageserver-protocol';
import {
    isCallChain,
    isFieldAccess,
    isNamedType,
    isSafeFieldAccess,
    type Program,
} from './generated/ast.js';
import { resolveTargetForIdToken } from './findsl-definition.js';
import type { FindslServices } from './findsl-module.js';

export class FindslDocumentHighlightProvider implements DocumentHighlightProvider {

    protected readonly documents: LangiumDocuments;
    protected readonly grammarConfig: GrammarConfig;

    constructor(services: FindslServices) {
        this.documents = services.shared.workspace.LangiumDocuments;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    getDocumentHighlight(
        document: LangiumDocument, params: DocumentHighlightParams,
    ): MaybePromise<DocumentHighlight[] | undefined> {
        const rootCst = document.parseResult?.value?.$cstNode;
        if (!rootCst) return undefined;
        const offset = document.textDocument.offsetAt(params.position);

        const idNode = CstUtils.findDeclarationNodeAtOffset(
            rootCst, offset, this.grammarConfig.nameRegexp,
        );
        if (!idNode) return undefined;

        const program = document.parseResult.value as Program;
        const target = resolveTargetForIdToken(idNode, program, this.documents);
        if (!target) return undefined;

        const highlights: DocumentHighlight[] = [];

        // Decl-Stelle als Write — aber nur, wenn die Decl in DIESEM Dokument
        // liegt. Importierte Symbole haben ihre Decl woanders.
        const declDoc = AstUtils.getDocument(target);
        if (declDoc.uri.toString() === document.uri.toString()) {
            const declRange = nameRangeOf(target);
            if (declRange) {
                highlights.push({ range: declRange, kind: DocumentHighlightKind.Write });
            }
        }

        // Verwendungs-Stellen im aktuellen Dokument.
        for (const node of AstUtils.streamAllContents(program)) {
            let name: string | undefined;
            if      (isCallChain(node)       && node.name) name = node.name;
            else if (isFieldAccess(node)     && node.name) name = node.name;
            else if (isSafeFieldAccess(node) && node.name) name = node.name;
            else if (isNamedType(node)       && node.name) name = node.name;
            else continue;

            const idLeaf = findIdLeaf(node, name);
            if (!idLeaf) continue;
            const resolved = resolveTargetForIdToken(idLeaf, program, this.documents);
            if (resolved === target) {
                highlights.push({ range: idLeaf.range, kind: DocumentHighlightKind.Read });
            }
        }
        return highlights;
    }
}

// ---------------------------------------------------------------------------
// Helfer (parallel zu references/rename — Extraktion möglich, derzeit ohne
// klaren Mehrwert da jede Stelle dünn ist)
// ---------------------------------------------------------------------------

function findIdLeaf(node: AstNode, name: string) {
    const cst = node.$cstNode;
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.text === name) return leaf;
    }
    return undefined;
}

function nameRangeOf(decl: AstNode) {
    const name = (decl as { name?: string }).name;
    if (!name) return undefined;
    const cst = decl.$cstNode;
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.text === name) return leaf.range;
    }
    return undefined;
}
