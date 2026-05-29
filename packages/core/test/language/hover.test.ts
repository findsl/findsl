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

describe('Hover: strukturiertes Doc-Markdown (Issue #65 Phase C)', () => {
    it('Funktion mit @param/@rückgabe → Sektionen "Parameter" + "Rückgabe"', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Berechnet die Bruttosumme aus Netto + MwSt.

@param netto         Netto-Betrag ohne Steuer.
@param mehrwertsteuer Anwendbarer Mehrwertsteuersatz.
@rückgabe Brutto-Betrag inklusive Steuer.
--
fn Brutto(netto: Euro, mehrwertsteuer: Prozent = 19%): Euro = netto + (netto * mehrwertsteuer)
`;
        const h = await hoverAt(src, 'fn Brutto');
        const md = content(h);
        expect(md).toContain('**Parameter**');
        expect(md).toContain('`netto` — Netto-Betrag ohne Steuer.');
        expect(md).toContain('`mehrwertsteuer` — Anwendbarer Mehrwertsteuersatz.');
        expect(md).toContain('**Rückgabe**');
        expect(md).toContain('Brutto-Betrag inklusive Steuer.');
        // Prosa muss vor den Sektionen stehen (Beschreibung zuerst)
        const proseIdx = md.indexOf('Berechnet die Bruttosumme');
        const paramIdx = md.indexOf('**Parameter**');
        expect(proseIdx).toBeGreaterThan(-1);
        expect(paramIdx).toBeGreaterThan(proseIdx);
    });

    it('Datensatz mit @param → Parameter-Sektion in Signatur-Reihenfolge sortiert', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Geometrischer Punkt in der Ebene.

@param y  Vertikale Koordinate.
@param x  Horizontale Koordinate.
--
datensatz Punkt(x: Ganzzahl, y: Ganzzahl)
`;
        const h = await hoverAt(src, 'datensatz Punkt');
        const md = content(h);
        expect(md).toContain('**Parameter**');
        // Auch wenn @param-Tags in der Doc in y-x-Reihenfolge stehen,
        // sollen sie nach Signatur-Reihenfolge (x, y) sortiert werden.
        const xIdx = md.indexOf('`x`');
        const yIdx = md.indexOf('`y`');
        expect(xIdx).toBeGreaterThan(-1);
        expect(yIdx).toBeGreaterThan(xIdx);
    });

    it('Inline-Math `$x \\cdot y$` wird als SVG-Bild gerendert + Klartext-alt (Issue #65)', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Berechnet die Tarifkurve nach $T(\\text{zve}) = a \\cdot \\text{zve} + b$.
--
fn T(zve: Euro): Euro = zve
`;
        const h = await hoverAt(src, 'fn T');
        const md = content(h);
        // SVG-Bild mit data-URL; alt-Text ist Klartext-Variante.
        expect(md).toContain('![T(zve) = a · zve + b](data:image/svg+xml');
        // Kein rohes TeX im Output.
        expect(md).not.toContain('\\cdot');
        expect(md).not.toMatch(/\$T\(.*\$/);
    });

    it('Block-Math `$$ \\frac{a}{b} $$` wird als SVG-Bild gerendert + Klartext-alt (Issue #65)', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Tarifformel:

$$
y = \\frac{\\text{zvE} - \\text{GFB}}{10000}
$$
--
fn T(zve: Euro): Euro = zve
`;
        const h = await hoverAt(src, 'fn T');
        const md = content(h);
        // Block-Math als SVG-Bild (alt = Klartext-Variante).
        expect(md).toContain('![y = (zvE - GFB)/10000](data:image/svg+xml');
        expect(md).not.toContain('\\frac');
        expect(md).not.toContain('\\text');
    });

    it('Block-Math mit cases-Umgebung wird als SVG-Bild gerendert (Issue #65)', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Tarif:

$$
\\begin{cases}
0 & x \\le 0 \\\\
(a + b)(c + d) & x > 0
\\end{cases}
$$
--
fn T(x: Euro): Euro = x
`;
        const h = await hoverAt(src, 'fn T');
        const md = content(h);
        // cases-Block wird als SVG-Bild gerendert; alt-Text enthält
        // die texToPlain-Variante (zur Barrierefreiheit + Fallback).
        expect(md).toContain('data:image/svg+xml');
        expect(md).toMatch(/!\[.*wenn x <= 0.*\]/);
        expect(md).toMatch(/!\[.*wenn x > 0.*\]/);
    });

    it('User-Bug est.findsl: komplexe Formeln werden alle als SVG-Bild gerendert (Issue #65)', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Tariflicher Einkommensteuerbetrag nach dem Grundtarif.

Mit den Hilfsgrößen $y = \\frac{\\text{zvE} - \\text{GFB}}{10000}$ (Zone 2)
und $z = \\frac{\\text{zvE} - \\text{ZONE\\_2}}{10000}$ (Zone 3) lautet
der Tarif zonenweise:

$$
\\text{ESt}(\\text{zvE}) =
\\begin{cases}
0 & \\text{zvE} \\le \\text{GFB} \\\\
(a_2\\,y + b_2)\\,y & \\text{Zone 2}
\\end{cases}
$$
--
fn EstGrundtarif(zve: Euro): Euro = zve
`;
        const h = await hoverAt(src, 'fn EstGrundtarif');
        const md = content(h);
        // Inline-Hilfsgrößen als SVG-Bilder (alt = Klartext)
        expect(md).toContain('![y = (zvE - GFB)/10000](data:image/svg+xml');
        expect(md).toContain('![z = (zvE - ZONE_2)/10000](data:image/svg+xml');
        // Block-Formel als SVG-Bild (alt enthält cases-Plain-Text)
        expect(md).toMatch(/!\[.*ESt\(zvE\).*wenn zvE <= GFB.*\]\(data:image\/svg\+xml/);
        // Kein rohes TeX im Output
        expect(md).not.toContain('\\frac');
        expect(md).not.toContain('\\cdot');
        expect(md).not.toContain('\\begin{cases}');
    });

    it('Funktion ohne @param-Tags zeigt nur Prosa (keine leere Parameter-Sektion)', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Verdoppelt einen Eurobetrag — kein Doc-Tag.
--
fn V(x: Euro): Euro = x * 2
`;
        const h = await hoverAt(src, 'fn V');
        const md = content(h);
        expect(md).toContain('Verdoppelt einen Eurobetrag');
        expect(md).not.toContain('**Parameter**');
        expect(md).not.toContain('**Rückgabe**');
    });

    it('@Quelle-Annotation wird durch `---`-Trenner abgetrennt', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Steuerformel.

@param zve  Zu versteuerndes Einkommen.
--
@Quelle("§ 32a Abs. 1 EStG")
fn T(zve: Euro): Euro = zve
`;
        const h = await hoverAt(src, 'fn T');
        const md = content(h);
        expect(md).toContain('**Parameter**');
        expect(md).toContain('*Quelle:* § 32a Abs. 1 EStG');
        // Quelle muss durch `---` von der Param-Sektion getrennt sein
        const paramIdx = md.indexOf('**Parameter**');
        const sepIdx = md.indexOf('---', paramIdx);
        const quelleIdx = md.indexOf('*Quelle:*', sepIdx);
        expect(sepIdx).toBeGreaterThan(paramIdx);
        expect(quelleIdx).toBeGreaterThan(sepIdx);
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

describe('Hover auf Builtin-Methoden (SPEC § 11)', () => {
    it('.höchstens auf Euro (§ 11.6) — Signatur + Doc + Quelle', async () => {
        const src = `konst BETRAG: Euro = 100
konst R: Euro = BETRAG.höchstens(80)
`;
        const h = await hoverAt(src, 'höchstens');
        const md = content(h);
        expect(md).toContain('höchstens');
        expect(md).toContain('grenze');           // Parameter-Name in Signatur
        expect(md).toMatch(/Minimum|höchstens jedoch/);
        expect(md).toContain('§ 11.6');
    });

    it('.abrunden auf EuroCent (§ 11.1)', async () => {
        const src = `konst R: Euro = (12,34 als EuroCent).abrunden()
`;
        const h = await hoverAt(src, 'abrunden');
        const md = content(h);
        expect(md).toContain('abrunden');
        expect(md).toContain('§ 11.1');
        expect(md).toMatch(/Richtung −∞|ab/);
    });

    it('.länge auf Liste<T> (Property, § 11.2)', async () => {
        const src = `konst XS: Liste<Ganzzahl> = [1, 2, 3]
konst N: Ganzzahl = XS.länge
`;
        const h = await hoverAt(src, 'länge');
        const md = content(h);
        expect(md).toContain('länge');
        expect(md).toMatch(/Anzahl|Elemente/);
        expect(md).toContain('§ 11.2');
    });

    it('.zuordnen auf Liste<T> (HOF, § 11.2)', async () => {
        const src = `konst XS: Liste<Ganzzahl> = [1, 2]
konst YS: Liste<Ganzzahl> = XS.zuordnen({ x -> x * 2 })
`;
        const h = await hoverAt(src, 'zuordnen');
        const md = content(h);
        expect(md).toContain('zuordnen');
        expect(md).toMatch(/Map|Abbild/);
    });

    it('.beginntMit auf Text (§ 11.5)', async () => {
        const src = `konst S: Text = "Hallo Welt"
konst B: Wahrheitswert = S.beginntMit("Ha")
`;
        const h = await hoverAt(src, 'beginntMit');
        const md = content(h);
        expect(md).toContain('beginntMit');
        expect(md).toContain('§ 11.5');
    });

    it('.abrundenAuf auf EuroCent (§ 11.6)', async () => {
        const src = `konst R: EuroCent = (12.345,67 als EuroCent).abrundenAuf(100,00)
`;
        const h = await hoverAt(src, 'abrundenAuf');
        const md = content(h);
        expect(md).toContain('abrundenAuf');
        expect(md).toContain('§ 11.6');
        expect(md).toContain('vielfaches');
    });

    it('Unbekannte Methode auf passendem Typ → kein Hover (kein Rauschen)', async () => {
        const src = `konst R: Euro = (100 als Euro).quatschMethode()
`;
        const h = await hoverAt(src, 'quatschMethode');
        // Darf keine falsche Doc-Karte zeigen
        expect(content(h)).not.toContain('§ 11');
    });

    it('verkettete Builtins: ZWEITE Methode bekommt Hover (Nutzer-Fall)', async () => {
        // `a.mindestens(b).mindestens(c)` — nach dem ersten typ-erhaltenden
        // `.mindestens(…)` muss der Empfänger weiter EuroCent sein, damit
        // das zweite `.mindestens` aufgelöst wird. Vorher lieferte der
        // Skeleton-Stepper `unknown` → kein Hover am zweiten Glied.
        const src = `konst A: EuroCent = 1,00
konst B: EuroCent = 2,00
konst R: EuroCent = A.mindestens(B).mindestens(0,00)
`;
        // `mindestens(0` trifft eindeutig das ZWEITE Kettenglied.
        const h = await hoverAt(src, 'mindestens(0');
        const md = content(h);
        expect(md).toContain('mindestens');
        expect(md).toContain('§ 11.6');
    });

    it('verkettete Builtins: erstes UND zweites Glied auf ParenChain', async () => {
        // Geklammerter Empfänger + zwei verkettete Methoden.
        const src = `konst A: EuroCent = 1,00
konst R: EuroCent = (A + 1,00).höchstens(9,00).mindestens(0,00)
`;
        const erst = content(await hoverAt(src, 'höchstens'));
        expect(erst).toContain('höchstens');
        expect(erst).toContain('§ 11.6');
        const zweit = content(await hoverAt(src, 'mindestens'));
        expect(zweit).toContain('mindestens');
        expect(zweit).toContain('§ 11.6');
    });
});

describe('Hover auf primitiven Typen in Annotationen', () => {
    it('Cursor auf "Euro" in Konst-Annotation → Doc-Karte', async () => {
        const src = `konst K: Euro = 5
`;
        const h = await hoverAt(src, 'Euro');
        const md = content(h);
        expect(md).toContain('Euro');
        expect(md).toMatch(/Geld|Nachkommastellen/);
    });

    it('Cursor auf "EuroCent" in fn-Param', async () => {
        const src = `fn f(betrag: EuroCent): Euro = betrag.abrunden()
`;
        const h = await hoverAt(src, 'EuroCent');
        const md = content(h);
        expect(md).toContain('EuroCent');
        expect(md).toMatch(/Cent-Genauigkeit|2 Nachkommastellen/);
    });

    it('Cursor auf "Prozent" in fn-Return', async () => {
        const src = `fn satz(): Prozent = 5%
`;
        const h = await hoverAt(src, 'Prozent');
        const md = content(h);
        expect(md).toContain('Prozent');
        expect(md).toMatch(/Prozentwert|%/);
    });

    it('Cursor auf "Text" in Annotation', async () => {
        const src = `konst K: Text = "x"
`;
        const h = await hoverAt(src, 'Text');
        const md = content(h);
        expect(md).toContain('Text');
        expect(md).toContain('§ 11.5');
    });
});

describe('Hover auf importierten Elementen im verwende-Block', () => {
    it('Cursor auf Source-Name → Cross-Decl-Karte mit Signatur, Doc, Source-Datei', async () => {
        const lib = `--
Datei-Dokumentation.
--

--
Tariflicher Grundbetrag.
--
@Quelle("§ 32a EStG")
fn kern(z: Euro): Euro = z
`;
        const app = `verwende { kern } aus "./lib"
fn r(): Euro = kern(0 als Euro)
`;
        const h = await hoverInModules({ lib, app }, 'app', 'kern }');
        const md = content(h);
        expect(md).toContain('fn kern(z: Euro): Euro');
        expect(md).toContain('Tariflicher Grundbetrag');
        expect(md).toContain('§ 32a EStG');
        expect(md).toMatch(/Importiert aus Datei/);
    });

    it('Cursor auf Alias → zeigt Quell-Decl-Karte (nicht den Alias)', async () => {
        const lib = `fn foo(z: Euro): Euro = z
`;
        const app = `verwende { foo als bar } aus "./lib"
fn r(): Euro = bar(0 als Euro)
`;
        const h = await hoverInModules({ lib, app }, 'app', 'bar }');
        const md = content(h);
        expect(md).toContain('fn foo(z: Euro): Euro');
        expect(md).toMatch(/Importiert aus Datei/);
    });

    it('Importierte Konstante zeigt Konst-Hover', async () => {
        const lib = `--
Datei-Dokumentation.
--

--
Grundfreibetrag.
--
@Quelle("§ 32a EStG")
konst GFB: Euro = 12.096 als Euro
`;
        const app = `verwende { GFB } aus "./lib"
konst R: Euro = GFB
`;
        const h = await hoverInModules({ lib, app }, 'app', 'GFB }');
        const md = content(h);
        expect(md).toContain('konst GFB');
        expect(md).toContain('Grundfreibetrag');
        expect(md).toMatch(/Importiert aus Datei/);
    });

    it('Importierter Aufzählungs-Wert zeigt Aufzählungs-Hover', async () => {
        // Werte sind Strings in AufzaehlungDecl.values, keine eigenen
        // Decls — Hover muss zur umschließenden Aufzählung fallen.
        const lib = `--
Datei-Dokumentation.
--

--
Fahrzeug-Klassifikation nach § 9 KraftStG.
--
aufzählung Fahrzeugart {
    Kraftrad,
    Pkw,
    Wohnmobil,
}
`;
        const app = `verwende { Pkw } aus "./lib"
`;
        const h = await hoverInModules({ lib, app }, 'app', 'Pkw }');
        const md = content(h);
        expect(md).toContain('aufzählung Fahrzeugart');
        expect(md).toContain('Fahrzeug-Klassifikation');
        expect(md).toMatch(/Importiert aus Datei/);
    });
});

describe('Hover auf Aufzählungs-Werten als Code-Referenz', () => {
    it('Lokal definiert, Wert im fn-Body → Aufzählungs-Hover', async () => {
        const src = `--
Datei-Dokumentation.
--

--
Antriebsart eines Fahrzeugs.
--
aufzählung Antrieb { Fremdzuendung, Elektro }
fn f(a: Antrieb): Ganzzahl = wähle (a) {
    falls Elektro -> 1
    sonst         -> 0
}
`;
        const h = await hoverAt(src, 'Elektro -> 1');
        const md = content(h);
        expect(md).toContain('aufzählung Antrieb');
        expect(md).toContain('Antriebsart');
    });

    it('Importierter Wert im fn-Body → Cross-Decl-Karte', async () => {
        const lib = `--
Datei-Dokumentation.
--

--
Antriebsart nach § 9 KraftStG.
--
aufzählung Antrieb { Fremdzuendung, Elektro }
`;
        const app = `verwende { Antrieb, Elektro } aus "./lib"
fn f(a: Antrieb): Ganzzahl = wähle (a) {
    falls Elektro -> 1
    sonst         -> 0
}
`;
        const h = await hoverInModules({ lib, app }, 'app', 'Elektro -> 1');
        const md = content(h);
        expect(md).toContain('aufzählung Antrieb');
        expect(md).toContain('Antriebsart');
        expect(md).toMatch(/Importiert aus Datei/);
    });
});
