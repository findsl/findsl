/**
 * Tests für den (bewusst konservativen) Formatter: Block-Einrückung +
 * ein Element pro Zeile für `prüfe`/`wähle`/Block-Body; Idempotenz;
 * formatiertes Ergebnis bleibt valide; `datensatz`-Felder und
 * `@param`/`@rückgabe` werden zweispaltig ausgerichtet (ehem.
 * § 4.15-Hand-Ausrichtung jetzt formatter-erzeugt).
 *
 * Jeder Fall nutzt eine FRISCHE Services-Instanz (keine Workspace-
 * Kontamination zwischen Fällen).
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createFindslServices } from '../../src/language/findsl-module.js';

async function format(src: string): Promise<string> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        src, URI.parse('file:///fmt.findsl'),
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    const edits = await services.lsp.Formatter!.formatDocument(doc, {
        textDocument: { uri: doc.uri.toString() },
        options: { tabSize: 4, insertSpaces: true },
    });
    return TextDocument.applyEdits(doc.textDocument, edits);
}

async function errorCount(src: string): Promise<number> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    // URI-Basename == Modulname, sonst greift die (themenfremde)
    // Modul-Pfad-Konsistenz-Diagnose.
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        src, URI.parse('file:///m.findsl'),
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return (doc.diagnostics ?? []).filter((d) => d.severity === 1).length;
}

describe('Formatter: Block-Strukturen', () => {
    it('prüfe-Block: je testfall eine eingerückte Zeile, } dedentiert', async () => {
        const out = await format(`fn F(): Ganzzahl = 1
prüfe "P" { testfall "a" { F() == 1 }   testfall "b" { F() == 1 } }
`);
        expect(out).toContain('prüfe "P" {\n    testfall "a" {\n        F() == 1\n    }\n    testfall "b" {\n        F() == 1\n    }\n}');
    });

    it('wähle-Block: je Arm eine eingerückte Zeile', async () => {
        const out = await format(`fn T(zve: Euro): Euro = wähle {
falls zve < 0 als Euro -> abbruch("neg")
sonst -> 0 als Euro
}
`);
        // Zwei-Spalten-Layout: `sonst` wird bis zur längsten Arm-Linken
        // (`falls zve < 0 als Euro`) gepolstert, alle `->` fluchten.
        expect(out).toContain('wähle {\n    falls zve < 0 als Euro -> abbruch("neg")\n    sonst                  -> 0 als Euro\n}');
    });

    it('Block-Body: var + Ergebnis eingerückt', async () => {
        const out = await format(`fn B(x: Euro): Euro {
var y: Euro = x
y
}
`);
        expect(out).toContain('fn B(x: Euro): Euro {\n    var y: Euro = x\n    y\n}');
    });

    it('verschachtelt: Einrückung staffelt sich (8 Spaces innen)', async () => {
        const out = await format(`fn F(zve: Euro): Euro = wähle {
falls zve < 0 als Euro -> {
var y: Euro = zve
y
}
sonst -> 0 als Euro
}
`);
        // wähle-Arm auf Ebene 1 (4), Block-Inhalt des Arms auf Ebene 2 (8).
        expect(out).toContain('\n    falls zve < 0 als Euro -> {');
        expect(out).toContain('\n        var y: Euro = zve');
        expect(out).toContain('\n        y');
    });
});

describe('Formatter: Inline-Deklarations-Spacing', () => {
    it('User-Fall: @Quelle + konst werden kanonisiert', async () => {
        const out = await format(`@Quelle("§ 32a Absatz 1 Nr. 5 EStG"  )
  konst   ZONE_15_SATZ:        Prozent
            = 45%
`);
        expect(out).toBe('@Quelle("§ 32a Absatz 1 Nr. 5 EStG")\nkonst ZONE_15_SATZ: Prozent = 45%\n');
    });

    it('@Quelle: keine Spaces in den Klammern', async () => {
        const out = await format(`@Quelle(  "§ 1 EStG"  )
konst K: Euro = 1 als Euro
`);
        expect(out).toContain('@Quelle("§ 1 EStG")');
    });

    it('konst-internes Spacing (: ohne Space davor, = mit je einem)', async () => {
        const out = await format('konst   X:Euro   =   1 als Euro\n');
        expect(out).toContain('konst X: Euro = 1 als Euro');
    });

    it('var-Bindung im Block', async () => {
        const out = await format(`fn F(x: Euro): Euro {
var   y :Euro=x
y
}
`);
        expect(out).toContain('var y: Euro = x');
    });

    it('Doc-Präfix: Decl-Keyword auf Spalte 0 nach der Annotation', async () => {
        const out = await format(`@Quelle("§ 1 EStG")
        konst K: Euro = 1 als Euro
`);
        expect(out).toContain('\nkonst K: Euro = 1 als Euro');
        expect(out).not.toContain('        konst');
    });

    it('Leerzeilen-Gruppierung zwischen Top-Level-Decls bleibt erhalten', async () => {
        const src = `@Quelle("§ 1 EStG")
konst A: Euro = 1 als Euro


@Quelle("§ 2 EStG")
konst B: Euro = 2 als Euro
`;
        const out = await format(src);
        // Zwei Leerzeilen (= 3 \n) vor dem zweiten Block bleiben.
        expect(out).toContain('konst A: Euro = 1 als Euro\n\n\n@Quelle("§ 2 EStG")');
        // Idempotent über die fit-Regel.
        expect(await format(out)).toBe(out);
    });

    it('eine Leerzeile zwischen Decls bleibt eine Leerzeile', async () => {
        const src = `konst A: Euro = 1 als Euro

konst B: Euro = 2 als Euro
`;
        const out = await format(src);
        expect(out).toContain('konst A: Euro = 1 als Euro\n\nkonst B: Euro = 2 als Euro');
        expect(await format(out)).toBe(out);
    });

    it('mehrere Annotationen je eine Zeile', async () => {
        const out = await format(`@Quelle("§ 1 EStG") @Quelle("§ 2 EStG")
konst K: Euro = 1 als Euro
`);
        expect(out).toContain('@Quelle("§ 1 EStG")\n@Quelle("§ 2 EStG")');
    });
});

describe('Formatter: Operator-/Ausdrucks-Spacing', () => {
    it('Mehrfach-Spaces um Operatoren werden kollabiert', async () => {
        const out = await format(`konst X: Euro = 1 als Euro
konst Y: Euro = 2 als Euro
konst Z: Euro = 3 als Euro
fn S(a: Euro, b: Euro, c: Euro): Euro = wähle {
    falls a >      X -> a
    falls b    > Y und a <= X -> b + a
    falls c > Z         oder a <= X und b <= Y -> (c / b) als Euro + a
    sonst -> abbruch("Ungültige Eingabe")
}
`);
        // Operatoren auf ein Space kollabiert UND `->` zweispaltig
        // ausgerichtet (Spalte = längste Arm-Linke
        // `falls c > Z oder a <= X und b <= Y`).
        expect(out).toContain('    falls a > X                        -> a\n');
        expect(out).toContain('    falls b > Y und a <= X             -> b + a\n');
        expect(out).toContain('    falls c > Z oder a <= X und b <= Y -> (c / b) als Euro + a\n');
        expect(out).toContain('    sonst                              -> abbruch("Ungültige Eingabe")\n');
        expect(await format(out)).toBe(out);          // idempotent
    });

    it('Arithmetik, Cast, Nullcheck, Bereich', async () => {
        const out = await format(`konst A: Euro? = nichts
konst R: Euro = (A   oder   0) als Euro  +  1 als Euro
fn T(n: Ganzzahl): Wahrheitswert = A    ist    nichts
fn R(): Bereich<Ganzzahl> = 1   bis   10   schritt   2
`);
        expect(out).toContain('(A oder 0) als Euro + 1 als Euro');
        expect(out).toContain('A ist nichts');
        expect(out).toContain('1 bis 10 schritt 2');
        expect(await format(out)).toBe(out);
    });
});

describe('Formatter: Invarianten', () => {
    it('idempotent (format∘format == format)', async () => {
        const messy = `fn T(zve: Euro): Euro = wähle {
falls zve < 0 als Euro -> abbruch("neg")
   sonst    ->    0 als Euro
}
prüfe "P" {   testfall "a" { T(1 als Euro) == 0 als Euro }
testfall "b" { T(2 als Euro) == 0 als Euro } }
`;
        const once = await format(messy);
        const twice = await format(once);
        expect(twice).toBe(once);
    });

    it('formatiertes Ergebnis bleibt valide (0 Fehler)', async () => {
        const out = await format(`@Quelle("§ 32a EStG")
fn T(zve: Euro): Euro = wähle {
falls zve < 0 als Euro -> abbruch("§ 32a: negativ")
sonst -> 0 als Euro
}
prüfe "P" { testfall "a" { T(1 als Euro) == 0 als Euro } }
`);
        expect(await errorCount(out)).toBe(0);
    });

    it('datensatz einzeilige Felder → kompakt', async () => {
        const out = await format(`datensatz EinkommensteuerBescheid (          zve: Euro, est: Euro,  name: Text
)
`);
        expect(out).toContain('datensatz EinkommensteuerBescheid(zve: Euro, est: Euro, name: Text');
        expect(await format(out)).toBe(out);          // idempotent
    });

    it('datensatz mehrzeilige Felder → kanonischer Block, EINE Einrückungsebene', async () => {
        const out = await format(`datensatz EinkommensteuerBescheid(zve: Euro,

est: Euro,

name: Text
)
`);
        // Headerlose Datei mit Decl als erster Zeile → führende
        // Leerzeile. Zwei-Spalten-Layout: maxNameLen=4 (`name`) →
        // `zve`/`est` mit 2 Spaces, `name` mit 1 → Typen fluchten.
        expect(out).toBe(`
datensatz EinkommensteuerBescheid(
    zve:  Euro,
    est:  Euro,
    name: Text
)
`);
        expect(await format(out)).toBe(out);          // idempotent, kein Kaskadieren
    });

    it('datensatz MIT Trailing-//: Name/Typ-Spalte normalisiert, Kommentar-Spalte ausgerichtet (Issue #202)', async () => {
        // Vormals § 4.15-geschützt; jetzt erzeugt der Formatter die
        // Ausrichtung selbst. Seit Issue #202 wird ZUSÄTZLICH die
        // Kommentar-Spalte gepaddet — gleicher Typ ⇒ mindestens 1 Space
        // zwischen `,` und `//`, alle `//` auf einer Spalte.
        const out = await format(`datensatz E(
    anp: Euro,    // Arbeitnehmer-Pauschbetrag (§ 9a EStG)
    sonderausgaben: Euro,    // § 10c EStG
)
`);
        expect(out).toContain(
            'datensatz E(\n'
            + '    anp:            Euro, // Arbeitnehmer-Pauschbetrag (§ 9a EStG)\n'
            + '    sonderausgaben: Euro, // § 10c EStG\n'
            + ')',
        );
        expect(await format(out)).toBe(out);          // idempotent
        expect(await errorCount(out)).toBe(0);        // valide
    });

    it('aufzählung-Einzeiler bleibt unangetastet', async () => {
        const src = 'aufzählung Ampel { Rot, Gelb, Grün }\n';
        // Headerlose Datei mit Decl als erster Zeile → führende
        // Leerzeile (verifiziert); der Einzeiler selbst unverändert.
        expect(await format(src)).toBe(`\n${src}`);
    });
});

// ---------------------------------------------------------------------------
// verwende-Block + erzwungene 4-Blank-Einrückung (Tabs → Spaces)
// ---------------------------------------------------------------------------

import { TextDocument as TD2 } from 'vscode-languageserver-textdocument';

/** Wie `format`, aber mit frei wählbaren Client-FormattingOptions. */
async function formatOpts(
    src: string, options: { tabSize: number; insertSpaces: boolean },
): Promise<string> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        src, URI.parse('file:///fmtopt.findsl'),
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    const edits = await services.lsp.Formatter!.formatDocument(doc, {
        textDocument: { uri: doc.uri.toString() }, options,
    });
    return TD2.applyEdits(doc.textDocument, edits);
}

