/**
 * Completion-Provider-Tests.
 *
 * Der Cursor wird per Marker `‸` im Quelltext gesetzt; der Marker wird vor
 * dem Parsen entfernt und die Position aus seinem Offset rekonstruiert.
 * Geprüft werden die vier Kontext-Buckets (Ausdruck, Typ, Member, Import)
 * plus die weiterhin von der Basisklasse gelieferten Keywords.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import { CompletionItemKind, type CompletionItem } from 'vscode-languageserver';

const MARKER = '‸';

async function completeIn(
    sources: Record<string, string>, main: string,
): Promise<CompletionItem[]> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const docs = Object.entries(sources).map(([name, src]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(
            src.replace(MARKER, ''), URI.parse(`file:///${name}.findsl`),
        ),
    );
    for (const d of docs) services.shared.workspace.LangiumDocuments.addDocument(d);
    await services.shared.workspace.DocumentBuilder.build(docs, { validation: false });

    const mainDoc = docs.find((d) => d.uri.path.endsWith(`/${main}.findsl`))!;
    const offset = sources[main].indexOf(MARKER);
    if (offset < 0) throw new Error(`Kein ${MARKER}-Marker im Modul "${main}".`);
    const position = mainDoc.textDocument.positionAt(offset);

    const list = await services.lsp.CompletionProvider!.getCompletion(mainDoc, {
        textDocument: { uri: mainDoc.uri.toString() },
        position,
    });
    return list?.items ?? [];
}

const labels = (items: CompletionItem[]): string[] => items.map((i) => i.label);

async function complete(source: string): Promise<CompletionItem[]> {
    return completeIn({ m: source }, 'm');
}

describe('Completion: Ausdrucks-Position', () => {
    it('schlägt Parameter, Top-Level-Symbole und Builtins vor', async () => {
        const items = await complete(`konst GFB: Euro = 12.096 als Euro
fn tarif(zve: Euro): Euro = ‸
`);
        const l = labels(items);
        expect(l).toContain('zve');            // Parameter
        expect(l).toContain('GFB');            // Top-Level-Konstante
        expect(l).toContain('tarif');          // Funktion selbst (Rekursion)
        expect(l).toContain('abrundenEuro');   // Builtin-Funktion
        expect(l).toContain('Grundtarif');     // Builtin-Aufzählungs-Wert
    });

    it('schlägt lokale var-Bindung und eigene Aufzählungs-Werte vor', async () => {
        const items = await complete(`aufzählung Ampel { Rot, Gelb, Grün }
fn f(x: Ganzzahl): Ganzzahl {
    var y: Ganzzahl = x
    ‸
}
`);
        const l = labels(items);
        expect(l).toContain('y');      // var-Bindung
        expect(l).toContain('x');      // Parameter
        expect(l).toContain('Rot');    // eigener Aufzählungs-Wert
    });

    it('liefert Builtin-Funktion mit Signatur als detail', async () => {
        const items = await complete(`fn f(b: EuroCent): Euro = ‸
`);
        const ar = items.find((i) => i.label === 'abrundenEuro');
        expect(ar?.detail).toBe('fn abrundenEuro(betrag: EuroCent): Euro');
    });
});

describe('Completion: Typ-Position', () => {
    it('schlägt Builtin-Primitive, Builtin-Aufzählung und lokalen Datensatz vor', async () => {
        const items = await complete(`datensatz Fall(betrag: Euro)
fn f(x: ‸): Euro = 0 als Euro
`);
        const l = labels(items);
        expect(l).toContain('Euro');
        expect(l).toContain('Prozent');
        expect(l).toContain('Tarifart');   // Builtin-Aufzählung
        expect(l).toContain('Fall');       // lokaler Datensatz
    });

    it('bietet in Typ-Position KEINE Builtin-Funktionen an', async () => {
        const items = await complete(`konst K: ‸ = 0
`);
        expect(labels(items)).not.toContain('abrundenEuro');
    });
});

describe('Completion: Member-Position', () => {
    it('schlägt nach `empfaenger.` die Datensatz-Felder vor', async () => {
        const items = await complete(`datensatz Fall(betrag: Euro, satz: Prozent)
fn f(fall: Fall): Euro = fall.‸
`);
        const l = labels(items);
        expect(l).toContain('betrag');
        expect(l).toContain('satz');
        expect(l).not.toContain('fall');   // kein Symbol-Leak in Member-Position
    });

    it('folgt verschachtelten Pfaden (a.b.)', async () => {
        const items = await complete(`datensatz Innen(wert: Euro)
datensatz Aussen(innen: Innen)
fn f(a: Aussen): Euro = a.innen.‸
`);
        expect(labels(items)).toContain('wert');
    });

    it('löst Felder über Cross-Modul-Datensatz auf', async () => {
        const items = await completeIn({
            lib: `datensatz Person(name: Text, alter: Ganzzahl)
`,
            app: `verwende {Person} aus "./lib"
fn f(p: Person): Text = p.‸
`,
        }, 'app');
        const l = labels(items);
        expect(l).toContain('name');
        expect(l).toContain('alter');
    });

    it('liefert nichts bei unbekanntem Empfänger (kein Falsch-Vorschlag)', async () => {
        const items = await complete(`fn f(x: Euro): Euro = unbekannt.‸
`);
        expect(items).toHaveLength(0);
    });
});

describe('Completion: Import-Item-Position', () => {
    it('schlägt exportierte Symbole des Quell-Moduls vor', async () => {
        const items = await completeIn({
            lib: `konst SATZ: Prozent = 42%
fn echt(z: Euro): Euro = z
datensatz Akte(nr: Ganzzahl)
`,
            app: `verwende { ‸ } aus "./lib"
`,
        }, 'app');
        const l = labels(items);
        expect(l).toContain('echt');
        expect(l).toContain('SATZ');
        expect(l).toContain('Akte');
    });

    it('bietet in Import-Position keine Builtins an', async () => {
        const items = await completeIn({
            lib: `fn echt(z: Euro): Euro = z
`,
            app: `verwende { ‸ } aus "./lib"
`,
        }, 'app');
        const l = labels(items);
        expect(l).not.toContain('Euro');
        expect(l).not.toContain('abrundenEuro');
    });
});

describe('Completion: abbruch-Snippet', () => {
    it('Ausdrucks-Position bietet das abbruch-Snippet an', async () => {
        const items = await complete(`fn f(zve: Euro): Euro = ‸
`);
        const snip = items.find((i) => i.label === 'abbruch(…)');
        expect(snip).toBeDefined();
        expect(snip!.insertText).toBe('abbruch("$1")');
        expect(snip!.kind).toBe(CompletionItemKind.Snippet);
    });
});

describe('Completion: Keywords (Basisklasse bleibt aktiv)', () => {
    it('schlägt auf Top-Level-Ebene Deklarations-Keywords vor', async () => {
        const items = await complete(`‸
`);
        const l = labels(items);
        // Mindestens eines der Top-Level-Keywords muss von super kommen.
        expect(l.some((x) => ['konst', 'fn', 'datensatz', 'aufzählung', 'prüfe', 'verwende'].includes(x)))
            .toBe(true);
    });
});

describe('Completion: Listen-Methoden (§ 11.2) bei `liste.`', () => {
    it('bietet die 12 Methoden auf einem Liste<T>-Parameter', async () => {
        const items = await complete('fn F(xs: Liste<Ganzzahl>): Ganzzahl = xs.‸\n');
        const l = labels(items);
        for (const m of [
            'länge', 'leer', 'kopf', 'rest', 'bei', 'enthält', 'zuordnen',
            'filtern', 'zusammenfassen', 'zähle', 'summe', 'größtes', 'kleinstes',
        ]) {
            expect(l).toContain(m);
        }
        const z = items.find((i) => i.label === 'zuordnen');
        expect(z?.kind).toBe(CompletionItemKind.Method);
        expect(z?.insertText).toBe('zuordnen(');
        const lng = items.find((i) => i.label === 'länge');
        expect(lng?.insertText).toBe('länge');           // Eigenschaft, kein "("
    });

    it('bietet sie auch auf einer var: Bereich<Ganzzahl>-Bindung', async () => {
        const items = await complete(
            'fn F(): Ganzzahl = {\n  var r: Bereich<Ganzzahl> = 1 bis 5\n  r.‸\n}\n',
        );
        expect(labels(items)).toContain('summe');
    });

    it('Record-Empfänger weiterhin Felder (keine Listen-Methoden)', async () => {
        const items = await complete(
            'datensatz P(x: Ganzzahl, y: Ganzzahl)\nfn F(p: P): Ganzzahl = p.‸\n',
        );
        const l = labels(items);
        expect(l).toContain('x');
        expect(l).toContain('y');
        expect(l).not.toContain('zuordnen');
    });
});
