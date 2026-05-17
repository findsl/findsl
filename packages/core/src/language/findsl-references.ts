/**
 * Find-All-References-Provider für FinDSL.
 *
 * Strategie:
 *   1. Cursor → ID-Token → kanonisches Target (über `resolveTargetForIdToken`
 *      aus `findsl-definition.ts`).
 *   2. Workspace-Walk: alle Documents iterieren, jeden Identifier-Token
 *      auflösen und mit dem Target vergleichen. Bei Match → Location.
 *   3. Optional die Decl-Stelle selbst inkludieren, je nach
 *      `params.context.includeDeclaration`.
 *
 * Performance-Hinweis: O(documents × tokens × resolution-cost). Für die
 * Skelett-Beispieldateien (3–4 Module, kleine Programme) trivial schnell.
 * Bei großen Workspaces bietet sich ein Symbol-Index an — eine spätere
 * Iteration.
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
import type { ReferencesProvider } from 'langium/lsp';
import type { Location, ReferenceParams, Range } from 'vscode-languageserver';
import {
    isCallChain,
    isFieldAccess,
    isNamedType,
    isSafeFieldAccess,
    type Program,
} from './generated/ast.js';
import { resolveTargetForIdToken } from './findsl-definition.js';
import type { FindslServices } from './findsl-module.js';

export class FindslReferencesProvider implements ReferencesProvider {

    protected readonly documents: LangiumDocuments;
    protected readonly grammarConfig: GrammarConfig;

    constructor(services: FindslServices) {
        this.documents = services.shared.workspace.LangiumDocuments;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    findReferences(
        document: LangiumDocument, params: ReferenceParams,
    ): MaybePromise<Location[]> {
        const rootCst = document.parseResult?.value?.$cstNode;
        if (!rootCst) return [];
        const offset = document.textDocument.offsetAt(params.position);

        const idNode = CstUtils.findDeclarationNodeAtOffset(
            rootCst, offset, this.grammarConfig.nameRegexp,
        );
        if (!idNode) return [];

        const program = document.parseResult.value as Program;
        const target = resolveTargetForIdToken(idNode, program, this.documents);
        if (!target) return [];

        const includeDeclaration = params.context?.includeDeclaration ?? false;
        const locations: Location[] = [];

        // 1. Decl-Stelle selbst — nur wenn includeDeclaration === true.
        if (includeDeclaration) {
            const declLoc = locationOfDeclName(target);
            if (declLoc) locations.push(declLoc);
        }

        // 2. Workspace-Scan: jeden Identifier auflösen und mit target
        //    vergleichen. AST-Identität (===) reicht, weil wir Knoten direkt
        //    referenzieren — kein deep-equal nötig.
        for (const doc of this.documents.all) {
            const docProgram = doc.parseResult?.value as Program | undefined;
            if (!docProgram) continue;
            this.collectReferences(doc, docProgram, target, locations);
        }
        return locations;
    }

    /**
     * Iteriert durch alle AST-Knoten eines Documents und sammelt die Stellen,
     * an denen ein Identifier-Token auf das gegebene Target verweist.
     *
     * Behandelte Stellen:
     *   - `CallChain.name`: Wurzel-Identifier (Variable, Funktion, Datensatz,
     *     Aufzählung, Aufzählungs-Wert)
     *   - `FieldAccess.name` / `SafeFieldAccess.name`: Feld-Zugriff in einer
     *     Chain (mit Type-Inferenz auf die Base, daher pro Match einmal
     *     resolven)
     */
    private collectReferences(
        doc: LangiumDocument, program: Program, target: AstNode, out: Location[],
    ): void {
        const uri = doc.uri.toString();
        for (const node of AstUtils.streamAllContents(program)) {
            let name: string | undefined;
            if (isCallChain(node) && node.name)                     name = node.name;
            else if (isFieldAccess(node) && node.name)              name = node.name;
            else if (isSafeFieldAccess(node) && node.name)          name = node.name;
            else if (isNamedType(node) && node.name)                name = node.name;
            else                                                    continue;

            const idCst = findIdLeaf(node, name);
            if (!idCst) continue;
            const resolved = resolveTargetForIdToken(idCst, program, this.documents);
            if (resolved === target) {
                out.push({ uri, range: idCst.range });
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

/**
 * Findet den CST-Leaf eines Identifier-Tokens innerhalb eines AST-Knotens
 * mit gegebenem Text. Greift für CallChain/FieldAccess, weil dort der `name`
 * direkt als Property gespeichert ist (nicht als CST-Referenz).
 */
function findIdLeaf(node: AstNode, name: string) {
    const cst = node.$cstNode;
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.text === name) return leaf;
    }
    return undefined;
}

/**
 * Liefert die Location des `name`-Tokens einer Decl (für includeDeclaration).
 * Funktioniert für Konst-/Funktion-/Datensatz-/Aufzählungs-Decls, Felder
 * und Params.
 */
function locationOfDeclName(decl: AstNode): Location | undefined {
    const doc = AstUtils.getDocument(decl);
    const name = (decl as { name?: string }).name;
    if (!name) return undefined;
    const cst = decl.$cstNode;
    if (!cst) return undefined;
    let range: Range | undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.text === name) { range = leaf.range; break; }
    }
    if (!range) return undefined;
    return { uri: doc.uri.toString(), range };
}