describe('Formatter: verwende-Block', () => {
    it('jeder Import eigene, um 4 eingerückte Zeile; } eigene Zeile; aus danach', async () => {
        const out = await format('verwende { A, B als c } aus "./x"\nkonst K: Euro = 1 als Euro\n');
        expect(out).toContain('verwende {\n    A,\n    B als c\n} aus "./x"');
    });

    it('Einzel-Import wird ebenfalls umgebrochen (immer mehrzeilig)', async () => {
        const out = await format('verwende { Nur } aus "./q"\nkonst K: Euro = 1 als Euro\n');
        expect(out).toContain('verwende {\n    Nur\n} aus "./q"');
    });

    it('idempotent (format∘format == format)', async () => {
        const out = await format('verwende {A,   B als c,} aus "./x"\nkonst K: Euro = 1 als Euro\n');
        expect(await format(out)).toBe(out);
    });

    it('formatiertes Ergebnis bleibt valide', async () => {
        const out = await format('verwende { A } aus "./x"\nkonst K: Euro = 1 als Euro\n');
        expect(await errorCount(out)).toBe(0);
    });
});

describe('Formatter: erzwingt 4 Blanks (Tabs → Spaces, unabh. Client-Optionen)', () => {
    it('Client verlangt Tabs/Größe 8 → Ausgabe trotzdem 4 Blanks, keine Tabs', async () => {
        const out = await formatOpts(
            'fn F(): Ganzzahl = 1\nprüfe "P" { testfall "a" { F() == 1 } }\n',
            { tabSize: 8, insertSpaces: false },
        );
        expect(out).not.toContain('\t');
        expect(out).toContain('prüfe "P" {\n    testfall "a" {\n        F() == 1\n    }\n}');
    });

    it('vorhandene Tab-Einrückung wird zu 4 Blanks konvertiert', async () => {
        const out = await format(
            'fn T(zve: Euro): Euro = wähle {\n\tfalls zve < 0 als Euro -> abbruch("neg")\n\tsonst -> 0 als Euro\n}\n',
        );
        expect(out).not.toContain('\t');
        // Zwei-Spalten-Layout: `sonst` wird bis zur längsten Arm-Linken
        // (`falls zve < 0 als Euro`) gepolstert, alle `->` fluchten.
        expect(out).toContain('wähle {\n    falls zve < 0 als Euro -> abbruch("neg")\n    sonst                  -> 0 als Euro\n}');
    });
});

