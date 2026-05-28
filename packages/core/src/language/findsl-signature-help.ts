/**
 * Signature-Help-Provider für FinDSL (LSP `textDocument/signatureHelp`).
 *
 * Beim Tippen eines Aufrufs `estGrundtarif(│)` blendet der Editor die
 * Signatur ein und hebt den aktiven Parameter hervor — für die
 * Zielgruppe (Sachbearbeiter:innen) zentral, um eine Berechnung zu
 * schreiben, ohne die Deklaration nachzuschlagen.
 *
 * Aufgelöst werden `fn`-Aufrufe und `datensatz`-Konstruktoren (lokal +
 * `verwende`-Cross-Modul) sowie Builtin-Funktionen. Nur die direkte
 * Aufrufform `name(args)` (CallChain mit `Call` als erstem Ketten-Glied);
 * Aufruf-Ergebnis-Ketten werden bewusst nicht unterstützt.
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
import type { SignatureHelpProvider } from 'langium/lsp';
import {
    type SignatureHelp,
    type SignatureHelpOptions,
    type SignatureHelpParams,
    type SignatureInformation,
} from 'vscode-languageserver';
import {
    isCall,
    isCallChain,
    isFieldAccess,
    isSafeFieldAccess,
    isParenChain,
    isDatensatzDecl,
    isFunktionDecl,
    type Call,
    type CallChain,
    type ChainOp,
    type DeclPrefix,
    type ParenChain,
    type Program,
    type Type as TypeAnnotation,
    type TypeAtom,
} from './generated/ast.js';
import { analyzeImports } from './findsl-scope.js';
import { findModuleInWorkspace } from './findsl-definition.js';
import { BUILTIN_FUNCTION_DEFS } from './findsl-stdlib.js';
import { findMethodDef } from './findsl-method-defs.js';
import { infer } from './findsl-inference.js';
import { buildLocalScope, stepChainOp } from './findsl-local-scope.js';
import { buildModuleHeader } from './findsl-scope.js';
import { type Type } from './findsl-types.js';
import type { FindslServices } from './findsl-module.js';

interface Sig {
    /** Vollständiges Signatur-Label (eine Zeile). */
    readonly label: string;
    /** Pro Parameter: [start, end] Offsets im Label (UTF-16). */
    readonly paramRanges: ReadonlyArray<[number, number]>;
    readonly doc?: string;
    readonly quelle?: string;
}

export class FindslSignatureHelpProvider implements SignatureHelpProvider {

    private readonly documents: LangiumDocuments;
    private readonly grammarConfig: GrammarConfig;

