/**
 * Completion-Provider (IntelliSense) für FinDSL.
 *
 * Die FinDSL-Grammatik deklariert KEINE `cross-references` — alle Bezeichner
 * sind einfache `ID`-Tokens, die Validator/Type-Checker selbst auflösen.
 * Damit liefert Langiums scope-getriebene Standard-Completion praktisch
 * nichts ausser Keyword-Vorschlägen. Wir ergänzen kontextsensitiv:
 *
 *   - Ausdrucks-Position (`CallChain.name`):
 *       lokale Bindungen (Parameter, `var`, Lambda-/Schleifen-Variablen),
 *       Top-Level-Deklarationen, importierte Symbole, Builtin-Funktionen,
 *       Aufzählungs-Werte (eigene + eingebaute).
 *   - Typ-Position (`NamedType.name`):
 *       Builtin-Primitive (`Euro`, `Prozent`, …), Builtin-Aufzählungen,
 *       lokale `datensatz`/`aufzählung`, importierte Typnamen.
 *   - Member-Position (`x.` / `x?.`):
 *       Felder des Datensatz-Typs des Empfängers (via Typ-Inferenz über
 *       die Punkt-Pfad-Kette).
 *   - Import-Item-Position (`verwende { … } aus modul`):
 *       die vom Quell-Modul exportierten Symbole (ohne Builtins).
 *
 * Keyword-Completion bleibt der Basisklasse überlassen (`super.completionFor`).
 *
 * Skelett-Grenzen: Member-Completion folgt nur reinen Bezeichner-Pfaden
 * (`a.b.c.`). Aufruf-Ergebnisse (`f().`) oder Index-Ausdrücke werden im
 * Text-Pfad bewusst NICHT inferiert — lieber keinen Vorschlag als einen
 * falschen.
 */

import {
    type AstNode,
    type LangiumDocument,
    type LangiumDocuments,
    type MaybePromise,
    AstUtils,
    GrammarAST,
} from 'langium';
import {
    DefaultCompletionProvider,
    type CompletionAcceptor,
    type CompletionContext,
    type CompletionValueItem,
} from 'langium/lsp';
import type { NextFeature } from 'langium/lsp';
import { CompletionItemKind, InsertTextFormat } from 'vscode-languageserver';
import {
    isAufzaehlungDecl,
    isBlockExpr,
    isDatensatzDecl,
    isFunktionDecl,
    isFuerExpr,
    isKonstDecl,
    isLambda,
    isLetStmt,
    type AufzaehlungDecl,
    type DatensatzDecl,
    type DeclPrefix,
    type FunktionDecl,
    type KonstDecl,
    type Program,
    type Type as TypeAnnotation,
    type TypeAtom,
} from './generated/ast.js';
import { analyzeImports, buildModuleHeader } from './findsl-scope.js';
import { findModuleInWorkspace } from './findsl-definition.js';
import {
    isInternalName,
    mayImportInternal,
    programFilePath,
    resolveImportPath,
} from './import-path.js';
import {
    BUILTIN_ENUM_DEFS,
    BUILTIN_FUNCTION_DEFS,
    BUILTIN_PRIMITIVE_TYPES,
    isBuiltinName,
} from './findsl-stdlib.js';
import { getMethodDefs } from './findsl-method-defs.js';
import {
    resolveTypeAnnotation,
    TNull,
    type Type,
    type TypeContext,
    type TypeEnv,
} from './findsl-types.js';
import type { FindslServices } from './findsl-module.js';

// ---------------------------------------------------------------------------
// Kontext-Klassifikation
// ---------------------------------------------------------------------------

type Bucket = 'member' | 'expression' | 'type' | 'import' | 'other';

/** Regeln, an deren `name`-Assignment wir Bezeichner vervollständigen. */
const NAME_RULES = new Set([
    'CallChain', 'FieldAccess', 'SafeFieldAccess', 'NamedType', 'ImportItem',
]);

// Sortier-Präfixe: lokale Symbole vor Importen vor Builtins.
const SORT_LOCAL   = '1';
const SORT_IMPORT  = '2';
const SORT_BUILTIN = '3';

