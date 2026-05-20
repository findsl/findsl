/**
 * Hover-Provider-Tests.
 *
 * Wir parsen kleine FinDSL-Snippets, lokalisieren eine Position über die
 * Suche nach einem Substring im Quelltext und rufen `getHoverContent`
 * direkt. So bleibt der Test deterministisch und decken sowohl die
 * Identifier-Auflösung als auch die Markdown-Formatierung ab.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { Hover } from 'vscode-languageserver';

async function hoverAt(source: string, locator: string): Promise<Hover | undefined> {
    return hoverInModules({ 'hover': source }, 'hover', locator);
}

async function hoverInModules(
    sources: Record<string, string>,
    mainModule: string,
    locator: string,
): Promise<Hover | undefined> {
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

    const mainDoc = documents.find((d) => d.uri.path.endsWith(`/${mainModule}.findsl`));
    if (!mainDoc) throw new Error(`Hauptmodul "${mainModule}" nicht in den Sources gefunden.`);

    const mainSrc = sources[mainModule];
    const offset = mainSrc.indexOf(locator);
    if (offset < 0) throw new Error(`Locator "${locator}" nicht im Quelltext gefunden.`);
    const position = mainDoc.textDocument.positionAt(offset);
    return await services.lsp.HoverProvider!.getHoverContent(mainDoc, {
        textDocument: { uri: mainDoc.uri.toString() },
        position,
    });
}

function content(h: Hover | undefined): string {
    if (!h) return '';
    const c = h.contents;
    if (typeof c === 'string')                return c;
    if ('value' in c && typeof c.value === 'string') return c.value;
    return JSON.stringify(c);
}

describe('Hover auf Konstanten', () => {
    it('Konstanten-Deklaration zeigt Signatur, Doc und Quelle', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Grundfreibetrag — steuerfreies Existenzminimum 2025.
--
@Quelle("§ 32a Absatz 1 Nr. 1 EStG")
konst GFB: Euro = 12.096
`;
        const h = await hoverAt(src, 'GFB');
        const md = content(h);
        expect(md).toContain('konst GFB: Euro');
        expect(md).toContain('Grundfreibetrag');
        expect(md).toContain('§ 32a Absatz 1 Nr. 1 EStG');
    });

    it('Hover auf Identifier in Expression zeigt die Decl-Karte', async () => {
        const src = `konst GFB: Euro = 12.096
konst R: Euro = GFB + 5
`;
        const h = await hoverAt(src, 'GFB +');
        const md = content(h);
        expect(md).toContain('konst GFB: Euro');
    });

    it('Hover auf Konstante zeigt den Wert (Issue #65 B1) — Geld-Literal', async () => {
        const h = await hoverAt('konst GFB: Euro = 12.096\n', 'GFB');
        expect(content(h)).toContain('konst GFB: Euro = 12.096');
    });

    it('Hover auf Konstante zeigt den Wert — Prozent-Literal', async () => {
        const h = await hoverAt('konst SATZ: Prozent = 19%\n', 'SATZ');
        expect(content(h)).toContain('konst SATZ: Prozent = 19%');
    });

    it('Hover auf Konstante zeigt den Wert — Datensatz-Konstruktor (gekürzt)', async () => {
        const src = `datensatz Punkt(x: Ganzzahl, y: Ganzzahl)
konst URSPRUNG: Punkt = Punkt(x = 0, y = 0)
`;
        const h = await hoverAt(src, 'URSPRUNG');
        const md = content(h);
        expect(md).toContain('konst URSPRUNG: Punkt = Punkt(x = 0, y = 0)');
    });

    it('Hover auf Konstante kürzt sehr lange Werte mit „…"', async () => {
        const src = `konst LONG: Text = "${'x'.repeat(200)}"\n`;
        const h = await hoverAt(src, 'LONG');
        const md = content(h);
        expect(md).toMatch(/konst LONG: Text = "x+…/);
    });
});

describe('Hover auf Funktionen', () => {
    it('Funktions-Signatur mit Params und Rückgabetyp', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Verdoppelt einen Eurobetrag.
--
@Quelle("Test-Quelle")
fn verdoppeln(x: Euro): Euro = x * 2
`;
        const h = await hoverAt(src, 'verdoppeln');
        const md = content(h);
        expect(md).toContain('fn verdoppeln(x: Euro): Euro');
        expect(md).toContain('Verdoppelt einen Eurobetrag');
        expect(md).toContain('Test-Quelle');
    });

    it('Hover auf Funktions-Parameter zeigt Parameter-Karte', async () => {
        const src = `fn f(zve: Euro): Euro = zve + 1
`;
        const h = await hoverAt(src, 'zve: Euro');
        const md = content(h);
        expect(md).toContain('Parameter zve: Euro');
    });
});

describe('Hover auf Datensätzen und Aufzählungen', () => {
    it('Datensatz-Deklaration listet Felder', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Geometrischer Punkt im 2D-Raum.
--
datensatz Punkt(x: Ganzzahl, y: Ganzzahl)
`;
        const h = await hoverAt(src, 'Punkt(');
        const md = content(h);
        expect(md).toContain('datensatz Punkt');
        expect(md).toMatch(/\*\*Felder:\*\*/);
        expect(md).toContain('`x: Ganzzahl`');
        expect(md).toContain('`y: Ganzzahl`');
        expect(md).toContain('Geometrischer Punkt');
    });

    it('Aufzählungs-Deklaration zeigt Werte', async () => {
        const src = `aufzählung Farbe { Rot, Grün, Blau }
`;
        const h = await hoverAt(src, 'Farbe');
        const md = content(h);
        expect(md).toContain('aufzählung Farbe { Rot, Grün, Blau }');
    });
});

