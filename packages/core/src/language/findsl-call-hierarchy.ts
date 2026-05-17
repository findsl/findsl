/**
 * Call-Hierarchy-Provider für FinDSL (LSP `textDocument/prepareCallHierarchy`
 * + `callHierarchy/{incoming,outgoing}Calls`).
 *
 * Beantwortet projektweit „wer ruft `estGrundtarif`" (eingehend) und
 * „welche Funktionen ruft `estGrundtarif`" (ausgehend) — zentrale
 * Audit-Frage: an welcher Berechnung hängt eine Norm-Regel.
 *
 * Langiums `AbstractCallHierarchyProvider` setzt auf den Referenz-Index
 * (Cross-References). FinDSL hat keine — daher implementieren wir das
 * Interface direkt und lösen Aufrufe selbst auf: ein „Aufruf" ist eine
 * `CallChain`, deren erstes Ketten-Glied ein `Call` ist und deren Name
 * (lokal oder via `verwende`) auf eine `FunktionDecl` zeigt. Datensatz-
 * Konstruktoren und Builtins zählen bewusst nicht als Funktionsaufrufe.
 *
 * Identität einer Funktion = die AST-Node der `FunktionDecl` (im selben
 * Workspace dasselbe Objekt) — Alias-Importe werden so korrekt aufgelöst.
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
import type { CallHierarchyProvider } from 'langium/lsp';
import {
    SymbolKind,
    type CallHierarchyIncomingCall,
    type CallHierarchyIncomingCallsParams,
    type CallHierarchyItem,
    type CallHierarchyOutgoingCall,
    type CallHierarchyOutgoingCallsParams,
    type CallHierarchyPrepareParams,
    type Range,
} from 'vscode-languageserver';
import {
    isCall,
    isCallChain,
    isFunktionDecl,
    type FunktionDecl,
    type Program,
    type Type as TypeAnnotation,
    type TypeAtom,
} from './generated/ast.js';
import { analyzeImports } from './findsl-scope.js';
import {
    findModuleInWorkspace,
    findNameRange,
    resolveTargetForIdToken,
} from './findsl-definition.js';
import type { FindslServices } from './findsl-module.js';

/** Wird in `CallHierarchyItem.data` mitgeführt, um die Decl wiederzufinden. */
interface ItemData {
    readonly uri: string;
    readonly fnName: string;
}

export class FindslCallHierarchyProvider implements CallHierarchyProvider {

    private readonly documents: LangiumDocuments;
    private readonly grammarConfig: GrammarConfig;