// ---------------------------------------------------------------------------
// CompletionProvider
// ---------------------------------------------------------------------------

export class FindslCompletionProvider extends DefaultCompletionProvider {

    override readonly completionOptions = { triggerCharacters: ['.', '?'] };

    private readonly docs: LangiumDocuments;

    constructor(services: FindslServices) {
        super(services);
        this.docs = services.shared.workspace.LangiumDocuments;
    }

    protected override completionFor(
        context: CompletionContext, next: NextFeature, acceptor: CompletionAcceptor,
    ): MaybePromise<void> {
        const bucket = this.classify(context, next);
        switch (bucket) {
            case 'member':     this.completeMember(context, acceptor); break;
            case 'expression': this.completeExpression(context, acceptor); break;
            case 'type':       this.completeType(context, acceptor); break;
            case 'import':     this.completeImportItem(context, acceptor); break;
            case 'other':      break;
        }
        // Keywords kommen weiterhin von der Basisklasse.
        return super.completionFor(context, next, acceptor);
    }

    /**
     * Ordnet das aktuell zu vervollständigende Grammatik-Feature einem
     * Completion-Bucket zu. Diskriminiert primär über den umschliessenden
     * Parser-Regelnamen + die Assignment-Property (robuster als `next.type`,
     * das Langium nur an Typ-Grenzen setzt). Ein direkt vor dem Cursor
     * stehender `.`/`?.` zwingt — unabhängig vom Parse-Zustand — in den
     * Member-Bucket (greift auch bei kaputtem Teil-Parse `abz.`).
     */
    private classify(context: CompletionContext, next: NextFeature): Bucket {
        const feature = next.feature;
        const asg = GrammarAST.isAssignment(feature) ? feature : undefined;
        const property = asg?.feature ?? next.property;
        const rule = AstUtils.getContainerOfType(feature, GrammarAST.isParserRule);
        const ruleName = rule?.name ?? next.type;

        if (!ruleName || property !== 'name' || !NAME_RULES.has(ruleName)) {
            return 'other';
        }

        const afterDot = endsWithMemberDot(
            context.textDocument.getText().slice(0, context.tokenOffset),
        );

        if (ruleName === 'FieldAccess' || ruleName === 'SafeFieldAccess') {
            return 'member';
        }
        if (ruleName === 'ImportItem') return 'import';
        if (afterDot) return 'member';     // `abz.` — Punkt noch nicht als FieldAccess geparst
        if (ruleName === 'NamedType') return 'type';
        if (ruleName === 'CallChain') return 'expression';
        return 'other';
    }

    // -----------------------------------------------------------------------
    // Ausdrucks-Position
    // -----------------------------------------------------------------------

