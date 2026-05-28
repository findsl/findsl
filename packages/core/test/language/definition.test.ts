/**
 * Tests für den Go-to-Definition-Provider. Wir parsen Snippets, lokalisieren
 * Positionen über `indexOf`, rufen `getDefinition` direkt und verifizieren
 * URI + Range des LocationLink-Targets.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { LocationLink } from 'vscode-languageserver';

async function defAt(source: string, locator: string): Promise<LocationLink[] | undefined> {
    return defInModules({ 'def': source }, 'def', locator);
}

async function defInModules(
    sources: Record<string, string>,
    mainModule: string,
    locator: string,
): Promise<LocationLink[] | undefined> {
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
    const result = await services.lsp.DefinitionProvider!.getDefinition(mainDoc, {
        textDocument: { uri: mainDoc.uri.toString() },
        position,
    });
    return result === null ? undefined : result;
}

describe('Go-to-Definition: lokale Decls', () => {
    it('Konstante in Expression springt zur Konst-Decl', async () => {
        const src = `konst GFB: Euro = 12.096 als Euro
konst R: Euro = GFB + 1
`;
        const links = await defAt(src, 'GFB +');
        expect(links).toHaveLength(1);
        const target = links![0];
        expect(target.targetUri).toMatch(/def\.findsl$/);
        // Target-Range: die Konst-Decl in Zeile 1 (0-indiziert: 0).
        expect(target.targetRange.start.line).toBe(0);
    });

    it('Funktions-Aufruf springt zur Funktions-Decl', async () => {
        const src = `fn verdoppeln(x: Euro): Euro = x * 2
konst R: Euro = verdoppeln(50 als Euro)
`;
        const links = await defAt(src, 'verdoppeln(50');
        expect(links).toHaveLength(1);
        expect(links![0].targetRange.start.line).toBe(0);
    });

    it('Datensatz-Konstruktor springt zur Datensatz-Decl', async () => {
        const src = `datensatz Pt(x: Ganzzahl, y: Ganzzahl)
konst P: Pt = Pt(1, 2)
`;
        const links = await defAt(src, 'Pt(1,');
        expect(links).toHaveLength(1);
        expect(links![0].targetRange.start.line).toBe(0);
    });

    it('Cursor auf Decl-Stelle selbst — Self-Link', async () => {
        const src = `konst GFB: Euro = 12.096 als Euro
`;
        const links = await defAt(src, 'GFB');
        expect(links).toHaveLength(1);
        expect(links![0].targetRange.start.line).toBe(0);
    });
});

describe('Go-to-Definition: Field-Access', () => {
    it('Field-Access springt zur Field-Decl im Datensatz', async () => {
        const src = `datensatz Pt(x: Ganzzahl, y: Ganzzahl)
konst P: Pt = Pt(1, 2)
konst R: Ganzzahl = P.x
`;
        const links = await defAt(src, 'x\n');
        expect(links).toHaveLength(1);
        // Field x ist in der Datensatz-Decl (Zeile 0, 0-indexed)
        expect(links![0].targetRange.start.line).toBe(0);
    });

    it('Verschachtelter Field-Zugriff', async () => {
        const src = `datensatz Adresse(stadt: Text)
datensatz Person(adresse: Adresse)
konst P: Person = Person(adresse = Adresse(stadt = "Berlin"))
konst R: Text = P.adresse.stadt
`;
        const links = await defAt(src, 'stadt\n');
        expect(links).toHaveLength(1);
        // Field stadt in Adresse (Zeile 0)
        expect(links![0].targetRange.start.line).toBe(0);
    });

    it('Field-Zugriff auf Param-Typ', async () => {
        const src = `datensatz Pt(x: Ganzzahl)
fn f(p: Pt): Ganzzahl = p.x
`;
        const links = await defAt(src, 'x\n');
        expect(links).toHaveLength(1);
        expect(links![0].targetRange.start.line).toBe(0);
    });

    it('Field-Zugriff aus Lambda-Param in HOF-Trailing-Syntax (Issue #65)', async () => {
        // Spiegelt das est.findsl-Beispiel: `kinder.zuordnen { k -> k.faktor }`
        const src = `datensatz Kind(faktor: Ganzzahl, anteil: Prozent)

fn Summe(kinder: Liste<Kind>): Ganzzahl =
    kinder.zuordnen( { k -> k.faktor } ).summe()
`;
        const links = await defAt(src, 'faktor }');
        expect(links).toHaveLength(1);
        // Field faktor ist in der Datensatz-Decl (Zeile 0).
        expect(links![0].targetRange.start.line).toBe(0);
    });

    it('Field-Zugriff aus für-jeden-Iter-Variable (Issue #65 RC3)', async () => {
        const src = `datensatz Punkt(x: Ganzzahl, y: Ganzzahl)
fn XSumme(ps: Liste<Punkt>): Liste<Ganzzahl> =
    für jeden p aus ps {
        p.x
    }
`;
        const links = await defAt(src, 'x\n');
        expect(links).toHaveLength(1);
        expect(links![0].targetRange.start.line).toBe(0);
    });
});

describe('Go-to-Definition: Cross-Modul', () => {
    it('Importiertes Symbol springt in das Quell-Dokument', async () => {
        const lib = `konst GFB: Euro = 12.096 als Euro
`;
        const app = `verwende {GFB} aus "./lib"
konst R: Euro = GFB + 1
`;
        const links = await defInModules({ lib, app }, 'app', 'GFB + 1');
        expect(links).toHaveLength(1);
        expect(links![0].targetUri).toMatch(/lib\.findsl$/);
        expect(links![0].targetRange.start.line).toBe(0);
    });

    it('Importierte Funktion mit Alias springt zur Original-Decl', async () => {
        const lib = `fn verdoppeln(x: Euro): Euro = x * 2
`;
        const app = `verwende {verdoppeln als doppel} aus "./lib"
konst R: Euro = doppel(50 als Euro)
`;
        const links = await defInModules({ lib, app }, 'app', 'doppel(50');
        expect(links).toHaveLength(1);
        expect(links![0].targetUri).toMatch(/lib\.findsl$/);
    });

    it('Cross-Modul Field-Access auf importierten Datensatz', async () => {
        const lib = `datensatz Fall(summe: Euro, steuer: Euro)
`;
        const app = `verwende {Fall} aus "./lib"
fn test(f: Fall): Euro = f.summe
`;
        const links = await defInModules({ lib, app }, 'app', 'summe\n');
        expect(links).toHaveLength(1);
        expect(links![0].targetUri).toMatch(/lib\.findsl$/);
    });
});

describe('Go-to-Definition: Grenzfälle', () => {
    it('Unbekannter Identifier → kein Link', async () => {
        const src = `fn f(): Ganzzahl = unbekannt
`;
        const links = await defAt(src, 'unbekannt');
        expect(links === undefined || links.length === 0).toBe(true);
    });

    it('Builtin-Funktion abrundenEuro → kein Link (kein User-Source)', async () => {
        const src = `fn f(x: EuroCent): Euro = abrundenEuro(x)
`;
        const links = await defAt(src, 'abrundenEuro(x)');
        expect(links === undefined || links.length === 0).toBe(true);
    });

    it('Builtin-Aufzählungs-Wert Grundtarif → kein Link', async () => {
        const src = `fn f(): Tarifart = Grundtarif
`;
        const links = await defAt(src, 'Grundtarif\n');
        expect(links === undefined || links.length === 0).toBe(true);
    });

    it('Cross-Modul: Modul nicht im Workspace → kein Link', async () => {
        const app = `verwende {X} aus "./nichtgeladen"
konst R: Euro = X
`;
        const links = await defInModules({ app }, 'app', 'X\n');
        expect(links === undefined || links.length === 0).toBe(true);
    });

    it('Param-Verwendung springt zur Param-Decl in der Signatur', async () => {
        const src = `fn f(zve: Euro): Euro = zve + 1 als Euro
`;
        // Cursor auf `zve` im Body
        const links = await defAt(src, 'zve + 1');
        expect(links).toHaveLength(1);
        // Param-Decl ist in der gleichen Zeile wie fn (Zeile 0)
        expect(links![0].targetRange.start.line).toBe(0);
    });
});

describe('Go-to-Definition: importierte Elemente im verwende-Block', () => {
    it('Cursor auf Source-Name im verwende-Block → Decl im Quellmodul', async () => {
        const lib = `fn kern(z: Euro): Euro = z
`;
        const app = `verwende { kern } aus "./lib"
fn r(): Euro = kern(0 als Euro)
`;
        const links = await defInModules({ lib, app }, 'app', 'kern }');
        expect(links).toBeDefined();
        expect(links).toHaveLength(1);
        // Sprung in die `lib`-Datei
        expect(links![0].targetUri).toMatch(/lib\.findsl$/);
        // Auf die fn-Decl (Zeile 0)
        expect(links![0].targetRange.start.line).toBe(0);
    });

    it('Cursor auf Alias → springt zur Source-Decl (nicht zum Alias)', async () => {
        const lib = `fn foo(z: Euro): Euro = z
`;
        const app = `verwende { foo als bar } aus "./lib"
fn r(): Euro = bar(0 als Euro)
`;
        const links = await defInModules({ lib, app }, 'app', 'bar }');
        expect(links).toBeDefined();
        expect(links).toHaveLength(1);
        expect(links![0].targetUri).toMatch(/lib\.findsl$/);
        expect(links![0].targetRange.start.line).toBe(0);
    });

    it('Cursor auf Source-Name in `Foo als Bar`-Form → ebenfalls Quell-Decl', async () => {
        const lib = `fn foo(z: Euro): Euro = z
`;
        const app = `verwende { foo als bar } aus "./lib"
fn r(): Euro = bar(0 als Euro)
`;
        const links = await defInModules({ lib, app }, 'app', 'foo als');
        expect(links).toBeDefined();
        expect(links).toHaveLength(1);
        expect(links![0].targetUri).toMatch(/lib\.findsl$/);
    });

    it('Konstante importieren → Sprung zur Konst-Decl', async () => {
        const lib = `konst GFB: Euro = 12.096 als Euro
`;
        const app = `verwende { GFB } aus "./lib"
konst R: Euro = GFB
`;
        const links = await defInModules({ lib, app }, 'app', 'GFB }');
        expect(links).toBeDefined();
        expect(links![0].targetUri).toMatch(/lib\.findsl$/);
    });

    it('Aufzählungs-Wert importieren → Sprung zur Aufzählungs-Decl', async () => {
        // Bug aus Issue #196 nachgereicht: Werte INNERHALB einer
        // aufzählung sind keine eigenen Top-Level-Decls, sondern Strings
        // in `AufzaehlungDecl.values`. Sprung zur umschließenden Decl.
        const lib = `aufzählung Fahrzeugart {
    Kraftrad,
    Pkw,
    Wohnmobil,
}
`;
        const app = `verwende { Pkw } aus "./lib"
`;
        const links = await defInModules({ lib, app }, 'app', 'Pkw }');
        expect(links).toBeDefined();
        expect(links).toHaveLength(1);
        expect(links![0].targetUri).toMatch(/lib\.findsl$/);
        // Aufzählung beginnt auf Zeile 0.
        expect(links![0].targetRange.start.line).toBe(0);
    });

    it('Aufzählungs-Wert mit Alias importieren → Sprung zur Aufzählungs-Decl', async () => {
        const lib = `aufzählung Status {
    Aktiv,
    Inaktiv,
}
`;
        const app = `verwende { Aktiv als Live } aus "./lib"
`;
        const links = await defInModules({ lib, app }, 'app', 'Live }');
        expect(links).toBeDefined();
        expect(links![0].targetUri).toMatch(/lib\.findsl$/);
    });
});

describe('Go-to-Definition: Aufzählungs-Wert als Code-Referenz', () => {
    it('Lokal definiertes Enum, Wert im fn-Body → Sprung zur Aufzählungs-Decl', async () => {
        const src = `aufzählung Farbe { Rot, Grün, Blau }
fn f(c: Farbe): Ganzzahl = wähle (c) {
    falls Rot -> 1
    sonst     -> 0
}
`;
        const links = await defAt(src, 'Rot -> 1');
        expect(links).toBeDefined();
        expect(links).toHaveLength(1);
        // Aufzählung in Zeile 0
        expect(links![0].targetRange.start.line).toBe(0);
    });

    it('Importierter Enum-Wert in fn-Body → Sprung zur Aufzählung im Quellmodul', async () => {
        // Reproduziert den Bug aus dem kraftst-Beispiel:
        //   falls f.antrieb == Elektro …
        const lib = `aufzählung Antrieb { Fremdzuendung, Selbstzuendung, Elektro }
`;
        const app = `verwende { Antrieb, Elektro } aus "./lib"
fn f(a: Antrieb): Ganzzahl = wähle {
    falls a == Elektro -> 1
    sonst              -> 0
}
`;
        const links = await defInModules({ lib, app }, 'app', 'Elektro -> 1');
        expect(links).toBeDefined();
        expect(links![0].targetUri).toMatch(/lib\.findsl$/);
        expect(links![0].targetRange.start.line).toBe(0);
    });

    it('Importierter Enum-Wert im Wert-Binding → Sprung zur Aufzählung', async () => {
        const lib = `aufzählung Stand { Aktiv, Pause }
`;
        const app = `verwende { Stand, Aktiv } aus "./lib"
konst K: Stand = Aktiv
`;
        const links = await defInModules({ lib, app }, 'app', 'Aktiv\n');
        expect(links).toBeDefined();
        expect(links![0].targetUri).toMatch(/lib\.findsl$/);
    });
});
