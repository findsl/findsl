/**
 * PAP-HTML-Emitter (Phase 4) — self-contained HTML mit inline mermaid.
 *
 * Prüft: gültiges HTML-Gerüst, eingebettetes mermaid (kein CDN),
 * `securityLevel: 'loose'` (klickbare Links), Tooltip-CSS mit
 * prefers-color-scheme (hell/dunkel), HTML-Escaping des Diagramm-
 * Quelltexts (`<br/>` → `&lt;br/&gt;`, sonst frisst der HTML-Parser es).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource } from '../helpers/parse.js';
import { buildModuleGraphs } from '../../src/papgen/model.js';
import { renderHtml } from '../../src/papgen/html.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const kstSource = fs.readFileSync(
    path.join(repoRoot, 'examples', 'kst', 'kst.findsl'), 'utf-8',
);

describe('papgen/html', () => {
    it('erzeugt eine self-contained HTML-Seite mit inline mermaid', async () => {
        const program = await parseSource(kstSource);
        const modul = buildModuleGraphs(program, 'kst', { detail: 'struktur', params: 'symbole' });
        const html = renderHtml([modul]);

        expect(html.startsWith('<!doctype html>')).toBe(true);
        expect(html).toContain('<pre class="mermaid">');
        // mermaid ist inline eingebettet (~3 MB), kein externer <script src>.
        expect(html.length).toBeGreaterThan(1_000_000);
        expect(html).not.toMatch(/<script\s+src=/);
    });

    it('aktiviert klickbare Links + Tooltip-CSS für hell/dunkel', async () => {
        const program = await parseSource(kstSource);
        const modul = buildModuleGraphs(program, 'kst', { detail: 'struktur', params: 'symbole' });
        const html = renderHtml([modul]);

        expect(html).toContain("securityLevel: 'loose'");
        expect(html).toContain('mermaid.run()');
        expect(html).toContain('.pap-tooltip');     // eigener KaTeX-fähiger Tooltip
        expect(html).toContain('prefers-color-scheme: dark');
    });

    it('rendert KaTeX-Math in den Hover-Tooltips + bettet KaTeX-CSS ein', async () => {
        const program = await parseSource(
            'konst X: Ganzzahl = 1\n'   // erste Decl, damit der Doc dem fn zugeordnet wird
            + '--\n'
            + 'Formel $$a^2 + b$$ im Doc.\n'
            + '--\n'
            + 'fn F(a: Euro): Euro = a\n',
        );
        const modul = buildModuleGraphs(program, 'm', { detail: 'struktur', params: 'symbole' });
        const html = renderHtml([modul]);

        expect(html).toContain('var PAP_TIPS =');
        // KaTeX-gerendertes Math (Quotes in PAP_TIPS sind JSON-escapt →
        // quote-unabhängiger Marker).
        expect(html).toContain('katex-mathml');
        expect(html).toContain('KaTeX_AMS');        // KATEX_CSS eingebettet
    });

    it('hebt Diagramm-Titel hervor und bietet Zoom (natürliche Größe + Buttons)', async () => {
        const program = await parseSource(kstSource);
        const modul = buildModuleGraphs(program, 'kst', { detail: 'struktur', params: 'symbole' });
        const html = renderHtml([modul]);

        expect(html).toContain('class="diagram-title"');
        expect(html).toContain('class="zoom-bar"');
        expect(html).toContain('data-z="in"');
        // Diagramme in natürlicher Größe (statt auf Containerbreite geschrumpft).
        expect(html).toContain('useMaxWidth: false');
        expect(html).toContain('class="diagram-scroll"');
    });

    it('Diagramm-Farben folgen dem OS-Hell/Dunkel (prefers-color-scheme)', async () => {
        const program = await parseSource(kstSource);
        const modul = buildModuleGraphs(program, 'kst', { detail: 'struktur', params: 'symbole' });
        const html = renderHtml([modul]);

        // Knoten farblos gerendert (Art-Klasse statt classDef), Farben via
        // Seiten-CSS — hell direkt, dunkel via @media.
        expect(html).toContain('.node.start');
        expect(html).toContain('@media (prefers-color-scheme: dark)');
        expect(html).toContain('#eef4fe');   // LIGHT start-Füllung
        expect(html).toContain('#1e2a3a');   // DARK start-Füllung
        // Diagramm-Quelltext nutzt class-Zuweisung statt classDef-Inlinefarben.
        expect(html).toContain('class KstSatz_n0');
    });

    it('neutralisiert </script> im Tooltip-Inhalt (kein Skript-Breakout)', async () => {
        const program = await parseSource(
            'konst X: Ganzzahl = 1\n'
            + '--\n'
            + 'Böse </script><script>alert(1)</script> Prosa.\n'
            + '--\n'
            + 'fn F(a: Euro): Euro = a\n',
        );
        const modul = buildModuleGraphs(program, 'm', { detail: 'struktur', params: 'symbole' });
        const html = renderHtml([modul]);
        const tipsLine = html.split('\n').find((l) => l.includes('var PAP_TIPS ='))!;

        expect(tipsLine).toBeDefined();
        // Die gefährlichen Sequenzen dürfen NICHT roh in der Skript-Zeile stehen …
        expect(tipsLine).not.toContain('</script>');
        expect(tipsLine).not.toContain('<script>');
        // … sondern escapt (htmlEscape: <→&lt;).
        expect(tipsLine).toContain('&lt;/script');
    });

    it('escapt den Diagramm-Quelltext (<br/> → &lt;br/&gt;)', async () => {
        const program = await parseSource(kstSource);
        const modul = buildModuleGraphs(program, 'kst', { detail: 'struktur', params: 'symbole' });
        const html = renderHtml([modul]);

        // KstSatz-Start trägt `<br/>` im Label → muss escapt im <pre> stehen.
        expect(html).toContain('&lt;br/&gt;');
    });

    it('Multi-Modul: gleichnamige fn bekommen eindeutige IDs + Anker (bug_001)', async () => {
        // `Gleich` in zwei Modulen → ohne Präfix kollidierten Node-IDs
        // (`Gleich_n0`), Tooltips wurden überschrieben, fn-Anker doppelt.
        const pa = await parseSource('fn Gleich(a: Euro): Euro = a\n');
        const pb = await parseSource('fn Gleich(a: Euro): Euro = a\n');
        const ma = buildModuleGraphs(pa, 'est', { detail: 'struktur', params: 'symbole' });
        const mb = buildModuleGraphs(pb, 'kst', { detail: 'struktur', params: 'symbole' });
        const html = renderHtml([ma, mb]);

        const anchors = [...html.matchAll(/id="fn-([^"]+)"/g)].map((m) => m[1]);
        expect(new Set(anchors).size).toBe(anchors.length);   // alle eindeutig
        expect(anchors).toContain('m0_Gleich');
        expect(anchors).toContain('m1_Gleich');
        // Node-IDs im Mermaid-Quelltext sind modul-präfixiert.
        expect(html).toContain('m0_Gleich_n0');
        expect(html).toContain('m1_Gleich_n0');
    });

    it('Einzelmodul bleibt unpräfixiert (byte-stabile IDs, bug_001)', async () => {
        const program = await parseSource('fn Gleich(a: Euro): Euro = a\n');
        const modul = buildModuleGraphs(program, 'm', { detail: 'struktur', params: 'symbole' });
        const html = renderHtml([modul]);
        expect(html).toContain('id="fn-Gleich"');
        expect(html).not.toContain('m0_');
    });
});
