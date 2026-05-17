/**
 * Visuelle Markierung modul-interner Symbole (`_`-Präfix, SPEC § 8.4):
 *   - SemanticTokens: Custom-Modifier `internal` an Deklaration UND
 *     Referenzen interner Top-Level-Decls (Editor-Färbung).
 *   - DocumentSymbol: `· intern`-Suffix im `detail` (Outline/Breadcrumbs).
 * Öffentliche Symbole bleiben unberührt.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { SemanticTokensDecoder } from 'langium/lsp';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { DocumentSymbol } from 'vscode-languageserver';

interface Tok { tokenType: string; tokenModifiers: number; text: string; }

const SRC = `fn _Intern(x: Euro): Euro = x + x

fn Pub(x: Euro): Euro = _Intern(x)

datensatz _Geheim(a: Euro)

datensatz Offen(b: Euro)

fn NutztTyp(d: _Geheim): Euro = d.a
`;

async function analyze(): Promise<{ toks: Tok[]; internMask: number; syms: DocumentSymbol[] }> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        SRC, URI.parse('file:///iv.findsl'),
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: false });

    const stp = services.lsp.SemanticTokenProvider!;
    const result = await stp.semanticHighlight(doc, { textDocument: { uri: doc.uri.toString() } });
    const toks = SemanticTokensDecoder.decode(result, stp.tokenTypes, doc) as Tok[];
    const internMask = (stp as unknown as { tokenModifiers: Record<string, number> })
        .tokenModifiers['internal'];

    const syms = await services.lsp.DocumentSymbolProvider!.getSymbols(doc, {
        textDocument: { uri: doc.uri.toString() },
    });
    return { toks, internMask, syms };
}

describe('SemanticTokens: internal-Modifier', () => {
    it('Legende enthält `internal` mit eigenem Bit', async () => {
        const { internMask } = await analyze();
        expect(internMask).toBe(1 << 10);
    });

    it('interne fn-Deklaration trägt `internal`, öffentliche nicht', async () => {
        const { toks, internMask } = await analyze();
        const intern = toks.find((t) => t.text === '_Intern' && t.tokenType === 'function');
        const pub = toks.find((t) => t.text === 'Pub' && t.tokenType === 'function');
        expect(intern).toBeDefined();
        expect((intern!.tokenModifiers & internMask) !== 0).toBe(true);
        expect(pub).toBeDefined();
        expect((pub!.tokenModifiers & internMask) !== 0).toBe(false);
    });

    it('Referenz auf interne fn trägt ebenfalls `internal`', async () => {
        const { toks, internMask } = await analyze();
        // Vorkommen von `_Intern` als CallChain-Wurzel im Body von `Pub`.
        const refs = toks.filter((t) => t.text === '_Intern' && t.tokenType === 'function');
        expect(refs.length).toBeGreaterThanOrEqual(2); // Decl + Referenz
        expect(refs.every((r) => (r.tokenModifiers & internMask) !== 0)).toBe(true);
    });

    it('interner datensatz: Decl und Typ-Referenz tragen `internal`', async () => {
        const { toks, internMask } = await analyze();
        const geheim = toks.filter((t) => t.text === '_Geheim');
        const offen = toks.find((t) => t.text === 'Offen' && t.tokenType === 'class');
        expect(geheim.length).toBeGreaterThanOrEqual(2); // Decl + Typ in NutztTyp
        expect(geheim.every((g) => (g.tokenModifiers & internMask) !== 0)).toBe(true);
        expect((offen!.tokenModifiers & internMask) !== 0).toBe(false);
    });
});

describe('DocumentSymbol: ·intern-Suffix in der Outline', () => {
    it('interne fn/datensatz markiert, öffentliche nicht', async () => {
        const { syms } = await analyze();
        const find = (n: string) => syms.find((s) => s.name === n)!;
        // Markierung als Präfix direkt hinter dem Namen (sichtbar, nicht
        // am Ende einer langen Signatur abgeschnitten).
        expect(find('_Intern').detail?.startsWith('🔒 intern · ')).toBe(true);
        expect(find('Pub').detail?.includes('intern')).toBe(false);
        expect(find('_Geheim').detail?.startsWith('🔒 intern · ')).toBe(true);
        expect(find('Offen').detail?.includes('intern')).toBe(false);
    });
});