describe('Hover auf Builtins', () => {
    // (Entfernt 2026-05-18: freie Builtin-Funktion `abrundenEuro` gibt es
    // nicht mehr — § 11.1 ist die Methode `.abrunden()`. Methoden-Builtins
    // erhalten — wie die § 11.2-Listenmethoden — keine eigene Hover-Karte;
    // Parität gewahrt. Aufzählungs-/Typ-Hover bleibt unten getestet.)

    it('Builtin-Aufzählung Tarifart', async () => {
        const src = `fn f(art: Tarifart): Tarifart = art
`;
        const h = await hoverAt(src, 'Tarifart): Tarifart');
        const md = content(h);
        expect(md).toContain('aufzählung Tarifart');
        expect(md).toContain('Grundtarif');
    });

    it('Builtin-Aufzählungs-Wert Grundtarif zeigt enthaltende Aufzählung', async () => {
        const src = `fn f(): Tarifart = Grundtarif
`;
        const h = await hoverAt(src, 'Grundtarif\n');
        const md = content(h);
        expect(md).toContain('Grundtarif: Tarifart');
        expect(md).toContain('eingebauten Aufzählung **Tarifart**');
    });

    it('Steuerklasse-Wert "III" zeigt die Aufzählungs-Info', async () => {
        const src = `fn f(): Steuerklasse = III
`;
        const h = await hoverAt(src, 'III\n');
        const md = content(h);
        expect(md).toContain('III: Steuerklasse');
        expect(md).toContain('Lohnsteuer-Klassen');
    });
});

describe('Cross-Modul-Hover', () => {
    it('Importiertes Symbol zeigt die Decl-Karte aus dem Quell-Modul', async () => {
        const lib = `--
Datei-Dokumentation.
--

--
Grundfreibetrag 2025 — steuerfreies Existenzminimum.
--
@Quelle("§ 32a Absatz 1 Nr. 1 EStG")
konst GFB: Euro = 12.096
`;
        const app = `verwende {GFB} aus "./lib"
konst R: Euro = GFB + 1
`;
        const h = await hoverInModules({ lib, app }, 'app', 'GFB + 1');
        const md = content(h);
        expect(md).toContain('Importiert aus Datei:');
        expect(md).toContain('`./lib`');
        expect(md).toContain('konst GFB: Euro');
        expect(md).toContain('Grundfreibetrag 2025');
        expect(md).toContain('§ 32a Absatz 1 Nr. 1 EStG');
    });

    it('Alias-Import: Hover auf lokalem Aliasnamen liefert Original-Decl', async () => {
        const lib = `--
Originalkonstante.
--
@Quelle("Test")
konst original: Euro = 42
`;
        const app = `verwende {original als umbenannt} aus "./lib"
konst R: Euro = umbenannt + 1
`;
        const h = await hoverInModules({ lib, app }, 'app', 'umbenannt +');
        const md = content(h);
        expect(md).toMatch(/Importiert aus Datei:.*\.\/lib/);
        expect(md).toContain('konst original: Euro');
    });

    it('Importierte Funktion liefert volle Signatur aus dem Quell-Modul', async () => {
        const lib = `--
Datei-Dokumentation.
--

--
Verdoppelt einen Geldbetrag.
--
@Quelle("Beispiel")
fn verdoppeln(x: Euro): Euro = x * 2
`;
        const app = `verwende {verdoppeln} aus "./lib"
konst R: Euro = verdoppeln(50 als Euro)
`;
        const h = await hoverInModules({ lib, app }, 'app', 'verdoppeln(50');
        const md = content(h);
        expect(md).toContain('fn verdoppeln(x: Euro): Euro');
        expect(md).toContain('Verdoppelt');
    });

    it('Nicht-im-Workspace-geladenes Quell-Modul → kein Hover (kein eager load)', async () => {
        const app = `verwende {X} aus "./nichtgeladen"
konst R: Euro = X
`;
        const h = await hoverInModules({ app }, 'app', 'X\n');
        const md = content(h);
        expect(md).toBe('');
    });

    it('Importiertes nicht-exportiertes Symbol → kein Hover', async () => {
        const lib = `konst andere: Euro = 1
`;
        const app = `verwende {fehlt} aus "./lib"
konst R: Euro = fehlt
`;
        const h = await hoverInModules({ lib, app }, 'app', 'fehlt\n');
        const md = content(h);
        expect(md).toBe('');
    });
});

