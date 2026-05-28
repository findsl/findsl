/**
 * Semantic-Tokens-Provider für FinDSL (LSP `textDocument/semanticTokens`).
 *
 * Ergänzt das statische TextMate-Highlighting um eine bedeutungsbasierte
 * Schicht, die der Lexer nicht liefern kann:
 *
 *   - **Builtins** (`Euro`, `Tarifart`, `Grundtarif`, `abrundenEuro`, …)
 *     bekommen den Modifier `defaultLibrary` → der Editor stellt sie
 *     erkennbar anders dar als eigene Symbole (lang gewünschter Punkt).
 *   - **Deklarationen vs. Referenzen**: `konst`/`fn`/`datensatz`/
 *     `aufzählung`/Feld/Parameter/`var` als `declaration`; Verwendungen
 *     in ihrer korrekten Symbol-Kategorie (Funktion, Konstante=readonly,
 *     Datensatz=class, Parameter, Feld=property, Aufzählungs-Wert).
 *   - `@Quelle` als `decorator`, `abbruch` als `keyword`.
 *
 * Klassifikation bewusst leichtgewichtig (Name + Scope + Workspace-Lookup,
 * keine volle Typinferenz) — Semantic Tokens laufen bei jedem Tastendruck.
 */

import {
    type AstNode,
    type LangiumDocuments,
    AstUtils,
} from 'langium';
import {
    AbstractSemanticTokenProvider,
    AllSemanticTokenModifiers,
    type SemanticTokenAcceptor,
} from 'langium/lsp';
import { SemanticTokenTypes, SemanticTokenModifiers } from 'vscode-languageserver';
import { isInternalName } from './import-path.js';
import {
    isAbbruchExpr,
    isAusgabeStmt,
    isAufzaehlungDecl,
    isCallChain,
    isDatensatzDecl,
    isFieldAccess,
    isField,
    isFunktionDecl,
    isKonstDecl,
    isLetStmt,
    isLambdaParam,
    isNamedType,
    isParam,
    isSafeFieldAccess,
    type Program,
} from './generated/ast.js';
import { analyzeImports } from './findsl-scope.js';
import { findModuleInWorkspace, resolveLocalBinding } from './findsl-definition.js';
import {
    BUILTIN_ENUM_VALUE_TO_ENUM,
    BUILTIN_FUNCTION_DEFS,
    BUILTIN_PRIMITIVE_TYPES,
    BUILTIN_ENUM_DEFS,
} from './findsl-stdlib.js';
import type { FindslServices } from './findsl-module.js';

const BUILTIN_PRIMITIVES = new Set<string>(BUILTIN_PRIMITIVE_TYPES);
const BUILTIN_ENUM_NAMES = new Set<string>(BUILTIN_ENUM_DEFS.map((e) => e.name));
const BUILTIN_FUNCS = new Set<string>(BUILTIN_FUNCTION_DEFS.map((f) => f.name));

const LIB = SemanticTokenModifiers.defaultLibrary;
const DECL = SemanticTokenModifiers.declaration;
const RO = SemanticTokenModifiers.readonly;

/**
 * Custom-Modifier für modul-interne Symbole (`_`-Präfix, SPEC § 8.4):
 * Deklaration UND Referenzen interner Top-Level-Decls bekommen ihn,
 * sodass der Editor sie sichtbar abhebt (Default-Stil: kursiv, via
 * `contributes.configurationDefaults` in package.json — themen- und
 * benutzerüberschreibbar). Eigener Modifier statt Missbrauch von
 * `deprecated` (semantisch falsch, Durchstreichung wäre im Audit-
 * Kontext irreführend).
 */
const INTERN = 'internal';

/** Hängt den `internal`-Modifier an, wenn das Symbol modul-intern ist. */
function withIntern(
    mod: string | string[] | undefined, intern: boolean,
): string | string[] | undefined {
    if (!intern) return mod;
    if (mod === undefined) return INTERN;
    return Array.isArray(mod) ? [...mod, INTERN] : [mod, INTERN];
}

export class FindslSemanticTokenProvider extends AbstractSemanticTokenProvider {

    private readonly docs: LangiumDocuments;

