/**
 * Tests für die Unicode-Identifier-Erweiterung (SPEC § 2.5) und die
 * begleitenden Fixes:
 *   - kyrillische/griechische/CJK-Identifier parsen
 *   - Keyword↔Identifier-LONGER_ALT bleibt korrekt (`nichtselbständigeArbeit`
 *     ist EIN Identifier, nicht `nicht` + Rest) — Regression-Schutz für
 *     den FindslTokenBuilder
 *   - verbleibende Fremdzeichen liefern die freundliche Lexer-Diagnose
 *   - der Symbol-nicht-exportiert-Quick-Fix greift jetzt auch bei
 *     Unicode-Symbolnamen
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { Diagnostic, CodeAction } from 'vscode-languageserver';

async function diagnose(
    sources: Record<string, string>, main: string,
): Promise<{ uri: string; diags: Diagnostic[]; services: ReturnType<typeof createFindslServices>['Findsl'] }> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const docs = Object.entries(sources).map(([n, s]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(
            s, URI.parse(`file:///${n}.findsl`),
        ),
    );
    for (const d of docs) services.shared.workspace.LangiumDocuments.addDocument(d);
    await services.shared.workspace.DocumentBuilder.build(docs, { validation: true });
    const doc = docs.find((d) => d.uri.path.endsWith(`/${main}.findsl`))!;
    return { uri: doc.uri.toString(), diags: (doc.diagnostics ?? []) as Diagnostic[], services };
}

describe('Unicode-Identifier parsen', () => {
    // Hinweis: Unicode bleibt für fn/var/Param/Datensatz gültig; nur
    // `konst`-Namen sind hart auf ASCII-UPPER beschränkt (SPEC § 2.5).
    it('Kyrillischer Bezeichner ist ein gültiger Identifier', async () => {
        const { diags } = await diagnose(
            { m: 'fn Сумма(): Euro = 100 als Euro\nkonst R: Euro = Сумма()\n' },
            'm',
        );
        const errors = diags.filter((d) => d.severity === 1);
        expect(errors).toEqual([]);
    });

    it('Griechischer und CJK-Bezeichner parsen', async () => {
        // Großschreibungs-Regel (SPEC § 2.5) gilt nur für fn/Datensatz/
        // Aufzählung/Enum-Wert. Griechisch hat Großbuchstaben (`Λ`) → als
        // fn-Name ok. CJK ist kaselos (kein Großbuchstabe möglich) →
        // `税金` als `var`-Name (nicht regelbetroffen); beweist weiterhin,
        // dass der CJK-Bezeichner lexikalisch erkannt und aufgelöst wird.
        const { diags } = await diagnose(
            { m: 'fn Λ(): Euro = 1 als Euro\nkonst R: Euro = {\n  var 税金: Euro = Λ()\n  税金\n}\n' },
            'm',
        );
        expect(diags.filter((d) => d.severity === 1)).toEqual([]);
    });

    it('Deutsche Umlaute funktionieren weiterhin', async () => {
        const { diags } = await diagnose(
            { m: 'fn Berücksichtige(wÄhrung: Euro): Euro = wÄhrung\nkonst R: Euro = Berücksichtige(1 als Euro)\n' },
            'm',
        );
        expect(diags.filter((d) => d.severity === 1)).toEqual([]);
    });
});

describe('Keyword↔Identifier-LONGER_ALT (TokenBuilder-Regression)', () => {
    it('`nichtselbständigeArbeit` ist EIN Identifier, nicht `nicht`+Rest', async () => {
        const { diags } = await diagnose({
            m: `datensatz E(nichtselbständigeArbeit: Euro = 0)
konst P: E = E(nichtselbständigeArbeit = 50 als Euro)
konst R: Euro = P.nichtselbständigeArbeit
`,
        }, 'm');
        // Würde der Lexer `nicht` abspalten, gäbe es Syntaxfehler.
        expect(diags.filter((d) => d.severity === 1)).toEqual([]);
    });

    it('`sonstigeEinkünfte` wird nicht in `sonst`+Rest zerschnitten', async () => {
        const { diags } = await diagnose({
            m: 'datensatz E(sonstigeEinkünfte: Euro = 0)\nkonst R: E = E()\n',
        }, 'm');
        expect(diags.filter((d) => d.severity === 1)).toEqual([]);
    });

    it('`abbruchkosten`/`erwartetesEinkommen` bleiben EIN Identifier (neue Keywords)', async () => {
        const { diags } = await diagnose({
            m: `datensatz E(abbruchkosten: Euro = 0, erwartetesEinkommen: Euro = 0)
konst R: Euro = E().abbruchkosten
`,
        }, 'm');
        // Würde der Lexer `abbruch`/`erwartet` abspalten, gäbe es Syntaxfehler.
        expect(diags.filter((d) => d.severity === 1)).toEqual([]);
    });

    it('`ausgabewert`/`ausgabeBetrag` bleiben EIN Identifier (Keyword `ausgabe`)', async () => {
        const { diags } = await diagnose({
            m: `datensatz E(ausgabewert: Euro = 0, ausgabeBetrag: Euro = 0)
konst R: Euro = E().ausgabewert
`,
        }, 'm');
        // Würde der Lexer `ausgabe` abspalten, gäbe es Syntaxfehler.
        expect(diags.filter((d) => d.severity === 1)).toEqual([]);
    });

    it('Reines Keyword bleibt Keyword (`wenn` allein ist kein Identifier)', async () => {
        const { diags } = await diagnose({
            m: 'konst R: Ganzzahl = wenn (wahr) 1 sonst 2\n',
        }, 'm');
        // `wenn`/`sonst` korrekt als Keywords → gültiger wenn-Ausdruck.
        expect(diags.filter((d) => d.severity === 1)).toEqual([]);
    });
});

describe('Freundliche Lexer-Diagnose bei Fremdzeichen', () => {
    it('§ außerhalb eines Strings → klare deutsche Meldung mit Code', async () => {
        const { diags } = await diagnose({
            m: 'konst R: Euro = 1 § 2\n',
        }, 'm');
        const lex = diags.find((d) => d.code === 'findsl.ungueltiges-zeichen');
        expect(lex).toBeDefined();
        expect(lex!.message).toMatch(/Ungueltiges Zeichen "§"/);
        expect(lex!.message).toMatch(/Text-Literal oder einen Kommentar/);
    });

    it('Emoji liefert dieselbe freundliche Meldung', async () => {
        const { diags } = await diagnose({
            m: 'konst R: Euro = 1 🎉 2\n',
        }, 'm');
        expect(diags.some((d) => d.code === 'findsl.ungueltiges-zeichen')).toBe(true);
    });

    it('§ INNERHALB eines Text-Literals ist erlaubt (kein Lexer-Fehler)', async () => {
        const { diags } = await diagnose({
            m: 'konst R: Text = "§ 32a EStG"\n',
        }, 'm');
        expect(diags.some((d) => d.code === 'findsl.ungueltiges-zeichen')).toBe(false);
    });
});

describe('Quick-Fix greift jetzt bei Unicode-Symbolnamen', () => {
    it('Nicht-exportiertes kyrillisches Symbol → Diagnose + Quick-Fix', async () => {
        const lib = 'fn Echt(z: Euro): Euro = z\n';
        const app = 'verwende {Echt, Фообар} aus "./lib"\nkonst R: Euro = Echt(1 als Euro)\n';
        const { uri, diags, services } = await diagnose({ lib, app }, 'app');

        const diag = diags.find((d) => d.code === 'findsl.symbol-nicht-exportiert');
        expect(diag).toBeDefined();
        expect(diag!.message).toMatch(/"Фообар".*nicht exportiert/);

        const doc = [...services.shared.workspace.LangiumDocuments.all]
            .find((d) => d.uri.toString() === uri)!;
        const actions = (await services.lsp.CodeActionProvider!.getCodeActions(doc, {
            textDocument: { uri },
            range: diag!.range,
            context: { diagnostics: [diag!] },
        })) as CodeAction[];
        const fix = actions.find((a) => a.title.includes('Nicht-exportiertes'));
        expect(fix).toBeDefined();
        const edit = fix!.edit!.changes![uri][0];
        expect(edit.newText).toContain('Echt');
        expect(edit.newText).not.toContain('Фообар');
    });
});
