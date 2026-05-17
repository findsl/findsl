/**
 * Go-to-Type-Definition-Provider für FinDSL (LSP `textDocument/typeDefinition`).
 *
 * Unterschied zu Go-to-Definition: nicht die Deklaration des Symbols
 * selbst, sondern die Deklaration seines **Typs**. Beispiel:
 *
 *   fn f(fall: Steuerfall) = fall.betrag
 *            ^^^^  Definition  → der Parameter `fall`
 *            ^^^^  Type-Def    → `datensatz Steuerfall(...)`
 *
 * Aufgelöst werden: Parameter, `var`, `konst`, Felder, Funktions-
 * Rückgabetypen, Field-Access-Ketten sowie direkt unter dem Cursor
 * stehende Typ-Annotationen. `Liste<T>` springt zum Element-Typ `T`,
 * `T?` ist transparent. Builtins (`Euro`, `Tarifart`, …) haben keine
 * Quelldatei → kein Sprung (bewusst, kein Fehler).
 *
 * Die Symbol→Decl-Auflösung wird aus `findsl-definition.ts` wieder-
 * verwendet (`resolveTargetForIdToken` etc.); hier kommt nur der Schritt
 * „Decl → Typ-Decl" dazu.
 */

import {
    type AstNode,
    type CstNode,
    type LangiumDocument,
    type LangiumDocuments,
    type MaybePromise,
    AstUtils,
    CstUtils,
    type GrammarConfig,
} from 'langium';
import type { TypeDefinitionProvider } from 'langium/lsp';
import type { LocationLink, TypeDefinitionParams } from 'vscode-languageserver';
import {
    isAufzaehlungDecl,
    isDatensatzDecl,
    isField,
    isFunktionDecl,
    isKonstDecl,
    isLetStmt,
    isNamedType,
    type Program,
    type Type as TypeAnnotation,
} from './generated/ast.js';
import { analyzeImports } from './findsl-scope.js';
import {
    findModuleInWorkspace,
    findNameRange,
    resolveTargetForIdToken,
} from './findsl-definition.js';
import type { FindslServices } from './findsl-module.js';

export class FindslTypeDefinitionProvider implements TypeDefinitionProvider {

    private readonly documents: LangiumDocuments;
    private readonly grammarConfig: GrammarConfig;

    constructor(services: FindslServices) {
        this.documents = services.shared.workspace.LangiumDocuments;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    getTypeDefinition(
        document: LangiumDocument, params: TypeDefinitionParams,
    ): MaybePromise<LocationLink[] | undefined> {
        const rootCst = document.parseResult?.value?.$cstNode;
        if (!rootCst) return undefined;
        const offset = document.textDocument.offsetAt(params.position);

        const idNode = CstUtils.findDeclarationNodeAtOffset(
            rootCst, offset, this.grammarConfig.nameRegexp,
        );
        if (!idNode) return undefined;

        const program = document.parseResult.value as Program;
        const target = this.resolveTypeDecl(idNode, program);
        if (!target) return undefined;

        return this.makeLocationLinks(idNode, target);
    }

    /**
     * Liefert die Typ-Deklaration (`datensatz`/`aufzählung`) für den
     * Identifier unter dem Cursor.
     */
    private resolveTypeDecl(idNode: CstNode, program: Program): AstNode | undefined {
        const ast = idNode.astNode;
        const text = idNode.text;

        // Cursor steht direkt auf einer Typ-Annotation (`x: Steuerfall`,
        // oder dem Element einer `Liste<Steuerfall>`): der Name IST der Typ.
        if (isNamedType(ast) && ast.name === text) {
            return resolveUserTypeDecl(ownerProgram(ast) ?? program, text, this.documents);
        }

        // Sonst: Symbol auflösen (wie Go-to-Definition), dann dessen Typ.
        const decl = resolveTargetForIdToken(idNode, program, this.documents);
        if (!decl) return undefined;

        // Der Typ eines Typs ist der Typ selbst.
        if (isDatensatzDecl(decl) || isAufzaehlungDecl(decl)) return decl;

        const annotation = typeAnnotationOf(decl);
        if (!annotation) return undefined;
        return typeDeclForAnnotation(annotation, decl, this.documents);
    }

    private makeLocationLinks(source: CstNode, target: AstNode): LocationLink[] | undefined {
        const targetCst = target.$cstNode;
        if (!targetCst) return undefined;
        const targetUri = AstUtils.getDocument(target).uri.toString();
        const nameRange = findNameRange(target) ?? targetCst.range;
        return [{
            originSelectionRange: source.range,
            targetUri,
            targetRange:          targetCst.range,
            targetSelectionRange: nameRange,
        }];
    }
}

// ---------------------------------------------------------------------------
// Decl → Typ-Annotation
// ---------------------------------------------------------------------------

/** Die typ-tragende Annotation einer Symbol-Deklaration, falls vorhanden. */
function typeAnnotationOf(decl: AstNode): TypeAnnotation | undefined {
    if (isFunktionDecl(decl)) return decl.returnType;
    if (isKonstDecl(decl))    return decl.type;
    if (isField(decl))        return decl.type;
    if (isLetStmt(decl))      return decl.type;
    if ('type' in decl && decl.type && typeof decl.type === 'object') {
        // Param (kein eigener Type-Guard nötig — Property-Form genügt).
        return (decl as { type: TypeAnnotation }).type;
    }
    return undefined;
}

/**
 * Folgt einer Typ-Annotation zur Quell-Deklaration:
 *   - `Liste<T>` → rekursiv zu `T`
 *   - benannter User-Typ → `datensatz`/`aufzählung`-Decl (lokal/Cross-Modul)
 *   - Primitive/Builtins/`(…)->…` → keine Decl (kein Sprung)
 */
function typeDeclForAnnotation(
    t: TypeAnnotation, owner: AstNode, documents: LangiumDocuments,
): AstNode | undefined {
    if (!t?.atom || t.atom.$type !== 'NamedType') return undefined;  // Funktionstyp/Teil-Parse
    const atom = t.atom;
    if (atom.name === 'Liste' && atom.typeArgs?.args.length) {
        return typeDeclForAnnotation(atom.typeArgs.args[0], owner, documents);
    }
    const prog = ownerProgram(owner);
    if (!prog) return undefined;
    return resolveUserTypeDecl(prog, atom.name, documents);
}

/**
 * Sucht eine `datensatz`/`aufzählung`-Decl mit dem Namen — erst lokal im
 * Modul, dann über `verwende`-Importe im Workspace. Builtins (`Euro`,
 * `Tarifart`, …) sind keine User-Decls → `undefined` (korrekt: keine
 * Quelldatei zum Hinspringen).
 */
function resolveUserTypeDecl(
    program: Program, name: string, documents: LangiumDocuments,
): AstNode | undefined {
    for (const d of program.decls) {
        if ((isDatensatzDecl(d) || isAufzaehlungDecl(d)) && d.name === name) return d;
    }
    const binding = analyzeImports(program).bindings.find((b) => b.localName === name);
    if (!binding) return undefined;
    const src = findModuleInWorkspace(documents, binding.resolvedPath);
    if (!src) return undefined;
    return src.decls.find(
        (d) => (isDatensatzDecl(d) || isAufzaehlungDecl(d)) && d.name === binding.sourceName,
    );
}

/** Das `Program`, in dem ein Knoten lebt (eigenes bzw. Quell-Modul). */
function ownerProgram(node: AstNode): Program | undefined {
    return AstUtils.getDocument(node).parseResult?.value as Program | undefined;
}