describe('Formatter: datensatz Zwei-Spalten-Layout', () => {
    it('Typen fluchten auf einer Spalte (Breite = längster Feldname + 1)', async () => {
        // Seit Issue #202: Kommentar-Spalte ist zusätzlich ausgerichtet
        // — `Prozent,` (kürzerer Typ) bekommt 2 Spaces vor `//`,
        // `EuroCent,` 1 Space — beide `//` fluchten auf Spalte 22.
        const out = await format(`@Quelle("§ 7 GewStG")
datensatz E(
  kurz: EuroCent,   // a
     sehrLangerName:      Prozent,   // b
  mittel:  EuroCent,
)
`);
        expect(out).toContain(
            'datensatz E(\n'
            + '    kurz:           EuroCent, // a\n'
            + '    sehrLangerName: Prozent,  // b\n'
            + '    mittel:         EuroCent,\n'
            + ')',
        );
    });

    it('idempotent (mit Trailing-//-Kommentaren — vormals § 4.15-Schutz)', async () => {
        const src = `datensatz E(
    anp: Euro,    // Arbeitnehmer-Pauschbetrag (§ 9a EStG)
    sonderausgabenPauschbetrag: Euro,    // § 10c EStG
)
`;
        const out = await format(src);
        expect(out).toContain('    anp:                        Euro,');
        expect(out).toContain('    sonderausgabenPauschbetrag: Euro,');
        expect(await format(out)).toBe(out);          // idempotent
        expect(await errorCount(out)).toBe(0);        // valide
    });

    it('Einzeiler-datensatz bleibt kompakt (keine Spalten-Ausrichtung)', async () => {
        const out = await format('datensatz P(a: Euro, b: Prozent)\n');
        expect(out).toContain('datensatz P(a: Euro, b: Prozent)');
    });

    it('Funktionsparameter NICHT spaltenausgerichtet (nur ein Space)', async () => {
        const out = await format('fn F(kurz: Euro, sehrLangerName: Prozent): Euro = kurz\n');
        expect(out).toContain('fn F(kurz: Euro, sehrLangerName: Prozent): Euro');
    });
});

