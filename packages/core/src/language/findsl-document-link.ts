/**
 * Document-Link-Provider für FinDSL (LSP `textDocument/documentLink`).
 *
 * Macht zwei Dinge im Editor anklickbar (Ctrl/Cmd+Click):
 *
 *  1. `@Quelle("§ 32a EStG")` → Tiefenlink auf gesetze-im-internet.de
 *     (stabiles, offizielles URL-Schema `/<abk>/__<para>.html`). Direkt
 *     aus dem Code zur Norm — zentral für die Audit-Vorlage (P4).
 *  2. `verwende {…} aus modul.pfad` → die Ziel-`.findsl`-Datei im Workspace.
 *
 * Beides degradiert sauber: unbekanntes Gesetz / Modul nicht im Workspace
 * → kein Link (kein falscher Link, keine Fehlmeldung).
 */

import {
    type LangiumDocument,
    type LangiumDocuments,
    type MaybePromise,
    AstUtils,
    GrammarUtils,
} from 'langium';
import type { DocumentLinkProvider } from 'langium/lsp';
import type { DocumentLink, DocumentLinkParams } from 'vscode-languageserver';
import {
    isAnnotation,
    isStringLiteral,
    type Program,
} from './generated/ast.js';
import { findModuleInWorkspace } from './findsl-definition.js';
import { programFilePath, resolveImportPath } from './import-path.js';
import { parseQuelleRefs } from '../docgen/quelle.js';
import type { FindslServices } from './findsl-module.js';

export class FindslDocumentLinkProvider implements DocumentLinkProvider {

    private readonly documents: LangiumDocuments;

    constructor(services: FindslServices) {
        this.documents = services.shared.workspace.LangiumDocuments;
    }

    getDocumentLinks(
        document: LangiumDocument, _params: DocumentLinkParams,
    ): MaybePromise<DocumentLink[]> {
        const program = document.parseResult?.value as Program | undefined;
        if (!program) return [];
        const links: DocumentLink[] = [];

        // 1. @Quelle("§ … <Gesetz>")
        for (const node of AstUtils.streamAllContents(program)) {
            if (!isAnnotation(node) || node.name !== 'Quelle') continue;
            const arg = node.args[0];
            if (!arg || !isStringLiteral(arg) || !arg.$cstNode) continue;
            const raw = arg.$cstNode.text;
            const base = arg.$cstNode.offset;
            for (const ref of parseQuelleRefs(raw)) {
                links.push({
                    range: {
                        start: document.textDocument.positionAt(base + ref.start),
                        end:   document.textDocument.positionAt(base + ref.end),
                    },
                    target: ref.url,
                    tooltip: `${ref.abk} § ${ref.num} auf gesetze-im-internet.de öffnen`,
                });
            }
        }

        // 2. verwende {…} aus "./pfad"  →  Ziel-.findsl-Datei
        const importingFile = programFilePath(program);
        for (const imp of program.imports ?? []) {
            const raw = imp?.source;
            if (!raw || !importingFile || !imp.$cstNode) continue;
            const resolved = resolveImportPath(importingFile, raw);
            const target = findModuleInWorkspace(this.documents, resolved);
            if (!target) continue;
            const targetUri = AstUtils.getDocument(target).uri.toString();

            // Linkbereich = das Pfad-String-Literal (inkl. Anführungszeichen).
            const srcCst = GrammarUtils.findNodeForProperty(imp.$cstNode, 'source');
            if (!srcCst) continue;
            links.push({
                range: {
                    start: document.textDocument.positionAt(srcCst.offset),
                    end:   document.textDocument.positionAt(srcCst.end),
                },
                target: targetUri,
                tooltip: `Datei "${raw}" öffnen`,
            });
        }

        // 3. §-Referenzen in der Prosa der `--…--`-Doc-Kommentare
        //    (Datei-Doc + je Deklaration) → gesetze-im-internet.de.
        //    Gleiche Quelle/Logik wie der `@Quelle`-Aside; Annotationen
        //    sind ein eigenes AST-Feld → keine Doppel-Links.
        const prefixes = [
            program.fileDoc,
            ...(program.decls ?? []).map((d) => d.docPrefix),
        ];
        for (const prefix of prefixes) {
            if (!prefix?.doc || !prefix.$cstNode) continue;
            const docCst = GrammarUtils.findNodeForProperty(prefix.$cstNode, 'doc');
            if (!docCst) continue;
            for (const ref of parseQuelleRefs(docCst.text)) {
                links.push({
                    range: {
                        start: document.textDocument.positionAt(docCst.offset + ref.start),
                        end:   document.textDocument.positionAt(docCst.offset + ref.end),
                    },
                    target: ref.url,
                    tooltip: `${ref.abk} § ${ref.num} auf gesetze-im-internet.de öffnen`,
                });
            }
        }

        return links;
    }
}
