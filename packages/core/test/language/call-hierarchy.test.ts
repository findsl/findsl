/**
 * Tests für den Call-Hierarchy-Provider: prepare (Cursor → Funktion),
 * incomingCalls (wer ruft) und outgoingCalls (was wird gerufen) —
 * inkl. Cross-Modul, Rekursion und Ignorieren von Builtins/Konstruktoren.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type {
    CallHierarchyItem,
    CallHierarchyIncomingCall,
    CallHierarchyOutgoingCall,
} from 'vscode-languageserver';

async function setup(sources: Record<string, string>) {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const docs = Object.entries(sources).map(([name, src]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(
            src, URI.parse(`file:///${name}.findsl`),
        ),
    );
    for (const d of docs) services.shared.workspace.LangiumDocuments.addDocument(d);
    await services.shared.workspace.DocumentBuilder.build(docs, { validation: false });
    const provider = services.lsp.CallHierarchyProvider!;

    const prepare = async (
        moduleName: string, locator: string, delta = 0,
    ): Promise<CallHierarchyItem | undefined> => {
        const doc = docs.find((d) => d.uri.path.endsWith(`/${moduleName}.findsl`))!;
        const idx = sources[moduleName].indexOf(locator);
        if (idx < 0) throw new Error(`Locator "${locator}" nicht gefunden.`);
        const position = doc.textDocument.positionAt(idx + delta);
        const items = await provider.prepareCallHierarchy(doc, {
            textDocument: { uri: doc.uri.toString() }, position,
        });
        return items?.[0];
    };

    const incoming = (item: CallHierarchyItem) =>
        provider.incomingCalls({ item }) as Promise<CallHierarchyIncomingCall[] | undefined>;
    const outgoing = (item: CallHierarchyItem) =>
        provider.outgoingCalls({ item }) as Promise<CallHierarchyOutgoingCall[] | undefined>;

    return { prepare, incoming, outgoing };
}

describe('Call-Hierarchy: prepare', () => {
    it('Cursor auf fn-Decl liefert das Funktions-Item', async () => {
        const { prepare } = await setup({
            m: `fn estGrundtarif(zve: Euro): Euro = 0 als Euro
`,
        });
        const item = await prepare('m', 'estGrundtarif(zve');
        expect(item).toBeDefined();
        expect(item!.name).toBe('estGrundtarif');
        expect(item!.detail).toBe('(zve: Euro): Euro');
    });

    it('Cursor auf Aufruf-Stelle liefert die gerufene Funktion', async () => {
        const { prepare } = await setup({
            m: `fn b(x: Euro): Euro = x
fn a(x: Euro): Euro = b(x)
`,
        });
        const item = await prepare('m', '= b(x)', 2);
        expect(item!.name).toBe('b');
    });

    it('Cursor auf Nicht-Funktion → kein Item', async () => {
        const { prepare } = await setup({
            m: `konst K: Euro = 1 als Euro
`,
        });
        expect(await prepare('m', 'K: Euro')).toBeUndefined();
    });
});

describe('Call-Hierarchy: incoming', () => {
    it('findet alle Aufrufer mit allen Aufrufstellen', async () => {
        const { prepare, incoming } = await setup({
            m: `fn b(x: Euro): Euro = x
fn a(x: Euro): Euro = b(x) + b(x)
`,
        });
        const b = await prepare('m', 'fn b(x: Euro)', 3);
        const calls = await incoming(b!);
        expect(calls).toHaveLength(1);
        expect(calls![0].from.name).toBe('a');
        expect(calls![0].fromRanges).toHaveLength(2);
    });

    it('Cross-Modul: Aufrufer im importierenden Modul', async () => {
        const { prepare, incoming } = await setup({
            lib: `fn kern(z: Euro): Euro = z
`,
            app: `verwende {kern} aus "./lib"
fn nutzt(z: Euro): Euro = kern(z)
`,
        });
        const kern = await prepare('lib', 'fn kern(z', 3);
        const calls = await incoming(kern!);
        expect(calls).toHaveLength(1);
        expect(calls![0].from.name).toBe('nutzt');
        expect(calls![0].from.uri).toContain('app.findsl');
    });

    it('Rekursion: Funktion ruft sich selbst', async () => {
        const { prepare, incoming } = await setup({
            m: `fn fak(n: Ganzzahl): Ganzzahl = fak(n)
`,
        });
        const fak = await prepare('m', 'fn fak(n', 3);
        const calls = await incoming(fak!);
        expect(calls).toHaveLength(1);
        expect(calls![0].from.name).toBe('fak');
    });
});

describe('Call-Hierarchy: outgoing', () => {
    it('listet gerufene Funktionen, ignoriert Builtins/Konstruktoren', async () => {
        const { prepare, outgoing } = await setup({
            m: `datensatz D(w: Euro)
fn b(x: Euro): Euro = x
fn c(x: Euro): Euro = x
fn haupt(x: EuroCent): D = D(w = abrundenEuro(b(x als Euro) + c(x als Euro)))
`,
        });
        const haupt = await prepare('m', 'fn haupt(x', 3);
        const calls = await outgoing(haupt!);
        const targets = (calls ?? []).map((c) => c.to.name).sort();
        expect(targets).toEqual(['b', 'c']);   // nicht D, nicht abrundenEuro
    });

    it('Cross-Modul-Aufruf erscheint als ausgehender Call', async () => {
        const { prepare, outgoing } = await setup({
            lib: `fn kern(z: Euro): Euro = z
`,
            app: `verwende {kern} aus "./lib"
fn nutzt(z: Euro): Euro = kern(z) + kern(z)
`,
        });
        const nutzt = await prepare('app', 'fn nutzt(z', 3);
        const calls = await outgoing(nutzt!);
        expect(calls).toHaveLength(1);
        expect(calls![0].to.name).toBe('kern');
        expect(calls![0].to.uri).toContain('lib.findsl');
        expect(calls![0].fromRanges).toHaveLength(2);
    });
});
