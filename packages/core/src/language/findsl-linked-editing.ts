// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Linked-Editing-Range-Provider für FinDSL (LSP
 * `textDocument/linkedEditingRange`, Issue #21).
 *
 * Steht der Cursor auf einem User-Bezeichner, werden alle Vorkommen
 * desselben Symbols **im aktuellen Dokument** als gekoppelte Range-Gruppe
 * geliefert — der Editor bearbeitet sie beim Tippen gleichzeitig (lokales
 * Sofort-Umbenennen ohne expliziten Rename-Aufruf). Mechanisch der kleine
 * Bruder von {@link import('./findsl-highlight.js').FindslDocumentHighlightProvider}.
 *
 * KONSERVATIV (im Zweifel nichts liefern, kein fehlerhaftes Mitbearbeiten):
 *   - Builtins/Keywords/unbekannte Tokens → `resolveTargetForIdToken` liefert
 *     kein Target → keine Ranges.
 *   - Liegt die Decl in einem ANDEREN Dokument (importiertes, cross-modul
 *     genutztes Symbol), bleibt der vollständige Rename-Provider zuständig →
 *     keine Ranges. Linked Editing ist per Protokoll dokumentlokal; ein
 *     importiertes Symbol würde sonst still nur hier mitlaufen.
 *
 * Hinweis zur Anbindung: Diese Langium-Version kennt KEINEN
 * `LinkedEditingRangeProvider`-Service und `startLanguageServer` registriert
 * dafür auch keinen Connection-Handler. Beides erledigen wir selbst — das
 * DI-Binding (`FindslModule`) macht den Provider auflösbar,
 * {@link registerLinkedEditingRangeHandler} verdrahtet den LSP-Request, und
 * der `FindslLanguageServer` kündigt die Capability an.
 */

import {
    type AstNode,
    type LangiumDocument,
    type LangiumDocuments,
    type MaybePromise,
    AstUtils,
    CstUtils,
    URI,
    type GrammarConfig,
} from 'langium';
import type { LangiumSharedServices } from 'langium/lsp';
import type { Connection } from 'vscode-languageserver';
import type {
    LinkedEditingRangeParams,
    LinkedEditingRanges,
    Range,
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
 * `wordPattern` für die Linked-Editing-Sitzung: ein FinDSL-Identifier inkl.
 * deutscher Umlaute. Ohne dieses Muster bräche der Editor die Kopplung beim
 * ersten Umlaut ab. Spiegelt `IDENTIFIER_REGEX` aus `findsl-rename.ts`.
 */
const WORD_PATTERN = '[A-Za-zäöüÄÖÜß_][A-Za-z0-9äöüÄÖÜß_]*';

export class FindslLinkedEditingRangeProvider {

    protected readonly documents: LangiumDocuments;
    protected readonly grammarConfig: GrammarConfig;

    constructor(services: FindslServices) {
        this.documents = services.shared.workspace.LangiumDocuments;
        this.grammarConfig = services.parser.GrammarConfig;
    }

    getLinkedEditingRanges(
        document: LangiumDocument, params: LinkedEditingRangeParams,
    ): MaybePromise<LinkedEditingRanges | undefined> {
        const rootCst = document.parseResult?.value?.$cstNode;
        if (!rootCst) return undefined;
        const offset = document.textDocument.offsetAt(params.position);

        const idNode = CstUtils.findDeclarationNodeAtOffset(
            rootCst, offset, this.grammarConfig.nameRegexp,
        );
        if (!idNode) return undefined;

        const program = document.parseResult.value as Program;
        const target = resolveTargetForIdToken(idNode, program, this.documents);
        if (!target) return undefined; // Builtin/Keyword/unbekannt → nichts.

        // Konservativ: importierte (cross-modul) Symbole bleiben dem Rename
        // überlassen — sonst liefe nur das aktuelle Dokument mit.
        const declDoc = AstUtils.getDocument(target);
        if (declDoc.uri.toString() !== document.uri.toString()) return undefined;

        const ranges: Range[] = [];

        // Decl-Name selbst (liegt in DIESEM Dokument, s. o.).
        const declRange = nameRangeOf(target);
        if (declRange) ranges.push(declRange);

        // Verwendungsstellen im aktuellen Dokument.
        for (const node of AstUtils.streamAllContents(program)) {
            let name: string | undefined;
            if      (isCallChain(node)       && node.name) name = node.name;
            else if (isFieldAccess(node)     && node.name) name = node.name;
            else if (isSafeFieldAccess(node) && node.name) name = node.name;
            else if (isNamedType(node)       && node.name) name = node.name;
            else continue;

            const idLeaf = findIdLeaf(node, name);
            if (!idLeaf) continue;
            if (resolveTargetForIdToken(idLeaf, program, this.documents) === target) {
                ranges.push(idLeaf.range);
            }
        }

        if (ranges.length === 0) return undefined;
        return { ranges, wordPattern: WORD_PATTERN };
    }
}

/**
 * Registriert den `textDocument/linkedEditingRange`-Handler auf der
 * Connection. Wird an JEDEM LSP-Entry-Point aufgerufen (Node-Server +
 * Web-Worker), da Langium den Handler nicht selbst verdrahtet — eine Quelle,
 * damit beide Surfaces nicht auseinanderlaufen.
 */
export function registerLinkedEditingRangeHandler(
    connection: Connection, shared: LangiumSharedServices,
): void {
    connection.languages.onLinkedEditingRange(async (params) => {
        const uri = URI.parse(params.textDocument.uri);
        const document = shared.workspace.LangiumDocuments.getDocument(uri);
        if (!document) return undefined;
        const services = shared.ServiceRegistry.getServices(uri) as FindslServices;
        const provider = services.lsp?.LinkedEditingRangeProvider;
        if (!provider) return undefined;
        return (await provider.getLinkedEditingRanges(document, params)) ?? undefined;
    });
}

// ---------------------------------------------------------------------------
// Helfer (parallel zu highlight/rename/references — dünn, Extraktion bislang
// ohne klaren Mehrwert)
// ---------------------------------------------------------------------------

function findIdLeaf(node: AstNode, name: string) {
    const cst = node.$cstNode;
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.text === name) return leaf;
    }
    return undefined;
}

function nameRangeOf(decl: AstNode): Range | undefined {
    const name = (decl as { name?: string }).name;
    if (!name) return undefined;
    const cst = decl.$cstNode;
    if (!cst) return undefined;
    for (const leaf of CstUtils.flattenCst(cst)) {
        if (leaf.text === name) return leaf.range;
    }
    return undefined;
}
