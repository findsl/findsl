/**
 * Rename-Provider für FinDSL.
 *
 * Implementiert:
 *   - `prepareRename(doc, pos)` — sanity-Check: liefert den Range des
 *     Identifier-Tokens, wenn er zu einem User-Symbol gehört. Bei Builtins
 *     (`abrundenEuro`, `Tarifart`, …), Keywords oder unbekannten Tokens
 *     liefert er `undefined`, sodass VS Code den Rename-Dialog gar nicht
 *     erst öffnet.
 *   - `rename(doc, params)` — sammelt alle Verwendungsstellen über den
 *     Workspace (analog `FindslReferencesProvider`) und liefert ein
 *     `WorkspaceEdit` zurück. Die Decl-Stelle wird immer mit-renamed.
 *
 * Neuer Name wird geprüft:
 *   - Gültiger FinDSL-Identifier (deutsche Umlaute erlaubt)
 *   - Kein reserviertes Keyword
 * Ein Konflikt mit einem bereits existierenden Binding im Ziel-Scope wird
 * NICHT statisch erkannt; der nachfolgende Validator-Lauf (Duplikat-
 * Detection) zeigt es als rote Wellenlinie.
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
import type { RenameProvider } from 'langium/lsp';
import type {
    Position,
    Range,
    RenameParams,
    TextDocumentPositionParams,
    TextEdit,
    WorkspaceEdit,
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

/**
 * Reservierte Schlüsselwörter — hier zentral, weil mehrere Stellen
 * (Validator, Rename, evtl. Quick-Fix) sie brauchen. Quelle: Anhang B der
 * SPEC plus die `keyword.control`-Liste in der auto-generierten TM-Grammar.
 */
const KEYWORDS: ReadonlySet<string> = new Set([
    'als', 'aufzählung', 'aus', 'bis', 'datensatz',
    'falls', 'falsch', 'fn', 'für', 'ist',
    'jeden', 'jede', 'konst', 'modul', 'nicht',
    'nichts', 'oder', 'prüfe', 'schritt', 'sonst',
    'testfall', 'und', 'unter', 'var', 'verwende',
    'wahr', 'wenn', 'wähle',
]);

const IDENTIFIER_REGEX = /^[a-zA-ZäöüÄÖÜß_][a-zA-Z0-9äöüÄÖÜß_]*$/;

export class FindslRenameProvider implements RenameProvider {

    protected readonly documents: LangiumDocuments;
    protected readonly grammarConfig: GrammarConfig;

    constructor(services: FindslServices) {
        this.documents = services.shared.workspace.LangiumDocuments;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    prepareRename(
        document: LangiumDocument, params: TextDocumentPositionParams,
    ): MaybePromise<Range | undefined> {
        const idNode = this.findIdNodeAt(document, params.position);
        if (!idNode) return undefined;

        const program = document.parseResult.value as Program;
        const target = resolveTargetForIdToken(idNode, program, this.documents);
        if (!target) return undefined;       // Builtin oder unbekannt → kein Rename
        return idNode.range;
    }

    rename(
        document: LangiumDocument, params: RenameParams,
    ): MaybePromise<WorkspaceEdit | undefined> {
        const newName = params.newName;
        if (!IDENTIFIER_REGEX.test(newName)) return undefined;
        if (KEYWORDS.has(newName))            return undefined;

        const idNode = this.findIdNodeAt(document, params.position);
        if (!idNode) return undefined;
        const program = document.parseResult.value as Program;
        const target = resolveTargetForIdToken(idNode, program, this.documents);
        if (!target) return undefined;

        const changes: Record<string, TextEdit[]> = {};
        const declLoc = locationOfDeclName(target);
        if (declLoc) {
            (changes[declLoc.uri] ??= []).push({ range: declLoc.range, newText: newName });
        }

        for (const doc of this.documents.all) {
            const docProgram = doc.parseResult?.value as Program | undefined;
            if (!docProgram) continue;
            this.collectRenameEdits(doc, docProgram, target, newName, changes);
        }
        return { changes };
    }

    private findIdNodeAt(document: LangiumDocument, position: Position) {
        const rootCst = document.parseResult?.value?.$cstNode;
        if (!rootCst) return undefined;
        const offset = document.textDocument.offsetAt(position);
        return CstUtils.findDeclarationNodeAtOffset(
            rootCst, offset, this.grammarConfig.nameRegexp,
        );
    }

    private collectRenameEdits(
        doc: LangiumDocument, program: Program, target: AstNode,
        newName: string, changes: Record<string, TextEdit[]>,
    ): void {
        const uri = doc.uri.toString();
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
                (changes[uri] ??= []).push({ range: idLeaf.range, newText: newName });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helfer (parallel zu findsl-references.ts — könnte später extrahiert werden)
// ---------------------------------------------------------------------------

function findIdLeaf(node: AstNode, name: string) {
    const cst = node.$cstNode;
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.text === name) return leaf;
    }
    return undefined;
}

function locationOfDeclName(decl: AstNode): { uri: string; range: Range } | undefined {
    const doc = AstUtils.getDocument(decl);
    const name = (decl as { name?: string }).name;
    if (!name) return undefined;
    const cst = decl.$cstNode;
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.text === name) {
            return { uri: doc.uri.toString(), range: leaf.range };
        }
    }
    return undefined;
}
