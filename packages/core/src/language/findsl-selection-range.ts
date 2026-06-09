// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Selection-Range-Provider für FinDSL (LSP `textDocument/selectionRange`,
 * Issue #19).
 *
 * Langium liefert für dieses LSP-Feature KEINEN Default (kein Service-Slot,
 * keine Handler-Registrierung) — Provider, DI-Bindung, Capability-Meldung und
 * Connection-Handler sind daher vollständig FinDSL-eigen.
 *
 * Idee: „Auswahl erweitern/verkleinern" (VS Code `Shift+Alt+→/←`, IntelliJ
 * analog). Zu jeder Cursor-Position wird die **CST-Container-Kette** vom
 * Blatt-Token bis zur Wurzel zu einer verschachtelten, monoton wachsenden
 * `SelectionRange` gefaltet (Token → Teilausdruck → Ausdruck → Anweisung →
 * Block → Deklaration → Programm). CST statt AST, weil das CST token-genaue
 * Grenzen kennt — die feinste sinnvolle Auswahl-Stufe.
 *
 * Teil-Parse-robust: ohne CST / ohne Blatt-Knoten an der Position wird eine
 * degenerierte (leere) Range an der Position zurückgegeben — nie eine
 * Exception.
 */

import {
    type CstNode,
    type LangiumDocument,
    type MaybePromise,
    CstUtils,
} from 'langium';
import type {
    CancellationToken,
    Position,
    Range,
    SelectionRange,
    SelectionRangeParams,
} from 'vscode-languageserver';

export class FindslSelectionRangeProvider {

    /** Eine `SelectionRange` je angefragter Position (LSP erlaubt mehrere). */
    getSelectionRanges(
        document: LangiumDocument,
        params: SelectionRangeParams,
        _cancelToken?: CancellationToken,
    ): MaybePromise<SelectionRange[]> {
        const root = document.parseResult?.value?.$cstNode;
        return params.positions.map((pos) => rangeForPosition(document, root, pos));
    }
}

/** Faltet die CST-Container-Kette an `pos` zu einer verschachtelten Range. */
function rangeForPosition(
    document: LangiumDocument, root: CstNode | undefined, pos: Position,
): SelectionRange {
    const degenerate: SelectionRange = { range: { start: pos, end: pos } };
    if (!root) return degenerate;

    const offset = document.textDocument.offsetAt(pos);
    const leaf = CstUtils.findLeafNodeAtOffset(root, offset);
    if (!leaf) return degenerate;

    // Vom Blatt nach aussen: jede Container-Range einsammeln; konsekutiv
    // gleiche Ranges (Komposit-Knoten mit Einzelkind) überspringen, und nur
    // ECHTE Vergrößerungen behalten → garantiert monoton wachsende Kette.
    const ranges: Range[] = [];
    let node: CstNode | undefined = leaf;
    let inner: Range | undefined;
    while (node) {
        const r = node.range;
        if (!inner || (!rangeEquals(inner, r) && rangeContains(r, inner))) {
            ranges.push(r);
            inner = r;
        }
        node = node.container;
    }
    if (ranges.length === 0) return degenerate;

    // Von aussen (größte Range) nach innen falten: `parent` zeigt nach aussen,
    // zurückgegeben wird die innerste `SelectionRange` (LSP-Konvention).
    let sel: SelectionRange | undefined;
    for (let i = ranges.length - 1; i >= 0; i--) {
        sel = { range: ranges[i], parent: sel };
    }
    return sel!;
}

function posEquals(a: Position, b: Position): boolean {
    return a.line === b.line && a.character === b.character;
}

function posLE(a: Position, b: Position): boolean {
    return a.line < b.line || (a.line === b.line && a.character <= b.character);
}

function rangeEquals(a: Range, b: Range): boolean {
    return posEquals(a.start, b.start) && posEquals(a.end, b.end);
}

/** Enthält `outer` die Range `inner` vollständig (Ränder eingeschlossen)? */
function rangeContains(outer: Range, inner: Range): boolean {
    return posLE(outer.start, inner.start) && posLE(inner.end, outer.end);
}