    constructor(services: FindslServices) {
        super(services);
        this.docs = services.shared.workspace.LangiumDocuments;
    }

    /**
     * Erweitert die Modifier-Legende um `internal`. Langium baut sowohl
     * die Client-Legende (`Object.keys`) als auch das Encoding aus
     * dieser Map — der angehängte Schlüssel bekommt Index 10, Bit
     * `1 << 10`, konsistent mit der Standard-Map (10 Einträge, Bits
     * `1 << 0..9`).
     */
    override get tokenModifiers(): Record<string, number> {
        return { ...AllSemanticTokenModifiers, [INTERN]: 1 << 10 };
    }

    protected highlightElement(
        node: AstNode, acceptor: SemanticTokenAcceptor,
    ): void | 'prune' {
        // --- Deklarationen --------------------------------------------------
        if (isKonstDecl(node)) {
            const it = isInternalName(node.name ?? '');
            acceptor({ node, property: 'name', type: SemanticTokenTypes.variable, modifier: withIntern([DECL, RO], it) });
            return;
        }
        if (isFunktionDecl(node)) {
            const it = isInternalName(node.name ?? '');
            acceptor({ node, property: 'name', type: SemanticTokenTypes.function, modifier: withIntern(DECL, it) });
            return;
        }
        if (isDatensatzDecl(node)) {
            const it = isInternalName(node.name ?? '');
            acceptor({ node, property: 'name', type: SemanticTokenTypes.class, modifier: withIntern(DECL, it) });
            return;
        }
        if (isAufzaehlungDecl(node)) {
            const it = isInternalName(node.name ?? '');
            acceptor({ node, property: 'name', type: SemanticTokenTypes.enum, modifier: withIntern(DECL, it) });
            node.values.forEach((_, i) => acceptor({
                node, property: 'values', index: i,
                type: SemanticTokenTypes.enumMember, modifier: DECL,
            }));
            return;
        }
        if (isField(node)) {
            acceptor({ node, property: 'name', type: SemanticTokenTypes.property, modifier: DECL });
            return;
        }
        if (isParam(node) || isLambdaParam(node)) {
            acceptor({ node, property: 'name', type: SemanticTokenTypes.parameter, modifier: DECL });
            return;
        }
        if (isLetStmt(node)) {
            acceptor({ node, property: 'name', type: SemanticTokenTypes.variable, modifier: DECL });
            return;
        }

        // --- Annotationen / abbruch ----------------------------------------
        if (node.$type === 'Annotation') {
            acceptor({ node, property: 'name', type: SemanticTokenTypes.decorator });
            return;
        }
        if (isAusgabeStmt(node)) {
            // Eigener Keyword-Scope → Reviewer sehen den Seiteneffekt (P4/P7).
            acceptor({ node, keyword: 'ausgabe', type: SemanticTokenTypes.keyword });
            return;
        }
        if (isAbbruchExpr(node)) {
            acceptor({ node, keyword: 'abbruch', type: SemanticTokenTypes.keyword });
            return;
        }

        // --- Typ-Annotation -------------------------------------------------
        if (isNamedType(node)) {
            const t = this.classifyType(node.name, node);
            if (t) acceptor({ node, property: 'name', type: t.type, modifier: t.modifier });
            return;
        }

        // --- Feldzugriff `.name` -------------------------------------------
        if (isFieldAccess(node) || isSafeFieldAccess(node)) {
            acceptor({ node, property: 'name', type: SemanticTokenTypes.property });
            return;
        }

        // --- CallChain-Wurzel ----------------------------------------------
        if (isCallChain(node) && node.name) {
            const c = this.classifyName(node.name, node);
            if (c) acceptor({ node, property: 'name', type: c.type, modifier: c.modifier });
            return;
        }
    }