import { alignDocTags } from '../../src/language/findsl-formatter.js';

describe('Formatter: @param/@rückgabe Zwei-Spalten-Layout', () => {
    it('alignDocTags: Marken-Spalte = längste Marke + 1, Beschreibung fluchtet', () => {
        const out = alignDocTags(
            '--\nTut etwas.\n\n@param a Kurz.\n@param betrag2   Zweiter.\n@rückgabe Ergebnis.\n--',
        );
        expect(out).toBe(
            '--\nTut etwas.\n\n'
            + '@param a       Kurz.\n'
            + '@param betrag2 Zweiter.\n'
            + '@rückgabe      Ergebnis.\n--',
        );
    });

    it('Fortsetzungszeile hängt unter der Beschreibungsspalte; idempotent', () => {
        const src = '--\n@param a Erster.\n@rückgabe Lange Zeile,\n   die umbricht.\n--';
        const o1 = alignDocTags(src);
        expect(o1).toBe(
            '--\n@param a  Erster.\n@rückgabe Lange Zeile,\n          die umbricht.\n--',
        );
        expect(alignDocTags(o1)).toBe(o1);            // idempotent
    });

    it('Prosa, Leerzeilen und ```-Codeblöcke bleiben unangetastet', () => {
        const src = '--\n# H\n\nText @param sieht aus wie tag im Fließtext? nein, prosa.\n\n```\n@param x im code\n```\n@param echt Wert.\n--';
        const out = alignDocTags(src);
        expect(out).toContain('```\n@param x im code\n```');     // Fence unberührt
        expect(out).toContain('@param echt Wert.');              // echtes Tag (einzeln → 1 Space)
        expect(out).toContain('# H\n\nText @param sieht');       // Prosa unberührt
    });

    it('ohne Tags: Text unverändert (kein No-op-Edit)', () => {
        const src = '--\nNur Prosa, kein Tag.\n--';
        expect(alignDocTags(src)).toBe(src);
    });

    it('integriert über den Formatter (fn-Doc), idempotent', async () => {
        const out = await format(`--
Wählt.

@param a Erster.
@param langerName Zweiter.
@rückgabe Resultat.
--
fn F(a: Euro, langerName: Euro): Euro = a + langerName
`);
        expect(out).toContain(
            '@param a          Erster.\n'
            + '@param langerName Zweiter.\n'
            + '@rückgabe         Resultat.',
        );
        expect(await format(out)).toBe(out);          // idempotent
        expect(await errorCount(out)).toBe(0);        // valide
    });
});

