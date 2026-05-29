/**
 * Folding-Range-Provider für FinDSL.
 *
 * Langiums `DefaultFoldingRangeProvider` faltet *jeden* AST-Knoten ab drei
 * Zeilen — das erzeugt zu viele und teils überlappende Falt-Marker (jeder
 * lange Ausdruck, jede Operandenkette). Wir whitelisten stattdessen die
 * Strukturen, die ein Sachbearbeiter sinnvoll ein-/ausklappen will:
 *
 *   - `prüfe`-Blöcke (Testfall-Sammlung)
 *   - Datensatz-Deklarationen (Feldliste)
 *   - Aufzählungs-Deklarationen
 *   - `wähle`-Blöcke (Tarifzonen-Verzweigung)
 *   - Block-Bodies von Funktionen / Lambdas (`{ … }`)
 *
 * Zusätzlich — was der Default *nicht* abdeckt:
 *   - `-- … --`-Doc-Kommentare (eigenes `DOC_COMMENT`-Terminal, kein
 *     hidden Block-Comment) → als `Comment`-Faltung
 *   - mehrzeilige `"""…"""`-Strings (Bescheid-Templates) → als Region
 *
 * Block-Kommentare im C-Stil werden weiterhin von der Basisklasse
 * (`collectCommentFolding`) gefaltet — wir rufen `super.collectFolding`.
 */

import {
    type AstNode,
    type LangiumDocument,
    CstUtils,
} from 'langium';
import { DefaultFoldingRangeProvider, type FoldingRangeAcceptor } from 'langium/lsp';
import { FoldingRange, FoldingRangeKind } from 'vscode-languageserver';
import {
    isAufzaehlungDecl,
    isBlockExpr,
    isDatensatzDecl,
    isFuerExpr,
    isFunktionDecl,
    isLambda,
    isPruefeDecl,
    isWaehleExpr,
} from './generated/ast.js';

export class FindslFoldingRangeProvider extends DefaultFoldingRangeProvider {

    /**
     * Nur strukturelle Knoten falten. `FunktionDecl` selbst ist bewusst
     * NICHT in der Liste: ihr Range überlappt fast vollständig mit dem
     * inneren Block-/Wähle-Knoten — ein Marker pro Funktion reicht, und
     * der sitzt am inneren Block.
     */
    protected override shouldProcess(node: AstNode): boolean {
        return isPruefeDecl(node)
            || isDatensatzDecl(node)
            || isAufzaehlungDecl(node)
            || isWaehleExpr(node)
            || isBlockExpr(node)
            || isLambda(node)
            || isFuerExpr(node)
            || isFunktionDecl(node);   // nur für `= expr`-Funktionen ohne Block
    }

    protected override collectFolding(
        document: LangiumDocument, acceptor: FoldingRangeAcceptor,
    ): void {
        super.collectFolding(document, acceptor);
        this.collectDocAndStringFolding(document, acceptor);
    }

    /**
     * Erzeugt den Folding-Range eines Decl-Knotens. Bei Knoten mit
     * `docPrefix` (Doc-Kommentar + Annotationen) wird der Start NACH dem
     * DeclPrefix gesetzt, damit der Decl-Falt-Pfeil nicht auf derselben
     * Zeile wie der separate Doc-Kommentar-Falt-Pfeil sitzt. Sonst würde
     * VS Code beim Falten des Doc-Kommentars die ganze Decl mitnehmen.
     *
     * Die "letzte Zeile sichtbar lassen"-Heuristik greift NUR, wenn die
     * letzte Zeile ausschließlich aus einem Block-Schließer besteht
     * (`}` / `)` / `]`, ggf. + `,`/`;`) — z. B. das alleinstehende `}` eines
     * `wähle`-Blocks. Bei einem `= ausdruck`-Body, der zufällig mit `)`
     * endet (`… oder 0)`), wird die letzte Zeile MIT eingeklappt, sonst
     * bliebe sie sichtbar stehen.
     */
    protected override collectObjectFolding(
        document: LangiumDocument, node: AstNode, acceptor: FoldingRangeAcceptor,
    ): void {
        const cst = node.$cstNode;
        if (!cst) return;
        const r = cst.range;

        let startLine = r.start.line;
        let startChar = r.start.character;

        const dp = (node as { docPrefix?: AstNode }).docPrefix;
        const dpEndLine = dp?.$cstNode?.range.end.line;
        if (dpEndLine !== undefined && dpEndLine > startLine) {
            startLine = dpEndLine;
            startChar = 0;
        }

        let end = r.end;
        if (end.line - startLine < 2) return;     // < 3 Zeilen: kein Folding

        // Text der letzten Zeile des Knotens.
        const lastLine = document.textDocument.getText({
            start: { line: end.line, character: 0 },
            end:   { line: end.line, character: Number.MAX_SAFE_INTEGER },
        }).trim();

        // Nur alleinstehende Schließer-Zeilen sichtbar lassen.
        if (/^[}\])]+[,;]?$/.test(lastLine)) {
            const off = document.textDocument.offsetAt({ line: end.line, character: 0 }) - 1;
            end = document.textDocument.positionAt(off);
        }
        if (end.line - startLine < 2) return;

        acceptor(FoldingRange.create(startLine, end.line, startChar, end.character));
    }

    /**
     * Faltung für `DOC_COMMENT`-Tokens (Markdown-Doc-Blöcke) und mehrzeilige
     * `STRING`-Tokens (`"""…"""`). Beide sind Terminal-Tokens, keine eigenen
     * AST-Knoten mit faltbarem Range — daher der direkte CST-Walk.
     */
    private collectDocAndStringFolding(
        document: LangiumDocument, acceptor: FoldingRangeAcceptor,
    ): void {
        const root = document.parseResult?.value;
        const cst = root?.$cstNode;
        if (!cst) return;

        for (const leaf of CstUtils.flattenCst(cst)) {
            const tokenName = leaf.tokenType?.name;
            if (tokenName === 'DOC_COMMENT') {
                const fr = this.toFoldingRange(document, leaf, FoldingRangeKind.Comment);
                if (fr) acceptor(fr);
            } else if (tokenName === 'STRING' && leaf.text.startsWith('"""')) {
                const fr = this.toFoldingRange(document, leaf, FoldingRangeKind.Region);
                if (fr) acceptor(fr);
            }
        }
    }
}
