/**
 * PAP-Emitter Phase 2 — FlowGraph → Mermaid.
 *
 * Prüft Shape-Abbildung, Label-Escaping (`<=`/`"`), @Quelle-Annotation,
 * Markdown-Hülle und Idempotenz (Doppellauf byte-identisch). Eine kleine
 * synthetische `fn` lockt zusätzlich das exakte Ausgabeformat (golden).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource } from '../helpers/parse.js';
import { buildModuleGraphs } from '../../src/papgen/model.js';
import { renderMermaid, renderModuleMarkdown } from '../../src/papgen/mermaid.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const kstSource = fs.readFileSync(
    path.join(repoRoot, 'examples', 'kst', 'kst.findsl'), 'utf-8',
);

describe('papgen/mermaid', () => {
    it('KstSatz: flowchart-Kopf, Stadium-Start, Rauten, ja/nein-Kanten', async () => {
        const program = await parseSource(kstSource);
        const { graphs } = buildModuleGraphs(program, 'kst', { detail: 'struktur' });
        const g = graphs.find((x) => x.fnName === 'KstSatz')!;
        const out = renderMermaid(g);

        // Init-Direktive (Monospace) vorangestellt, dann flowchart.
        expect(out.startsWith('%%{init:')).toBe(true);
        expect(out).toContain("'fontFamily'");
        expect(out).toContain('\nflowchart TD');
        // Start als Grenzstelle (gerundetes Rechteck `(…)`).
        expect(out).toMatch(/KstSatz_n0\("/);
        // Mindestens eine Raute `{…}` und eine beschriftete Kante.
        expect(out).toContain('{"');
        expect(out).toContain('-->|"ja"|');
        expect(out).toContain('-->|"nein"|');
    });

    it('escapt <= und behält @Quelle als zweite Zeile am Start', async () => {
        const program = await parseSource(kstSource);
        const { graphs } = buildModuleGraphs(program, 'kst', { detail: 'struktur' });
        const g = graphs.find((x) => x.fnName === 'KörperschaftsteuerBetrag')!;
        const out = renderMermaid(g);

        // `<=` darf nicht roh erscheinen (würde Mermaid-Label zerbrechen).
        expect(out).not.toContain('<=');
        expect(out).toContain('#lt;=');
        // @Quelle durch eine Leerzeile (<br/><br/>) abgegrenzt.
        expect(out).toContain('<br/><br/>⟨');
        expect(out).toContain('§ 23');
    });

    it('subprogram → [[…]], case → {{…}}', async () => {
        const program = await parseSource(kstSource);
        const { graphs } = buildModuleGraphs(program, 'kst', { detail: 'struktur' });

        const ber = renderMermaid(graphs.find((x) => x.fnName === 'BerechneKörperschaftsteuer')!);
        expect(ber).toContain('[["'); // Unterprogramm-Aufrufe

        const frei = renderMermaid(graphs.find((x) => x.fnName === 'FreibetragNach24')!);
        expect(frei).toContain('{{"'); // case-Hexagon
    });

    it('Modul-Markdown: je fn ein ```mermaid-Block', async () => {
        const program = await parseSource(kstSource);
        const modul = buildModuleGraphs(program, 'kst', { detail: 'struktur' });
        const md = renderModuleMarkdown(modul);

        expect(md).toMatch(/^# Programmablaufpläne — kst/);
        const fences = md.match(/```mermaid/g) ?? [];
        expect(fences.length).toBe(modul.graphs.length);
        expect(md).toContain('## KstSatz');
    });

    it('golden: kleine fn → exaktes Mermaid-Format', async () => {
        const program = await parseSource(
            'fn Maximal(a: Ganzzahl, b: Ganzzahl): Ganzzahl = wenn (a > b) a sonst b\n',
        );
        // inline-Modus explizit (Default ist symbole) — Golden lockt das
        // Inline-Signatur-Format.
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur', params: 'inline' });
        const out = renderMermaid(graphs[0], { farben: false });

        // Kantenreihenfolge = Einfüge-Reihenfolge des Walkers: die wenn-
        // Verzweigungskanten entstehen beim Walk des Rumpfes, die Start-
        // Kante erst danach (build verdrahtet Start → Rumpf-Eintritt zum
        // Schluss). Deterministisch; für das Mermaid-Rendering irrelevant.
        // Erste Zeile ist die (volatile) %%{init}%%-Direktive (Schrift/Theme);
        // das Golden lockt den Diagramm-Rumpf danach.
        expect(out.startsWith('%%{init:')).toBe(true);
        const body = out.slice(out.indexOf('\n') + 1);
        expect(body).toBe(
            'flowchart TD\n'
            + '    Maximal_n0("Maximal<br/>(a: Ganzzahl,<br/>b: Ganzzahl): Ganzzahl")\n'
            + '    Maximal_n1{"a #gt; b"}\n'
            + '    Maximal_n2["a"]\n'
            + '    Maximal_n3["b"]\n'
            + '    Maximal_n4("Ergebnis: Ganzzahl")\n'
            + '    Maximal_n1 -->|"ja"| Maximal_n2\n'
            + '    Maximal_n1 -->|"nein"| Maximal_n3\n'
            + '    Maximal_n0 --> Maximal_n1\n'
            + '    Maximal_n2 --> Maximal_n4\n'
            + '    Maximal_n3 --> Maximal_n4',
        );
    });

    it('Formel: arithmetische Umbrüche werden zu <br/>', async () => {
        const program = await parseSource(
            'fn S(a: Euro, b: Euro, c: Euro): Euro = a + b + c\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const out = renderMermaid(graphs[0]);
        expect(out).toContain('"a +<br/>b +<br/>c"');
    });

    it('Gesetzes-Link: Start-Knoten mit @Quelle bekommt click href', async () => {
        const program = await parseSource(kstSource);
        const { graphs } = buildModuleGraphs(program, 'kst', { detail: 'struktur' });
        const out = renderMermaid(graphs.find((x) => x.fnName === 'KörperschaftsteuerBetrag')!);
        // href-URL aufs § (ggf. gefolgt von einem Doc-Tooltip vor _blank).
        expect(out).toMatch(/click \S+ href "https?:\/\/[^"]*gesetze-im-internet[^"]*"/);
    });

    it('abbruch: § als Link + voller Grund als Tooltip', async () => {
        const program = await parseSource(
            'fn F(a: Ganzzahl): Euro = wähle {\n'
            + '  falls a < 0 -> abbruch("§ 23 Absatz 1 KStG: nicht abgedeckt, voller Wortlaut")\n'
            + '  sonst -> 0\n'
            + '}\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const out = renderMermaid(graphs[0]);
        expect(out).toMatch(
            /click \S+ href "[^"]*gesetze-im-internet[^"]*" "[^"]*voller Wortlaut[^"]*" _blank/,
        );
    });

    it('Tooltip ohne Link erzeugt KEINE click-callback-Direktive (bug_014)', async () => {
        // abbruch ohne § im Grund → Tooltip, aber kein href. Früher wurde
        // `click … callback "…"` emittiert — `callback` existiert nirgends
        // (Laufzeitfehler beim Klick in loose-Renderern).
        const program = await parseSource(
            'fn F(a: Ganzzahl): Euro = abbruch("kein Paragraf hier, nur Prosa")\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const out = renderMermaid(graphs[0]);   // tooltips default = true
        expect(out).not.toContain('callback');
    });

    it('Theme + Monospace: %%{init}%% trägt theme (nur ≠default) und immer fontFamily', async () => {
        const program = await parseSource('fn F(a: Euro): Euro = a\n');
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });

        const dark = renderMermaid(graphs[0], { theme: 'dark' });
        expect(dark.startsWith("%%{init: {'theme': 'dark', 'fontFamily':")).toBe(true);
        expect(dark).toContain("'themeVariables'");
        expect(dark).toContain("'fontSize': '13px'");
        // Default-Theme: kein theme, aber immer fontFamily (Monospace, top-level
        // + themeVariables) für korrekte Breitenmessung.
        const def = renderMermaid(graphs[0]);
        expect(def.startsWith("%%{init: {'fontFamily':")).toBe(true);
        expect(def).toContain('monospace');
        expect(def).toContain("'curve': 'basis'");
        expect(def).toContain('\nflowchart TD');
    });

    it('Färbung: classDef/class je Knotenart, abbruch eigene Klasse', async () => {
        const program = await parseSource(
            'fn F(a: Ganzzahl): Euro = wähle {\n'
            + '  falls a < 0 -> abbruch("§ 23 KStG: x")\n'
            + '  sonst -> 0\n'
            + '}\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const out = renderMermaid(graphs[0]); // farben default an

        expect(out).toContain('classDef abbruch fill:');
        expect(out).toContain('classDef start fill:');
        expect(out).toMatch(/class \S+ abbruch/);
        // --no-farben (farben:false) → keine classDef-Zeilen.
        expect(renderMermaid(graphs[0], { farben: false })).not.toContain('classDef');
    });

    it('Färbung: dark-Palette unterscheidet sich von hell', async () => {
        const program = await parseSource('fn F(a: Euro): Euro = a\n');
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const hell = renderMermaid(graphs[0]);
        const dunkel = renderMermaid(graphs[0], { theme: 'dark' });
        // Beide Paletten setzen Textfarbe, aber unterschiedlich (dezent):
        // dunkel = helle Schrift, hell = weiches Grau.
        expect(dunkel).toContain('color:#e3e3e3');
        expect(hell).toContain('color:#3c4043');
        expect(hell).not.toContain('color:#e3e3e3');
        // Zarte 1px-Ränder.
        expect(hell).toContain('stroke-width:1px');
    });

    it('ist idempotent (Doppellauf byte-identisch)', async () => {
        const program = await parseSource(kstSource);
        const modul = buildModuleGraphs(program, 'kst', { detail: 'struktur' });
        expect(renderModuleMarkdown(modul)).toEqual(renderModuleMarkdown(modul));
    });
});