describe('Field-Access-Hover (mit Typ-Inferenz)', () => {
    it('Direkter Feld-Zugriff über lokale Konstante', async () => {
        const src = `--
Geometrischer Punkt.
--
datensatz Punkt(
    x: Ganzzahl,    // Erste Koordinate
    y: Ganzzahl,    // Zweite Koordinate
)

konst P: Punkt = Punkt(1, 2)
konst R: Ganzzahl = P.x
`;
        const h = await hoverAt(src, 'x\n');
        const md = content(h);
        expect(md).toContain('Feld x: Ganzzahl');
    });

    it('Feld-Zugriff über Funktions-Parameter', async () => {
        const src = `--
Steuerfall mit Tarifart-Feld.
--
datensatz Fall(tarifart: Ganzzahl)

fn ermittle(f: Fall): Ganzzahl = f.tarifart
`;
        const h = await hoverAt(src, 'tarifart\n');
        const md = content(h);
        expect(md).toContain('Feld tarifart: Ganzzahl');
    });

    it('Verschachtelter Feld-Zugriff (.einkünfte.lohn)', async () => {
        const src = `datensatz Einkünfte(lohn: Euro, miete: Euro)
datensatz Fall(einkünfte: Einkünfte)

fn lohnGet(f: Fall): Euro = f.einkünfte.lohn
`;
        const h = await hoverAt(src, 'lohn\n');
        const md = content(h);
        expect(md).toContain('Feld lohn: Euro');
    });

    it('Feld-Zugriff auf Call-Ergebnis', async () => {
        const src = `datensatz Ergebnis(summe: Euro, steuer: Euro)

fn berechne(): Ergebnis = Ergebnis(summe = 100, steuer = 20)
fn test(): Euro = berechne().steuer
`;
        const h = await hoverAt(src, 'steuer\n');
        const md = content(h);
        expect(md).toContain('Feld steuer: Euro');
    });

    it('Sicher-Zugriff (?.feld) auf Nullable-Datensatz', async () => {
        const src = `datensatz Adresse(strasse: Text)
datensatz Person(adresse: Adresse?)

fn test(p: Person): Text? = p.adresse?.strasse
`;
        const h = await hoverAt(src, 'strasse\n');
        const md = content(h);
        expect(md).toContain('Feld strasse: Text');
    });

    it('Force-Unwrap, dann Field-Access', async () => {
        const src = `datensatz Punkt(koord: Ganzzahl)

fn test(p: Punkt?): Ganzzahl = p!!.koord
`;
        const h = await hoverAt(src, 'koord\n');
        const md = content(h);
        expect(md).toContain('Feld koord: Ganzzahl');
    });

    it('Unbekanntes Feld → kein Hover', async () => {
        const src = `datensatz Punkt(x: Ganzzahl)
konst P: Punkt = Punkt(1)
konst R: Ganzzahl = P.unbekannt
`;
        const h = await hoverAt(src, 'unbekannt');
        const md = content(h);
        expect(md).toBe('');
    });

    it('Cross-Modul: Field-Zugriff auf importierten Datensatz', async () => {
        const lib = `--
Steuerfall — vollständige Eingabe für die Veranlagung.
--
datensatz Fall(
    summe:    Euro,
    steuer:   Euro,
)
`;
        const app = `verwende {Fall} aus "./lib"

fn test(f: Fall): Euro = f.summe
`;
        const h = await hoverInModules({ lib, app }, 'app', 'summe\n');
        const md = content(h);
        expect(md).toContain('Feld summe: Euro');
    });

    it('Hover auf Feld-Zugriff zeigt @param-Beschreibung (Issue #65 B2)', async () => {
        // Erstes `--…--` ist Datei-Doku; das zweite ist die
        // Datensatz-Doku (SPEC: fileDoc=DeclPrefix? am Programm-Anfang).
        const src = `--
Datei-Dokumentation.
--

--
Geometrischer Punkt in der Ebene.

@param x  Horizontale Koordinate, positiv nach rechts.
@param y  Vertikale Koordinate, positiv nach oben.
--
datensatz Punkt(
    x: Ganzzahl,
    y: Ganzzahl,
)

konst URSPRUNG: Punkt = Punkt(0, 0)
konst REF_X: Ganzzahl = URSPRUNG.x
`;
        const h = await hoverAt(src, 'x\n');
        const md = content(h);
        expect(md).toContain('Feld x: Ganzzahl');
        expect(md).toContain('Horizontale Koordinate');
    });

    it('Hover auf Feld OHNE @param-Beschreibung zeigt nur Signatur', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Steuerfall ohne Feld-Doku.
--
datensatz Fall(betrag: Euro)

fn test(f: Fall): Euro = f.betrag
`;
        const h = await hoverAt(src, 'betrag\n');
        const md = content(h);
        expect(md).toContain('Feld betrag: Euro');
        // Kein Blockquote-Marker (`> `) am Anfang einer Zeile, weil
        // keine @param-Beschreibung extrahiert wurde.
        expect(md).not.toMatch(/\n>\s/);
    });

    it('Hover auf Feld-Zugriff aus Lambda-Param in HOF-Trailing-Syntax (Issue #65)', async () => {
        // Spiegelt das est.findsl-Beispiel: `kinder.zuordnen { k -> k.faktor }`
        // — k hat keine explizite Typ-Annotation, der Typ ergibt sich aus
        // dem Element-Typ von `kinder: Liste<Kind>`.
        const src = `--
Datei-Dokumentation.
--

--
Kind im Steuerfall.

@param faktor  Multiplikator für den Freibetrag.
--
datensatz Kind(faktor: Ganzzahl, anteil: Prozent)

fn Summe(kinder: Liste<Kind>): Ganzzahl =
    kinder.zuordnen( { k -> k.faktor } ).summe()
`;
        const h = await hoverAt(src, 'faktor }');
        const md = content(h);
        expect(md).toContain('Feld faktor: Ganzzahl');
        expect(md).toContain('Multiplikator');
    });

    it('Hover auf Feld-Zugriff aus für-jeden-Iter-Variable (Issue #65 RC3)', async () => {
        const src = `--
Datei-Dokumentation.
--

datensatz Punkt(x: Ganzzahl, y: Ganzzahl)

fn XSumme(ps: Liste<Punkt>): Liste<Ganzzahl> =
    für jeden p aus ps {
        p.x
    }
`;
        const h = await hoverAt(src, 'x\n');
        const md = content(h);
        expect(md).toContain('Feld x: Ganzzahl');
    });

    it('Cross-Modul: Hover auf Feld-Zugriff zeigt @param aus importiertem Datensatz', async () => {
        const lib = `--
Datei-Dokumentation des lib-Moduls.
--

--
Steuerfall — vollständige Eingabe.

@param summe   Gesamtsumme aller Einkünfte des Veranlagungsjahres.
@param steuer  Berechneter Steuerbetrag nach Anwendung des Tarifs.
--
datensatz Fall(summe: Euro, steuer: Euro)
`;
        const app = `verwende {Fall} aus "./lib"

fn test(f: Fall): Euro = f.summe
`;
        const h = await hoverInModules({ lib, app }, 'app', 'summe\n');
        const md = content(h);
        expect(md).toContain('Feld summe: Euro');
        expect(md).toContain('Gesamtsumme');
    });
});

describe('Hover-Grenzfälle', () => {
    it('Cursor auf unbekanntem Identifier → kein Hover', async () => {
        const src = `fn f(): Ganzzahl = unbekannt
`;
        const h = await hoverAt(src, 'unbekannt');
        const md = content(h);
        expect(md).toBe('');
    });

    it('Cursor auf Keyword "fn" zeigt die umschließende Decl (Fallback)', async () => {
        const src = `fn verdoppeln(x: Euro): Euro = x * 2
`;
        const h = await hoverAt(src, 'fn');
        const md = content(h);
        expect(md).toContain('fn verdoppeln(x: Euro): Euro');
    });
});

describe('Hover auf abbruch', () => {
    it('Cursor auf "abbruch" erklärt Semantik (never, nicht abfangbar)', async () => {
        const src = `fn t(zve: Euro): Euro = abbruch("§ 32a EStG: unzulässig")
`;
        const h = await hoverAt(src, 'abbruch');
        const md = content(h);
        expect(md).toContain('never');
        expect(md).toContain('nicht abfangbar');
        expect(md).toContain('§ 4.19');
    });
});
