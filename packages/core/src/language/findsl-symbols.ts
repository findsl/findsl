/**
 * Document-Symbol-Provider für FinDSL (LSP `textDocument/documentSymbol`).
 *
 * Speist Outline (Cmd+Shift+O), Breadcrumbs und „Sticky Scroll". Langiums
 * Default produziert nur eine flache, kind-lose Liste — wir liefern
 * stattdessen eine strukturierte Hierarchie mit korrekten Symbol-Kinds:
 *
 *   konst       → Constant     (detail: `: Euro`)
 *   fn          → Function     (detail: `(zve: Euro): Euro`)
 *   datensatz   → Struct       + Felder als Field-Kinder
 *   aufzählung  → Enum         + Werte als EnumMember-Kinder
 *   prüfe       → Namespace     + Testfälle als Method-Kinder
 *
 * Das macht große Steuermodule navigierbar: ein `Steuerfall`-Datensatz
 * zeigt seine sechs Felder aufklappbar, ein `prüfe`-Block seine Testfälle.
 */

import {
    type AstNode,
    type CstNode,
    type LangiumDocument,
    type MaybePromise,
    CstUtils,
} from 'langium';
import type { DocumentSymbolProvider } from 'langium/lsp';
import {
    SymbolKind,
    type DocumentSymbol,
    type DocumentSymbolParams,
    type Range,
} from 'vscode-languageserver';
import {
    isAufzaehlungDecl,
    isDatensatzDecl,
    isFunktionDecl,
    isKonstDecl,
    isPruefeDecl,
    type AufzaehlungDecl,
    type DatensatzDecl,
    type FunktionDecl,
    type KonstDecl,
    type Program,
    type PruefeDecl,
    type Type as TypeAnnotation,
    type TypeAtom,
} from './generated/ast.js';
import { isInternalName } from './import-path.js';

/**
 * Outline-Markierung modul-interner Decls (`_`-Präfix, SPEC § 8.4).
 * VS Code zeigt `detail` gedämpft DIREKT hinter dem Namen — deshalb als
 * **Präfix** (am Ende einer langen Signatur wäre es abgeschnitten/
 * unsichtbar). Glyph + Wort = sofort erkennbar in Outline, Breadcrumbs
 * und Sticky-Scroll, zuverlässig themenunabhängig (kein
 * `SymbolTag.Deprecated`: Durchstreichung wäre im Audit-Kontext
 * irreführend).
 */
function internPrefix(name: string | undefined): string {
    return isInternalName(name ?? '') ? '🔒 intern · ' : '';
}

export class FindslDocumentSymbolProvider implements DocumentSymbolProvider {

    getSymbols(
        document: LangiumDocument, _params: DocumentSymbolParams,
    ): MaybePromise<DocumentSymbol[]> {
        const program = document.parseResult?.value as Program | undefined;
        if (!program) return [];

        const symbols: DocumentSymbol[] = [];
        for (const decl of program.decls) {
            const sym = this.declSymbol(decl);
            if (sym) symbols.push(sym);
        }
        // Sicherheitsnetz: LSP verbietet leere Symbol-Namen
        // ("name must not be falsy") — beim Teil-Parse (`fn `) hat eine
        // Decl noch keinen Namen. Rekursiv aussortieren.
        return sanitize(symbols);
    }

    private declSymbol(decl: AstNode): DocumentSymbol | undefined {
        if (isKonstDecl(decl))       return this.konstSymbol(decl);
        if (isFunktionDecl(decl))    return this.funktionSymbol(decl);
        if (isDatensatzDecl(decl))   return this.datensatzSymbol(decl);
        if (isAufzaehlungDecl(decl)) return this.aufzaehlungSymbol(decl);
        if (isPruefeDecl(decl))      return this.pruefeSymbol(decl);
        return undefined;
    }

    private konstSymbol(decl: KonstDecl): DocumentSymbol | undefined {
        const full = decl.$cstNode?.range;
        if (!full || !decl.name) return undefined;
        return {
            name:           decl.name,
            detail:         `${internPrefix(decl.name)}: ${typeToString(decl.type)}`,
            kind:           SymbolKind.Constant,
            range:          full,
            selectionRange: nameRange(decl, decl.name) ?? full,
        };
    }

