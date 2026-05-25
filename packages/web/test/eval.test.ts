// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * @findsl/web — Node-Smoke für `findsl/eval` (Issue #164): wertet einen freien
 * FinDSL-Ausdruck im Scope des offenen Dokuments aus. Interpreter als Orakel
 * (bit-genau, decimal.js); fixiert deutsches Format + Typnamen, nicht die
 * Rechenlogik. EmptyFileSystem wie im Browser.
 */

import { describe, it, expect } from 'vitest';
import { EmptyFileSystem, URI } from 'langium';
import { createFindslServices } from '@findsl/core/language/findsl-module.js';
import { runEval } from '../src/eval.js';

const SOURCE = [
    // Wie die echte KSt (examples/kst): Geld-Produkt explizit auf ganze Euro
    // runden — `einkommen * 15%` allein bliebe EuroCent (Cent-genau).
    'fn Koerperschaftsteuer(einkommen: Euro): Euro = (einkommen * 15%).abrunden()',
    'fn Verdopple(x: Ganzzahl): Ganzzahl = x + x',
    'konst Satz: Prozent = 15%',
    'konst Grund: Euro = 50.000',
    '',
].join('\n');

const URI_STR = 'inmemory://playground/main.findsl';

async function setup(): Promise<{
    shared: ReturnType<typeof createFindslServices>['shared'];
    uri: string;
}> {
    const { shared } = createFindslServices(EmptyFileSystem);
    const doc = shared.workspace.LangiumDocumentFactory.fromString(SOURCE, URI.parse(URI_STR));
    shared.workspace.LangiumDocuments.addDocument(doc);
    await shared.workspace.DocumentBuilder.build([doc], { validation: true });
    return { shared, uri: URI_STR };
}

describe('@findsl/web — findsl/eval (Node-Smoke)', () => {
    it('Geld: Koerperschaftsteuer(50000) → 7.500 € (Euro)', async () => {
        const { shared, uri } = await setup();
        const r = await runEval(shared, uri, 'Koerperschaftsteuer(50000)');
        expect(r.ok).toBe(true);
        expect(r.type).toBe('Euro');
        expect(r.value).toBe('7.500');
        expect(r.text).toBe('7.500 €');
    });

    it('Prozent-Literal: 15% → "15" / "15 %" (Prozent)', async () => {
        const { shared, uri } = await setup();
        const r = await runEval(shared, uri, '15%');
        expect(r.ok).toBe(true);
        expect(r.type).toBe('Prozent');
        expect(r.value).toBe('15');
        expect(r.text).toBe('15 %');
    });

    it('Ganzzahl-Ausdruck: 2 + 3 → 5 (Ganzzahl, keine Einheit)', async () => {
        const { shared, uri } = await setup();
        const r = await runEval(shared, uri, '2 + 3');
        expect(r.ok).toBe(true);
        expect(r.type).toBe('Ganzzahl');
        expect(r.value).toBe('5');
        expect(r.text).toBe('5');
    });

    it('Funktionsaufruf: Verdopple(21) → 42 (Ganzzahl)', async () => {
        const { shared, uri } = await setup();
        const r = await runEval(shared, uri, 'Verdopple(21)');
        expect(r.ok).toBe(true);
        expect(r.value).toBe('42');
        expect(r.type).toBe('Ganzzahl');
    });

    it('Modul-Konstante referenzieren: Satz → Prozent', async () => {
        const { shared, uri } = await setup();
        const r = await runEval(shared, uri, 'Satz');
        expect(r.ok).toBe(true);
        expect(r.type).toBe('Prozent');
        expect(r.text).toBe('15 %');
    });

    it('EuroCent (ungerundete Geldrechnung): Grund * 15% → "7.500,00 €"', async () => {
        const { shared, uri } = await setup();
        // Euro * Prozent bleibt OHNE Rundung Cent-genau (EuroCent) — fixiert
        // die einheitenbewusste Darstellung (2 Nachkommastellen + €).
        const r = await runEval(shared, uri, 'Grund * 15%');
        expect(r.ok).toBe(true);
        expect(r.type).toBe('EuroCent');
        expect(r.value).toBe('7.500,00');
        expect(r.text).toBe('7.500,00 €');
    });

    it('} innerhalb eines String-Literals sprengt die Einbettung nicht', async () => {
        const { shared, uri } = await setup();
        const r = await runEval(shared, uri, '"a}b"');
        expect(r.ok).toBe(true);
        expect(r.type).toBe('Text');
        expect(r.text).toBe('a}b');
    });

    it('Wahrheitswert: wahr und falsch → falsch', async () => {
        const { shared, uri } = await setup();
        const r = await runEval(shared, uri, 'wahr und falsch');
        expect(r.ok).toBe(true);
        expect(r.type).toBe('Wahrheitswert');
        expect(r.text).toBe('falsch');
    });

    it('Text: "hallo" → Text (ohne JSON-Quotes)', async () => {
        const { shared, uri } = await setup();
        const r = await runEval(shared, uri, '"hallo"');
        expect(r.ok).toBe(true);
        expect(r.type).toBe('Text');
        expect(r.value).toBe('hallo');
        expect(r.text).toBe('hallo');
    });

    it('abbruch: liefert ok:false mit Begründung', async () => {
        const { shared, uri } = await setup();
        const r = await runEval(shared, uri, 'abbruch("kein Wert")');
        expect(r.ok).toBe(false);
        expect(r.error).toContain('kein Wert');
    });

    it('Auswertungsfehler: 1 / 0 → ok:false', async () => {
        const { shared, uri } = await setup();
        const r = await runEval(shared, uri, '1 / 0');
        expect(r.ok).toBe(false);
        expect(r.error).toBeTruthy();
    });

    it('unbekannter Identifier → ok:false', async () => {
        const { shared, uri } = await setup();
        const r = await runEval(shared, uri, 'Gibtsnicht(1)');
        expect(r.ok).toBe(false);
        expect(r.error).toBeTruthy();
    });

    it('nicht offenes Dokument → ok:false mit error', async () => {
        const { shared } = createFindslServices(EmptyFileSystem);
        const r = await runEval(shared, 'inmemory://playground/nichtda.findsl', '1 + 1');
        expect(r.ok).toBe(false);
        expect(r.error).toBeTruthy();
    });

    it('Teil-Parse (unvollständiger Ausdruck) → ok:false', async () => {
        const { shared, uri } = await setup();
        const r = await runEval(shared, uri, 'Koerperschaftsteuer(');
        expect(r.ok).toBe(false);
        expect(r.error).toBeTruthy();
    });
});
