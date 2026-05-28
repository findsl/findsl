/**
 * Tests für den Signature-Help-Provider. Cursor-Position via `‸`-Marker;
 * geprüft werden Label, Parameter-Offsets, aktiver Parameter,
 * Builtins, Datensatz-Konstruktoren, Cross-Modul und Doc/Quelle.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { SignatureHelp } from 'vscode-languageserver';

const MARKER = '‸';

async function sigIn(
    sources: Record<string, string>, main: string,
): Promise<SignatureHelp | undefined> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const docs = Object.entries(sources).map(([n, s]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(
            s.replace(MARKER, ''), URI.parse(`file:///${n}.findsl`),
        ),
    );
    for (const d of docs) services.shared.workspace.LangiumDocuments.addDocument(d);
    await services.shared.workspace.DocumentBuilder.build(docs, { validation: false });
    const doc = docs.find((d) => d.uri.path.endsWith(`/${main}.findsl`))!;
    const offset = sources[main].indexOf(MARKER);
    if (offset < 0) throw new Error(`Kein ${MARKER} in "${main}".`);
    const position = doc.textDocument.positionAt(offset);
    return services.lsp.SignatureHelp!.provideSignatureHelp(doc, {
        textDocument: { uri: doc.uri.toString() }, position,
    });
}

const sig = (src: string) => sigIn({ m: src }, 'm');

describe('SignatureHelp: lokale Funktionen', () => {
    it('zeigt Label, Parameter und aktiven Parameter (Position 0)', async () => {
        const h = await sig(`fn est(zve: Euro, art: Tarifart): Euro = 0 als Euro
fn r(): Euro = est(‸)
`);
        expect(h).toBeDefined();
        const s = h!.signatures[0];
        expect(s.label).toBe('fn est(zve: Euro, art: Tarifart): Euro');
        expect(s.parameters).toHaveLength(2);
        expect(h!.activeParameter).toBe(0);
        // Offsets zeigen exakt auf die Parameter-Substrings.
        const [a, b] = s.parameters![0].label as [number, number];
        expect(s.label.slice(a, b)).toBe('zve: Euro');
        const [c, d] = s.parameters![1].label as [number, number];
        expect(s.label.slice(c, d)).toBe('art: Tarifart');
    });

    it('aktiver Parameter nach Komma = 1', async () => {
        const h = await sig(`fn est(zve: Euro, art: Tarifart): Euro = 0 als Euro
fn r(): Euro = est(60.000, ‸)
`);
        expect(h!.activeParameter).toBe(1);
    });

    it('Cursor im ersten Argument = Parameter 0', async () => {
        const h = await sig(`fn est(zve: Euro, art: Tarifart): Euro = 0 als Euro
fn r(): Euro = est(60‸.000, Grundtarif)
`);
        expect(h!.activeParameter).toBe(0);
    });

    it('Default-Parameter wird mit "= …" gekennzeichnet', async () => {
        const h = await sig(`fn f(x: Euro, y: Euro = 0 als Euro): Euro = x
fn r(): Euro = f(‸)
`);
        expect(h!.signatures[0].label).toBe('fn f(x: Euro, y: Euro = …): Euro');
    });
});

describe('SignatureHelp: Builtins & Konstruktoren', () => {
    // (Entfernt 2026-05-18: freie Builtin-Funktion `abrundenEuro` gibt es
    // nicht mehr — § 11.1 ist die parameterlose Methode `.abrunden()`.
    // Methoden-Builtins haben — wie § 11.2-Listenmethoden — keine eigene
    // SignatureHelp; Parität gewahrt.)

    it('Datensatz-Konstruktor', async () => {
        const h = await sig(`datensatz Fall(betrag: Euro, satz: Prozent)
fn f(): Fall = Fall(1 als Euro, ‸)
`);
        const s = h!.signatures[0];
        expect(s.label).toBe('Fall(betrag: Euro, satz: Prozent)');
        expect(h!.activeParameter).toBe(1);
    });
});

describe('SignatureHelp: Cross-Modul & Doku', () => {
    it('importierte Funktion wird aufgelöst', async () => {
        const h = await sigIn({
            lib: `fn kern(z: Euro): Euro = z
`,
            app: `verwende {kern} aus "./lib"
fn f(): Euro = kern(‸)
`,
        }, 'app');
        expect(h!.signatures[0].label).toBe('fn kern(z: Euro): Euro');
    });

    it('Doc-Kommentar und @Quelle erscheinen in documentation', async () => {
        const h = await sig(`--
Datei-Dokumentation.
--

--
Tariflicher Grundbetrag.
--
@Quelle("§ 32a EStG")
fn estGrundtarif(zve: Euro): Euro = 0 als Euro
fn r(): Euro = estGrundtarif(‸)
`);
        const docu = h!.signatures[0].documentation;
        const text = typeof docu === 'string' ? docu : docu?.value ?? '';
        expect(text).toContain('Tariflicher Grundbetrag');
        expect(text).toContain('§ 32a EStG');
    });

    it('kein Aufruf an der Cursor-Position → undefined', async () => {
        const h = await sig(`konst K: Euro = 1 als Euro‸
`);
        expect(h).toBeUndefined();
    });
});

describe('SignatureHelp: Builtin-Methoden (SPEC § 11)', () => {
    it('.höchstens(grenze) auf Euro — Parameter + Doc + Quelle', async () => {
        const h = await sig(`konst BETRAG: Euro = 100
konst R: Euro = BETRAG.höchstens(‸)
`);
        expect(h).toBeDefined();
        const s = h!.signatures[0];
        expect(s.label).toContain('grenze');
        expect(s.parameters).toHaveLength(1);
        expect(h!.activeParameter).toBe(0);
        const docu = s.documentation;
        const text = typeof docu === 'string' ? docu : docu?.value ?? '';
        expect(text).toContain('Minimum');
        expect(text).toContain('§ 11.6');
    });

    it('.abrundenAuf(vielfaches) auf EuroCent', async () => {
        const h = await sig(`konst B: EuroCent = 12.345,67
konst R: EuroCent = B.abrundenAuf(‸)
`);
        expect(h).toBeDefined();
        expect(h!.signatures[0].label).toContain('vielfaches');
        expect(h!.activeParameter).toBe(0);
    });

    it('.zusammenfassen(start, f) auf Liste<T> — zwei Parameter, active=1', async () => {
        const h = await sig(`konst XS: Liste<Ganzzahl> = [1, 2, 3]
konst R: Ganzzahl = XS.zusammenfassen(0, ‸)
`);
        expect(h).toBeDefined();
        const s = h!.signatures[0];
        expect(s.parameters).toHaveLength(2);
        expect(h!.activeParameter).toBe(1);
        expect(s.label).toMatch(/start.*f/);
    });

    it('.beginntMit auf Text', async () => {
        const h = await sig(`konst S: Text = "Hallo"
konst B: Wahrheitswert = S.beginntMit(‸)
`);
        expect(h).toBeDefined();
        expect(h!.signatures[0].label).toContain('prefix');
    });

    it('.abrunden auf ParenChain `(x als EuroCent).abrunden()` — keine Argumente, kein Sig', async () => {
        // `.abrunden()` ist parameterlos → Signature-Help sinnvoll nicht
        // anbietbar; muss aber sauber undefined liefern, nicht werfen.
        const h = await sig(`konst R: Euro = (12,34 als EuroCent).abrunden(‸)
`);
        // Parameterlose Aufrufe: kein Parameter, aber Provider darf
        // entweder undefined oder einen leeren Sig liefern.
        if (h) expect(h.signatures[0].parameters?.length ?? 0).toBe(0);
    });

    it('Unbekannte Methode auf passendem Typ → undefined', async () => {
        const h = await sig(`konst E: Euro = 100
konst R: Euro = E.quatschMethode(‸)
`);
        expect(h).toBeUndefined();
    });
});