    constructor(services: FindslServices) {
        this.documents = services.shared.workspace.LangiumDocuments;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    get signatureHelpOptions(): SignatureHelpOptions {
        return { triggerCharacters: ['(', ','], retriggerCharacters: [','] };
    }

    provideSignatureHelp(
        document: LangiumDocument, params: SignatureHelpParams,
    ): MaybePromise<SignatureHelp | undefined> {
        const rootCst = document.parseResult?.value?.$cstNode;
        if (!rootCst) return undefined;
        const offset = document.textDocument.offsetAt(params.position);

        const call = this.enclosingCall(rootCst, offset);
        if (!call) return undefined;
        const chain = call.$container;
        const program = document.parseResult.value as Program;

        // Zwei Aufrufformen werden unterstützt:
        //   A) `name(args)`        — freie Funktion / Datensatz-Konstruktor
        //   B) `recv.methode(args)` — Builtin-Methode (SPEC § 11)
        let sig: Sig | undefined;
        if (isCallChain(chain) && chain.chain[0] === call && chain.name) {
            sig = this.resolveSignature(program, chain.name);
        } else if (isCallChain(chain) || isParenChain(chain)) {
            sig = this.resolveBuiltinMethodSignature(chain, call, program);
        }
        if (!sig) return undefined;

        const active = activeParameter(call, offset, document, sig.paramRanges.length);

        const info: SignatureInformation = {
            label: sig.label,
            parameters: sig.paramRanges.map((r) => ({ label: r })),
            activeParameter: active,
        };
        const docText = [sig.doc, sig.quelle ? `*Quelle:* ${sig.quelle}` : '']
            .filter(Boolean).join('\n\n');
        if (docText) info.documentation = { kind: 'markdown', value: docText };

        return { signatures: [info], activeSignature: 0, activeParameter: active };
    }

    /**
     * Builtin-Methoden-Signatur für `recv.methode(args)` — sucht den
     * unmittelbar vor dem Call stehenden `FieldAccess`, inferiert den
     * Empfänger-Typ und befragt `findMethodDef`. Liefert `undefined`,
     * wenn keine Builtin-Methode (Record-Feld, unbekannter Name, …).
     */
    private resolveBuiltinMethodSignature(
        chain: CallChain | ParenChain, call: Call, program: Program,
    ): Sig | undefined {
        const callIdx = chain.chain.indexOf(call);
        const prev = callIdx > 0 ? chain.chain[callIdx - 1] : undefined;
        if (!prev || (!isFieldAccess(prev) && !isSafeFieldAccess(prev)) || !prev.name) return undefined;

        const receiverType = inferReceiverTypeAt(chain, callIdx - 1, program, this.documents);
        if (!receiverType) return undefined;

        const def = findMethodDef(receiverType, prev.name);
        if (!def || def.property) return undefined;  // Properties haben keine Params

        return { ...sigFromText(def.signature), doc: def.doc, quelle: def.quelle };
    }

    /**
     * Innerster `Call`-Knoten, dessen Klammern den Offset umschließen
     * (Cursor nach dem `(`). Über die CST-Leaf-Kette aufwärts gesucht.
     */
    private enclosingCall(rootCst: AstNode['$cstNode'], offset: number): Call | undefined {
        const leaf = CstUtils.findLeafNodeAtOffset(rootCst!, offset)
            ?? CstUtils.findLeafNodeAtOffset(rootCst!, offset - 1);
        let n: AstNode | undefined = leaf?.astNode;
        while (n) {
            if (isCall(n) && n.$cstNode) {
                const r = n.$cstNode.range;
                const start = n.$cstNode.offset;
                const end = n.$cstNode.end;
                // Offset muss innerhalb der Aufruf-Klammern liegen
                // (nach `(`, bis einschließlich `)`).
                if (offset > start && offset <= end && r) return n;
            }
            n = n.$container;
        }
        return undefined;
    }

    private resolveSignature(program: Program, name: string): Sig | undefined {
        const builtin = BUILTIN_FUNCTION_DEFS.find((f) => f.name === name);
        if (builtin) {
            return { ...sigFromText(builtin.signature), doc: builtin.doc, quelle: builtin.quelle };
        }
        const decl = this.lookupDecl(program, name);
        if (decl && isFunktionDecl(decl)) {
            const parts = decl.params.map((p) =>
                `${p.name}: ${typeToString(p.type)}${p.default ? ' = …' : ''}`);
            const head = `fn ${decl.name}(`;
            return {
                ...assemble(head, parts, `): ${typeToString(decl.returnType)}`),
                ...declDoc(decl.docPrefix),
            };
        }
        if (decl && isDatensatzDecl(decl)) {
            const parts = decl.fields.map((f) =>
                `${f.name}: ${typeToString(f.type)}${f.default ? ' = …' : ''}`);
            return {
                ...assemble(`${decl.name}(`, parts, ')'),
                ...declDoc(decl.docPrefix),
            };
        }
        return undefined;
    }

    private lookupDecl(program: Program, name: string): AstNode | undefined {
        for (const d of program.decls) {
            if (d.name === name) return d;
        }
        const binding = analyzeImports(program).bindings.find((b) => b.localName === name);
        if (!binding) return undefined;
        const src = findModuleInWorkspace(this.documents, binding.resolvedPath);
        return src?.decls.find((d) => d.name === binding.sourceName);
    }
}

// ---------------------------------------------------------------------------
// Aktiver Parameter aus der Cursor-Position
// ---------------------------------------------------------------------------

function activeParameter(
    call: Call, offset: number, _document: LangiumDocument, paramCount: number,
): number {
    let active = 0;
    for (let i = 0; i < call.args.length; i++) {
        const arg = call.args[i];
        const cst = arg.value?.$cstNode
            ?? (arg as { $cstNode?: { offset: number; end: number } }).$cstNode;
        if (!cst) continue;
        if (offset > cst.end) {
            active = i + 1;          // hinter Argument i → (mind.) nächstes
            continue;
        }
        if (offset >= cst.offset) active = i;   // im Argument i
        // sonst (offset < Start): zwischen Komma und nächstem Arg →
        // `active` bleibt auf dem zuvor gesetzten i+1.
        break;
    }
    if (paramCount === 0) return 0;
    return Math.min(active, paramCount - 1);
}

// ---------------------------------------------------------------------------
// Signatur-Label + Parameter-Offsets bauen
// ---------------------------------------------------------------------------

function assemble(
    head: string, parts: ReadonlyArray<string>, tail: string,
): { label: string; paramRanges: Array<[number, number]> } {
    let label = head;
    const ranges: Array<[number, number]> = [];
    parts.forEach((p, i) => {
        if (i > 0) label += ', ';
        const start = label.length;
        label += p;
        ranges.push([start, label.length]);
    });
    label += tail;
    return { label, paramRanges: ranges };
}

/** Parst Parameter aus einem fertigen Signatur-String (Builtins). */
function sigFromText(signature: string): { label: string; paramRanges: Array<[number, number]> } {
    const open = signature.indexOf('(');
    const close = open >= 0 ? matchingClosingParen(signature, open) : -1;
    const ranges: Array<[number, number]> = [];
    if (open < 0 || close < 0) return { label: signature, paramRanges: ranges };
    const inner = signature.slice(open + 1, close);
    // Klammer-tief splitten — Lambda-Argumente wie `f: (A, T) -> A` sind
    // sonst fälschlich drei Parameter (Bug für `.zusammenfassen` & Co.).
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < inner.length; i++) {
        const c = inner[i];
        if (c === '(' || c === '<' || c === '[') depth++;
        else if (c === ')' || c === '>' || c === ']') depth--;
        else if (c === ',' && depth === 0) {
            parts.push(inner.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(inner.slice(start));

    let cursor = open + 1;
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed) {
            const startIdx = signature.indexOf(trimmed, cursor);
            ranges.push([startIdx, startIdx + trimmed.length]);
            cursor = startIdx + trimmed.length;
        }
    }
    return { label: signature, paramRanges: ranges };
}

// ---------------------------------------------------------------------------
// Doku-Extraktion + Typ-Pretty-Print (lokal, wie in den anderen Providern)
// ---------------------------------------------------------------------------

function declDoc(prefix?: DeclPrefix): { doc?: string; quelle?: string } {
    if (!prefix) return {};
    let doc: string | undefined;
    if (prefix.doc) {
        let s = prefix.doc;
        if (s.startsWith('--')) s = s.slice(2);
        if (s.endsWith('--')) s = s.slice(0, -2);
        s = s.replace(/^\s*\n/, '').replace(/\n\s*$/, '').trim();
        doc = s || undefined;
    }
    let quelle: string | undefined;
    for (const a of prefix.annotations ?? []) {
        if (a.name !== 'Quelle') continue;
        const arg = a.args[0] as { $type?: string; value?: string } | undefined;
        if (arg?.$type === 'StringLiteral' && typeof arg.value === 'string') {
            const raw = arg.value;
            quelle = raw.startsWith('"') ? raw.slice(1, -1) : raw;
        }
    }
    return { doc, quelle };
}

function typeToString(t: TypeAnnotation | undefined): string {
    if (!t || !t.atom) return '?';
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

// ---------------------------------------------------------------------------
// Empfänger-Typ vor einer Chain-Op bestimmen (für Builtin-Methoden-Sig)
// ---------------------------------------------------------------------------

/**
 * Inferiert den Typ des Empfängers vor der Chain-Op an `idx` —
 * funktioniert für `CallChain` (`a.b.c`) und `ParenChain` (`(a + b).c`).
 *
 * Bewusst eigenständige Funktion (nicht aus dem Hover wiederverwendet),
 * weil hover.ts den Provider selbst für Cross-Modul-Lookup braucht;
 * Signature-Help kommt mit dem LangiumDocuments-Workspace aus. Beide
 * Provider könnten sich später eine zentrale Variante teilen.
 */
function inferReceiverTypeAt(
    chain: CallChain | ParenChain,
    untilIndex: number,
    program: Program,
    _documents: LangiumDocuments,
): Type | undefined {
    const header = buildModuleHeader(program);
    const ctx = header.context;
    const localEnv = buildLocalScope(chain, ctx, program, () => undefined);

    let current: Type | undefined;
    if (isCallChain(chain)) {
        if (!chain.name) return undefined;
        current = localEnv.lookup(chain.name);
    } else {
        if (!chain.receiver) return undefined;
        current = infer(chain.receiver, localEnv, ctx, () => {});
    }
    for (let i = 0; i < untilIndex; i++) {
        if (!current || current.kind === 'unknown') return undefined;
        current = stepChainOp(current, chain.chain[i], true);
    }
    return current;
}

/** Index der zur `(` an `openIdx` passenden `)`, oder −1. Konsistent mit
 *  `paramNamesFromSignature` (klammer-aware), anders als das frühere
 *  `lastIndexOf(')')` — robust gegen verschachtelte Lambda-Klammern. */
function matchingClosingParen(s: string, openIdx: number): number {
    let depth = 0;
    for (let i = openIdx; i < s.length; i++) {
        const c = s[i];
        if (c === '(') depth++;
        else if (c === ')') {
            depth--;
            if (depth === 0) return i;
        }
    }
    return -1;
}
