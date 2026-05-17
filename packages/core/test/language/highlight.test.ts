/**
 * Tests für den Document-Highlight-Provider. Wir parsen Snippets,
 * lokalisieren eine Cursor-Position und prüfen, dass alle Vorkommen des
 * Symbols im selben Dokument zurückkommen — Decl als Write, Uses als Read.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import {
    DocumentHighlightKind,
    type DocumentHighlight,
} from 'vscode-languageserver-protocol';

async function highlightAt(
    source: string, locator: string,
): Promise<DocumentHighlight[] | undefined> {
    return highlightInModules({ 'hl': source }, 'hl', locator);
}

async function highlightInModules(
    sources: Record<string, string>,
    mainModule: string,
    locator: string,
): Promise<DocumentHighlight[] | undefined> {
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
    return await services.lsp.DocumentHighlightProvider!.getDocumentHighlight(mainDoc, {
        textDocument: { uri: mainDoc.uri.toString() },
        position,
    });
}

function kinds(hls: DocumentHighlight[] | undefined) {
    return (hls ?? []).map((h) => h.kind);
}

describe('Document Highlight: lokale Symbole', () => {
    it('Konstante: Decl als Write + Uses als Read', async () => {
        const src = `konst GFB: Euro = 12.096 als Euro
konst A: Euro = GFB + 1
konst B: Euro = GFB * 2 als Euro
`;
        const hls = await highlightAt(src, 'GFB +');
        expect(hls).toHaveLength(3);
        const k = kinds(hls);
        expect(k.filter((x) => x === DocumentHighlightKind.Write)).toHaveLength(1);
        expect(k.filter((x) => x === DocumentHighlightKind.Read)).toHaveLength(2);
    });

    it('Cursor auf der Decl selbst — auch alle Uses', async () => {
        const src = `konst GFB: Euro = 12.096 als Euro
konst A: Euro = GFB + 1
`;
        const hls = await highlightAt(src, 'GFB:');
        expect(hls).toHaveLength(2);  // Decl (Write) + 1 Use (Read)
    });

    it('Funktion: Decl + alle Aufrufe', async () => {
        const src = `fn doppel(x: Euro): Euro = x * 2
konst A: Euro = doppel(50 als Euro)
konst B: Euro = doppel(100 als Euro)
`;
        const hls = await highlightAt(src, 'doppel(50');
        expect(hls).toHaveLength(3);
    });

    it('Param: nur Vorkommen innerhalb der eigenen Funktion', async () => {
        const src = `fn f(zve: Euro): Euro = zve + zve
fn g(zve: Euro): Euro = zve * 2 als Euro
`;
        const hls = await highlightAt(src, 'zve + zve');
        // f's zve: Param-Decl (Write) + 2 Uses (Read) = 3; g bleibt unberührt
        expect(hls).toHaveLength(3);
    });

    it('Field-Access', async () => {
        const src = `datensatz Pt(x: Ganzzahl, y: Ganzzahl)
konst P: Pt = Pt(1, 2)
konst A: Ganzzahl = P.x
konst B: Ganzzahl = P.x + P.x
`;
        // Cursor auf der Field-Decl `x: Ganzzahl`.
        const hls = await highlightAt(src, 'x: Ganzzahl');
        // Field-Decl x (Write) + drei P.x-Use-Sites (Read)
        expect((hls ?? []).length).toBeGreaterThanOrEqual(4);
    });

    it('Unbekannter Identifier → kein Highlight', async () => {
        const src = `konst R: Euro = unbekannt
`;
        const hls = await highlightAt(src, 'unbekannt');
        expect(hls === undefined || hls.length === 0).toBe(true);
    });

    it('Builtin-Funktion → kein Highlight', async () => {
        const src = `fn f(x: EuroCent): Euro = abrundenEuro(x)
`;
        const hls = await highlightAt(src, 'abrundenEuro');
        expect(hls === undefined || hls.length === 0).toBe(true);
    });
});

describe('Document Highlight: Cross-Modul', () => {
    it('Importiertes Symbol — nur lokale Vorkommen, KEINE Decl im Fremd-Doc', async () => {
        const lib = `konst GFB: Euro = 12.096 als Euro
`;
        const app = `verwende {GFB} aus "./lib"
konst R: Euro = GFB + 1
konst S: Euro = GFB * 2 als Euro
`;
        const hls = await highlightInModules({ lib, app }, 'app', 'GFB + 1');
        // app: Import-Item + 2 Use-Sites. Keine Write-Markierung, weil die
        // Decl in lib (anderem Dokument) liegt.
        expect((hls ?? []).length).toBeGreaterThanOrEqual(2);
        expect(kinds(hls).every((k) => k === DocumentHighlightKind.Read)).toBe(true);
    });
});