    private completeExpression(context: CompletionContext, acceptor: CompletionAcceptor): void {
        const program = programOf(context.document);
        if (!program) return;

        // 0. abbruch-Snippet (begründeter, nicht abfangbarer Abbruch).
        acceptor(context, {
            label: 'abbruch(…)',
            kind: CompletionItemKind.Snippet,
            detail: 'abbruch("…"): never — begründeter, nicht abfangbarer Abbruch',
            documentation: {
                kind: 'markdown',
                value: 'Terminiert den Lauf mit Pflicht-Begründung (SPEC § 4.19). '
                    + 'Bottom-Typ `never` — als Body oder `wähle`/`wenn`-Zweig nutzbar.',
            },
            insertText: 'abbruch("$1")',
            insertTextFormat: InsertTextFormat.Snippet,
            sortText: SORT_LOCAL + 'abbruch',
        });

        // 0b. ausgabe-Snippet (Konsolen-Ausgabe; Anweisung, nur als
        // Block-Zeile gültig — Seiteneffekt, SPEC § 5.4 / § 4.18).
        acceptor(context, {
            label: 'ausgabe(…)',
            kind: CompletionItemKind.Snippet,
            detail: 'ausgabe("…") — Konsolen-Ausgabe (Anweisung, kein Wert)',
            documentation: {
                kind: 'markdown',
                value: 'Gibt Text auf die Konsole aus (SPEC § 5.4). '
                    + 'Anweisung — nur als eigene Block-Zeile, nicht in '
                    + 'Ausdrucksposition. Echter Seiteneffekt (P2-Ausnahme).',
            },
            insertText: 'ausgabe("$1")',
            insertTextFormat: InsertTextFormat.Snippet,
            sortText: SORT_LOCAL + 'ausgabe',
        });

        // 1. Lokale Bindungen (innen → aussen).
        for (const b of collectLocalBindings(context.node)) {
            acceptor(context, {
                label: b.name,
                kind: CompletionItemKind.Variable,
                detail: b.detail,
                sortText: SORT_LOCAL + b.name,
            });
        }

        // 2. Top-Level-Deklarationen des aktuellen Moduls.
        for (const decl of program.decls) {
            const item = topDeclItem(decl);
            if (item) acceptor(context, { ...item, sortText: SORT_LOCAL + (item.label ?? '') });
            // Aufzählungs-Werte sind im Ausdruck direkt verwendbar.
            if (isAufzaehlungDecl(decl)) {
                for (const v of decl.values) {
                    acceptor(context, {
                        label: v,
                        kind: CompletionItemKind.EnumMember,
                        detail: `${v}: ${decl.name}`,
                        sortText: SORT_LOCAL + v,
                    });
                }
            }
        }

        // 3. Importierte Symbole.
        for (const b of analyzeImports(program).bindings) {
            if (isBuiltinName(b.sourceName)) continue;
            acceptor(context, {
                label: b.localName,
                kind: CompletionItemKind.Reference,
                detail: `aus ${b.rawSource}`,
                sortText: SORT_IMPORT + b.localName,
            });
        }

        // 4. Builtin-Funktionen.
        for (const f of BUILTIN_FUNCTION_DEFS) {
            acceptor(context, {
                label: f.name,
                kind: CompletionItemKind.Function,
                detail: f.signature,
                documentation: markup(f.doc, f.quelle),
                sortText: SORT_BUILTIN + f.name,
            });
        }

        // 5. Builtin-Aufzählungs-Werte (Grundtarif, I, II, Jahr, …).
        for (const e of BUILTIN_ENUM_DEFS) {
            for (const v of e.values) {
                acceptor(context, {
                    label: v,
                    kind: CompletionItemKind.EnumMember,
                    detail: `${v}: ${e.name}`,
                    documentation: markup(e.doc, e.quelle),
                    sortText: SORT_BUILTIN + v,
                });
            }
        }
    }

    // -----------------------------------------------------------------------
    // Typ-Position
    // -----------------------------------------------------------------------

    private completeType(context: CompletionContext, acceptor: CompletionAcceptor): void {
        const program = programOf(context.document);
        if (!program) return;

        for (const p of BUILTIN_PRIMITIVE_TYPES) {
            acceptor(context, {
                label: p,
                kind: CompletionItemKind.Struct,
                detail: 'eingebauter Typ',
                sortText: SORT_BUILTIN + p,
            });
        }
        for (const e of BUILTIN_ENUM_DEFS) {
            acceptor(context, {
                label: e.name,
                kind: CompletionItemKind.Enum,
                detail: `aufzählung ${e.name}`,
                documentation: markup(e.doc, e.quelle),
                sortText: SORT_BUILTIN + e.name,
            });
        }
        for (const decl of program.decls) {
            if (isDatensatzDecl(decl)) {
                acceptor(context, {
                    label: decl.name,
                    kind: CompletionItemKind.Class,
                    detail: `datensatz ${decl.name}`,
                    documentation: declDoc(decl.docPrefix),
                    sortText: SORT_LOCAL + decl.name,
                });
            } else if (isAufzaehlungDecl(decl)) {
                acceptor(context, {
                    label: decl.name,
                    kind: CompletionItemKind.Enum,
                    detail: `aufzählung ${decl.name}`,
                    documentation: declDoc(decl.docPrefix),
                    sortText: SORT_LOCAL + decl.name,
                });
            }
        }
        for (const b of analyzeImports(program).bindings) {
            if (isBuiltinName(b.sourceName)) continue;
            acceptor(context, {
                label: b.localName,
                kind: CompletionItemKind.Class,
                detail: `aus ${b.rawSource}`,
                sortText: SORT_IMPORT + b.localName,
            });
        }
    }

