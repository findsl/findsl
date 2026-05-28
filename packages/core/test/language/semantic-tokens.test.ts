/**
 * Tests für den Semantic-Tokens-Provider. Wir parsen Snippets, lassen
 * `semanticHighlight` laufen und dekodieren das Ergebnis mit
 * `SemanticTokensDecoder`. Geprüft werden Token-Typ + Modifier
 * (insb. `defaultLibrary` für Builtins, `declaration` für Decls).
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { SemanticTokensDecoder, AllSemanticTokenModifiers } from 'langium/lsp';
import { createFindslServices } from '../../src/language/findsl-module.js';

interface Tok { offset: number; tokenType: string; tokenModifiers: number; text: string; }

async function decodeIn(
    sources: Record<string, string>, main: string,
): Promise<Tok[]> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const docs = Object.entries(sources).map(([n, s]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(
            s, URI.parse(`file:///${n}.findsl`),
        ),
    );
    for (const d of docs) services.shared.workspace.LangiumDocuments.addDocument(d);
    await services.shared.workspace.DocumentBuilder.build(docs, { validation: false });

    const provider = services.lsp.SemanticTokenProvider!;
    const doc = docs.find((d) => d.uri.path.endsWith(`/${main}.findsl`))!;
    const result = await provider.semanticHighlight(doc, {
        textDocument: { uri: doc.uri.toString() },
    });
    return SemanticTokensDecoder.decode(result, provider.tokenTypes, doc) as Tok[];
}

const decode = (src: string) => decodeIn({ m: src }, 'm');

const has = (m: number, name: keyof typeof AllSemanticTokenModifiers): boolean =>
    (m & AllSemanticTokenModifiers[name]) !== 0;

const pick = (toks: Tok[], text: string, type?: string): Tok | undefined =>
    toks.find((t) => t.text === text && (type ? t.tokenType === type : true));

describe('Semantic-Tokens: Builtins (defaultLibrary)', () => {
    it('Builtin-Primitive in Annotation', async () => {
        const toks = await decode(`konst K: Euro = 1 als Euro
`);
        const euro = pick(toks, 'Euro', 'type');
        expect(euro).toBeDefined();
        expect(has(euro!.tokenModifiers, 'defaultLibrary')).toBe(true);
    });

    it('Builtin-Aufzählung als Typ', async () => {
        const toks = await decode(`fn f(art: Tarifart): Euro = 0 als Euro
`);
        const t = pick(toks, 'Tarifart', 'enum');
        expect(t).toBeDefined();
        expect(has(t!.tokenModifiers, 'defaultLibrary')).toBe(true);
    });

    it('Builtin-Aufzählungs-Wert in Expression', async () => {
        const toks = await decode(`fn f(): Tarifart = Grundtarif
`);
        const v = pick(toks, 'Grundtarif', 'enumMember');
        expect(v).toBeDefined();
        expect(has(v!.tokenModifiers, 'defaultLibrary')).toBe(true);
    });

    // (Entfernt 2026-05-18: freie Builtin-Funktion `abrundenEuro` gibt es
    // nicht mehr — § 11.1 ist die Methode `.abrunden()`. Methoden-Builtin-
    // Namen werden — wie die § 11.2-Listenmethoden-Namen — nicht eigens
    // als `function`/`defaultLibrary` getokent; Parität gewahrt. Builtin-
    // Primitive/Aufzählungen oben bleiben abgedeckt.)
});

describe('Semantic-Tokens: Deklarationen', () => {
    it('konst → variable + declaration + readonly', async () => {
        const toks = await decode(`konst GFB: Euro = 1 als Euro
`);
        const t = pick(toks, 'GFB', 'variable')!;
        expect(has(t.tokenModifiers, 'declaration')).toBe(true);
        expect(has(t.tokenModifiers, 'readonly')).toBe(true);
    });

    it('datensatz → class + Feld → property (declaration)', async () => {
        const toks = await decode(`datensatz Fall(betrag: Euro)
`);
        const d = pick(toks, 'Fall', 'class')!;
        expect(has(d.tokenModifiers, 'declaration')).toBe(true);
        const f = pick(toks, 'betrag', 'property')!;
        expect(has(f.tokenModifiers, 'declaration')).toBe(true);
    });

    it('aufzählung → enum + Werte → enumMember', async () => {
        const toks = await decode(`aufzählung Ampel { Rot, Gelb }
`);
        expect(has(pick(toks, 'Ampel', 'enum')!.tokenModifiers, 'declaration')).toBe(true);
        expect(pick(toks, 'Rot', 'enumMember')).toBeDefined();
    });

    it('Parameter-Deklaration vs. -Verwendung', async () => {
        const toks = await decode(`fn f(zve: Euro): Euro = zve
`);
        const decl = toks.find((t) => t.text === 'zve' && has(t.tokenModifiers, 'declaration'));
        const use  = toks.find((t) => t.text === 'zve' && !has(t.tokenModifiers, 'declaration'));
        expect(decl?.tokenType).toBe('parameter');
        expect(use?.tokenType).toBe('parameter');
    });
});

describe('Semantic-Tokens: Referenzen & Sonstiges', () => {
    it('User-Funktion und -Konstante referenziert', async () => {
        const toks = await decode(`konst BASIS: Euro = 1 als Euro
fn g(x: Euro): Euro = x
fn h(x: Euro): Euro = g(x) + BASIS
`);
        const gUse = toks.filter((t) => t.text === 'g' && !has(t.tokenModifiers, 'declaration'));
        expect(gUse[0]?.tokenType).toBe('function');
        const bUse = toks.filter((t) => t.text === 'BASIS' && !has(t.tokenModifiers, 'declaration'));
        expect(bUse[0]?.tokenType).toBe('variable');
        expect(has(bUse[0]!.tokenModifiers, 'readonly')).toBe(true);
    });

    it('@Quelle → decorator, abbruch → keyword', async () => {
        const toks = await decode(`@Quelle("§ 32a EStG")
fn f(zve: Euro): Euro = abbruch("§ 32a EStG: unzulässig")
`);
        expect(pick(toks, 'Quelle', 'decorator')).toBeDefined();
        expect(pick(toks, 'abbruch', 'keyword')).toBeDefined();
    });

    it('User-Datensatz als Typ → class (kein defaultLibrary)', async () => {
        const toks = await decode(`datensatz Steuerfall(b: Euro)
fn f(s: Steuerfall): Euro = s.b
`);
        const typeRef = toks.find(
            (t) => t.text === 'Steuerfall' && t.tokenType === 'class'
                && !has(t.tokenModifiers, 'declaration'),
        );
        expect(typeRef).toBeDefined();
        expect(has(typeRef!.tokenModifiers, 'defaultLibrary')).toBe(false);
        expect(pick(toks, 'b', 'property')).toBeDefined();   // Feldzugriff s.b
    });

    it('Cross-Modul-Datensatz als Typ → class', async () => {
        const toks = await decodeIn({
            lib: `datensatz Person(name: Text)
`,
            app: `verwende {Person} aus "./lib"
fn f(p: Person): Text = p.name
`,
        }, 'app');
        const t = toks.find((x) => x.text === 'Person' && x.tokenType === 'class');
        expect(t).toBeDefined();
    });

    it('User-Aufzählungs-Wert in Referenz → enumMember', async () => {
        // Werte sind Strings in AufzaehlungDecl.values, keine eigenen
        // Top-Level-Decls. Klassifizierung muss trotzdem `enumMember`
        // liefern (Theme stylt sie unterstrichen, Issue zum
        // Aufzählungs-Werte-Highlighting).
        const toks = await decode(`aufzählung Farbe { Rot, Grün, Blau }
konst K: Farbe = Rot
`);
        // Die Decl-Stelle (innerhalb der aufzählung) ist seit jeher
        // enumMember; entscheidend ist die Referenz `= Rot` in Z.1.
        const refs = toks.filter((t) => t.text === 'Rot' && t.tokenType === 'enumMember');
        expect(refs.length).toBeGreaterThanOrEqual(2); // Decl + Referenz
    });

    it('User-Aufzählungs-Wert als wähle-Pattern → enumMember', async () => {
        const toks = await decode(`aufzählung Stand { Aktiv, Pause }
fn f(s: Stand): Ganzzahl = wähle (s) {
    falls Aktiv -> 1
    falls Pause -> 0
}
`);
        expect(pick(toks, 'Aktiv', 'enumMember')).toBeDefined();
        expect(pick(toks, 'Pause', 'enumMember')).toBeDefined();
    });

    it('Cross-Modul Aufzählungs-Wert via verwende → enumMember', async () => {
        const toks = await decodeIn({
            lib: `aufzählung Tarifart { Grund, Spez }
`,
            app: `verwende { Grund } aus "./lib"
konst T: Ganzzahl = wähle (Grund) {
    falls Grund -> 1
    sonst       -> 0
}
`,
        }, 'app');
        // Mindestens der Pattern-Treffer `falls Grund` muss enumMember sein.
        const grundRefs = toks.filter((t) => t.text === 'Grund' && t.tokenType === 'enumMember');
        expect(grundRefs.length).toBeGreaterThanOrEqual(1);
    });
});
