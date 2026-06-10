/**
 * Tests für den Linked-Editing-Range-Provider (LSP
 * `textDocument/linkedEditingRange`, Issue #21).
 *
 * Wir parsen Snippets, lokalisieren eine Cursor-Position und rufen
 * `getLinkedEditingRanges` direkt auf dem gebundenen Provider. Verifiziert
 * wird die Range-Gruppe (Decl + Verwendungen im selben Dokument) sowie die
 * konservative Abgrenzung: importierte (cross-modul) Symbole, Builtins,
 * Keywords und unbekannte Bezeichner liefern KEINE Ranges.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import type { LinkedEditingRanges } from 'vscode-languageserver-protocol';
import { createFindslServices } from '../../src/language/findsl-module.js';

async function linkedAt(
    source: string, locator: string,
): Promise<LinkedEditingRanges | undefined> {
    return linkedInModules({ main: source }, 'main', locator);
}

async function linkedInModules(
    sources: Record<string, string>,
    mainModule: string,
    locator: string,
): Promise<LinkedEditingRanges | undefined> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const documents = Object.entries(sources).map(([name, src]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(
            src, URI.parse(`file:///${name}.findsl`),
        ),
    );
    for (const d of documents) {
        services.shared.workspace.LangiumDocuments.addDocument(d);
    }
    await services.shared.workspace.DocumentBuilder.build(documents, { validation: false });

    const mainDoc = documents.find((d) => d.uri.path.endsWith(`/${mainModule}.findsl`))!;
    const offset = sources[mainModule].indexOf(locator);
    if (offset < 0) throw new Error(`Locator "${locator}" nicht gefunden.`);
    const position = mainDoc.textDocument.positionAt(offset);
    const result = await services.lsp.LinkedEditingRangeProvider!.getLinkedEditingRanges(
        mainDoc, { textDocument: { uri: mainDoc.uri.toString() }, position },
    );
    return result ?? undefined;
}

describe('linked editing: lokale Bezeichner', () => {
    it('Top-Level konst — Decl + alle Verwendungen im Dokument', async () => {
        const src = `konst GFB: Euro = 12.096 als Euro
konst A: Euro = GFB + 1
konst B: Euro = GFB * 2 als Euro
`;
        const result = await linkedAt(src, 'GFB +');
        expect(result).toBeDefined();
        expect(result!.ranges).toHaveLength(3); // Decl + 2 Verwendungen
    });

    it('Cursor auf der Decl selbst — Decl + alle Verwendungen', async () => {
        const src = `konst GFB: Euro = 12.096 als Euro
konst A: Euro = GFB + 1
`;
        // Cursor direkt auf der Decl-Stelle (nicht auf einer Use-Site).
        const result = await linkedAt(src, 'GFB:');
        expect(result).toBeDefined();
        expect(result!.ranges).toHaveLength(2); // Decl + 1 Verwendung
    });

    it('Funktion — Decl + alle Aufrufstellen', async () => {
        const src = `fn doppel(x: Euro): Euro = x * 2
konst A: Euro = doppel(50 als Euro)
konst B: Euro = doppel(100 als Euro)
`;
        const result = await linkedAt(src, 'doppel(50');
        expect(result).toBeDefined();
        expect(result!.ranges).toHaveLength(3); // Decl + 2 Aufrufe
    });

    it('Funktionsparameter — nur innerhalb der eigenen Funktion', async () => {
        const src = `fn f(zve: Euro): Euro = zve + zve
fn g(zve: Euro): Euro = zve * 2 als Euro
`;
        const result = await linkedAt(src, 'zve + zve');
        expect(result).toBeDefined();
        expect(result!.ranges).toHaveLength(3); // Param-Decl + 2 Use-Sites in f
    });

    it('Field-Access — Field-Decl + alle Punkt-Zugriffe', async () => {
        const src = `datensatz Pt(x: Ganzzahl, y: Ganzzahl)
konst P: Pt = Pt(1, 2)
konst A: Ganzzahl = P.x
konst B: Ganzzahl = P.x + P.x
`;
        // Cursor auf der Field-Decl `x: Ganzzahl`.
        const result = await linkedAt(src, 'x: Ganzzahl');
        expect(result).toBeDefined();
        // Field-Decl x + drei P.x-Use-Sites.
        expect(result!.ranges.length).toBeGreaterThanOrEqual(4);
    });

    it('Block-lokales `var` — Decl + Verwendungen im Block', async () => {
        const src = `fn f(x: Euro): Euro = {
  var y: Euro = x
  y + y
}
`;
        const result = await linkedAt(src, 'y: Euro');
        expect(result).toBeDefined();
        expect(result!.ranges).toHaveLength(3); // var-Decl + 2x in `y + y`
    });
});

describe('linked editing: konservative Abgrenzung', () => {
    it('Importiertes (cross-modul) Symbol → keine Ranges', async () => {
        const lib = `konst GFB: Euro = 12.096 als Euro
`;
        const app = `verwende {GFB} aus "./lib"
konst R: Euro = GFB + 1
`;
        const result = await linkedInModules({ lib, app }, 'app', 'GFB + 1');
        expect(result).toBeUndefined();
    });

    it('Builtin-Funktion → keine Ranges', async () => {
        const src = `fn f(x: EuroCent): Euro = abrundenEuro(x)
`;
        const result = await linkedAt(src, 'abrundenEuro');
        expect(result).toBeUndefined();
    });

    it('Builtin-Typ → keine Ranges', async () => {
        const src = `konst X: Euro = 100 als Euro
`;
        const result = await linkedAt(src, 'Euro =');
        expect(result).toBeUndefined();
    });

    it('Unbekannter Bezeichner → keine Ranges', async () => {
        const src = `konst R: Euro = unbekannt
`;
        const result = await linkedAt(src, 'unbekannt');
        expect(result).toBeUndefined();
    });

    it('Keyword → keine Ranges', async () => {
        const src = `konst X: Euro = 100 als Euro
`;
        const result = await linkedAt(src, 'konst');
        expect(result).toBeUndefined();
    });
});

describe('linked editing: Robustheit & wordPattern', () => {
    it('Teilgeparstes Dokument wirft nicht', async () => {
        const src = `konst GFB: Euro = 12.096 als Euro
konst A: Euro = GFB +`;
        const result = await linkedAt(src, 'GFB +');
        // Entweder undefined oder eine gültige Gruppe — wichtig: kein Throw.
        if (result) expect(result.ranges.length).toBeGreaterThanOrEqual(1);
    });

    it('wordPattern erlaubt deutsche Umlaute', async () => {
        const src = `konst größe: Ganzzahl = 1
konst R: Ganzzahl = größe + 1
`;
        const result = await linkedAt(src, 'größe +');
        expect(result).toBeDefined();
        expect(result!.wordPattern).toBeTypeOf('string');
        expect(new RegExp(result!.wordPattern!).test('grundfreibetragö')).toBe(true);
    });
});
