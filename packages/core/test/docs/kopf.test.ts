/**
 * Tests für den Dokumentkopf (Front-Matter-Parser, Ableitung aus dem
 * ersten Modul, Auflösung) und die Renderer-Integration (md/html/pdf).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildDocModel, findFinFiles, type DocModel } from '../../src/docgen/model.js';
import {
    parseKopf, ladeKopf, kopfAusModell, aufloesenKopf,
} from '../../src/docgen/kopf.js';
import { renderMarkdown } from '../../src/docgen/markdown.js';
import { renderHtml } from '../../src/docgen/html.js';
import { buildPdfDoc } from '../../src/docgen/pdf.js';

const SRC = `--
# Kraftfahrzeugsteuer — Jahressteuer-Tarif

Bildet die Jahressteuer nach §§ 8, 9 KraftStG vollständig ab. Weiterer
Satz, der nicht mehr in den Untertitel soll.
--

--
Grundbetrag.
--
@Quelle("§ 9 Absatz 1 KraftStG")
konst KRAD: Euro = 2
`;

const KOPF_MD = `---
name: Kraftfahrzeugsteuer
titel: Kraftfahrzeugsteuer-Handbuch
autor: Max Mustermann
untertitel: Jahressteuer nach §§ 8, 9 KraftStG
beschreibung: "Vollständige, prüfbare Abbildung des Tarifs."
lizenz: MIT
ressort: Steuerrecht
metadaten:
  stand: KraftStG 2002 i.d.g.F.
  pruefer: Finanzamt
---
## Einleitung

Dieses Dokument ist eine **Audit-Vorlage**.

- Punkt eins
- Punkt zwei
`;

let dir: string;
let model: DocModel;

beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'findsl-kopf-'));
    await fs.writeFile(path.join(dir, 'k.findsl'), SRC);
    model = await buildDocModel(await findFinFiles(dir));
});
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('parseKopf — Front-Matter', () => {
    it('zerlegt Skalare, Metadaten-Map, unbekannte Schlüssel und Einleitung', () => {
        const k = parseKopf(KOPF_MD);
        expect(k.titel).toBe('Kraftfahrzeugsteuer-Handbuch');   // `titel` schlägt `name`
        expect(k.autor).toBe('Max Mustermann');
        expect(k.untertitel).toBe('Jahressteuer nach §§ 8, 9 KraftStG');
        expect(k.beschreibung).toBe('Vollständige, prüfbare Abbildung des Tarifs.'); // entquotet
        expect(k.lizenz).toBe('MIT');
        // Nested metadaten + unbekannter Top-Level-Schlüssel `ressort`.
        expect(k.metadaten).toEqual(
            expect.arrayContaining([
                ['stand', 'KraftStG 2002 i.d.g.F.'],
                ['pruefer', 'Finanzamt'],
                ['ressort', 'Steuerrecht'],
            ]),
        );
        expect(k.einleitung).toContain('## Einleitung');
        expect(k.einleitung).toContain('**Audit-Vorlage**');
    });

    it('ohne Front-Matter → ganzer Inhalt ist Einleitung, kein Titel', () => {
        const k = parseKopf('# Nur Text\n\nKein Front-Matter hier.');
        expect(k.titel).toBe('');
        expect(k.einleitung).toContain('# Nur Text');
        expect(k.metadaten).toEqual([]);
    });

    it('`name` greift, wenn kein `titel` gesetzt ist', () => {
        const k = parseKopf('---\nname: Nur Name\n---\n');
        expect(k.titel).toBe('Nur Name');
    });
});

describe('ladeKopf', () => {
    it('liefert undefined ohne Pfad oder bei fehlender Datei', async () => {
        expect(await ladeKopf(undefined)).toBeUndefined();
        expect(await ladeKopf(path.join(dir, 'gibtsnicht.md'))).toBeUndefined();
    });
    it('lädt und parst eine vorhandene Datei', async () => {
        const p = path.join(dir, 'kopf.md');
        await fs.writeFile(p, KOPF_MD);
        const k = await ladeKopf(p);
        expect(k?.titel).toBe('Kraftfahrzeugsteuer-Handbuch');
    });
});

describe('Ableitung aus dem ersten Modul', () => {
    it('kopfAusModell nimmt erste Überschrift als Titel, ersten Satz als Untertitel', () => {
        const k = kopfAusModell(model);
        expect(k.titel).toBe('Kraftfahrzeugsteuer — Jahressteuer-Tarif');
        expect(k.untertitel).toBe(
            'Bildet die Jahressteuer nach §§ 8, 9 KraftStG vollständig ab.',
        );
    });

    it('aufloesenKopf: explizit hat Vorrang, fehlender Titel wird abgeleitet', () => {
        const explizit = parseKopf('---\nautor: A\n---\nText');
        const k = aufloesenKopf(explizit, model);
        expect(k.autor).toBe('A');
        // titel war leer → aus Modell
        expect(k.titel).toBe('Kraftfahrzeugsteuer — Jahressteuer-Tarif');
        // ohne expliziten Kopf → vollständig abgeleitet
        expect(aufloesenKopf(undefined, model).titel)
            .toBe('Kraftfahrzeugsteuer — Jahressteuer-Tarif');
    });
});

describe('Renderer-Integration mit Kopf', () => {
    const kopf = parseKopf(KOPF_MD);

    it('Markdown: Titel/Untertitel/Metadaten/Einleitung statt Default-Titel', () => {
        const mdOut = renderMarkdown(model, { kopf });
        expect(mdOut).toContain('# Kraftfahrzeugsteuer-Handbuch');
        expect(mdOut).toContain('*Jahressteuer nach §§ 8, 9 KraftStG*');
        expect(mdOut).toContain('**Autor:** Max Mustermann');
        expect(mdOut).toContain('| stand | KraftStG 2002 i.d.g.F. |');
        expect(mdOut).toContain('## Einleitung');
        expect(mdOut).not.toContain('# FinDSL-Dokumentation');
    });

    it('Markdown ohne Kopf bleibt unverändert (Rückwärtskompatibilität)', () => {
        expect(renderMarkdown(model)).toContain('# FinDSL-Dokumentation');
    });

    it('HTML: Titel in <title>/Brand + Deckblatt-Sektion', () => {
        const html = renderHtml(model, { stand: '2026-05-17', kopf });
        expect(html).toContain('<title>Kraftfahrzeugsteuer-Handbuch</title>');
        expect(html).toContain('class="doc-cover"');
        expect(html).toContain('Jahressteuer nach §§ 8, 9 KraftStG');
        expect(html).not.toContain('FinDSL-Dokumentation');
    });

    it('PDF: Deckblatt-Felder + Einleitung in der Definition', () => {
        const json = JSON.stringify(buildPdfDoc(model, { stand: '2026-05-17', kopf }));
        expect(json).toContain('Kraftfahrzeugsteuer-Handbuch');
        expect(json).toContain('Jahressteuer nach §§ 8, 9 KraftStG');
        expect(json).toContain('Autor: Max Mustermann');
        expect(json).toContain('Audit-Vorlage');
        expect(json).not.toContain('Domänenspezifische Sprache');
    });

    it('PDF ohne Kopf behält Default-Titel + Sprach-Untertitel', () => {
        const json = JSON.stringify(buildPdfDoc(model, { stand: '2026-05-17' }));
        expect(json).toContain('FinDSL-Dokumentation');
        expect(json).toContain('Domänenspezifische Sprache');
    });
});

describe('§-Verweise in der Kopf-Einleitung werden verlinkt', () => {
    const GEWSTG8 = 'https://www.gesetze-im-internet.de/gewstg/__8.html';
    const ESTG32A = 'https://www.gesetze-im-internet.de/estg/__32a.html';
    const roh = parseKopf(
        '---\nname: T\n---\n## Einleitung\n\n'
        + 'Modelliert § 8 GewStG sowie § 32a EStG.\n',
    );

    it('aufloesenKopf verlinkt §-Refs in der Einleitung (idempotent)', () => {
        const k = aufloesenKopf(roh, model);
        expect(k.einleitung).toContain(`[§ 8 GewStG](${GEWSTG8})`);
        expect(k.einleitung).toContain(`[§ 32a EStG](${ESTG32A})`);
        // Erneutes Auflösen erzeugt keine doppelten Links.
        expect(aufloesenKopf(k, model).einleitung).toBe(k.einleitung);
    });

    it('Titel/Untertitel/Metadaten bleiben unverlinkt (PDF-Deckblatt = Klartext)', () => {
        const k = aufloesenKopf(
            parseKopf('---\nname: T\nuntertitel: nach § 8 GewStG\n---\nText'),
            model,
        );
        expect(k.untertitel).toBe('nach § 8 GewStG');
        expect(k.untertitel).not.toContain('http');
    });

    it('Markdown/HTML/PDF zeigen den §-Link aus der Einleitung', () => {
        const k = aufloesenKopf(roh, model);
        expect(renderMarkdown(model, { kopf: k })).toContain(GEWSTG8);
        expect(renderHtml(model, { kopf: k })).toContain(`href="${GEWSTG8}"`);
        expect(JSON.stringify(buildPdfDoc(model, { kopf: k }))).toContain(GEWSTG8);
    });
});
