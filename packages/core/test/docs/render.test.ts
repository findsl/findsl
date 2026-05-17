/**
 * Tests für die Doc-Renderer: kanonisches Markdown, Single-File-HTML
 * (markdown-it + Theme, §-Links klickbar), PDF (pdfmake-Definition +
 * Binär-Smoke).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildDocModel, findFinFiles, type DocModel } from '../../src/docgen/model.js';
import { renderMarkdown } from '../../src/docgen/markdown.js';
import { renderHtml } from '../../src/docgen/html.js';
import { buildPdfDoc, renderPdf } from '../../src/docgen/pdf.js';

const SRC = `--
# Tarif
Berechnet. Siehe § 32a EStG.
--

--
Grundfreibetrag.
--
@Quelle("§ 32a Absatz 1 EStG")
konst GFB: Euro = 12.096

datensatz Bescheid(
    zve: Euro,    // zu versteuerndes Einkommen
)

--
Verdoppelt den Betrag. Vgl. § 19 EStG.

@param betrag  Eingabebetrag in Euro.
@rückgabe      Das Doppelte von \`betrag\`.
--
fn doppelt(betrag: Euro): Euro = betrag * 2

prüfe "P" {
    testfall "ist 0" {
        GFB == (12.096 als Euro)
    }
}
`;

let dir: string;
let model: DocModel;

beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'findsl-rnd-'));
    await fs.writeFile(path.join(dir, 't.findsl'), SRC);
    model = await buildDocModel(await findFinFiles(dir));
});
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('Markdown-Renderer (kanonisch)', () => {
    it('Titel, ToC, Modul-Kapitel, Decl, §-Link, Feldtabelle, Beispiel', () => {
        const md = renderMarkdown(model);
        expect(md).toContain('# FinDSL-Dokumentation');
        expect(md).toContain('## Inhalt');
        // Einzeldatei → Datei-Identität = Dateiname ohne `.findsl` (`t`);
        // Überschrift ohne das Wort „Modul".
        expect(md).toContain('## `t`');
        expect(md).not.toContain('## Modul');
        // Relativer Dateipfad (mit `.findsl`) als Zeile direkt unter dem
        // Kapitelnamen.
        expect(md).toContain('## `t`\n\n*`t.findsl`*');
        // Pro Modul Gruppierung nach Bereich (Bereichs-Heading H3,
        // Deklarationen darunter H4).
        expect(md).toContain('### Konstanten');
        expect(md).toContain('### Datensätze');
        expect(md).toContain('### Prüfungen');
        expect(md).toContain('#### konst `GFB`');
        // Reihenfolge: Konstanten vor Datensätzen vor Prüfungen.
        expect(md.indexOf('### Konstanten'))
            .toBeLessThan(md.indexOf('### Datensätze'));
        expect(md.indexOf('### Datensätze'))
            .toBeLessThan(md.indexOf('### Prüfungen'));
        expect(md).toContain('```findsl\nkonst GFB: Euro = 12.096\n```');
        expect(md).toContain('https://www.gesetze-im-internet.de/estg/__32a.html');
        expect(md).toContain('| `zve` | `Euro` | zu versteuerndes Einkommen |');
        expect(md).toContain('**Testfall — ist 0**');
        // @param/@rückgabe strukturiert (Parameter-Tabelle + Rückgabe),
        // Tags aus der Prosa entfernt.
        expect(md).toContain('Verdoppelt den Betrag.');
        expect(md).toContain('**Parameter**');
        expect(md).toContain('| `betrag` | Eingabebetrag in Euro. |');
        expect(md).toContain('**Rückgabe**');
        expect(md).not.toContain('@param betrag');
        expect(md).not.toContain('@rückgabe ');
    });

    it('deterministisch (kein Zeitstempel)', () => {
        expect(renderMarkdown(model)).toBe(renderMarkdown(model));
    });
});

describe('HTML-Renderer (Single-File)', () => {
    it('eigenständiges HTML mit Theme, Anker, klickbarem §-Link', () => {
        const html = renderHtml(model, { stand: '2026-05-16' });
        expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
        expect(html).toContain('<style>');                       // eingebettetes Theme
        expect(html).toContain('Stand: 2026-05-16');
        expect(html).toContain('id="t"');                        // Slug-Anker (Dateiname, ohne „modul-")
        expect(html).not.toContain('id="modul-t"');
        // Relativer Dateipfad als kleine, ausgegraute Zeile (eigene
        // CSS-Klasse) unter dem Kapitelnamen.
        expect(html).toContain('class="module-path"');
        expect(html).toContain('.content p.module-path');         // Stylesheet-Regel
        expect(html).toContain('<code>t.findsl</code>');
        expect(html).toContain('href="#t"');                     // Sidebar-Link trifft den Anker
        expect(html).toContain('>Konstanten<');                  // Bereichs-Gruppierung
        expect(html).toContain('class="nav-cat"');               // Sidebar-Bereiche
        expect(html).toContain('class="decl-kw"');               // Keyword-Underline im Titel
        expect(html).toContain('<blockquote>');                  // Quelle als dezenter Aside
        expect(html).toContain('<table>');                       // strukturierte Parameter-Tabelle
        expect(html).toContain('<code>betrag</code>');           // Parametername als Code-Zelle
        expect(html).toContain('Rückgabe');                      // Rückgabe-Block gerendert
        expect(html).toContain('href="https://www.gesetze-im-internet.de/estg/__32a.html"');
        expect(html).not.toContain('](http');                    // Markdown wurde gerendert
    });
});

describe('PDF-Renderer', () => {
    it('pdfmake-Definition: Cover-Titel, ToC, Datei-Kapitel', () => {
        const def = buildPdfDoc(model, { stand: '2026-05-16' });
        const json = JSON.stringify(def);
        expect(json).toContain('FinDSL-Dokumentation');
        expect(json).toContain('Stand: 2026-05-16');
        expect(json).toContain('"toc"');
        // Relativer Dateipfad als eigener kleiner grauer Text-Knoten
        // (Style `modulePfad`) unter dem Kapitelnamen.
        expect(json).toContain('modulePfad');
        expect(json).toContain('"text":"t.findsl"');
        expect(json).not.toContain('Modul t');                   // Kapitel-Titel ohne „Modul"
        expect(json).toContain('"text":"t"');                    // Datei-Kapitel-Titel
        expect(json).toContain('"text":"DATEI"');                // Eyebrow statt „MODUL"
        expect(json).toContain('KONSTANTEN');                    // Bereichs-Trenner (Versal)
        expect(json).toContain('DATENSÄTZE');
        expect(json).toContain('PRÜFUNGEN');
        expect(json).toContain('tocGroup');                      // Bereiche im ToC
        expect(json).toContain('tocModule');
        expect(json).toContain('Parameter');                     // strukturierte @param
        expect(json).toContain('Rückgabe');                      // strukturierte @rückgabe
        expect(json).toContain('betrag');
        expect(def.defaultStyle).toMatchObject({ font: 'Helvetica' });
    });

    it('Binär-Smoke: erzeugt nicht-leeres PDF', async () => {
        const buf = await renderPdf(model, { stand: '2026-05-16' });
        expect(buf.length).toBeGreaterThan(800);
        expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    });
});

describe('§-Referenzen in Doc-Prosa werden verlinkt', () => {
    const ESTG19 = 'https://www.gesetze-im-internet.de/estg/__19.html';
    const ESTG32A = 'https://www.gesetze-im-internet.de/estg/__32a.html';

    it('Markdown: Datei-Doc- und Decl-Doc-Prosa erhalten Links', () => {
        const md = renderMarkdown(model);
        expect(md).toContain(`[§ 32a EStG](${ESTG32A})`);   // Datei-Doc-Prosa
        expect(md).toContain(`[§ 19 EStG](${ESTG19})`);     // Decl-Doc-Prosa
    });

    it('HTML: Prosa-§ wird zu <a href> (nicht nur der @Quelle-Aside)', () => {
        const html = renderHtml(model, { stand: '2026-05-16' });
        // /estg/__19.html kommt NUR aus der Prosa (kein @Quelle("§ 19 …"))
        expect(html).toContain(`href="${ESTG19}"`);
    });

    it('PDF: Prosa-Link landet als link-Run in der Definition', () => {
        const json = JSON.stringify(buildPdfDoc(model, { stand: '2026-05-16' }));
        expect(json).toContain(ESTG19);
    });
});