    /** Klassifiziert einen Typ-Namen (Builtin vs. User-Datensatz/Aufzählung). */
    private classifyType(
        name: string, ctx: AstNode,
    ): { type: string; modifier?: string | string[] } | undefined {
        if (BUILTIN_PRIMITIVES.has(name) || name === 'Liste' || name === 'Bereich') {
            return { type: SemanticTokenTypes.type, modifier: LIB };
        }
        if (BUILTIN_ENUM_NAMES.has(name)) {
            return { type: SemanticTokenTypes.enum, modifier: LIB };
        }
        const decl = this.lookupTopDecl(name, ctx);
        const it = decl ? isInternalName((decl as { name?: string }).name ?? '') : false;
        if (decl && isDatensatzDecl(decl)) return { type: SemanticTokenTypes.class, modifier: withIntern(undefined, it) };
        if (decl && isAufzaehlungDecl(decl)) return { type: SemanticTokenTypes.enum, modifier: withIntern(undefined, it) };
        return { type: SemanticTokenTypes.type };
    }

    /** Klassifiziert eine CallChain-Wurzel (Symbol-Referenz). */
    private classifyName(
        name: string, ctx: AstNode,
    ): { type: string; modifier?: string | string[] } | undefined {
        if (BUILTIN_FUNCS.has(name)) {
            return { type: SemanticTokenTypes.function, modifier: LIB };
        }
        if (BUILTIN_ENUM_VALUE_TO_ENUM.has(name)) {
            return { type: SemanticTokenTypes.enumMember, modifier: LIB };
        }
        const local = resolveLocalBinding(ctx, name);
        if (local) {
            return { type: isParam(local) ? SemanticTokenTypes.parameter : SemanticTokenTypes.variable };
        }
        const decl = this.lookupTopDecl(name, ctx);
        if (decl) {
            const it = isInternalName((decl as { name?: string }).name ?? '');
            if (isFunktionDecl(decl))    return { type: SemanticTokenTypes.function, modifier: withIntern(undefined, it) };
            if (isKonstDecl(decl))       return { type: SemanticTokenTypes.variable, modifier: withIntern(RO, it) };
            if (isDatensatzDecl(decl))   return { type: SemanticTokenTypes.class, modifier: withIntern(undefined, it) };
            if (isAufzaehlungDecl(decl)) return { type: SemanticTokenTypes.enum, modifier: withIntern(undefined, it) };
        }
        // User-Aufzählungs-Werte: kein eigener Decl-Knoten, sondern String
        // in `AufzaehlungDecl.values` (lokal oder via `verwende`). Spiegelt
        // die Cross-Modul-Auflösung aus PR #197 (Definition/Hover).
        const enumOwner = this.lookupEnumValueOwner(name, ctx);
        if (enumOwner) {
            const it = isInternalName((enumOwner as { name?: string }).name ?? '');
            return { type: SemanticTokenTypes.enumMember, modifier: withIntern(undefined, it) };
        }
        return undefined;
    }

    /**
     * Findet die Aufzählungs-Decl, deren `values` `name` enthält — lokal
     * im Modul oder über ein `verwende`-Binding. Für die semantische
     * Klassifikation als `enumMember` in Referenzen außerhalb der Decl
     * (Patterns, Wert-Bindings, Aufruf-Argumente).
     */
    private lookupEnumValueOwner(name: string, ctx: AstNode): AstNode | undefined {
        const program = AstUtils.getDocument(ctx).parseResult?.value as Program | undefined;
        if (!program) return undefined;
        for (const d of program.decls) {
            if (isAufzaehlungDecl(d) && d.values.includes(name)) return d;
        }
        const binding = analyzeImports(program).bindings.find((b) => b.localName === name);
        if (!binding) return undefined;
        const src = findModuleInWorkspace(this.docs, binding.resolvedPath);
        if (!src) return undefined;
        return src.decls.find(
            (d) => isAufzaehlungDecl(d) && d.values.includes(binding.sourceName),
        );
    }

    /**
     * Findet die Top-Level-Decl eines Namens — lokal im Modul, dann über
     * `verwende`-Importe im Workspace. Kind-Auflösung ohne Typinferenz.
     */
    private lookupTopDecl(name: string, ctx: AstNode): AstNode | undefined {
        const program = AstUtils.getDocument(ctx).parseResult?.value as Program | undefined;
        if (!program) return undefined;
        for (const d of program.decls) {
            if (d.name === name) return d;
        }
        const binding = analyzeImports(program).bindings.find((b) => b.localName === name);
        if (!binding) return undefined;
        const src = findModuleInWorkspace(this.docs, binding.resolvedPath);
        return src?.decls.find((d) => d.name === binding.sourceName);
    }
}