    // -----------------------------------------------------------------------
    // Member-Position
    // -----------------------------------------------------------------------

    private completeMember(context: CompletionContext, acceptor: CompletionAcceptor): void {
        const program = programOf(context.document);
        if (!program) return;

        const before = context.textDocument.getText().slice(0, context.tokenOffset);
        const segs = receiverPath(before);
        if (segs.length === 0) return;

        const recv = this.resolveReceiverType(segs, context.node, program);
        if (!recv) return;

        const rec = asRecord(recv);
        if (rec) {
            for (const f of rec.decl.fields) {
                acceptor(context, {
                    label: f.name,
                    kind: CompletionItemKind.Field,
                    detail: `${f.name}: ${typeToString(f.type)}`,
                    sortText: SORT_LOCAL + f.name,
                });
            }
            return;
        }

        // Anwendbare §-11-Methoden je Empfänger-Typ (Liste/Geld/Zahl/Text)
        // — Dispatch via zentralem Helper, der von Completion, Hover,
        // Signature-Help und Inlay-Hints geteilt wird (findsl-method-defs).
        for (const m of getMethodDefs(recv)) {
            acceptor(context, {
                label: m.name,
                kind: CompletionItemKind.Method,
                detail: `${m.name}: ${m.signature}`,
                documentation: m.doc,
                insertText: m.property ? m.name : `${m.name}(`,
                sortText: SORT_LOCAL + m.name,
            });
        }
    }

    /**
     * Inferiert den Typ des Empfänger-Pfads (`a.b.c`) — der Endtyp
     * (Record/Liste/…); Nullable wird beim Durchsteigen transparent
     * ausgepackt (Feld-Liste identisch, egal ob `Pt` oder `Pt?`).
     */
    private resolveReceiverType(
        segs: ReadonlyArray<string>, anchor: AstNode | undefined, program: Program,
    ): Type | undefined {
        const header = buildModuleHeader(program);
        const env = this.buildTypeEnv(anchor, header.context, program);

        let current: Type | undefined =
            env.lookup(segs[0]) ?? this.crossModuleType(program, segs[0]);
        if (!current) return undefined;

        for (let i = 1; i < segs.length; i++) {
            const rec = asRecord(current);
            if (!rec) return undefined;
            const field = rec.decl.fields.find((f) => f.name === segs[i]);
            if (!field) return undefined;
            const recProgram = (rec.decl as { $container?: Program }).$container;
            const recCtx = recProgram ? buildModuleHeader(recProgram).context : header.context;
            current = resolveTypeAnnotation(field.type, recCtx);
        }

        return current;
    }

    /**
     * Baut die Typ-Umgebung am Cursor: Modul-Globals als Basis, darüber
     * Parameter / `var` / Lambda-Parameter entlang der `$container`-Kette
     * (aussen zuerst, innen überschreibt — Shadowing via Map-set).
     */
    private buildTypeEnv(
        anchor: AstNode | undefined, ctx: TypeContext, program: Program,
    ): TypeEnv {
        const env = ctx.globals.child();
        if (!anchor) return env;

        const stack: AstNode[] = [];
        let n: AstNode | undefined = anchor;
        while (n) { stack.push(n); n = n.$container; }

        const resolve = (t: TypeAnnotation): Type => {
            const local = resolveTypeAnnotation(t, ctx);
            if (local.kind !== 'unknown') return local;
            if (!t?.atom || t.atom.$type !== 'NamedType') return local;
            const sym = this.crossModuleType(program, t.atom.name);
            if (sym?.kind === 'function' && sym.result.kind === 'record') {
                return t.optional ? TNull(sym.result) : sym.result;
            }
            if (sym?.kind === 'enum') return t.optional ? TNull(sym) : sym;
            return local;
        };

        for (const node of stack.reverse()) {
            if (isFunktionDecl(node)) {
                for (const p of node.params) env.define(p.name, resolve(p.type));
            } else if (isBlockExpr(node) || isLambda(node)) {
                for (const s of node.stmts) {
                    if (isLetStmt(s)) env.define(s.name, resolve(s.type));
                }
                if (isLambda(node)) {
                    for (const p of node.params) if (p.type) env.define(p.name, resolve(p.type));
                }
            }
        }
        return env;
    }

