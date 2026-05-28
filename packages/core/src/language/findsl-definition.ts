/**
 * Go-to-Definition-Provider für FinDSL.
 *
 * Liefert beim Cmd/Strg+Click auf einen Identifier seine Definition als
 * `LocationLink[]`. Die Resolution-Logik spiegelt den Hover-Provider —
 * lokale Top-Decls, Cross-Modul-Imports und Field-Access werden gleich
 * behandelt; Unterschied ist das Output-Shape (LSP-LocationLink statt
 * Markdown-Karte).
 *
 * Reuse von `findsl-hover.ts`-Internen wurde bewusst vermieden: die zwei
 * Provider sind LSP-Services, und Service-Querverweise würden den DI-Graph
 * verkomplizieren. Stattdessen nutzen wir gemeinsame Utilities aus
 * `findsl-scope.ts` (Import-Analyse, Header-Build) und `findsl-types.ts`
 * (Type-Resolution für Field-Access-Pfade).
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
import type { DefinitionProvider } from 'langium/lsp';
import type { Range } from 'vscode-languageserver';
import type { DefinitionParams, LocationLink } from 'vscode-languageserver';
import {
    isAufzaehlungDecl,
    isBlockExpr,
    isCall,
    isCallChain,
    isDatensatzDecl,
    isFieldAccess,
    isField,
    isForceUnwrap,
    isFuerExpr,
    isFunktionDecl,
    isImportItem,
    isKonstDecl,
    isLambda,
    isLetStmt,
    isNamedType,
    isParam,
    isSafeFieldAccess,
    type CallChain,
    type ChainOp,
    type Expr,
    type Field,
    type ImportItem,
    type Program,
    type Type as TypeAnnotation,
} from './generated/ast.js';
import { analyzeImports, buildModuleHeader } from './findsl-scope.js';
import * as path from 'node:path';
import {
    infer,
    resolveTypeAnnotation,
    TNull,
    TUnknown,
    TypeEnv,
    type Type,
    type TypeContext,
} from './findsl-types.js';
import { buildLocalScope, stepChainOp } from './findsl-local-scope.js';
import type { FindslServices } from './findsl-module.js';

export class FindslDefinitionProvider implements DefinitionProvider {

    protected readonly documents: LangiumDocuments;
    protected readonly grammarConfig: GrammarConfig;

    constructor(services: FindslServices) {
        this.documents = services.shared.workspace.LangiumDocuments;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    getDefinition(
        document: LangiumDocument,
        params: DefinitionParams,
    ): MaybePromise<LocationLink[] | undefined> {
        const program = document.parseResult?.value as Program | undefined;
        const rootCst = program?.$cstNode;
        if (!program || !rootCst) return undefined;
        const offset = document.textDocument.offsetAt(params.position);

        const idNode = CstUtils.findDeclarationNodeAtOffset(
            rootCst, offset, this.grammarConfig.nameRegexp,
        );
        if (!idNode) return undefined;

        const target = resolveTargetForIdToken(idNode, program, this.documents);
        if (!target) return undefined;

        return this.makeLocationLinks(idNode, target);
    }

    private makeLocationLinks(source: CstNode, target: AstNode): LocationLink[] | undefined {
        const targetCst = target.$cstNode;
        if (!targetCst) return undefined;
        const targetDoc = AstUtils.getDocument(target);
        const targetUri = targetDoc.uri.toString();

        // targetSelectionRange: bevorzugt der Name-Token der Decl, damit der
        // Cursor nach dem Sprung auf dem Identifier landet, nicht auf der
        // ganzen Decl.
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
// Resolve-Logik als freistehende Funktionen — werden vom
// `FindslReferencesProvider` mit-genutzt.
// ---------------------------------------------------------------------------

/**
 * Findet den Target-AST-Knoten für einen Identifier-Token. Berücksichtigt:
 * direkter Decl-Knoten, CallChain-Wurzel (lokal + Cross-Modul), FieldAccess
 * in einer Chain (mit Typ-Inferenz auf die Base).
 */
