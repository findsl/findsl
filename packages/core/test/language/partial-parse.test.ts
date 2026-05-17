/**
 * Robustheits-Regression: beim Editieren liefert der fehlertolerante
 * Parser unvollständige ASTs (z. B. `konst K: = 1` während des Tippens).
 * Pflicht-Annotationen sind dann `undefined`. Der Type-Checker
 * (`resolveTypeAnnotation`) darf darüber NICHT crashen — sonst stirbt der
 * gesamte Validierungslauf im Editor mit
 *   "TypeError: Cannot read properties of undefined (reading 'atom')".
 *
 * Wir fahren den vollen DocumentBuilder-+-Validation-Pfad (= LSP-Pfad,
 * inkl. FindslValidator.checkTypes → typeCheckProgram).
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { Diagnostic } from 'vscode-languageserver';

async function validate(source: string): Promise<Diagnostic[]> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        source, URI.parse('file:///m.findsl'),
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    // Wirft vor dem Fix eine unbehandelte TypeError-Exception.
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return (doc.diagnostics ?? []) as Diagnostic[];
}

describe('Unvollständige Annotationen crashen die Validierung nicht', () => {
    const cases: Array<[string, string]> = [
        ['konst ohne Typ',            'konst K: = 1\n'],
        ['Parameter ohne Typ',        'fn F(x: ): Euro = x\n'],
        ['Rückgabetyp fehlt',         'fn F(): = 1\n'],
        ['Datensatz-Feld ohne Typ',   'datensatz D(a: )\n'],
        ['var ohne Typ im Block',     'fn F(): Euro = {\n  var y: = 1\n  y\n}\n'],
        ['NamedType halb getippt',    'fn F(x: Steuer'],
        // Tipp-Progression einer Funktion (jeder Zwischenstand ist gültig
        // beim Editieren): kein Body / kein Rückgabetyp / leere Params.
        ['fn (nur Keyword)',          'fn \n'],
        ['fn Name',                   'fn F\n'],
        ['fn Name(',                  'fn F(\n'],
        ['fn Name()',                 'fn F()\n'],
        ['fn Name():',                'fn F():\n'],
        ['fn Name(): Typ (kein Body)','fn F(): Euro\n'],
        ['fn …  = (Body leer)',       'fn F(): Euro = \n'],
    ];

    for (const [label, src] of cases) {
        it(`${label} → Diagnosen statt Crash`, async () => {
            const diags = await validate(src);
            // Wichtig ist allein: build() wirft nicht. Ein Teil-Parse
            // erzeugt mindestens eine (Syntax-)Diagnose.
            expect(Array.isArray(diags)).toBe(true);
            expect(diags.length).toBeGreaterThanOrEqual(1);
        });
    }

    // Der ursprüngliche Editor-Bug zeigte sich auch als
    // "Request textDocument/documentSymbol failed … reading 'atom'".
    it('documentSymbol crasht bei unvollständiger fn nicht', async () => {
        const services = createFindslServices(NodeFileSystem).Findsl;
        for (const src of [
            'fn \n', 'fn F\n', 'fn F(\n',
            'fn F()\n', 'fn F():\n', 'fn F(): Euro\n',
            'fn F(x:\n', 'fn F(): Euro = \n',
        ]) {
            const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
                src, URI.parse('file:///m.findsl'),
            );
            services.shared.workspace.LangiumDocuments.addDocument(doc);
            await services.shared.workspace.DocumentBuilder.build([doc], { validation: false });
            const syms = await services.lsp.DocumentSymbolProvider!.getSymbols(doc, {
                textDocument: { uri: doc.uri.toString() },
            });
            expect(Array.isArray(syms)).toBe(true);
            // LSP-Pflicht: KEIN Symbol (auch kein Kind) mit leerem Namen,
            // sonst "name must not be falsy" im Client.
            const allNamed = (xs: typeof syms): boolean =>
                xs.every((x) => !!x.name && allNamed(x.children ?? []));
            expect(allNamed(syms)).toBe(true);
            services.shared.workspace.LangiumDocuments.deleteDocument(doc.uri);
        }
    });

    it('vollständiger Code bleibt unbeeinflusst (kein Fehler)', async () => {
        const diags = await validate(`@Quelle("§ 32a EStG")
konst GFB: Euro = 12.096 als Euro
fn F(zve: Euro): Euro = zve
`);
        expect(diags.filter((d) => d.severity === 1)).toEqual([]);
    });
});
