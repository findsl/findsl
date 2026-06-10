/**
 * Tests für den Selection-Range-Provider (Issue #19): zu einer Cursor-
 * Position liefert `getSelectionRanges` eine verschachtelte, monoton
 * wachsende Range-Kette (Token → … → Deklaration). Der Provider wird direkt
 * über die Services aufgerufen (kein LSP-Transport nötig).
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI, type LangiumDocument } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { Position, Range, SelectionRange } from 'vscode-languageserver';

const services = createFindslServices(NodeFileSystem).Findsl;

let docCounter = 0;

async function buildDoc(source: string): Promise<LangiumDocument> {
    // Eindeutige URI je Aufruf — die Services (und ihr LangiumDocuments-
    // Store) sind über die Testdatei geteilt; dieselbe URI doppelt anzulegen
    // würfe „already present".
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        source, URI.parse(`file:///sel-${docCounter++}.findsl`),
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    return doc;
}

/** Ruft den Provider an der Position des Markers `¦` im Quelltext auf. */
async function rangesAt(sourceWithCursor: string): Promise<SelectionRange> {
    const offset = sourceWithCursor.indexOf('¦');
    const source = sourceWithCursor.replace('¦', '');
    const doc = await buildDoc(source);
    const pos = doc.textDocument.positionAt(offset);
    const res = await services.lsp.SelectionRangeProvider.getSelectionRanges(
        doc, { textDocument: { uri: doc.uri.toString() }, positions: [pos] },
    );
    return res[0];
}

/** Range-Kette von innen nach aussen als Array. */
function chain(sel: SelectionRange): Range[] {
    const out: Range[] = [];
    let cur: SelectionRange | undefined = sel;
    while (cur) { out.push(cur.range); cur = cur.parent; }
    return out;
}

function posLE(a: Position, b: Position): boolean {
    return a.line < b.line || (a.line === b.line && a.character <= b.character);
}
function contains(outer: Range, inner: Range): boolean {
    return posLE(outer.start, inner.start) && posLE(inner.end, outer.end);
}
function size(r: Range): number {
    return (r.end.line - r.start.line) * 100000 + (r.end.character - r.start.character);
}

/** Jede äußere Range enthält die nächst-innere und ist echt größer. */
function expectMonotonic(sel: SelectionRange): void {
    const links = chain(sel);
    for (let i = 0; i + 1 < links.length; i++) {
        expect(contains(links[i + 1], links[i])).toBe(true);
        expect(size(links[i + 1])).toBeGreaterThan(size(links[i]));
    }
}

describe('selection-range', () => {
    it('liefert eine monoton wachsende, verschachtelte Kette', async () => {
        const sel = await rangesAt('@Quelle("§ 1")\nkonst R: Ganzzahl = 1 + ¦2 * 3\n');
        const links = chain(sel);

        // Mindestens: Token `2` → `2 * 3` → `1 + 2 * 3` → konst-Decl.
        expect(links.length).toBeGreaterThanOrEqual(3);

        // Jede äußere Range enthält die nächst-innere und ist echt größer.
        for (let i = 0; i + 1 < links.length; i++) {
            expect(contains(links[i + 1], links[i])).toBe(true);
            expect(size(links[i + 1])).toBeGreaterThan(size(links[i]));
        }

        // Innerste Range ist genau das Token `2` (Länge 1, eine Zeile).
        const innermost = links[0];
        expect(innermost.start.line).toBe(1);
        expect(innermost.end.character - innermost.start.character).toBe(1);
    });

    it('unterstützt mehrere Positionen — je Position eine eigene monotone Kette', async () => {
        const source = '@Quelle("§ 1")\nkonst R: Ganzzahl = 1 + 2\n';
        const doc = await buildDoc(source);
        const res = await services.lsp.SelectionRangeProvider.getSelectionRanges(doc, {
            textDocument: { uri: doc.uri.toString() },
            positions: [
                doc.textDocument.positionAt(source.indexOf('R')),     // Bezeichner
                doc.textDocument.positionAt(source.indexOf('2\n')),   // Token im Ausdruck
            ],
        });
        expect(res).toHaveLength(2);
        // Jede Position bekommt ihre eigene, korrekt monoton wachsende Kette.
        expectMonotonic(res[0]);
        expectMonotonic(res[1]);
        // Cursor im Teilausdruck (`2`) erzeugt eine echt tiefere Kette als der
        // Decl-Name (`R`) — beweist, dass je Position separat gefaltet wird.
        expect(chain(res[1]).length).toBeGreaterThan(chain(res[0]).length);
    });

    it('Position jenseits EOF → eine gültige Range, kein Absturz', async () => {
        const doc = await buildDoc('konst R: Ganzzahl = 1\n');
        const pos: Position = { line: 999, character: 0 };
        const res = await services.lsp.SelectionRangeProvider.getSelectionRanges(
            doc, { textDocument: { uri: doc.uri.toString() }, positions: [pos] },
        );
        expect(res).toHaveLength(1);
        expect(res[0].range).toBeDefined();
        expectMonotonic(res[0]); // egal ob degeneriert oder Kette: stets monoton.
    });

    it('Cursor auf Whitespace zwischen Tokens → gültige, monotone Range', async () => {
        // Leerzeichen zwischen `+` und `2`.
        const sel = await rangesAt('konst R: Ganzzahl = 1 +¦ 2\n');
        expect(sel.range).toBeDefined();
        expectMonotonic(sel);
    });

    it('verschachtelter Block: Cursor tief im inneren Ausdruck → Kette bis zur Deklaration', async () => {
        const sel = await rangesAt(
            'fn f(x: Ganzzahl): Ganzzahl = {\n  var y: Ganzzahl = x + ¦1\n  y * 2\n}\n',
        );
        const links = chain(sel);
        // Token `1` → `x + 1` → var-Decl → Block → fn-Decl: deutlich tiefer als flach.
        expect(links.length).toBeGreaterThanOrEqual(4);
        expectMonotonic(sel);
        // Äußerste Range umfasst die innerste vollständig.
        expect(contains(links[links.length - 1], links[0])).toBe(true);
    });

    it('ist Teil-Parse-robust: leeres Dokument → degenerierte Range', async () => {
        const doc = await buildDoc('');
        const pos = { line: 0, character: 0 };
        const res = await services.lsp.SelectionRangeProvider.getSelectionRanges(
            doc, { textDocument: { uri: doc.uri.toString() }, positions: [pos] },
        );
        expect(res).toHaveLength(1);
        expect(res[0].range).toEqual({ start: pos, end: pos });
        expect(res[0].parent).toBeUndefined();
    });
});