export function resolveTargetForIdToken(
    idNode: CstNode,
    program: Program,
    documents: LangiumDocuments,
): AstNode | undefined {
    const ast = idNode.astNode;
    const text = idNode.text;

    if (isKonstDecl(ast)       && ast.name === text) return ast;
    if (isFunktionDecl(ast)    && ast.name === text) return ast;
    if (isDatensatzDecl(ast)   && ast.name === text) return ast;
    if (isAufzaehlungDecl(ast) && ast.name === text) return ast;
    if (isField(ast)           && ast.name === text) return ast;
    if (isParam(ast)           && ast.name === text) return ast;

    // Cursor auf einem `ImportItem`-Token im `verwende { … } aus "…"`-Block
    // (Source-Name oder Alias) → Sprung zur Decl im Quellmodul. Vor dem
    // FieldAccess/CallChain-Fallback, damit ein lokales gleichnamiges
    // Symbol nicht fälschlich gewinnt.
    if (isImportItem(ast) && (ast.name === text || ast.alias === text)) {
        return resolveImportItemTarget(ast, program, documents);
    }

    if ((isFieldAccess(ast) || isSafeFieldAccess(ast)) && ast.name === text) {
        return resolveFieldAccessTarget(ast, program, documents);
    }

    // Type-Annotation auf einen User-Typ (Datensatz oder Aufzählung) →
    // springe zur Decl. Primitive (`Euro`, `Ganzzahl`, …) und `Liste`
    // landen im resolveTopLevelTarget → undefined und damit kein Link.
    if (isNamedType(ast) && ast.name === text) {
        return resolveTopLevelTarget(program, text, documents);
    }

    if (isCallChain(ast) && ast.name === text) {
        return resolveLocalBinding(ast, text)
            ?? resolveTopLevelTarget(program, text, documents);
    }

    return resolveLocalBinding(ast, text)
        ?? resolveTopLevelTarget(program, text, documents);
}

function resolveTopLevelTarget(
    program: Program, name: string, documents: LangiumDocuments,
): AstNode | undefined {
    for (const decl of program.decls) {
        if (decl.name === name) return decl;
    }
    return resolveCrossModuleTarget(program, name, documents);
}

function resolveCrossModuleTarget(
    program: Program, localName: string, documents: LangiumDocuments,
): AstNode | undefined {
    const { bindings } = analyzeImports(program);
    const binding = bindings.find((b) => b.localName === localName);
    if (!binding) return undefined;
    const sourceProgram = findModuleInWorkspace(documents, binding.resolvedPath);
    if (!sourceProgram) return undefined;
    return sourceProgram.decls.find((d) => d.name === binding.sourceName);
}

/**
 * Sprung von einem `ImportItem`-Token im `verwende { … } aus "…"`-Block
 * zur Source-Decl im Quellmodul. Funktioniert für Source-Name **und**
 * Alias (`Foo als Bar` — beide springen zu `Foo`). Nutzt `analyzeImports`
 * für die Pfadauflösung; das Binding wird über die AST-Knoten-Identität
 * gefunden, daher unabhängig davon, ob mehrere Items denselben Quellnamen
 * tragen.
 */
function resolveImportItemTarget(
    item: ImportItem, program: Program, documents: LangiumDocuments,
): AstNode | undefined {
    const { bindings } = analyzeImports(program);
    const binding = bindings.find((b) => b.node === item);
    if (!binding) return undefined;
    const sourceProgram = findModuleInWorkspace(documents, binding.resolvedPath);
    if (!sourceProgram) return undefined;
    return sourceProgram.decls.find((d) => d.name === item.name);
}

/**
 * Findet das Programm einer Workspace-Datei anhand ihres absoluten,
 * normalisierten Dateipfads (Ersatz für die frühere Modulnamen-Suche;
 * es gibt keinen `modul`-Header mehr). `undefined` wenn kein Pfad
 * gegeben oder die Datei nicht im Workspace-Index liegt.
 */
export function findModuleInWorkspace(
    documents: LangiumDocuments, filePath: string | undefined,
): Program | undefined {
    if (!filePath) return undefined;
    const target = path.normalize(filePath);
    for (const doc of documents.all) {
        if (path.normalize(doc.uri.fsPath) === target) {
            return doc.parseResult?.value as Program | undefined;
        }
    }
    return undefined;
}

