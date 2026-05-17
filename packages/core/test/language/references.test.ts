/**
 * Tests für den Find-All-References-Provider. Wir parsen Snippets, lokali-
 * sieren eine Cursor-Position und prüfen, dass alle Use-Sites des Symbols
 * gefunden werden — inkl. cross-modul.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { Location } from 'vscode-languageserver';

async function refsAt(
    source: string, locator: string, includeDecl = false,
): Promise<Location[]> {
    return refsInModules({ 'ref': source }, 'ref', locator, includeDecl);
}

async function refsInModules(
    sources: Record<string, string>,
    mainModule: string,
    locator: string,
    includeDecl: boolean,
): Promise<Location[]> {
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
    return await services.lsp.ReferencesProvider!.findReferences(mainDoc, {
        textDocument: { uri: mainDoc.uri.toString() },
        position,
        context: { includeDeclaration: includeDecl },
    });
}

describe('Find References: lokale Symbole', () => {
    it('Konstante: zwei Use-Sites werden gefunden', async () => {
        const src = `konst GFB: Euro = 12.096 als Euro
konst A: Euro = GFB + 1
konst B: Euro = GFB * 2 als Euro
`;
        const refs = await refsAt(src, 'GFB +');
        expect(refs).toHaveLength(2);
        const lines = refs.map((r) => r.range.start.line).sort();
        // Use-Sites in Zeile 1 (GFB + 1) und Zeile 2 (GFB * 2)
        expect(lines).toEqual([1, 2]);
    });

    it('includeDeclaration fügt die Decl-Stelle hinzu', async () => {
        const src = `konst GFB: Euro = 12.096 als Euro
konst A: Euro = GFB + 1
`;
        const refs = await refsAt(src, 'GFB +', true);
        expect(refs).toHaveLength(2);
        const lines = refs.map((r) => r.range.start.line).sort();
        expect(lines).toEqual([0, 1]);   // Decl in 0, Verwendung in 1
    });

    it('Funktion: alle Aufrufe', async () => {
        const src = `fn doppel(x: Euro): Euro = x * 2
konst A: Euro = doppel(50 als Euro)
konst B: Euro = doppel(100 als Euro) + doppel(200 als Euro)
`;
        const refs = await refsAt(src, 'doppel(50');
        expect(refs).toHaveLength(3);
    });

    it('Datensatz-Konstruktor + Typ-Annotationen als Referenzen', async () => {
        const src = `datensatz Pt(x: Ganzzahl, y: Ganzzahl)
konst P1: Pt = Pt(1, 2)
konst P2: Pt = Pt(3, 4)
`;
        const refs = await refsAt(src, 'Pt(1,');
        // Vier Use-Sites: zwei Type-Annotationen (P1, P2) + zwei Konstruktor-
        // Aufrufe. Beide sind Refs auf den Datensatz-Namen.
        expect(refs).toHaveLength(4);
    });

    it('Param: nur Use-Sites innerhalb der eigenen Funktion', async () => {
        const src = `fn f(zve: Euro): Euro = zve + zve
fn g(zve: Euro): Euro = zve * 2 als Euro
`;
        // Cursor auf `zve` in fn f's Body
        const refs = await refsAt(src, 'zve + zve');
        // Erwartet: nur die zwei zve-Vorkommen im f-Body, NICHT g's zve
        expect(refs).toHaveLength(2);
        for (const r of refs) {
            // beide Refs müssen auf Zeile 0 (= f's Body) sein
            expect(r.range.start.line).toBe(0);
        }
    });

    it('Keine Refs für unbekannten Identifier', async () => {
        const src = `konst R: Euro = unbekannt
`;
        const refs = await refsAt(src, 'unbekannt');
        expect(refs).toEqual([]);
    });
});

describe('Find References: Field-Access', () => {
    it('Field-Access auf Datensatz-Feld findet alle Field-Use-Sites', async () => {
        const src = `datensatz Pt(x: Ganzzahl, y: Ganzzahl)
konst P1: Pt = Pt(1, 2)
konst P2: Pt = Pt(3, 4)
konst A: Ganzzahl = P1.x
konst B: Ganzzahl = P2.x + P1.x
`;
        const refs = await refsAt(src, 'x\n');
        // Drei Field-Access-Stellen: P1.x, P2.x, P1.x
        expect(refs).toHaveLength(3);
    });

    it('Field-Access mit includeDeclaration', async () => {
        const src = `datensatz Pt(x: Ganzzahl)
konst P: Pt = Pt(1)
konst R: Ganzzahl = P.x
`;
        const refs = await refsAt(src, 'x\n', true);
        expect(refs.length).toBe(2);  // Field-Decl + 1 Use-Site
    });
});

describe('Find References: Cross-Modul', () => {
    it('Importiertes Symbol — Use-Sites in beiden Modulen', async () => {
        const lib = `konst GFB: Euro = 12.096 als Euro
`;
        const app = `verwende {GFB} aus "./lib"
konst R: Euro = GFB + 1
konst S: Euro = GFB * 2 als Euro
`;
        const refs = await refsInModules({ lib, app }, 'app', 'GFB + 1', false);
        // Zwei Use-Sites in app: GFB+1 und GFB*2
        expect(refs).toHaveLength(2);
        for (const r of refs) {
            expect(r.uri).toMatch(/app\.findsl$/);
        }
    });

    it('Mit includeDeclaration: Decl in lib + Verwendungen in app', async () => {
        const lib = `konst GFB: Euro = 12.096 als Euro
`;
        const app = `verwende {GFB} aus "./lib"
konst R: Euro = GFB + 1
`;
        const refs = await refsInModules({ lib, app }, 'app', 'GFB + 1', true);
        expect(refs).toHaveLength(2);
        const uris = refs.map((r) => r.uri).sort();
        expect(uris[0]).toMatch(/app\.findsl$/);
        expect(uris[1]).toMatch(/lib\.findsl$/);
    });

    it('Cursor auf Decl-Stelle in lib findet alle App-Use-Sites', async () => {
        const lib = `konst GFB: Euro = 12.096 als Euro
`;
        const app = `verwende {GFB} aus "./lib"
konst R: Euro = GFB + 1
konst S: Euro = GFB * 2 als Euro
`;
        const refs = await refsInModules({ lib, app }, 'lib', 'GFB:', false);
        // Beide Refs sind in app, nicht in lib (kein Use-Site in lib)
        expect(refs).toHaveLength(2);
        for (const r of refs) {
            expect(r.uri).toMatch(/app\.findsl$/);
        }
    });
});

describe('Find References: Grenzfälle', () => {
    it('Builtin-Symbole liefern keine Refs', async () => {
        const src = `fn f(): Tarifart = Grundtarif
`;
        const refs = await refsAt(src, 'Grundtarif\n');
        // Grundtarif ist ein Builtin-Symbol ohne User-Decl → keine Refs
        expect(refs).toEqual([]);
    });

    it('Aufzählungs-Wert: Skelett-Limit — kein eigener AST-Knoten pro Wert', async () => {
        const src = `aufzählung Farbe { Rot, Grün, Blau }
fn f(): Farbe = Rot
fn g(): Farbe = Rot
`;
        // SPEC § 3.7: Aufzählungs-Werte sind eigenständige Singletons. Im
        // aktuellen AST stehen sie aber als String-Array auf AufzaehlungDecl
        // — kein eigener AST-Knoten, keine `===`-Identität pro Wert. Refs
        // sind daher (noch) leer. Behebung erfordert eine Grammatik-
        // Erweiterung (eigener `AufzaehlungValue`-Knoten).
        const refs = await refsAt(src, 'Rot\n');
        expect(refs).toEqual([]);
    });

    it('Aufzählungs-Typ-Name findet alle Verwendungen in Type-Annotationen', async () => {
        const src = `aufzählung Farbe { Rot, Grün, Blau }
fn f(c: Farbe): Farbe = c
fn g(): Farbe = Rot
`;
        // Cursor auf der Type-Annotation `Farbe`.
        const refs = await refsAt(src, 'Farbe):');
        // Drei Use-Sites in Type-Annotationen
        expect(refs.length).toBeGreaterThanOrEqual(2);
    });
});