    /** Typ eines via `verwende` importierten Symbols (für Empfänger-Wurzeln). */
    private crossModuleType(program: Program, localName: string): Type | undefined {
        const binding = analyzeImports(program).bindings.find((b) => b.localName === localName);
        if (!binding) return undefined;
        const root = findModuleInWorkspace(this.docs, binding.resolvedPath);
        if (!root) return undefined;
        return buildModuleHeader(root).context.globals.lookup(binding.sourceName);
    }

    // -----------------------------------------------------------------------
    // Import-Item-Position
    // -----------------------------------------------------------------------

    private completeImportItem(context: CompletionContext, acceptor: CompletionAcceptor): void {
        const src = this.importSource(context);
        if (!src) return;

        const root = findModuleInWorkspace(this.docs, src.resolvedPath);
        if (!root) return;
        // `_`-Interne sind nicht importierbar (SPEC § 4.16) → nicht
        // vorschlagen; Ausnahme: zugehörige `<basis>.test.findsl`.
        const importingAbs = (() => {
            const p = programOf(context.document);
            return p ? programFilePath(p) : undefined;
        })();
        const internOk = mayImportInternal(importingAbs, src.resolvedPath);
        const header = buildModuleHeader(root);
        for (const name of header.exports) {
            if (isBuiltinName(name)) continue;
            if (isInternalName(name) && !internOk) continue;
            const t = header.context.globals.lookup(name);
            acceptor(context, {
                label: name,
                kind: importKind(t),
                detail: `aus ${src.rawSource}`,
                sortText: SORT_IMPORT + name,
            });
        }
    }

    /**
     * Liest den `aus`-Pfad aus dem `verwende {…} aus "…"`-Knoten am Cursor
     * und löst ihn gegen das Verzeichnis der aktuellen Datei auf.
     */
    private importSource(
        context: CompletionContext,
    ): { rawSource: string; resolvedPath: string | undefined } | undefined {
        const imp = AstUtils.getContainerOfType(
            context.node, (n): n is AstNode & { source?: string } =>
                n.$type === 'ImportDecl',
        );
        const raw = (imp as { source?: string } | undefined)?.source;
        if (!raw || raw.length === 0) return undefined;
        const program = programOf(context.document);
        const fp = program ? programFilePath(program) : undefined;
        return {
            rawSource: raw,
            resolvedPath: fp ? resolveImportPath(fp, raw) : undefined,
        };
    }
}

// ---------------------------------------------------------------------------
// Lokale Bindungen (Namensliste für Ausdrucks-Completion)
// ---------------------------------------------------------------------------

interface LocalBinding { readonly name: string; readonly detail: string; }

function collectLocalBindings(anchor: AstNode | undefined): LocalBinding[] {
    const out: LocalBinding[] = [];
    const seen = new Set<string>();
    const add = (name: string, detail: string): void => {
        if (name && !seen.has(name)) { seen.add(name); out.push({ name, detail }); }
    };

    let n: AstNode | undefined = anchor;
    while (n) {
        if (isFunktionDecl(n)) {
            for (const p of n.params) add(p.name, `Parameter: ${typeToString(p.type)}`);
        } else if (isBlockExpr(n) || isLambda(n)) {
            for (const s of n.stmts) {
                if (isLetStmt(s)) add(s.name, `var: ${typeToString(s.type)}`);
            }
            if (isLambda(n)) {
                for (const p of n.params) {
                    add(p.name, p.type ? `Lambda-Parameter: ${typeToString(p.type)}` : 'Lambda-Parameter');
                }
            }
        } else if (isFuerExpr(n)) {
            if (n.iter) add(n.iter, 'Schleifen-Variable');
        }
        n = n.$container;
    }
    return out;
}

