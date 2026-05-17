/**
 * Validator-Tests für den `abbruch`-Ausdruck.
 *
 * Geprüft wird die Warnung `findsl.abbruch-ohne-begruendung` bei leerem
 * Text-Literal. Die Text-Typ-Pflicht selbst liegt im Type-Checker
 * (type-check.test.ts), nicht hier.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { Diagnostic } from 'vscode-languageserver';

async function diagnose(source: string): Promise<Diagnostic[]> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        source, URI.parse('file:///m.findsl'),
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return (doc.diagnostics ?? []) as Diagnostic[];
}

const hasCode = (ds: Diagnostic[], code: string): boolean =>
    ds.some((d) => d.code === code);

describe('Validator: abbruch-Begründung', () => {
    it('leeres Text-Literal → Warnung findsl.abbruch-ohne-begruendung', async () => {
        const ds = await diagnose(`fn F(zve: Euro): Euro = abbruch("")
`);
        const w = ds.find((d) => d.code === 'findsl.abbruch-ohne-begruendung');
        expect(w).toBeDefined();
        expect(w!.severity).toBe(2);   // Warning
    });

    it('nur-Whitespace-Begründung → Warnung', async () => {
        const ds = await diagnose(`fn F(zve: Euro): Euro = abbruch("   ")
`);
        expect(hasCode(ds, 'findsl.abbruch-ohne-begruendung')).toBe(true);
    });

    it('inhaltliche Begründung → keine Warnung', async () => {
        const ds = await diagnose(`fn F(zve: Euro): Euro = abbruch("§ 32a EStG: negatives zvE unzulässig")
`);
        expect(hasCode(ds, 'findsl.abbruch-ohne-begruendung')).toBe(false);
    });

    it('dynamische Begründung (Interpolation) → keine Warnung', async () => {
        const ds = await diagnose(`fn F(zve: Euro): Euro = abbruch("zvE ist \${zve}")
`);
        expect(hasCode(ds, 'findsl.abbruch-ohne-begruendung')).toBe(false);
    });

    it('abbruch OHNE Klammer ist ein Parse-Fehler (voller Diagnosepfad)', async () => {
        // Regression: stellt sicher, dass der LSP-Diagnosepfad (nicht nur
        // CLI-Parse) den fehlenden `(`-Fehler liefert. Editor zeigt ihn
        // nur dann nicht, wenn der LSP-Serverprozess veraltet ist.
        const ds = await diagnose(`fn F(): Euro = abbruch
`);
        const err = ds.find((d) => d.severity === 1 && /Expecting token of type '\('/.test(d.message));
        expect(err).toBeDefined();
    });

    it('valider abbruch mit Klammer erzeugt keinen Parse-Fehler', async () => {
        const ds = await diagnose(`fn F(zve: Euro): Euro = abbruch("§ 32a EStG: unzulässig")
`);
        expect(ds.filter((d) => d.severity === 1)).toEqual([]);
    });

    it('valider abbruch im wähle erzeugt keine abbruch-Diagnose', async () => {
        const ds = await diagnose(`@Quelle("§ 32a EStG")
fn EstGrundtarif(zve: Euro): Euro = wähle {
    falls zve < 0 als Euro -> abbruch("§ 32a EStG: negatives zvE unzulässig")
    sonst                  -> 0 als Euro
}
`);
        expect(hasCode(ds, 'findsl.abbruch-ohne-begruendung')).toBe(false);
        // auch kein Typfehler aus der never-Behandlung
        expect(ds.filter((d) => d.severity === 1)).toEqual([]);
    });
});