describe('Formatter: wähle Zwei-Spalten-Layout (-> fluchten)', () => {
    it('Nutzer-Fall: sonst wird bis zur längsten Arm-Linken gepolstert', async () => {
        const out = await format(
            'fn _Hoechstens(betrag: EuroCent, hoechstens: EuroCent): EuroCent = wähle {\n'
            + 'falls betrag > hoechstens -> hoechstens\n'
            + 'sonst -> betrag\n}\n',
        );
        expect(out).toContain(
            'wähle {\n'
            + '    falls betrag > hoechstens -> hoechstens\n'
            + '    sonst                     -> betrag\n'
            + '}',
        );
    });

    it('Mehrfach-Pattern (falls I, II) als Spaltenmaß', async () => {
        const out = await format(
            'fn K(stkl: Steuerklasse): Ganzzahl = wähle (stkl) {\n'
            + 'falls I, II -> 0\nfalls III -> 4800\nsonst -> 9600\n}\n',
        );
        expect(out).toContain(
            'wähle (stkl) {\n'
            + '    falls I, II -> 0\n'
            + '    falls III   -> 4800\n'
            + '    sonst       -> 9600\n'
            + '}',
        );
        expect(await format(out)).toBe(out);          // idempotent
        expect(await errorCount(out)).toBe(0);
    });

    it('Block-Arm: nur das Separator-`->` wird ausgerichtet (kein -> im Block)', async () => {
        const out = await format(
            'fn F(zve: Euro): Euro = wähle {\n'
            + 'falls zve < 0 als Euro -> {\nvar y: Euro = zve\ny\n}\n'
            + 'sonst -> 0 als Euro\n}\n',
        );
        // längste Linke = `falls zve < 0 als Euro` → deren `->` 1 Space;
        // `sonst` gepolstert, Block-Inhalt unberührt.
        expect(out).toContain('    falls zve < 0 als Euro -> {');
        expect(out).toContain('\n        var y: Euro = zve\n');
        expect(out).toContain('\n    sonst                  -> 0 als Euro\n');
        expect(await format(out)).toBe(out);          // idempotent
    });
});

describe('Formatter: Operator-Ketten — Umbruch/Erhalt (≤120)', () => {
    const LONG =
        'fn SummeHinzurechnungen8(h: Hinzurechnungen8): EuroCent = Hinzurechnung8Nr1(h)'
        + ' + h.gewinnanteilePhgKgaa + h.steuerfreieDividenden'
        + ' + h.verlustanteileMitunternehmerschaft + h.ausgaben9Abs1Nr2KStG'
        + ' + h.gewinnminderungenTeilwert + h.auslaendischeSteuern\n';

    it('>120 einzeilig geschrieben → bricht vor jedem Operator (4-Hang)', async () => {
        const out = await format(LONG);
        expect(out).toContain(
            '= Hinzurechnung8Nr1(h)\n'
            + '    + h.gewinnanteilePhgKgaa\n'
            + '    + h.steuerfreieDividenden\n'
            + '    + h.verlustanteileMitunternehmerschaft\n'
            + '    + h.ausgaben9Abs1Nr2KStG\n'
            + '    + h.gewinnminderungenTeilwert\n'
            + '    + h.auslaendischeSteuern',
        );
        out.split('\n').forEach((l) => expect(l.length).toBeLessThanOrEqual(120));
        expect(await format(out)).toBe(out);          // idempotent
        // (kein errorCount: Snippet referenziert bewusst externe Symbole
        //  `Hinzurechnungen8`/`Hinzurechnung8Nr1` — reiner Formatierungs-,
        //  kein Semantik-Test.)
    });

    it('≤120 vom Autor mehrzeilig → bleibt erhalten (nicht kollabiert)', async () => {
        const src = 'fn S(a: Euro, b: Euro): Euro = a\n    + b\n';
        const out = await format(src);
        expect(out).toContain('= a\n    + b');
        expect(await format(out)).toBe(out);          // idempotent
    });

    it('≤120 einzeilig → bleibt einzeilig', async () => {
        const out = await format('fn T(a: Euro, b: Euro): Euro = a + b\n');
        expect(out).toContain('fn T(a: Euro, b: Euro): Euro = a + b');
        expect(await format(out)).toBe(out);
    });

    it('langer konst-Ausdruck > 120 bricht ebenfalls um', async () => {
        const out = await format(
            'konst R: EuroCent = AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
            + ' + BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB + CCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
            + ' + DDDDDDDDDDDDDDDDDDDDDDDDDDDDDD + EEEEEEEEEEEEEEEEEEEEEEEEEEEEEE\n',
        );
        expect(out).toContain('= AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n    + BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB');
        expect(await format(out)).toBe(out);          // idempotent
    });
});