    constructor(services: FindslServices) {
        this.documents = services.shared.workspace.LangiumDocuments;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    // -- prepare ------------------------------------------------------------

    prepareCallHierarchy(
        document: LangiumDocument, params: CallHierarchyPrepareParams,
    ): MaybePromise<CallHierarchyItem[] | undefined> {
        const rootCst = document.parseResult?.value?.$cstNode;
        if (!rootCst) return undefined;
        const offset = document.textDocument.offsetAt(params.position);
        const idNode = CstUtils.findDeclarationNodeAtOffset(
            rootCst, offset, this.grammarConfig.nameRegexp,
        );
        if (!idNode) return undefined;

        const program = document.parseResult.value as Program;
        const target = resolveTargetForIdToken(idNode, program, this.documents);
        if (!target || !isFunktionDecl(target)) return undefined;

        const item = this.itemFor(target);
        return item ? [item] : undefined;
    }

    // -- incoming: wer ruft diese Funktion ----------------------------------

    incomingCalls(
        params: CallHierarchyIncomingCallsParams,
    ): MaybePromise<CallHierarchyIncomingCall[] | undefined> {
        const target = this.declFromItem(params.item);
        if (!target) return undefined;

        const calls: CallHierarchyIncomingCall[] = [];
        for (const doc of this.documents.all) {
            const program = doc.parseResult?.value as Program | undefined;
            if (!program) continue;
            for (const decl of program.decls) {
                if (!isFunktionDecl(decl)) continue;
                const ranges = this.callSiteRangesTo(decl, target, program);
                if (ranges.length === 0) continue;
                const from = this.itemFor(decl);
                if (from) calls.push({ from, fromRanges: ranges });
            }
        }
        return calls;
    }

    // -- outgoing: welche Funktionen ruft diese Funktion --------------------

    outgoingCalls(
        params: CallHierarchyOutgoingCallsParams,
    ): MaybePromise<CallHierarchyOutgoingCall[] | undefined> {
        const caller = this.declFromItem(params.item);
        if (!caller) return undefined;
        const program = AstUtils.getDocument(caller).parseResult?.value as Program | undefined;
        if (!program) return undefined;

        // callee-Decl → Liste der Aufrufstellen-Ranges im caller-Body.
        const byCallee = new Map<FunktionDecl, Range[]>();
        for (const { name, range } of this.callsIn(caller)) {
            const callee = resolveFunction(program, name, this.documents);
            if (!callee) continue;
            const list = byCallee.get(callee) ?? [];
            list.push(range);
            byCallee.set(callee, list);
        }

        const out: CallHierarchyOutgoingCall[] = [];
        for (const [callee, fromRanges] of byCallee) {
            const to = this.itemFor(callee);
            if (to) out.push({ to, fromRanges });
        }
        return out;
    }

    // -- Helfer -------------------------------------------------------------

    /** Alle Aufrufstellen in `caller`, die `target` treffen. */
    private callSiteRangesTo(
        caller: FunktionDecl, target: FunktionDecl, callerProgram: Program,
    ): Range[] {
        const ranges: Range[] = [];
        for (const { name, range } of this.callsIn(caller)) {
            if (resolveFunction(callerProgram, name, this.documents) === target) {
                ranges.push(range);
            }
        }
        return ranges;
    }

    /**
     * Alle Funktionsaufruf-Stellen im Body von `fn`: `CallChain` mit einem
     * `Call` als erstem Ketten-Glied. Range = der Name-Token der Kette.
     */
    private callsIn(fn: FunktionDecl): Array<{ name: string; range: Range }> {
        const result: Array<{ name: string; range: Range }> = [];
        for (const node of AstUtils.streamAllContents(fn)) {
            if (!isCallChain(node)) continue;
            const first = node.chain[0];
            if (!first || !isCall(first)) continue;
            if (!node.name) continue;
            const range = nameLeafRange(node, node.name) ?? node.$cstNode?.range;
            if (range) result.push({ name: node.name, range });
        }
        return result;
    }

    private itemFor(decl: FunktionDecl): CallHierarchyItem | undefined {
        const cst = decl.$cstNode;
        if (!cst) return undefined;
        const doc = AstUtils.getDocument(decl);
        const uri = doc.uri.toString();
        const params = decl.params
            .map((p) => `${p.name}: ${typeToString(p.type)}`)
            .join(', ');
        return {
            name:           decl.name,
            kind:           SymbolKind.Function,
            detail:         `(${params}): ${typeToString(decl.returnType)}`,
            uri,
            range:          cst.range,
            selectionRange: findNameRange(decl) ?? cst.range,
            data:           { uri, fnName: decl.name } satisfies ItemData,
        };
    }

    private declFromItem(item: CallHierarchyItem): FunktionDecl | undefined {
        const data = item.data as ItemData | undefined;
        if (!data) return undefined;
        for (const doc of this.documents.all) {
            if (doc.uri.toString() !== data.uri) continue;
            const program = doc.parseResult?.value as Program | undefined;
            const decl = program?.decls.find(
                (d) => isFunktionDecl(d) && d.name === data.fnName,
            );
            return decl && isFunktionDecl(decl) ? decl : undefined;
        }
        return undefined;
    }
}

/**
 * Löst einen Aufruf-Namen im Kontext eines Programms zu seiner
 * `FunktionDecl` auf — lokal, dann über `verwende`-Importe im Workspace.
 * Builtins/Datensatz-Konstruktoren → `undefined` (kein Funktionsaufruf
 * im Sinne der Call-Hierarchy).
 */
function resolveFunction(
    program: Program, name: string, documents: LangiumDocuments,
): FunktionDecl | undefined {
    for (const d of program.decls) {
        if (isFunktionDecl(d) && d.name === name) return d;
    }
    const binding = analyzeImports(program).bindings.find((b) => b.localName === name);
    if (!binding) return undefined;
    const src = findModuleInWorkspace(documents, binding.resolvedPath);
    if (!src) return undefined;
    const d = src.decls.find((x) => isFunktionDecl(x) && x.name === binding.sourceName);
    return d && isFunktionDecl(d) ? d : undefined;
}

/** Range des Tokens mit gegebenem Text innerhalb eines AST-Knotens. */
function nameLeafRange(node: AstNode, text: string): Range | undefined {
    const cst = node.$cstNode;
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.text === text) return leaf.range;
    }
    return undefined;
}

// Type-Annotation pretty-print (lokal — parallel zu den anderen Providern).
function typeToString(t: TypeAnnotation | undefined): string {
    if (!t || !t.atom) return '?';        // Teil-Parse beim Tippen
    return typeAtomToString(t.atom) + (t.optional ? '?' : '');
}

function typeAtomToString(atom: TypeAtom): string {
    if (atom.$type === 'NamedType') {
        const args = atom.typeArgs?.args.map(typeToString).join(', ');
        return args ? `${atom.name}<${args}>` : atom.name;
    }
    const params = atom.paramTypes.map(typeToString).join(', ');
    const result = atom.returnType ? typeToString(atom.returnType) : '?';
    return `(${params}) -> ${result}`;
}
