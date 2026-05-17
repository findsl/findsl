/**
 * Workspace-Symbol-Provider für FinDSL (LSP `workspace/symbol`, Cmd+T).
 *
 * Globale Symbolsuche über ALLE `.findsl`-Dateien des Workspace — im
 * Gegensatz zum DocumentSymbolProvider (Outline einer einzelnen Datei).
 * Macht große Mehrjahres-/Mehrmodul-Steuerprojekte navigierbar: „wo ist
 * `estGrundtarif`", „welche Module haben ein Feld `freibetrag`".
 *
 * Da FinDSL keine Langium-`cross-references`/Scope-Computation nutzt,
 * indexiert der Default-Provider nichts Brauchbares. Wir gehen daher
 * direkt über die geparsten Programme aller Workspace-Dokumente und
 * emittieren Symbole für die navigationsrelevanten Deklarationen:
 *
 *   konst       → Constant
 *   fn          → Function
 *   datensatz   → Struct      (+ Felder als Field, containerName=Datensatz)
 *   aufzählung  → Enum        (+ Werte als EnumMember)
 *   prüfe       → Namespace
 *
 * Parameter, `var` und Testfall-Labels bleiben bewusst aussen vor —
 * lokal bzw. zu rauschig für eine projektweite Suche.
 */

import { type AstNode, type LangiumDocuments, CstUtils } from 'langium';
import type { WorkspaceSymbolProvider } from 'langium/lsp';
import type { LangiumSharedServices } from 'langium/lsp';
import {
    SymbolKind,
    type Range,
    type WorkspaceSymbol,
    type WorkspaceSymbolParams,
} from 'vscode-languageserver';
import {
    isAufzaehlungDecl,
    isDatensatzDecl,
    isFunktionDecl,
    isKonstDecl,
    isPruefeDecl,
    type Program,
} from './generated/ast.js';
import { findNameRange } from './findsl-definition.js';
import { commonBase, displayId } from './import-path.js';

const ZERO_RANGE: Range = {
    start: { line: 0, character: 0 },
    end:   { line: 0, character: 0 },
};

export class FindslWorkspaceSymbolProvider implements WorkspaceSymbolProvider {

    private readonly documents: LangiumDocuments;

    constructor(services: LangiumSharedServices) {
        this.documents = services.workspace.LangiumDocuments;
    }

    getSymbols(params: WorkspaceSymbolParams): WorkspaceSymbol[] {
        // Case-insensitive Substring statt Langiums Default-FuzzyMatcher:
        // der matcht nur an Wortgrenzen (camelCase/snake) und verfehlt damit
        // deutsche Kleinbuchstaben-Komposita (`freibetrag` in
        // `Grundfreibetrag`) — genau der Cmd+T-Normalfall in FinDSL.
        const query = (params.query ?? '').toLowerCase();
        const out: WorkspaceSymbol[] = [];

        const add = (
            name: string, kind: SymbolKind, uri: string,
            range: Range | undefined, container: string,
        ): void => {
            if (!name) return;
            if (query && !name.toLowerCase().includes(query)) return;
            out.push({
                name,
                kind,
                location: { uri, range: range ?? ZERO_RANGE },
                containerName: container || undefined,
            });
        };

        const allDocs = [...this.documents.all];
        const base = commonBase(
            allDocs
                .filter((d) => d.parseResult?.value)
                .map((d) => d.uri.fsPath),
        );
        for (const doc of allDocs) {
            const program = doc.parseResult?.value as Program | undefined;
            if (!program) continue;
            const uri = doc.uri.toString();
            const modul = displayId(doc.uri.fsPath, base);

            for (const decl of program.decls) {
                if (isKonstDecl(decl)) {
                    add(decl.name, SymbolKind.Constant, uri, declNameRange(decl), modul);
                } else if (isFunktionDecl(decl)) {
                    add(decl.name, SymbolKind.Function, uri, declNameRange(decl), modul);
                } else if (isDatensatzDecl(decl)) {
                    add(decl.name, SymbolKind.Struct, uri, declNameRange(decl), modul);
                    const container = qualify(modul, decl.name);
                    for (const f of decl.fields) {
                        add(f.name, SymbolKind.Field, uri, declNameRange(f), container);
                    }
                } else if (isAufzaehlungDecl(decl)) {
                    add(decl.name, SymbolKind.Enum, uri, declNameRange(decl), modul);
                    const container = qualify(modul, decl.name);
                    const cst = decl.$cstNode;
                    for (const v of decl.values) {
                        add(v, SymbolKind.EnumMember, uri, leafRange(cst, v), container);
                    }
                } else if (isPruefeDecl(decl)) {
                    add(decl.name, SymbolKind.Namespace, uri, stringLeafRange(decl.$cstNode), modul);
                }
            }
        }
        return out;
    }
}

function qualify(modul: string, name: string): string {
    return modul ? `${modul}.${name}` : name;
}

/** Range des `name`-Identifier-Tokens einer Decl, sonst der ganze Knoten. */
function declNameRange(node: AstNode): Range | undefined {
    return findNameRange(node) ?? node.$cstNode?.range;
}

/** Range des Tokens mit gegebenem Text innerhalb eines CST-Knotens. */
function leafRange(cst: AstNode['$cstNode'] | undefined, text: string): Range | undefined {
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.text === text) return leaf.range;
    }
    return cst.range;
}

/** Range des ersten STRING-Tokens (prüfe-Label). */
function stringLeafRange(cst: AstNode['$cstNode'] | undefined): Range | undefined {
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.tokenType?.name === 'STRING') return leaf.range;
    }
    return cst.range;
}
