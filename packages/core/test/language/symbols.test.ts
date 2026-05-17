/**
 * Tests für den Document-Symbol-Provider: Outline-Struktur, Symbol-Kinds
 * und Verschachtelung (Datensatz-Felder, Aufzählungs-Werte, Testfälle).
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import { SymbolKind, type DocumentSymbol } from 'vscode-languageserver';

async function symbolsOf(source: string): Promise<DocumentSymbol[]> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        source, URI.parse('file:///sym.findsl'),
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    return await services.lsp.DocumentSymbolProvider!.getSymbols(doc, {
        textDocument: { uri: doc.uri.toString() },
    });
}

function byName(syms: DocumentSymbol[], name: string): DocumentSymbol | undefined {
    return syms.find((s) => s.name === name);
}

describe('Top-Level-Symbole mit korrekten Kinds', () => {
    it('Konstante → Constant mit Typ-Detail', async () => {
        const syms = await symbolsOf('modul m\nkonst GFB: Euro = 12.096 als Euro\n');
        const gfb = byName(syms, 'GFB')!;
        expect(gfb.kind).toBe(SymbolKind.Constant);
        expect(gfb.detail).toBe(': Euro');
    });

    it('Funktion → Function mit Signatur-Detail', async () => {
        const syms = await symbolsOf(
            'modul m\nfn estGrundtarif(zve: Euro): Euro = zve\n',
        );
        const fn = byName(syms, 'estGrundtarif')!;
        expect(fn.kind).toBe(SymbolKind.Function);
        expect(fn.detail).toBe('(zve: Euro): Euro');
    });

    it('Datensatz → Struct mit Feldern als Field-Kindern', async () => {
        const syms = await symbolsOf(`modul m
datensatz Steuerfall(
    einkuenfte: Euro,
    tarif: Tarifart,
    kinder: Euro? = nichts,
)
`);
        const sf = byName(syms, 'Steuerfall')!;
        expect(sf.kind).toBe(SymbolKind.Struct);
        expect(sf.detail).toBe('(3 Felder)');
        expect(sf.children).toHaveLength(3);
        const felder = Object.fromEntries(
            sf.children!.map((c) => [c.name, c]),
        );
        expect(felder.einkuenfte.kind).toBe(SymbolKind.Field);
        expect(felder.einkuenfte.detail).toBe(': Euro');
        expect(felder.tarif.detail).toBe(': Tarifart');
        expect(felder.kinder.detail).toBe(': Euro? = …');
    });

    it('Aufzählung → Enum mit Werten als EnumMember-Kindern', async () => {
        const syms = await symbolsOf('modul m\naufzählung Farbe { Rot, Grün, Blau }\n');
        const e = byName(syms, 'Farbe')!;
        expect(e.kind).toBe(SymbolKind.Enum);
        expect(e.detail).toBe('{ Rot, Grün, Blau }');
        expect(e.children).toHaveLength(3);
        expect(e.children!.map((c) => c.name)).toEqual(['Rot', 'Grün', 'Blau']);
        expect(e.children!.every((c) => c.kind === SymbolKind.EnumMember)).toBe(true);
    });

    it('prüfe → Namespace mit Testfällen als Method-Kindern', async () => {
        const syms = await symbolsOf(`modul m
fn f(): Ganzzahl = 1
prüfe "Knotenpunkte" {
    testfall "Zone 1" { f() == 1 }
    testfall "Zone 2" { f() == 1 }
}
`);
        const p = byName(syms, 'Knotenpunkte')!;
        expect(p.kind).toBe(SymbolKind.Namespace);
        expect(p.detail).toBe('(2 Testfälle)');
        expect(p.children).toHaveLength(2);
        expect(p.children!.map((c) => c.name)).toEqual(['Zone 1', 'Zone 2']);
        expect(p.children!.every((c) => c.kind === SymbolKind.Method)).toBe(true);
    });
});

describe('Range-Konsistenz (LSP-Anforderung)', () => {
    it('selectionRange liegt innerhalb von range', async () => {
        const syms = await symbolsOf(`modul m

--
Grundfreibetrag.
--
@Quelle("§ 32a EStG")
konst GFB: Euro = 12.096 als Euro
`);
        const gfb = byName(syms, 'GFB')!;
        // range startet beim Doc-Kommentar (Decl-CST), selectionRange beim
        // Namen — selectionRange muss enthalten sein.
        expect(gfb.selectionRange.start.line).toBeGreaterThanOrEqual(gfb.range.start.line);
        expect(gfb.selectionRange.end.line).toBeLessThanOrEqual(gfb.range.end.line);
    });

    it('Feld-selectionRange liegt innerhalb des Feld-range', async () => {
        const syms = await symbolsOf(
            'modul m\ndatensatz Pt(x: Ganzzahl, y: Ganzzahl)\n',
        );
        const pt = byName(syms, 'Pt')!;
        for (const f of pt.children!) {
            expect(f.selectionRange.start.character)
                .toBeGreaterThanOrEqual(f.range.start.character - 0);
        }
    });
});

describe('Reihenfolge und Vollständigkeit', () => {
    it('Symbole erscheinen in Quelltext-Reihenfolge', async () => {
        const syms = await symbolsOf(`modul m
konst A: Euro = 1 als Euro
fn f(): Euro = A
datensatz D(x: Ganzzahl)
aufzählung E { X, Y }
`);
        expect(syms.map((s) => s.name)).toEqual(['A', 'f', 'D', 'E']);
    });

    it('Leeres Modul → keine Symbole', async () => {
        const syms = await symbolsOf('modul leer\n');
        expect(syms).toEqual([]);
    });
});