function resolveFieldAccessTarget(
    field: ChainOp, program: Program, documents: LangiumDocuments,
): Field | undefined {
    const chain = field.$container;
    if (!isCallChain(chain)) return undefined;
    const idx = chain.chain.indexOf(field);
    if (idx < 0) return undefined;

    const fieldName = (field as { name?: string }).name;
    if (!fieldName) return undefined;

    const baseType = inferBaseTypeAt(chain, idx, program, documents);
    if (!baseType) return undefined;
    const unwrapped = baseType.kind === 'nullable' ? baseType.inner : baseType;
    if (unwrapped.kind !== 'record') return undefined;
    return unwrapped.decl.fields.find((f) => f.name === fieldName);
}

/**
 * Liefert den Typ eines Cross-Modul-importierten Symbols — für den
 * Type-Stepper bei Field-Access-Auflösung mit Param-Typen, die importiert
 * sind. Wird auch von außerhalb genutzt (Tests, Referenz-Vergleiche).
 */
export function resolveCrossModuleType(
    program: Program, localName: string, documents: LangiumDocuments,
): Type | undefined {
    const { bindings } = analyzeImports(program);
    const binding = bindings.find((b) => b.localName === localName);
    if (!binding) return undefined;
    const sourceProgram = findModuleInWorkspace(documents, binding.resolvedPath);
    if (!sourceProgram) return undefined;
    const header = buildModuleHeader(sourceProgram);
    return header.context.globals.lookup(binding.sourceName);
}

/**
 * Sucht von einem inneren AST-Knoten aus aufwärts nach einem lokalen
 * Binding mit dem gegebenen Namen: Funktions-Parameter, Lambda-Parameter,
 * `var`-Lets in BlockExpr/Lambda. Stoppt am Programm-Knoten (Top-Level
 * landet im separaten Lookup).
 */
export function resolveLocalBinding(from: AstNode, name: string): AstNode | undefined {
    let n: AstNode | undefined = from;
    while (n) {
        if (isFunktionDecl(n)) {
            const p = n.params.find((p) => p.name === name);
            if (p) return p;
        }
        if (isBlockExpr(n) || isLambda(n)) {
            const l = n.stmts.find((s) => isLetStmt(s) && s.name === name);
            if (l) return l;
            if (isLambda(n)) {
                const lp = n.params.find((p) => p.name === name);
                if (lp) return lp;
            }
        }
        n = n.$container as AstNode | undefined;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Type-Stepper für Field-Access — parallel zum gleichnamigen Helfer in
// `findsl-hover.ts`. Kleine Duplikation; ein gemeinsames Modul wäre möglich,
// kostet aber Indirektion ohne klaren Mehrwert (beide Provider sind dünn).
// ---------------------------------------------------------------------------

function inferBaseTypeAt(
    chain: CallChain,
    untilIndex: number,
    program: Program,
    documents: LangiumDocuments,
): Type | undefined {
    if (!chain.name) return undefined;

    const header = buildModuleHeader(program);
    const ctx = header.context;
    const localEnv = buildLocalScope(
        chain, ctx, program,
        (p, n) => resolveCrossModuleType(p, n, documents),
    );

    let current: Type | undefined =
        localEnv.lookup(chain.name) ?? resolveCrossModuleType(program, chain.name, documents);
    if (!current) return undefined;

    for (let i = 0; i < untilIndex; i++) {
        current = stepChainOp(current, chain.chain[i], false);
        if (!current || current.kind === 'unknown') return undefined;
    }
    return current;
}

// ---------------------------------------------------------------------------
// Helfer
// ---------------------------------------------------------------------------

/**
 * Findet den Range des `name`-Tokens innerhalb einer Decl. Liefert sonst
 * undefined; der Aufrufer fällt dann auf den ganzen Decl-Range zurück.
 */
export function findNameRange(node: AstNode): Range | undefined {
    const named = node as unknown as { name?: string };
    if (!named.name) return undefined;
    const cst = node.$cstNode;
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.text === named.name) return leaf.range;
    }
    return undefined;
}

