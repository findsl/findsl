/**
 * Tests für den Inlay-Hint-Provider: Parameter-Namen an positionalen
 * Argumenten + Geld-/Prozent-Einheit hinter blanken Zahl-Literalen.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import { InlayHintKind, type InlayHint } from 'vscode-languageserver';

const FULL_RANGE = {
    start: { line: 0, character: 0 },
    end:   { line: 100000, character: 0 },
};

async function hintsIn(
    sources: Record<string, string>, main: string,
): Promise<InlayHint[]> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const docs = Object.entries(sources).map(([n, s]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(
            s, URI.parse(`file:///${n}.findsl`),
        ),
    );
    for (const d of docs) services.shared.workspace.LangiumDocuments.addDocument(d);
    await services.shared.workspace.DocumentBuilder.build(docs, { validation: false });
    const doc = docs.find((d) => d.uri.path.endsWith(`/${main}.findsl`))!;
    const r = await services.lsp.InlayHintProvider!.getInlayHints(doc, {
        textDocument: { uri: doc.uri.toString() }, range: FULL_RANGE,
    });
    return r ?? [];
}

async function hintsRange(
    src: string, range: { start: { line: number; character: number }; end: { line: number; character: number } },
): Promise<InlayHint[]> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        src, URI.parse('file:///m.findsl'),
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    return (await services.lsp.InlayHintProvider!.getInlayHints(doc, {
        textDocument: { uri: doc.uri.toString() }, range,
    })) ?? [];
}

const hints = (src: string) => hintsIn({ m: src }, 'm');
const labels = (hs: InlayHint[]) => hs.map((h) => h.label as string);
const param = (hs: InlayHint[]) => hs.filter((h) => h.kind === InlayHintKind.Parameter);
const types = (hs: InlayHint[]) => hs.filter((h) => h.kind === InlayHintKind.Type);

describe('Inlay-Hints: Parameter-Namen', () => {
    it('positionale Argumente bekommen den Parameter-Namen', async () => {
        const hs = await hints(`fn est(zve: Euro, art: Tarifart): Euro = 0 als Euro
fn ruf(): Euro = est(60.000, Grundtarif)
`);
        expect(labels(param(hs))).toEqual(expect.arrayContaining(['zve:', 'art:']));
    });

    it('benannte Argumente bekommen KEINEN Namens-Hint', async () => {
        const hs = await hints(`fn f(x: Euro): Euro = x
fn g(): Euro = f(x = 1 als Euro)
`);
        expect(labels(param(hs))).not.toContain('x:');
    });

    it('Datensatz-Konstruktor: Feld-Namen als Hints', async () => {
        const hs = await hints(`datensatz Fall(betrag: Euro, satz: Prozent)
fn f(): Fall = Fall(1.000, 5%)
`);
        expect(labels(param(hs))).toEqual(expect.arrayContaining(['betrag:', 'satz:']));
    });

    it('Cross-Modul-Aufruf', async () => {
        const hs = await hintsIn({
            lib: `fn kern(z: Euro): Euro = z
`,
            app: `verwende {kern} aus "./lib"
fn f(): Euro = kern(99)
`,
        }, 'app');
        expect(labels(param(hs))).toContain('z:');
    });

    it('kein Hint ohne Aufruf / bei unbekanntem Ziel', async () => {
        const hs = await hints(`fn f(x: Euro): Euro = x
konst K: Euro = unbekannt
`);
        expect(param(hs)).toHaveLength(0);
    });
});

describe('Inlay-Hints: Geld-/Prozent-Einheit', () => {
    it('blankes Zahl-Literal in Euro-Position → "€"', async () => {
        const hs = await hints(`fn est(zve: Euro): Euro = 0 als Euro
fn ruf(): Euro = est(50.000)
`);
        expect(labels(types(hs))).toContain('€');
    });

    it('Cent-Position → "¢"', async () => {
        const hs = await hints(`fn f(c: Cent): Cent = c
fn ruf(): Cent = f(250)
`);
        expect(labels(types(hs))).toContain('¢');
    });

    it('Cross-Modul: importierter Euro-Rückgabetyp → "€" im prüfe-Vergleich', async () => {
        // Spiegelt das `.test`-Modul-Szenario: der Rückgabetyp der
        // importierten Funktion muss über den Workspace aufgelöst
        // werden, sonst (unknown) fehlt der €-Hint.
        const hs = await hintsIn({
            lib: `fn kern(z: Euro): Euro = z
`,
            'app.test': `verwende { kern } aus "./lib"
prüfe "P" {
    testfall "t" {
        kern(100) == 0
    }
}
`,
        }, 'app.test');
        expect(labels(types(hs))).toContain('€');
    });

    it('§ 11.1-Methode `.abrunden()`: ParenChain-Ergebnis bekommt "€"', async () => {
        // Kein Parameter-Name-Hint mehr (parameterlose Methode); der
        // type-checker-getriebene Geld-Einheit-Hint am Rundungsergebnis
        // (Euro) bleibt — ParenChain ist wie CallChain ein Geld-Leaf.
        const hs = await hints(`fn f(b: Euro): Euro = (b * 5%).abrunden()
`);
        expect(labels(types(hs))).toContain('€');
    });

    it('%-Suffix bekommt KEINEN Einheit-Hint (schon sichtbar)', async () => {
        const hs = await hints(`fn f(s: Prozent): Prozent = s
fn g(): Prozent = f(42%)
`);
        expect(labels(param(hs))).toContain('s:');
        expect(labels(types(hs))).not.toContain(': Prozent');
    });

    it('als-Cast-Argument bekommt KEINEN Einheit-Hint am Aufruf', async () => {
        // Rückgabetyp Wahrheitswert → kein Aufrufergebnis-€; Fokus: das
        // `als`-Cast-Argument selbst bekommt keine Einheit. Seit Issue
        // #65 bekommt der Param `zve: Euro` (ohne Default) einen
        // €-Hint nach der Typ-Annotation in der `est`-Signatur — der
        // Cast-Argument-Pfad bleibt aber weiterhin hint-frei.
        const hs = await hints(`fn est(zve: Euro): Wahrheitswert = wahr
fn ruf(): Wahrheitswert = est(50.000 als Euro)
`);
        expect(labels(param(hs))).toContain('zve:');
        // €-Hint nur an der Param-Deklaration (Zeile 0), nicht am Aufruf (Zeile 1):
        expect(types(hs).filter((h) => h.position.line === 1)).toHaveLength(0);
        expect(types(hs).filter((h) => h.position.line === 0 && h.label === '€')).toHaveLength(1);
    });

    it('Nicht-Geld-Parameter bekommt KEINEN Einheit-Hint', async () => {
        const hs = await hints(`fn f(n: Ganzzahl): Ganzzahl = n
fn g(): Ganzzahl = f(5)
`);
        expect(labels(param(hs))).toContain('n:');
        expect(types(hs)).toHaveLength(0);
    });
});

describe('Inlay-Hints: Konstanten-Deklaration mit Währungssymbol', () => {
    it('konst mit Euro → "€" hinter dem Wert', async () => {
        const hs = await hints('konst GFB: Euro = 12.096\n');
        expect(labels(types(hs))).toContain('€');
    });

    it('konst mit Cent → "¢"', async () => {
        const hs = await hints('konst K: Cent = 250\n');
        expect(labels(types(hs))).toContain('¢');
    });

    it('konst mit EuroCent → "€"', async () => {
        const hs = await hints('konst P: EuroCent = 3.434,00\n');
        expect(labels(types(hs))).toContain('€');
    });

    it('konst ohne Geldtyp bekommt KEINEN Symbol-Hint', async () => {
        const hs = await hints('konst N: Ganzzahl = 5\n');
        expect(types(hs)).toHaveLength(0);
    });

    it('als-Cast bekommt KEIN Symbol, nackte Euro-Referenz schon', async () => {
        const hs = await hints(
            'konst A: Euro = 1 als Euro\nkonst B: Euro = A\n',
        );
        // Zeile 0 (`1 als Euro`, Cast) ohne €; Zeile 1 (`A`, Referenz) mit €.
        expect(types(hs).some((h) => h.position.line === 0)).toBe(false);
        expect(types(hs).some((h) => h.position.line === 1 && h.label === '€')).toBe(true);
    });
});

describe('Inlay-Hints: var-Bindung + datensatz-Feld-Default mit Symbol', () => {
    it('var mit Euro → "€"', async () => {
        const hs = await hints(
            'fn f(): Euro = {\n  var x: Euro = 12.096\n  x\n}\n',
        );
        expect(labels(types(hs))).toContain('€');
    });

    it('var mit Cent → "¢"', async () => {
        const hs = await hints(
            'fn f(): Cent = {\n  var c: Cent = 250\n  c\n}\n',
        );
        expect(labels(types(hs))).toContain('¢');
    });

    it('datensatz-Feld-Default Euro → "€"', async () => {
        const hs = await hints('datensatz X(a: Euro = 0)\n');
        expect(labels(types(hs))).toContain('€');
    });

    it('datensatz-Feld-Default Cent → "¢"', async () => {
        const hs = await hints('datensatz Y(c: Cent = 100)\n');
        expect(labels(types(hs))).toContain('¢');
    });

    it('Feld OHNE Default bekommt Symbol-Hint NACH der Typ-Annotation (Issue #65)', async () => {
        const hs = await hints('datensatz Z(b: Euro)\n');
        expect(labels(types(hs))).toContain('€');
    });

    it('Feld OHNE Default Cent → "¢" nach der Typ-Annotation', async () => {
        const hs = await hints('datensatz Y(c: Cent)\n');
        expect(labels(types(hs))).toContain('¢');
    });

    it('Feld OHNE Default EuroCent → "€" nach der Typ-Annotation', async () => {
        const hs = await hints('datensatz X(p: EuroCent)\n');
        expect(labels(types(hs))).toContain('€');
    });

    it('fn-Parameter-Default Euro → "€"', async () => {
        const hs = await hints('fn f(x: Euro = 0): Euro = x\n');
        expect(labels(types(hs))).toContain('€');
    });

    it('fn-Parameter-Default Cent → "¢"', async () => {
        const hs = await hints('fn g(c: Cent = 100): Cent = c\n');
        expect(labels(types(hs))).toContain('¢');
    });

    it('Param ohne Default → Symbol-Hint NACH der Typ-Annotation (Issue #65)', async () => {
        // Rückgabetyp Wahrheitswert → kein fn-Rumpf-Symbol; Fokus: Params.
        // `b: Euro` ohne Default bekommt Hint nach Typ; `y: Euro = 0 als Euro`
        // bekommt KEINEN Hint (als-Cast macht Typ explizit sichtbar — bestehendes Verhalten).
        const hs = await hints(
            'fn h(b: Euro, y: Euro = 0 als Euro): Wahrheitswert = wahr\n',
        );
        expect(labels(types(hs))).toEqual(['€']);
    });

    it('Param ohne Default Cent → "¢"', async () => {
        const hs = await hints('fn k(c: Cent): Wahrheitswert = wahr\n');
        expect(labels(types(hs))).toContain('¢');
    });
});

describe('Inlay-Hints: Prozent-Einheit (Issue #65)', () => {
    it('konst mit Prozent (Nicht-Literal-Wert) → "%"', async () => {
        const hs = await hints(
            'fn berechne(): Prozent = 19%\nkonst SATZ: Prozent = berechne()\n',
        );
        // Hint am Aufruf-Ergebnis (Leaf), nicht am Literal in `berechne`.
        const prozentHints = types(hs).filter((h) => h.label === '%');
        expect(prozentHints.length).toBeGreaterThanOrEqual(1);
    });

    it('konst mit Prozent-Literal (`19%`) → KEIN doppelter "%" am Literal', async () => {
        const hs = await hints('konst SATZ: Prozent = 19%\n');
        // Suffix-Skip: das `%` ist im Literal sichtbar.
        expect(types(hs).filter((h) => h.label === '%')).toHaveLength(0);
    });

    it('var mit Prozent (Nicht-Literal) → "%"', async () => {
        const hs = await hints(
            'fn berechne(): Prozent = 7%\n'
            + 'fn f(): Prozent = {\n  var s: Prozent = berechne()\n  s\n}\n',
        );
        expect(labels(types(hs))).toContain('%');
    });

    it('Field OHNE Default Prozent → "%" nach Typ-Annotation', async () => {
        const hs = await hints('datensatz Tarif(satz: Prozent)\n');
        expect(labels(types(hs))).toContain('%');
    });

    it('Field MIT Prozent-Literal-Default → KEIN doppelter "%"', async () => {
        const hs = await hints('datensatz Tarif(satz: Prozent = 19%)\n');
        expect(types(hs).filter((h) => h.label === '%')).toHaveLength(0);
    });

    it('Param OHNE Default Prozent → "%" nach Typ-Annotation', async () => {
        const hs = await hints(
            'fn anwende(satz: Prozent): Prozent = satz\n',
        );
        expect(labels(types(hs))).toContain('%');
    });
});

describe('Inlay-Hints: Symbol in +/- -Ausdruck (Typ-Propagierung)', () => {
    it('konst EuroCent = B + 10,23 → "€" am Literal 10,23', async () => {
        const hs = await hints(
            'konst B: Euro = 233\nkonst Z: EuroCent = B + 10,23\n',
        );
        expect(labels(types(hs))).toContain('€');
        // Symbol sitzt am Literal in Zeile 1 (B+10,23), nicht an B.
        expect(types(hs).some((h) => h.position.line === 1)).toBe(true);
    });

    it('verschachtelt: (B + 10,23) - 1,00 → drei "€" (B-Ref + 2 Literale)', async () => {
        const hs = await hints(
            'konst B: Euro = 233\nkonst Z: EuroCent = (B + 10,23) - 1,00\n',
        );
        expect(types(hs).filter((h) => h.position.line === 1 && h.label === '€').length).toBe(3);
    });

    it('Cent-Kontext: K + 50 → "¢" am Literal 50 (Zeile 1)', async () => {
        const hs = await hints(
            'konst K: Cent = 100\nkonst R: Cent = K + 50\n',
        );
        expect(types(hs).some((h) => h.position.line === 1 && h.label === '¢')).toBe(true);
    });

    it('* / propagieren NICHT (wie Type-Checker): B * 2 ohne Symbol am 2', async () => {
        const hs = await hints(
            'konst B: Euro = 233\nkonst R: EuroCent = B * 2\n',
        );
        // nur ggf. Symbol an B selbst nicht (B ist Referenz); am `2` keiner.
        expect(types(hs).some((h) => h.position.line === 1)).toBe(false);
    });
});

describe('Inlay-Hints: fn-Rumpf + Feldzugriffe in +/- -Kette', () => {
    it('Summe von Euro-Feldern → "€" hinter jedem Feldzugriff', async () => {
        const hs = await hints([
            'datensatz E(a: Euro, b: Euro, c: Euro)',
            'fn s(e: E): Euro =',
            '  e.a',
            '  + e.b',
            '  + e.c',
            '',
        ].join('\n'));
        // 3 €-Hints in den Rumpf-Zeilen 2–4 (Feldzugriffe).
        const euroInBody = types(hs).filter(
            (h) => h.label === '€' && h.position.line >= 2 && h.position.line <= 4,
        );
        expect(euroInBody.length).toBe(3);
    });

    it('fn mit blankem Literal-Rumpf → "€"', async () => {
        const hs = await hints('fn f(): Euro = 12.096\n');
        expect(types(hs).some((h) => h.position.line === 0 && h.label === '€')).toBe(true);
    });

    it('einzelner Euro-Feldzugriff als Rumpf → "€"', async () => {
        const hs = await hints(
            'datensatz E(a: Euro)\nfn s(e: E): Euro = e.a\n',
        );
        expect(types(hs).some((h) => h.position.line === 1 && h.label === '€')).toBe(true);
    });

    it('Differenz zweier nackter Euro-Referenzen (Param − konst) → zwei "€"', async () => {
        const hs = await hints([
            '@Quelle("§ 20 EStG")',
            'konst SPARER_PAUSCHBETRAG: Euro = 1.000',
            'fn einkünfteAusKapital(',
            '    bruttoKapitalerträge: Euro,',
            '): Euro = bruttoKapitalerträge - SPARER_PAUSCHBETRAG',
            '',
        ].join('\n'));
        // Beide Operanden (Zeile 4) sind Euro → je ein €.
        expect(types(hs).filter((h) => h.position.line === 4 && h.label === '€').length).toBe(2);
    });

    it('nackte Referenz als ganzer Rumpf → "€" (Euro-Rückgabetyp)', async () => {
        const hs = await hints(
            '@Quelle("x")\nkonst GFB: Euro = 12.096\nfn f(): Euro = GFB\n',
        );
        expect(types(hs).some((h) => h.position.line === 2 && h.label === '€')).toBe(true);
    });

    it('Elvis-Gruppen `(abz.x oder 0)` → EIN "€" je Klammer (nach `)`)', async () => {
        const hs = await hints([
            'datensatz A(',
            '  altersentlastungsbetrag: Euro?,',
            '  entlastungsbetragAlleinerz: Euro?,',
            '  freibetragLandForst: Euro?)',
            'fn g(summe: Euro, abz: A): Euro =',
            '      summe',
            '    - (abz.altersentlastungsbetrag    oder 0)',
            '    - (abz.entlastungsbetragAlleinerz oder 0)',
            '    - (abz.freibetragLandForst        oder 0)',
            '',
        ].join('\n'));
        // Zeilen 6–8: je genau ein € (die ganze Elvis-Klammer, nicht je
        // Operand doppelt); plus `summe` auf Zeile 5.
        for (const ln of [6, 7, 8]) {
            expect(types(hs).filter((h) => h.position.line === ln && h.label === '€').length).toBe(1);
        }
        expect(types(hs).some((h) => h.position.line === 5 && h.label === '€')).toBe(true);
    });

    it('benannte Datensatz-Konstruktor-Argumente → "€" je Euro-Feld', async () => {
        const hs = await hints([
            'datensatz B(summeEinkünfte: Euro, einkommen: Euro, name: Text)',
            'fn mk(summe: Euro, eink: Euro): B =',
            '  B(',
            '    summeEinkünfte = summe,',
            '    einkommen      = eink,',
            '    name           = "x",',
            '  )',
            '',
        ].join('\n'));
        // Zeile 3 + 4: je ein € (Euro-Felder); Zeile 5 (Text) keins.
        expect(types(hs).some((h) => h.position.line === 3 && h.label === '€')).toBe(true);
        expect(types(hs).some((h) => h.position.line === 4 && h.label === '€')).toBe(true);
        expect(types(hs).some((h) => h.position.line === 5)).toBe(false);
    });

    it('Euro-Aufrufresultat bekommt Symbol (argumentloser Aufruf)', async () => {
        const hs = await hints([
            'fn g(): Euro = 0 als Euro',
            'fn h(): Euro = {',
            '  var s: Euro = g()',
            '  s',
            '}',
            '',
        ].join('\n'));
        // Zeile 2 (`var s: Euro = g()`): € NUR durch das Aufrufresultat
        // (kein Argument, das eins liefern könnte).
        expect(types(hs).some((h) => h.position.line === 2 && h.label === '€')).toBe(true);
    });

    it('wenn-Zweige (Euro) bekommen je ein Symbol', async () => {
        const hs = await hints([
            '@Quelle("x")',
            'konst R: Euro = 1.000',
            'fn f(b: Wahrheitswert): Euro = {',
            '  var anp: Euro = wenn (b) 0 sonst R',
            '  anp',
            '}',
            '',
        ].join('\n'));
        // Zeile 3: `0` und `R` (then/else) → zwei €.
        expect(types(hs).filter((h) => h.position.line === 3 && h.label === '€').length).toBe(2);
    });

    it('wähle-Arm-Resultate (Euro) bekommen je ein Symbol', async () => {
        const hs = await hints([
            '@Quelle("x")',
            'konst R: Euro = 1.000',
            'fn f(s: Steuerklasse): Euro = wähle (s) {',
            '  falls I, II -> 0',
            '  falls III   -> R',
            '}',
            '',
        ].join('\n'));
        // Zeile 3 (`-> 0`) und Zeile 4 (`-> R`) je ein €.
        expect(types(hs).some((h) => h.position.line === 3 && h.label === '€')).toBe(true);
        expect(types(hs).some((h) => h.position.line === 4 && h.label === '€')).toBe(true);
    });
});

describe('Inlay-Hints: type-checker-getrieben (Gap 3 — Vergleich im testfall)', () => {
    it('testfall `… .kfb == 9.600` → "€" hinter 9.600', async () => {
        const hs = await hints([
            'datensatz Frei(kfb: Euro)',
            'fn tabellenFreibetraege(stkl: Steuerklasse, kinder: Ganzzahl): Frei =',
            '  Frei(kfb = 9.600)',
            'prüfe "T" {',
            '  testfall "STKL III, 2 Kinder" {',
            '    tabellenFreibetraege(III, 2).kfb == 9.600',
            '  }',
            '}',
            '',
        ].join('\n'));
        // Zeile 5: das Literal 9.600 im Vergleich ist Euro → €.
        expect(types(hs).some((h) => h.position.line === 5 && h.label === '€')).toBe(true);
    });

    it('testfall ohne Geld-Vergleich → kein €', async () => {
        const hs = await hints([
            'fn f(n: Ganzzahl): Ganzzahl = n',
            'prüfe "T" {',
            '  testfall "x" { f(2) == 2 }',
            '}',
            '',
        ].join('\n'));
        expect(types(hs).filter((h) => h.label === '€' || h.label === '¢')).toHaveLength(0);
    });
});

describe('Inlay-Hints: range-stabil (kein Scroll-Flackern)', () => {
    // Quelltext mit Geld-konst auf Zeile 4; angefragt wird nur Zeile 0.
    // Range-gepruntes Streaming würde den Hint auslassen → Flackern.
    const SRC = [
        'konst A: Euro = 1',// 0
        'konst B: Euro = 2',// 1
        'konst C: Euro = 3',// 2
        'konst D: Euro = 4',// 3
        'konst GFB: Euro = 12.096', // 4
        '',
    ].join('\n');

    it('Hint für späte Zeile erscheint auch bei schmalem Sichtbereich', async () => {
        const nur0 = { start: { line: 0, character: 0 }, end: { line: 0, character: 99 } };
        const hs = await hintsRange(SRC, nur0);
        expect(labels(types(hs))).toContain('€');
        // GFB-Hint sitzt auf Zeile 4, obwohl nur Zeile 0 angefragt wurde.
        expect(types(hs).some((h) => h.position.line === 4)).toBe(true);
    });

    it('gleiches Ergebnis für Voll- und Teil-Range (stabil)', async () => {
        const voll = await hintsRange(SRC, FULL_RANGE);
        const teil = await hintsRange(SRC, {
            start: { line: 2, character: 0 }, end: { line: 2, character: 1 },
        });
        expect(teil.length).toBe(voll.length);
    });
});