describe('Formatter: wähle-Arm-RHS Operator-Kette > 120 bricht (idempotent)', () => {
    it('Nutzer-Fall VerlustVerrechnungsobergrenze10a: sonst-RHS bricht, -> bleibt ausgerichtet', async () => {
        const out = await format(
            'fn VerlustVerrechnungsobergrenze10a(gewerbeertrag: EuroCent): EuroCent = wähle {\n'
            + 'falls gewerbeertrag <= 0,00 -> 0,00\n'
            + 'falls gewerbeertrag <= VERLUST_SOCKEL_10A -> gewerbeertrag\n'
            + 'sonst -> VERLUST_SOCKEL_10A'
            + ' + (VERLUST_QUOTE_10A * (gewerbeertrag - VERLUST_SOCKEL_10A)) als EuroCent\n}\n',
        );
        expect(out).toContain(
            '    falls gewerbeertrag <= 0,00               -> 0,00\n'
            + '    falls gewerbeertrag <= VERLUST_SOCKEL_10A -> gewerbeertrag\n'
            + '    sonst                                     -> VERLUST_SOCKEL_10A\n'
            + '        + (VERLUST_QUOTE_10A * (gewerbeertrag - VERLUST_SOCKEL_10A)) als EuroCent\n',
        );
        out.split('\n').forEach((l) => expect(l.length).toBeLessThanOrEqual(120));
        expect(await format(out)).toBe(out);          // idempotent (war vorher Oszillation!)
    });

    it('kurze Arm-RHS-Kette bleibt einzeilig', async () => {
        const out = await format(
            'fn H(a: EuroCent, b: EuroCent): EuroCent = wähle {\n'
            + 'falls a > b -> a + b\nsonst -> b\n}\n',
        );
        expect(out).toContain('    falls a > b -> a + b\n    sonst       -> b\n');
        expect(await format(out)).toBe(out);
    });
});

describe('Formatter: Aufruf mit benannten Argumenten — Zwei-Spalten', () => {
    it('Nutzer-Fall: Konstruktor-Aufruf, alle = fluchten (Spalte = längster Name + 1)', async () => {
        const out = await format(
            'fn B(): GewerbesteuerErgebnis = GewerbesteuerErgebnis(\n'
            + 'gewinn = g,\n'
            + 'summeHinzurechnungen = h8,\n'
            + 'abgerundeterGewerbeertrag = abgerundet,\n'
            + 'gewerbesteuer = steuer,\n)\n',
        );
        expect(out).toContain(
            'GewerbesteuerErgebnis(\n'
            + '    gewinn                    = g,\n'
            + '    summeHinzurechnungen      = h8,\n'
            + '    abgerundeterGewerbeertrag = abgerundet,\n'
            + '    gewerbesteuer             = steuer,\n'
            + ')',
        );
        expect(await format(out)).toBe(out);          // idempotent
    });

    it('einzeiliger benannter Aufruf bleibt kompakt (name = wert, ein Space)', async () => {
        const out = await format('fn F(): Euro = G(a = 1 als Euro, b = 2 als Euro)\n');
        expect(out).toContain('G(a = 1 als Euro, b = 2 als Euro)');
        expect(await format(out)).toBe(out);
    });

    it('positionale Argumente: keine =-Ausrichtung, kein Schaden', async () => {
        const out = await format('fn F(x: Euro): Euro = H(x, x)\n');
        expect(out).toContain('H(x, x)');
        expect(await format(out)).toBe(out);
    });

    it('verschachtelter benannter Aufruf: inneres = unberührt vom äußeren', async () => {
        const out = await format(
            'fn F(): A = A(\nlangerName = B(k = 1 als Euro),\nx = 2 als Euro,\n)\n',
        );
        expect(out).toContain('    langerName = B(k = 1 als Euro),\n    x          = 2 als Euro,\n)');
        expect(await format(out)).toBe(out);          // idempotent
    });
});