function topDeclItem(
    decl: KonstDecl | FunktionDecl | DatensatzDecl | AufzaehlungDecl | AstNode,
): CompletionValueItem | undefined {
    if (isKonstDecl(decl)) {
        return {
            label: decl.name,
            kind: CompletionItemKind.Constant,
            detail: `konst ${decl.name}: ${typeToString(decl.type)}`,
            documentation: declDoc(decl.docPrefix),
        };
    }
    if (isFunktionDecl(decl)) {
        const params = decl.params
            .map((p) => `${p.name}: ${typeToString(p.type)}`)
            .join(', ');
        return {
            label: decl.name,
            kind: CompletionItemKind.Function,
            detail: `fn ${decl.name}(${params}): ${typeToString(decl.returnType)}`,
            documentation: declDoc(decl.docPrefix),
        };
    }
    if (isDatensatzDecl(decl)) {
        return {
            label: decl.name,
            kind: CompletionItemKind.Constructor,
            detail: `datensatz ${decl.name}(…${decl.fields.length} Felder…)`,
            documentation: declDoc(decl.docPrefix),
        };
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Empfänger-Pfad aus Text rekonstruieren
// ---------------------------------------------------------------------------

/** Prüft, ob `before` (rechts getrimmt) mit `.` oder `?.` endet. */
function endsWithMemberDot(before: string): boolean {
    return /\.\s*$/.test(before);
}

/**
 * Zerlegt den Empfänger eines gerade getippten Member-Zugriffs aus dem
 * Text VOR dem Cursor in seine Bezeichner-Segmente. `fall.tarifart.` →
 * `['fall', 'tarifart']`. Bricht ab, sobald ein Nicht-Pfad-Zeichen
 * (Klammer, Operator, Whitespace ohne folgenden Punkt) erreicht ist —
 * Aufruf-/Index-Empfänger werden bewusst nicht inferiert.
 */
function receiverPath(before: string): string[] {
    const trimmed = before.replace(/\s+$/, '');
    if (!trimmed.endsWith('.')) return [];
    let body = trimmed.slice(0, -1).replace(/\s+$/, '');
    if (body.endsWith('?')) body = body.slice(0, -1);   // `?.`

    const matched = body.match(
        /(?:[\p{L}_][\p{L}\p{N}_]*\s*\??\.\s*)*[\p{L}_][\p{L}\p{N}_]*$/u,
    );
    if (!matched) return [];
    return matched[0]
        .split(/\??\./)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Typ-Helfer
// ---------------------------------------------------------------------------

function asRecord(t: Type | undefined): Extract<Type, { kind: 'record' }> | undefined {
    if (!t) return undefined;
    const u = t.kind === 'nullable' ? t.inner : t;
    return u.kind === 'record' ? u : undefined;
}

function importKind(t: Type | undefined): CompletionItemKind {
    if (!t) return CompletionItemKind.Reference;
    if (t.kind === 'enum') return CompletionItemKind.Enum;
    if (t.kind === 'function') {
        return t.result.kind === 'record'
            ? CompletionItemKind.Class
            : CompletionItemKind.Function;
    }
    return CompletionItemKind.Constant;
}

function programOf(document: LangiumDocument): Program | undefined {
    return document.parseResult?.value as Program | undefined;
}

// ---------------------------------------------------------------------------
// Doku-/Formatierungs-Helfer
// ---------------------------------------------------------------------------

function markup(doc: string, quelle?: string): { kind: 'markdown'; value: string } {
    const q = quelle ? `\n\n*Quelle:* ${quelle}` : '';
    return { kind: 'markdown', value: doc + q };
}

function declDoc(prefix?: DeclPrefix): { kind: 'markdown'; value: string } | undefined {
    if (!prefix?.doc) return undefined;
    let s = prefix.doc;
    if (s.startsWith('--')) s = s.slice(2);
    if (s.endsWith('--')) s = s.slice(0, -2);
    s = s.replace(/^\s*\n/, '').replace(/\n\s*$/, '').trim();
    return s ? { kind: 'markdown', value: s } : undefined;
}

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
