/**
 * Tests für Go-to-Type-Definition. Cursor auf ein Symbol/eine Annotation →
 * Sprung zur `datensatz`/`aufzählung`-Decl seines Typs. Wir verifizieren
 * den Ziel-URI und den Text der `targetSelectionRange` (= Typ-Name).
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { LocationLink } from 'vscode-languageserver';

interface TdResult {
    links: LocationLink[] | undefined;
    /** Text der targetSelectionRange des ersten Links. */
    selText(): string | undefined;
}

async function typeDefIn(
    sources: Record<string, string>, main: string, locator: string, delta = 0,
): Promise<TdResult> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const docs = Object.entries(sources).map(([name, src]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(
            src, URI.parse(`file:///${name}.findsl`),
        ),
    );
    for (const d of docs) services.shared.workspace.LangiumDocuments.addDocument(d);
    await services.shared.workspace.DocumentBuilder.build(docs, { validation: false });

    const mainDoc = docs.find((d) => d.uri.path.endsWith(`/${main}.findsl`))!;
    const idx = sources[main].indexOf(locator);
    if (idx < 0) throw new Error(`Locator "${locator}" nicht gefunden.`);
    const position = mainDoc.textDocument.positionAt(idx + delta);

    const r = await services.lsp.TypeProvider!.getTypeDefinition(mainDoc, {
        textDocument: { uri: mainDoc.uri.toString() },
        position,
    });
    const links = r === null ? undefined : r;

    return {
        links,
        selText() {
            const l = links?.[0];
            if (!l) return undefined;
            const doc = docs.find((d) => d.uri.toString() === l.targetUri)!;
            return doc.textDocument.getText(l.targetSelectionRange);
        },
    };
}

const td = (source: string, locator: string, delta = 0) =>
    typeDefIn({ m: source }, 'm', locator, delta);

describe('Go-to-Type-Definition: lokale Typen', () => {
    it('Parameter → datensatz-Decl (über Field-Access-Nutzung)', async () => {
        const r = await td(`datensatz Steuerfall(betrag: Euro)
fn f(fall: Steuerfall): Euro = fall.betrag
`, 'fall.betrag');
        expect(r.links).toHaveLength(1);
        expect(r.selText()).toBe('Steuerfall');
    });

    it('var-Bindung → datensatz-Decl', async () => {
        const r = await td(`datensatz Akte(nr: Ganzzahl)
fn f(): Ganzzahl = {
    var a: Akte = Akte(nr = 1)
    a.nr
}
`, 'a.nr');
        expect(r.selText()).toBe('Akte');
    });

    it('konst → aufzählung-Decl', async () => {
        const r = await td(`aufzählung Tarifklasse { A1, A2 }
konst basis: Tarifklasse = A1
konst abgeleitet: Tarifklasse = basis
`, '= basis', 2);
        expect(r.selText()).toBe('Tarifklasse');
    });

    it('Liste<T> springt zum Element-Typ', async () => {
        const r = await td(`datensatz Posten(wert: Euro)
fn f(xs: Liste<Posten>): Liste<Posten> = xs
`, '= xs', 2);
        expect(r.selText()).toBe('Posten');
    });

    it('Nullable T? ist transparent', async () => {
        const r = await td(`datensatz Bescheid(summe: Euro)
fn f(b: Bescheid?): Bescheid? = b
`, '= b', 2);
        expect(r.selText()).toBe('Bescheid');
    });

    it('Cursor direkt auf Typ-Annotation springt zur Decl', async () => {
        const r = await td(`datensatz Steuerfall(betrag: Euro)
fn f(p: Steuerfall): Euro = 0 als Euro
`, ': Steuerfall)', 2);
        expect(r.selText()).toBe('Steuerfall');
    });

    it('Funktions-Rückgabetyp → datensatz-Decl', async () => {
        const r = await td(`datensatz Ergebnis(wert: Euro)
fn bau(): Ergebnis = Ergebnis(wert = 1 als Euro)
fn nutze(): Ergebnis = bau()
`, '= bau()', 2);
        expect(r.selText()).toBe('Ergebnis');
    });

    it('Builtin-Typ (Euro) → kein Sprung', async () => {
        const r = await td(`konst x: Euro = 1 als Euro
konst y: Euro = x
`, '= x', 2);
        expect(r.links === undefined || r.links.length === 0).toBe(true);
    });
});

describe('Go-to-Type-Definition: Cross-Modul', () => {
    it('importierter Datensatz-Parameter → Decl im Quell-Modul', async () => {
        const r = await typeDefIn({
            lib: `datensatz Person(name: Text, alter: Ganzzahl)
`,
            app: `verwende {Person} aus "./lib"
fn f(p: Person): Text = p.name
`,
        }, 'app', 'p.name');
        expect(r.links).toHaveLength(1);
        expect(r.links![0].targetUri).toContain('lib.findsl');
        expect(r.selText()).toBe('Person');
    });
});
