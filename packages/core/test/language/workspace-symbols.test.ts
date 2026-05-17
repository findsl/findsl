/**
 * Tests für die Workspace-Symbol-Suche (Cmd+T). Mehrere Module werden in
 * den Workspace gelegt; geprüft werden projektweite Symbole, Query-Filter,
 * SymbolKind, containerName und Mehrmodul-Abdeckung.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import { SymbolKind, type WorkspaceSymbol } from 'vscode-languageserver';

async function symbols(
    sources: Record<string, string>, query = '',
): Promise<WorkspaceSymbol[]> {
    const services = createFindslServices(NodeFileSystem);
    const docs = Object.entries(sources).map(([name, src]) =>
        services.Findsl.shared.workspace.LangiumDocumentFactory.fromString(
            src, URI.parse(`file:///${name}.findsl`),
        ),
    );
    for (const d of docs) services.Findsl.shared.workspace.LangiumDocuments.addDocument(d);
    await services.Findsl.shared.workspace.DocumentBuilder.build(docs, { validation: false });

    const provider = services.shared.lsp.WorkspaceSymbolProvider!;
    return provider.getSymbols({ query });
}

const names = (s: WorkspaceSymbol[]): string[] => s.map((x) => x.name);

describe('Workspace-Symbol-Suche', () => {
    it('findet Top-Level-Decls über mehrere Module', async () => {
        const s = await symbols({
            tarif: `@Quelle("§ 32a EStG")
konst GFB: Euro = 12.096 als Euro
fn estGrundtarif(zve: Euro): Euro = 0 als Euro
`,
            lohn: `datensatz Freibetraege(anp: Euro, sap: Euro)
aufzählung Steuerklasse { I, II }
`,
        });
        const n = names(s);
        expect(n).toContain('GFB');
        expect(n).toContain('estGrundtarif');
        expect(n).toContain('Freibetraege');
        expect(n).toContain('Steuerklasse');
    });

    it('liefert korrekte SymbolKind und containerName', async () => {
        const s = await symbols({
            m: `konst K: Euro = 1 als Euro
fn f(): Euro = K
datensatz D(feld: Euro)
aufzählung E { A, B }
`,
        });
        const byName = (nm: string) => s.find((x) => x.name === nm)!;
        expect(byName('K').kind).toBe(SymbolKind.Constant);
        expect(byName('f').kind).toBe(SymbolKind.Function);
        expect(byName('D').kind).toBe(SymbolKind.Struct);
        expect(byName('E').kind).toBe(SymbolKind.Enum);
        // Anzeige-Identität = Dateiname ohne `.findsl` (gemeinsame Basis `/`).
        expect(byName('K').containerName).toBe('m');
        // Feld trägt den qualifizierten Datensatz als Container.
        expect(byName('feld').kind).toBe(SymbolKind.Field);
        expect(byName('feld').containerName).toBe('m.D');
        // Enum-Wert.
        expect(byName('A').kind).toBe(SymbolKind.EnumMember);
        expect(byName('A').containerName).toBe('m.E');
    });

    it('Query filtert (Fuzzy, case-insensitive)', async () => {
        const s = await symbols({
            m: `konst Grundfreibetrag: Euro = 1 als Euro
konst Kinderfreibetrag: Euro = 2 als Euro
fn tarif(): Euro = Grundfreibetrag
`,
        }, 'freibetrag');
        const n = names(s);
        expect(n).toContain('Grundfreibetrag');
        expect(n).toContain('Kinderfreibetrag');
        expect(n).not.toContain('tarif');
    });

    it('leere Query liefert alle navigierbaren Symbole', async () => {
        const s = await symbols({
            m: `konst K: Euro = 1 als Euro
prüfe "P" { testfall "t" { K == 1 als Euro } }
`,
        });
        const n = names(s);
        expect(n).toContain('K');
        expect(n).toContain('P');                 // prüfe-Block als Namespace
    });

    it('Location zeigt auf den Namen-Token', async () => {
        const src = `konst Zielwert: Euro = 1 als Euro
`;
        const s = await symbols({ m: src });
        const sym = s.find((x) => x.name === 'Zielwert')!;
        expect('range' in sym.location).toBe(true);
        const loc = sym.location as { uri: string; range: { start: { line: number } } };
        expect(loc.uri).toContain('m.findsl');
        expect(loc.range.start.line).toBe(0);     // 0-basiert: erste Zeile
    });
});