describe('Formatter: @formatter:off / @formatter:on (SPEC § 2.3.1)', () => {
    // Bereichs-Formatierung über den geteilten Chokepoint.
    async function formatRange(src: string): Promise<string> {
        const services = createFindslServices(NodeFileSystem).Findsl;
        const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
            src, URI.parse('file:///fmt.findsl'),
        );
        services.shared.workspace.LangiumDocuments.addDocument(doc);
        await services.shared.workspace.DocumentBuilder.build([doc], { validation: false });
        const end = doc.textDocument.positionAt(src.length);
        const edits = await services.lsp.Formatter!.formatDocumentRange(doc, {
            textDocument: { uri: doc.uri.toString() },
            options: { tabSize: 4, insertSpaces: true },
            range: { start: { line: 0, character: 0 }, end },
        });
        return TextDocument.applyEdits(doc.textDocument, edits);
    }

    const OFF_BLOCK = '// @formatter:off\n'
        + 'konst    Y   :   Euro   =    2\n'
        + '// @formatter:on';

    it('1 — Quelltext zwischen OFF/ON byte-für-byte erhalten, außen formatiert', async () => {
        const out = await format(
            'konst X: Euro =    1\n\n' + OFF_BLOCK + '\n\nkonst Z: Euro =   3\n',
        );
        expect(out).toContain('konst X: Euro = 1\n');     // außen kanonisch
        expect(out).toContain('konst Z: Euro = 3');
        expect(out).toContain(OFF_BLOCK);                 // innen byte-genau (inkl. Direktiv-Zeilen)
    });

    it('2 — idempotent mit OFF/ON-Region', async () => {
        const src = 'konst A: Euro =  1\n' + OFF_BLOCK + '\n';
        const once = await format(src);
        expect(await format(once)).toBe(once);
    });

    it('3 — ohne Direktive: normale Formatierung unverändert (Fast-Path)', async () => {
        const out = await format('konst    A   :   Euro   =    1\n');
        expect(out).toContain('konst A: Euro = 1');
    });

    it('4 — OFF ohne ON: bis Dateiende geschützt, davor formatiert', async () => {
        const out = await format(
            'konst A: Euro =   1\n// @formatter:off\nkonst    B   :   Euro   =   2\n',
        );
        expect(out).toContain('konst A: Euro = 1\n');
        expect(out).toContain('// @formatter:off\nkonst    B   :   Euro   =   2');
    });

    it('5 — Streu-ON ohne OFF: ganzes Dokument normal formatiert', async () => {
        const out = await format('// @formatter:on\nkonst    C   :   Euro   =   3\n');
        expect(out).toContain('konst C: Euro = 3');
    });

    it('6 — verschachteltes OFF…OFF…ON = genau eine Region', async () => {
        const out = await format(
            '// @formatter:off\nkonst    D:Euro=1\n// @formatter:off\nkonst    E:Euro=2\n'
            + '// @formatter:on\nkonst F: Euro =   3\n',
        );
        expect(out).toContain(
            '// @formatter:off\nkonst    D:Euro=1\n// @formatter:off\nkonst    E:Euro=2\n// @formatter:on',
        );
        expect(out).toContain('konst F: Euro = 3');
    });

    it('7 — `//` in String-Literal ist KEINE Direktive (token-basiert)', async () => {
        const out = await format(
            'konst S: Text = "// @formatter:off"\nkonst    G   :   Euro   =   1\n',
        );
        expect(out).toContain('konst G: Euro = 1');       // keine Region ⇒ formatiert
    });

    it('8 — Trailing-OFF nach Code: ab dieser ganzen Zeile geschützt', async () => {
        const src = 'konst H: Euro =   1   // @formatter:off\nkonst    I:Euro=2\n// @formatter:on\n';
        const out = await format(src);
        expect(out).toContain('konst H: Euro =   1   // @formatter:off\nkonst    I:Euro=2');
    });

    it('9 — Range-Formatierung respektiert OFF-Region', async () => {
        const out = await formatRange(
            'konst X: Euro =   1\n' + OFF_BLOCK + '\nkonst Z: Euro =   3\n',
        );
        expect(out).toContain('konst X: Euro = 1\n');
        expect(out).toContain(OFF_BLOCK);
    });

    it('10 — docTagEdits in OFF-Region unterdrückt, außerhalb ausgerichtet', async () => {
        const inside = await format(
            '// @formatter:off\n--\n@param x erstes\n@rückgabe ergebnis\n--\n'
            + 'fn f(x: Euro): Euro = x\n// @formatter:on\n',
        );
        expect(inside).toContain('@param x erstes\n@rückgabe ergebnis');   // nicht ausgerichtet
        const outside = await format(
            '--\n@param x erstes\n@rückgabe ergebnis\n--\nfn f(x: Euro): Euro = x\n',
        );
        expect(outside).not.toContain('@param x erstes\n@rückgabe ergebnis'); // ausgerichtet
    });
});

