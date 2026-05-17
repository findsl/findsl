/**
 * Tests für den Folding-Range-Provider. Wir parsen Snippets und prüfen,
 * dass die erwarteten Strukturen (prüfe-Block, Datensatz, wähle, Block-
 * Body, Doc-Kommentar, Multi-Line-String) faltbare Ranges liefern — und
 * dass triviale Ausdrücke KEINE erzeugen.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import { FoldingRangeKind, type FoldingRange } from 'vscode-languageserver';

async function foldingOf(source: string): Promise<FoldingRange[]> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const document = services.shared.workspace.LangiumDocumentFactory.fromString(
        source, URI.parse('file:///fold.findsl'),
    );
    services.shared.workspace.LangiumDocuments.addDocument(document);
    await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
    return await services.lsp.FoldingRangeProvider!.getFoldingRanges(document, {
        textDocument: { uri: document.uri.toString() },
    });
}

function hasRangeStartingAtLine(frs: FoldingRange[], line0: number): boolean {
    return frs.some((f) => f.startLine === line0);
}

describe('Folding: strukturelle Blöcke', () => {
    it('prüfe-Block ist faltbar', async () => {
        const src = `modul m
fn f(): Ganzzahl = 1
prüfe "Test" {
    testfall "a" { f() == 1 }
    testfall "b" { f() == 1 }
    testfall "c" { f() == 1 }
}
`;
        const frs = await foldingOf(src);
        // prüfe beginnt auf Zeile 3 (0-indexed: 2)
        expect(hasRangeStartingAtLine(frs, 2)).toBe(true);
    });

    it('Datensatz mit mehreren Feldern ist faltbar', async () => {
        const src = `modul m
datensatz Steuerfall(
    einkuenfte: Euro,
    abzuege: Euro,
    tarif: Tarifart,
)
`;
        const frs = await foldingOf(src);
        expect(hasRangeStartingAtLine(frs, 1)).toBe(true);
    });

    it('wähle-Block ist faltbar', async () => {
        const src = `modul m
fn tarif(zve: Euro): Euro = wähle {
    falls zve < 1000 als Euro -> 0 als Euro
    falls zve < 5000 als Euro -> 100 als Euro
    sonst -> 500 als Euro
}
`;
        const frs = await foldingOf(src);
        // wähle-Block startet auf Zeile 2 (0-indexed: 1)
        expect(frs.length).toBeGreaterThanOrEqual(1);
    });

    it('Block-Body einer Funktion ist faltbar', async () => {
        const src = `modul m
fn f(x: Ganzzahl): Ganzzahl {
    var a: Ganzzahl = x * 2
    var b: Ganzzahl = a + 1
    b
}
`;
        const frs = await foldingOf(src);
        expect(frs.length).toBeGreaterThanOrEqual(1);
    });

    it('= ausdruck-Body endet mit ) — letzte Zeile wird MIT gefaltet (Bug-Regression)', async () => {
        const src = `modul m
datensatz Abz(a: Euro? = nichts, b: Euro? = nichts, c: Euro? = nichts)
@Quelle("§ 2 Absatz 3 EStG")
fn gesamtbetrag(summe: Euro, abz: Abz): Euro =
      summe
    - (abz.a oder 0)
    - (abz.b oder 0)
    - (abz.c oder 0)
`;
        const frs = await foldingOf(src);
        // Letzte Body-Zeile ist 7 (0-indexed). Die fn-Faltung muss bis
        // Zeile 7 reichen — NICHT bei 6 enden, sonst bliebe
        // "- (abz.c oder 0)" beim Zuklappen sichtbar stehen.
        const fnFold = frs
            .filter((f) => f.kind !== FoldingRangeKind.Comment)
            .sort((a, b) => b.endLine - a.endLine)[0];
        expect(fnFold).toBeDefined();
        expect(fnFold!.endLine).toBe(7);
    });

    it('wähle-Block: alleinstehendes } bleibt sichtbar (letzte Zeile nicht gefaltet)', async () => {
        const src = `modul m
fn t(zve: Euro): Euro = wähle {
    falls zve < 1000 als Euro -> 0 als Euro
    falls zve < 5000 als Euro -> 100 als Euro
    sonst -> 500 als Euro
}
`;
        const frs = await foldingOf(src);
        // wähle-Block: Zeile 1..5, schließendes } auf Zeile 5.
        // Faltung soll bei Zeile 4 enden (} bleibt sichtbar).
        const waehle = frs
            .filter((f) => f.kind !== FoldingRangeKind.Comment)
            .sort((a, b) => b.endLine - a.endLine)[0];
        expect(waehle).toBeDefined();
        expect(waehle!.endLine).toBe(4);
    });

    it('Triviale einzeilige Funktion erzeugt KEINE Folding-Range', async () => {
        const src = `modul m
fn f(x: Euro): Euro = x
`;
        const frs = await foldingOf(src);
        expect(frs).toHaveLength(0);
    });
});

describe('Folding: Doc-Kommentare und Strings', () => {
    it('Mehrzeiliger Doc-Kommentar ist als Comment faltbar', async () => {
        const src = `modul m

--
Grundfreibetrag — steuerfreies Existenzminimum.
Erhöht 2025 auf 12.096 EUR.
--
@Quelle("§ 32a EStG")
konst GFB: Euro = 12.096
`;
        const frs = await foldingOf(src);
        const commentFolds = frs.filter((f) => f.kind === FoldingRangeKind.Comment);
        expect(commentFolds.length).toBeGreaterThanOrEqual(1);
    });

    it('Mehrzeiliger String ist als Region faltbar', async () => {
        const src = `modul m
konst name: Text = "Anna"
konst bescheid: Text = """
Sehr geehrte:r \${name},

Mit freundlichen Grüßen
Ihr Finanzamt
"""
`;
        const frs = await foldingOf(src);
        const regionFolds = frs.filter((f) => f.kind === FoldingRangeKind.Region);
        expect(regionFolds.length).toBeGreaterThanOrEqual(1);
    });

    it('Doc-Block und zugehörige Funktion falten unabhängig (Bug-Regression)', async () => {
        const src = `modul m

--
Berechnet die tarifliche Einkommensteuer.
Fünf Zonen gemäß § 32a EStG.
--
@Quelle("§ 32a EStG")
fn estGrundtarif(zve: Euro): Euro {
    var a: Euro = zve
    var b: Euro = a
    b
}
`;
        const frs = await foldingOf(src);
        const comment = frs.find((f) => f.kind === FoldingRangeKind.Comment);
        const fnFold = frs
            .filter((f) => f.kind !== FoldingRangeKind.Comment)
            .sort((x, y) => x.startLine - y.startLine)[0];

        expect(comment).toBeDefined();
        expect(fnFold).toBeDefined();

        // Der Doc-Kommentar beginnt auf Zeile 2 (0-indexed). Die Funktions-
        // Faltung MUSS auf einer späteren Zeile beginnen, sonst klappt ein
        // Klick auf den Doc-Pfeil die ganze Funktion mit zu.
        expect(comment!.startLine).toBe(2);
        expect(fnFold!.startLine).toBeGreaterThan(comment!.endLine);
    });

    it('Einzeiliger Doc-Kommentar erzeugt keine Faltung (< 3 Zeilen)', async () => {
        const src = `modul m
-- Kurze Beschreibung. --
@Quelle("Test")
konst K: Euro = 1
`;
        const frs = await foldingOf(src);
        const commentFolds = frs.filter((f) => f.kind === FoldingRangeKind.Comment);
        expect(commentFolds).toHaveLength(0);
    });
});

describe('Folding: Beispieldatei-realistisch', () => {
    it('tarif-ähnliche Datei: prüfe + wähle + Doc-Block werden gefaltet', async () => {
        const src = `modul tarif

--
Tariflicher Einkommensteuer-Berechnung.
Fünf Zonen gemäß § 32a EStG.
--
@Quelle("§ 32a EStG")
fn estGrundtarif(zve: Euro): Euro = wähle {
    falls zve < 12096 als Euro -> 0 als Euro
    falls zve < 17443 als Euro -> 100 als Euro
    sonst -> 500 als Euro
}

prüfe "Knotenpunkte" {
    testfall "Zone 1" { estGrundtarif(12096 als Euro) == 0 als Euro }
    testfall "Zone 2" { estGrundtarif(15000 als Euro) == 100 als Euro }
}
`;
        const frs = await foldingOf(src);
        // Mindestens: Doc-Kommentar (Comment), wähle-Block, prüfe-Block
        expect(frs.length).toBeGreaterThanOrEqual(3);
        expect(frs.some((f) => f.kind === FoldingRangeKind.Comment)).toBe(true);
    });
});
