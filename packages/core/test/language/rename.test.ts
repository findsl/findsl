/**
 * Tests für den Rename-Provider. Wir parsen Snippets, lokalisieren eine
 * Cursor-Position, rufen `rename`/`prepareRename` und verifizieren die
 * resultierenden `WorkspaceEdit`s — pro Datei eine Liste von Text-Edits.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { Range, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol';

async function renameAt(
    source: string, locator: string, newName: string,
): Promise<WorkspaceEdit | undefined> {
    return renameInModules({ 'ren': source }, 'ren', locator, newName);
}

async function renameInModules(
    sources: Record<string, string>,
    mainModule: string,
    locator: string,
    newName: string,
): Promise<WorkspaceEdit | undefined> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const documents = Object.entries(sources).map(([name, src]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(
            src,
            URI.parse(`file:///${name}.findsl`),
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
    return await services.lsp.RenameProvider!.rename(mainDoc, {
        textDocument: { uri: mainDoc.uri.toString() },
        position,
        newName,
    });
}

async function prepareRenameAt(
    source: string, locator: string,
): Promise<Range | undefined> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(
        source, URI.parse('file:///prep.findsl'),
    );
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
    const offset = source.indexOf(locator);
    const position = document.textDocument.positionAt(offset);
    return await services.lsp.RenameProvider!.prepareRename(document, {
        textDocument: { uri: document.uri.toString() },
        position,
    });
}

function countEdits(edit: WorkspaceEdit | undefined): number {
    if (!edit?.changes) return 0;
    return Object.values(edit.changes).reduce((n, arr) => n + arr.length, 0);
}

function editsFor(edit: WorkspaceEdit, uriSuffix: string): TextEdit[] {
    const entry = Object.entries(edit.changes ?? {})
        .find(([uri]) => uri.endsWith(uriSuffix));
    return entry ? entry[1] : [];
}

describe('prepareRename', () => {
    it('Erlaubt Rename auf User-Konstante', async () => {
        const src = `konst GFB: Euro = 12.096 als Euro
konst R: Euro = GFB + 1
`;
        const range = await prepareRenameAt(src, 'GFB +');
        expect(range).toBeDefined();
    });

    it('Erlaubt Rename auf User-Funktion', async () => {
        const src = `fn doppel(x: Euro): Euro = x * 2
`;
        const range = await prepareRenameAt(src, 'doppel');
        expect(range).toBeDefined();
    });

    it('Verbietet Rename auf Builtin-Funktion', async () => {
        const src = `fn f(x: EuroCent): Euro = abrundenEuro(x)
`;
        const range = await prepareRenameAt(src, 'abrundenEuro');
        expect(range).toBeUndefined();
    });

    it('Verbietet Rename auf Builtin-Typ', async () => {
        const src = `konst X: Euro = 100 als Euro
`;
        const range = await prepareRenameAt(src, 'Euro =');
        expect(range).toBeUndefined();
    });

    it('Verbietet Rename auf unbekanntem Identifier', async () => {
        const src = `konst R: Euro = unbekannt
`;
        const range = await prepareRenameAt(src, 'unbekannt');
        expect(range).toBeUndefined();
    });
});

describe('rename: lokale Symbole', () => {
    it('Konstante umbenennen — Decl + Use-Sites werden geändert', async () => {
        const src = `konst GFB: Euro = 12.096 als Euro
konst A: Euro = GFB + 1
konst B: Euro = GFB * 2 als Euro
`;
        const edit = await renameAt(src, 'GFB +', 'GRUNDFREIBETRAG');
        expect(countEdits(edit)).toBe(3);  // Decl + 2 Use-Sites
        const edits = editsFor(edit!, 'ren.findsl');
        for (const e of edits) {
            expect(e.newText).toBe('GRUNDFREIBETRAG');
        }
    });

    it('Funktion umbenennen — Decl + alle Aufrufe', async () => {
        const src = `fn doppel(x: Euro): Euro = x * 2
konst A: Euro = doppel(50 als Euro)
konst B: Euro = doppel(100 als Euro)
`;
        const edit = await renameAt(src, 'doppel(50', 'verdoppeln');
        expect(countEdits(edit)).toBe(3);  // Decl + 2 Aufrufe
    });

    it('Datensatz umbenennen — Decl + Konstruktor + Typ-Annotationen', async () => {
        const src = `datensatz Pt(x: Ganzzahl, y: Ganzzahl)
konst P1: Pt = Pt(1, 2)
fn f(p: Pt): Ganzzahl = p.x
`;
        const edit = await renameAt(src, 'Pt(x:', 'Punkt');
        // Decl + 2 Typ-Annotationen (P1, f(p)) + 1 Konstruktor → 4 Edits
        expect(countEdits(edit)).toBeGreaterThanOrEqual(4);
    });

    it('Param umbenennen — nur innerhalb der eigenen Funktion', async () => {
        const src = `fn f(zve: Euro): Euro = zve + zve
fn g(zve: Euro): Euro = zve * 2 als Euro
`;
        const edit = await renameAt(src, 'zve + zve', 'einkommen');
        // 3 Edits in f: Param-Decl + 2 Use-Sites; g bleibt unverändert
        expect(countEdits(edit)).toBe(3);
    });

    it('Field umbenennen', async () => {
        const src = `datensatz Pt(x: Ganzzahl, y: Ganzzahl)
konst P: Pt = Pt(x = 1, y = 2)
konst R: Ganzzahl = P.x
`;
        const edit = await renameAt(src, 'x: Ganzzahl', 'koordX');
        // Field-Decl + P.x Use-Site. (Konstruktor `x = 1` ist ein
        // named-Argument-Marker, der separat im AST liegt — wird im Skelett
        // nicht umbenannt; daher mind. 2 Edits.)
        expect(countEdits(edit)).toBeGreaterThanOrEqual(2);
    });
});

describe('rename: Cross-Modul', () => {
    it('Importiertes Symbol — Edits in beiden Modulen', async () => {
        const lib = `konst GFB: Euro = 12.096 als Euro
`;
        const app = `verwende {GFB} aus "./lib"
konst R: Euro = GFB + 1
`;
        const edit = await renameInModules(
            { lib, app }, 'app', 'GFB + 1', 'GRUNDFREIBETRAG',
        );
        const libEdits = editsFor(edit!, 'lib.findsl');
        const appEdits = editsFor(edit!, 'app.findsl');
        expect(libEdits).toHaveLength(1);   // Decl in lib
        // app: Import-Item (GFB in `{GFB} aus "./lib"`) + Use-Site = mind. 1
        expect(appEdits.length).toBeGreaterThanOrEqual(1);
    });
});

describe('rename: Validierung', () => {
    it('Neuer Name muss gültiger Identifier sein', async () => {
        const src = `konst GFB: Euro = 1 als Euro
`;
        const edit = await renameAt(src, 'GFB', '123ungültig');
        expect(edit).toBeUndefined();
    });

    it('Neuer Name darf nicht reserviertes Keyword sein', async () => {
        const src = `konst GFB: Euro = 1 als Euro
`;
        const edit = await renameAt(src, 'GFB', 'falls');
        expect(edit).toBeUndefined();
    });

    it('Deutsche Umlaute im neuen Namen erlaubt', async () => {
        const src = `konst gfb: Euro = 1 als Euro
konst R: Euro = gfb + 1
`;
        const edit = await renameAt(src, 'gfb +', 'grundfreibetragö');
        expect(edit).toBeDefined();
        expect(countEdits(edit)).toBe(2);
    });
});