describe('Formatter: datensatz-Felder als 4-Spalten-Tabelle (Issue #202)', () => {
    it('Felder ohne Default — Typ-Spalte irrelevant, `,` klebt am Typ', async () => {
        const out = await format(
            'datensatz Fall(\n'
            + '    art: Fahrzeugart,\n'
            + '    antrieb: Antrieb,\n'
            + ')\n',
        );
        // Spalte 1: `art:` und `antrieb:` fluchten (bestehende Logik).
        expect(out).toMatch(/^    art:     Fahrzeugart,$/m);
        expect(out).toMatch(/^    antrieb: Antrieb,$/m);
    });

    it('Mit Default — `=` fluchtet, `,` direkt nach Default-Wert', async () => {
        const out = await format(
            'datensatz Fall(\n'
            + '    hubraumCcm: Ganzzahl = 0,\n'
            + '    erstzulassung: Erstzulassungsregime = AbJan2021,\n'
            + '    pkwStufe: PkwSchadstoffstufe = Ee,\n'
            + ')\n',
        );
        // Alle `=` in derselben Spalte: maxTypeLen('Erstzulassungsregime')=20
        //  → kürzere Typen werden mit zusätzlichen Spaces gepaddet.
        const lines = out.split('\n');
        const eqCols = lines
            .filter((l) => l.includes(' = '))
            .map((l) => l.indexOf(' = '));
        expect(new Set(eqCols).size).toBe(1);     // alle gleichmäßig
    });

    it('Gemischt: Default + kein Default → `,` an verschiedenen Positionen', async () => {
        const out = await format(
            'datensatz Fall(\n'
            + '    art: Fahrzeugart,\n'
            + '    hubraumCcm: Ganzzahl = 0,\n'
            + ')\n',
        );
        // Feld ohne Default: `,` klebt direkt am Typ (kein Padding-Komma).
        expect(out).toMatch(/Fahrzeugart,/);
        expect(out).not.toMatch(/Fahrzeugart\s+,/);
        // Feld mit Default: `= 0,`.
        expect(out).toMatch(/= 0,/);
    });

    it('Inline-Kommentare — `//` fluchtet über alle Felder', async () => {
        const out = await format(
            'datensatz Fall(\n'
            + '    art: Fahrzeugart, // Auswahl\n'
            + '    hubraumCcm: Ganzzahl = 0, // cm³\n'
            + '    erstzulassung: Erstzulassungsregime = AbJan2021, // PKW\n'
            + ')\n',
        );
        const lines = out.split('\n');
        const commentCols = lines
            .filter((l) => l.includes('//'))
            .map((l) => l.indexOf('//'));
        expect(new Set(commentCols).size).toBe(1);
    });

    it('Kein trailing-Kommentar → keine Trailing-Spaces eingefügt', async () => {
        const out = await format(
            'datensatz Fall(\n'
            + '    art: Fahrzeugart,\n'
            + '    hubraumCcm: Ganzzahl = 0,\n'
            + ')\n',
        );
        for (const line of out.split('\n')) {
            expect(line).not.toMatch(/\s+$/);   // kein trailing whitespace
        }
    });

    it('Idempotenz — zweimal formatieren ergibt identischen Output', async () => {
        const src = 'datensatz Fall(\n'
            + '    art: Fahrzeugart, // Auswahl\n'
            + '    hubraumCcm: Ganzzahl = 0, // cm³\n'
            + '    erstzulassung: Erstzulassungsregime = AbJan2021, // PKW\n'
            + ')\n';
        const once = await format(src);
        const twice = await format(once);
        expect(twice).toBe(once);
    });
});

describe('Formatter: fn-Parameter als 4-Spalten-Tabelle (Folge zu #202)', () => {
    it('Mehrzeilige fn-Signatur — Params fluchten (Spalte 1 Name, Spalte 2 Typ)', async () => {
        const out = await format(
            'fn berechne(\n'
            + '    zve: Euro,\n'
            + '    tarifart: Tarifart,\n'
            + '): Euro = 0 als Euro\n',
        );
        // Spalte 1 (Name + `:`) fluchtet
        expect(out).toMatch(/^    zve:      Euro,$/m);
        expect(out).toMatch(/^    tarifart: Tarifart,$/m);
    });

    it('Mit Default — `=` fluchtet über alle Default-Params', async () => {
        const out = await format(
            'fn f(\n'
            + '    x: Euro = 0 als Euro,\n'
            + '    art: Tarifart = Grundtarif,\n'
            + '    klasse: Steuerklasse = I,\n'
            + '): Euro = 0 als Euro\n',
        );
        const lines = out.split('\n');
        const eqCols = lines
            .filter((l) => l.includes(' = ') && !l.includes('): Euro = 0'))
            .map((l) => l.indexOf(' = '));
        expect(new Set(eqCols).size).toBe(1);     // alle Param-`=` fluchten
    });

    it('Gemischt: Default + kein Default → `,` direkt am Typ ohne Default', async () => {
        const out = await format(
            'fn f(\n'
            + '    a: Euro,\n'
            + '    b: Euro = 0 als Euro,\n'
            + '): Euro = a\n',
        );
        // `Euro,` direkt nach Typ bei Param ohne Default
        expect(out).toMatch(/^    a:[ ]+Euro,$/m);
        // Param mit Default hat `=`-Padding
        expect(out).toMatch(/^    b:[ ]+Euro\s+= 0 als Euro,$/m);
    });

    it('Inline-Kommentare in fn-Params — `//` fluchtet', async () => {
        const out = await format(
            'fn f(\n'
            + '    a: Euro, // erstes\n'
            + '    b: Euro = 0 als Euro, // zweites\n'
            + '): Euro = a\n',
        );
        const lines = out.split('\n');
        const commentCols = lines
            .filter((l) => l.match(/^    [a-z]/) && l.includes('//'))
            .map((l) => l.indexOf('//'));
        expect(commentCols.length).toBe(2);
        expect(new Set(commentCols).size).toBe(1);
    });

    it('Idempotenz — zweimal formatieren ergibt identischen Output', async () => {
        const src = 'fn f(\n'
            + '    a: Euro, // erstes\n'
            + '    b: Euro = 0 als Euro, // zweites\n'
            + '): Euro = a\n';
        const once = await format(src);
        const twice = await format(once);
        expect(twice).toBe(once);
    });

    it('Einzeilige fn bleibt kompakt (kein Spalten-Padding)', async () => {
        const out = await format('fn f(a: Euro, b: Euro): Euro = a + b\n');
        expect(out).toContain('fn f(a: Euro, b: Euro): Euro = a + b');
    });
});