    private funktionSymbol(decl: FunktionDecl): DocumentSymbol | undefined {
        const full = decl.$cstNode?.range;
        if (!full || !decl.name) return undefined;
        const params = decl.params
            .map((p) => `${p.name}: ${typeToString(p.type)}`)
            .join(', ');
        return {
            name:           decl.name,
            detail:         `${internPrefix(decl.name)}(${params}): ${typeToString(decl.returnType)}`,
            kind:           SymbolKind.Function,
            range:          full,
            selectionRange: nameRange(decl, decl.name) ?? full,
        };
    }

    private datensatzSymbol(decl: DatensatzDecl): DocumentSymbol | undefined {
        const full = decl.$cstNode?.range;
        if (!full || !decl.name) return undefined;
        const children: DocumentSymbol[] = [];
        for (const f of decl.fields) {
            const fr = f.$cstNode?.range;
            if (!fr || !f.name) continue;
            children.push({
                name:           f.name,
                detail:         `: ${typeToString(f.type)}${f.default ? ' = …' : ''}`,
                kind:           SymbolKind.Field,
                range:          fr,
                selectionRange: nameRange(f, f.name) ?? fr,
            });
        }
        return {
            name:           decl.name,
            detail:         `${internPrefix(decl.name)}(${decl.fields.length} Felder)`,
            kind:           SymbolKind.Struct,
            range:          full,
            selectionRange: nameRange(decl, decl.name) ?? full,
            children,
        };
    }

    private aufzaehlungSymbol(decl: AufzaehlungDecl): DocumentSymbol | undefined {
        const full = decl.$cstNode?.range;
        if (!full || !decl.name) return undefined;
        const children: DocumentSymbol[] = [];
        for (const value of decl.values) {
            if (!value) continue;
            const vr = leafRange(decl.$cstNode, value);
            children.push({
                name:           value,
                kind:           SymbolKind.EnumMember,
                range:          vr ?? full,
                selectionRange: vr ?? full,
            });
        }
        return {
            name:           decl.name,
            detail:         `${internPrefix(decl.name)}{ ${decl.values.join(', ')} }`,
            kind:           SymbolKind.Enum,
            range:          full,
            selectionRange: nameRange(decl, decl.name) ?? full,
            children,
        };
    }

    private pruefeSymbol(decl: PruefeDecl): DocumentSymbol | undefined {
        const full = decl.$cstNode?.range;
        if (!full || !decl.name) return undefined;
        const children: DocumentSymbol[] = [];
        for (const tf of decl.testfaelle) {
            const tr = tf.$cstNode?.range;
            if (!tr || !tf.label) continue;
            children.push({
                name:           tf.label,
                kind:           SymbolKind.Method,
                range:          tr,
                selectionRange: stringLeafRange(tf.$cstNode) ?? tr,
            });
        }
        return {
            name:           decl.name,
            detail:         `(${decl.testfaelle.length} Testfälle)`,
            kind:           SymbolKind.Namespace,
            range:          full,
            selectionRange: stringLeafRange(decl.$cstNode) ?? full,
            children,
        };
    }
}

// ---------------------------------------------------------------------------
// Sicherheitsnetz: kein DocumentSymbol mit leerem Namen (LSP-Pflicht)
// ---------------------------------------------------------------------------

function sanitize(symbols: DocumentSymbol[]): DocumentSymbol[] {
    const out: DocumentSymbol[] = [];
    for (const s of symbols) {
        if (!s.name) continue;
        if (s.children?.length) s.children = sanitize(s.children);
        out.push(s);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Range-Helfer
// ---------------------------------------------------------------------------

/** Range des Identifier-Tokens mit gegebenem Text innerhalb eines Knotens. */
function nameRange(node: AstNode, name: string): Range | undefined {
    return leafRange(node.$cstNode, name);
}

function leafRange(cst: CstNode | undefined, text: string): Range | undefined {
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.text === text) return leaf.range;
    }
    return undefined;
}

/** Range des ersten STRING-Literal-Tokens (für prüfe-/Testfall-Label). */
function stringLeafRange(cst: CstNode | undefined): Range | undefined {
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.tokenType?.name === 'STRING') return leaf.range;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Type-Annotation pretty-print (lokal — parallel zu findsl-hover)
// ---------------------------------------------------------------------------

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
