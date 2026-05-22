/**
 * PAP-Generator Phase 1 — FlowGraph-Modell + AST-Walker (struktur-Ebene).
 *
 * Prüft die AST→Ablaufgraph-Abbildung gegen das reale `kst`-Modul:
 *   - `wähle` ohne subject → Verzweigungs-Kaskade (Rauten)
 *   - `wähle (subject)`    → Mehrfach-Fallunterscheidung (`case`)
 *   - Block + `var`-Aufrufe → Unterprogramm-Sequenz
 *   - @Quelle landet am Start-Knoten
 *   - Determinismus (Doppellauf byte-identisch)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSource } from '../helpers/parse.js';
import { buildModuleGraphs, buildPapModel, type FlowGraph } from '../../src/papgen/model.js';

// packages/core/test/papgen → Repo-Wurzel (vier Ebenen hoch).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const kstPath = path.join(repoRoot, 'examples', 'kst', 'kst.findsl');
const kstSource = fs.readFileSync(kstPath, 'utf-8');

function graphOf(graphs: ReadonlyArray<FlowGraph>, fnName: string): FlowGraph {
    const g = graphs.find((x) => x.fnName === fnName);
    if (!g) throw new Error(`fn "${fnName}" nicht im Modell`);
    return g;
}

describe('papgen/model — kst (struktur)', () => {
    it('baut je fn genau einen Graphen mit Start und mindestens einem Ende', async () => {
        const program = await parseSource(kstSource);
        const { graphs } = buildModuleGraphs(program, 'kst', { detail: 'struktur' });

        expect(graphs.length).toBeGreaterThan(0);
        for (const g of graphs) {
            expect(g.nodes.filter((n) => n.kind === 'start')).toHaveLength(1);
            expect(g.nodes.filter((n) => n.kind === 'ende').length).toBeGreaterThanOrEqual(1);
            // Start hat genau eine ausgehende Kante (in den Rumpf).
            const start = g.nodes.find((n) => n.kind === 'start')!;
            expect(g.edges.filter((e) => e.from === start.id)).toHaveLength(1);
        }
    });

    it('KstSatz: boolesche wähle-Kaskade → 5 Rauten + ja/nein-Kanten', async () => {
        const program = await parseSource(kstSource);
        const { graphs } = buildModuleGraphs(program, 'kst', { detail: 'struktur' });
        const g = graphOf(graphs, 'KstSatz');

        // 5 `falls`-Arme → 5 Verzweigungs-Rauten (der `sonst`-Arm ist keine).
        expect(g.nodes.filter((n) => n.kind === 'decision')).toHaveLength(5);
        // Jede Raute hat eine `ja`-Kante.
        expect(g.edges.filter((e) => e.label === 'ja')).toHaveLength(5);
        // Jede Raute hat eine `nein`-Kante: 4 verketten die Rauten, die 5.
        // führt zum `sonst`-Ergebnis (10%).
        expect(g.edges.filter((e) => e.label === 'nein')).toHaveLength(5);
    });

    it('KörperschaftsteuerBetrag: eine Raute (zvE<=0) + sonst, @Quelle am Start', async () => {
        const program = await parseSource(kstSource);
        const { graphs } = buildModuleGraphs(program, 'kst', { detail: 'struktur' });
        const g = graphOf(graphs, 'KörperschaftsteuerBetrag');

        expect(g.nodes.filter((n) => n.kind === 'decision')).toHaveLength(1);
        const start = g.nodes.find((n) => n.kind === 'start')!;
        expect(start.quelle).toContain('§ 23');
    });

    it('FreibetragNach24: wähle (subject) → genau ein case-Knoten mit Enum-Kanten', async () => {
        const program = await parseSource(kstSource);
        const { graphs } = buildModuleGraphs(program, 'kst', { detail: 'struktur' });
        const g = graphOf(graphs, 'FreibetragNach24');

        const cases = g.nodes.filter((n) => n.kind === 'case');
        expect(cases).toHaveLength(1);
        // Ausgänge tragen die Enum-Muster als Kantenbeschriftung (erschöpfend,
        // ohne `sonst`): ein Arm `Keiner`, ein Arm mit den Nr1–Nr3-Mustern.
        const labels = g.edges
            .filter((e) => e.from === cases[0].id)
            .map((e) => e.label ?? '');
        expect(labels.some((l) => l.includes('Keiner'))).toBe(true);
        expect(labels.some((l) => l.includes('Nr1KapitalLeistungen'))).toBe(true);
    });

    it('BerechneKörperschaftsteuer: Block mit var-Aufrufen → Unterprogramm-Sequenz', async () => {
        const program = await parseSource(kstSource);
        const { graphs } = buildModuleGraphs(program, 'kst', { detail: 'struktur' });
        const g = graphOf(graphs, 'BerechneKörperschaftsteuer');

        // Fünf `var x = SomeFn(...)` → mindestens fünf Unterprogramm-Knoten.
        expect(g.nodes.filter((n) => n.kind === 'subprogram').length).toBeGreaterThanOrEqual(5);
    });

    it('struktur: Aufruf-Argumente zu (…) gekürzt, Argumente nicht ausgeschrieben', async () => {
        const program = await parseSource(kstSource);
        const { graphs } = buildModuleGraphs(program, 'kst', { detail: 'struktur' });
        const g = graphOf(graphs, 'BerechneKörperschaftsteuer');
        const subs = g.nodes.filter((n) => n.kind === 'subprogram');

        // Jeder Unterprogramm-Knoten zeigt `… ← Callee(…)` (Parameter-Hinweis,
        // aber keine ausgeschriebenen Argumente).
        for (const n of subs) expect(n.label).toContain('(…)');
        expect(subs.some((n) => n.label.includes('fall.'))).toBe(false);
    });

    it('voll: volle Argumente bleiben erhalten', async () => {
        const program = await parseSource(kstSource);
        const { graphs } = buildModuleGraphs(program, 'kst', { detail: 'voll' });
        const g = graphOf(graphs, 'BerechneKörperschaftsteuer');
        const subs = g.nodes.filter((n) => n.kind === 'subprogram');

        // Bei `voll` erscheinen die ausgeschriebenen Argumente wieder.
        expect(subs.some((n) => n.label.includes('fall.'))).toBe(true);
        expect(subs.every((n) => !n.label.includes('(…)'))).toBe(true);
    });

    it('Formel-Knoten: Umbruch nach jedem arithmetischen Operator (+ - * /)', async () => {
        const program = await parseSource(
            'fn Summe(a: Euro, b: Euro, c: Euro): Euro = a + b + c\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const op = graphs[0].nodes.find((n) => n.kind === 'operation')!;
        expect(op.label).toBe('a +\nb +\nc');
    });

    it('Vergleiche werden NICHT umgebrochen (kein arithmetischer Operator)', async () => {
        const program = await parseSource(
            'fn Kleiner(a: Ganzzahl, b: Ganzzahl): Wahrheitswert = wenn (a <= b) wahr sonst falsch\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const d = graphs[0].nodes.find((n) => n.kind === 'decision')!;
        expect(d.label).toBe('a <= b');
    });

    it('Block-Funktionskörper `= { … }` (Lambda) → einzelne Knoten statt einem Block', async () => {
        // Diese Form wird vom Parser als parameterloses Lambda interpretiert
        // (anders als `): T { … }` = BlockExpr) — muss trotzdem zerlegt werden.
        const program = await parseSource(
            'fn F(a: Euro): Euro = {\n'
            + '  var x: Euro = G(a)\n'
            + '  var y: Euro = H(x)\n'
            + '  R(x, y)\n'
            + '}\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const g = graphs[0];

        // Kein Knoten enthält den ganzen `{ var … }`-Rumpf.
        expect(g.nodes.every((n) => !n.label.includes('var '))).toBe(true);
        expect(g.nodes.every((n) => !n.label.includes('{'))).toBe(true);
        // Die zwei var-Aufrufe + das Ergebnis = drei Unterprogramm-Knoten.
        expect(g.nodes.filter((n) => n.kind === 'subprogram')).toHaveLength(3);
    });

    it('Start-Knoten: jeder Parameter auf eigener Zeile (gegen Überlauf)', async () => {
        const program = await parseSource(
            'fn V(a: Euro, b: Euro, c: Euro): Euro = a\n',
        );
        // inline-Modus explizit (Default ist symbole).
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur', params: 'inline' });
        const start = graphs[0].nodes.find((n) => n.kind === 'start')!;
        // Name, dann je Parameter eine Zeile, zuletzt `): Rückgabe`.
        expect(start.label).toBe('V\n(a: Euro,\nb: Euro,\nc: Euro): Euro');
    });

    it('var x = wähle { … } → Kontrollfluss zerlegt, kein Block-Text in einem Knoten', async () => {
        const program = await parseSource(
            'fn F(a: Ganzzahl): Euro = {\n'
            + '  var x: Euro = wähle {\n'
            + '    falls a <= 0 -> 0\n'
            + '    sonst -> G(a)\n'
            + '  }\n'
            + '  x\n'
            + '}\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const g = graphs[0];

        // Der wähle-Block darf nicht als Text in einem Knoten landen.
        expect(g.nodes.every((n) => !n.label.includes('wähle {'))).toBe(true);
        expect(g.nodes.every((n) => !n.label.includes('falls'))).toBe(true);
        // Stattdessen: Zuordnungs-Knoten `x ←` + die wähle-Raute.
        expect(g.nodes.some((n) => n.label === 'x ←')).toBe(true);
        expect(g.nodes.filter((n) => n.kind === 'decision').length).toBeGreaterThanOrEqual(1);
    });

    it('abbruch-Grund wird gekürzt (erste Zeile, ohne Tripelquotes, mit …)', async () => {
        const program = await parseSource(
            'fn F(a: Ganzzahl): Euro = wähle {\n'
            + '  falls a < 0 -> abbruch("""\n'
            + '§ 1 Gesetz: lange Begründung die wirklich sehr ausführlich ausfällt und noch mehr;\n'
            + 'zweite Zeile ${a}\n'
            + '""")\n'
            + '  sonst -> 0\n'
            + '}\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const ab = graphs[0].nodes.find((n) => n.label.startsWith('abbruch'))!;

        expect(ab.label).not.toContain('"""');
        expect(ab.label).not.toContain('zweite Zeile');
        expect(ab.label.startsWith('abbruch\n§ 1 Gesetz:')).toBe(true);
        expect(ab.label.endsWith('…')).toBe(true);
    });

    it('--params symbole: Parameter als Eingabe-Knoten → Start, Start nur Name', async () => {
        const program = await parseSource('fn F(a: Euro, b: Euro): Euro = a + b\n');
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur', params: 'symbole' });
        const g = graphs[0];
        const start = g.nodes.find((n) => n.kind === 'start')!;
        const eingaben = g.nodes.filter((n) => n.kind === 'eingabe');

        // Start trägt nur den Namen; je Parameter ein Eingabe-Parallelogramm.
        expect(start.label).toBe('F');
        expect(eingaben.map((n) => n.label)).toEqual(['a: Euro', 'b: Euro']);
        for (const e of eingaben) {
            expect(g.edges.some((ed) => ed.from === e.id && ed.to === start.id)).toBe(true);
        }

        // inline-Modus explizit: Parameter im Start, keine Eingabe-Knoten.
        const inlineG = buildModuleGraphs(program, 'm', { detail: 'struktur', params: 'inline' }).graphs[0];
        expect(inlineG.nodes.some((n) => n.kind === 'eingabe')).toBe(false);
        expect(inlineG.nodes.find((n) => n.kind === 'start')!.label).toContain('(a: Euro');
    });

    it('Hover: Doc-Prosa am Start, @param an Eingabe-Knoten; $$-Math als Plain', async () => {
        const program = await parseSource(
            // Eine Decl voran, damit der folgende `--…--`-Block dem fn-
            // docPrefix zugeordnet wird (der ERSTE Block einer Datei würde
            // sonst greedy zum Datei-Doc, SPEC § 4.9 / docs/05).
            'konst X: Ganzzahl = 1\n'
            + '--\n'
            + 'Berechnet etwas mit $$a^2$$ Bezug.\n'
            + '@param a  Der Eingabewert, vgl. $$x^2$$.\n'
            + '--\n'
            + 'fn F(a: Euro): Euro = a\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur', params: 'symbole' });
        const g = graphs[0];
        const start = g.nodes.find((n) => n.kind === 'start')!;
        const eingabe = g.nodes.find((n) => n.kind === 'eingabe')!;

        // Funktions-Prosa am Start, @param-Beschreibung am Eingabe-Knoten.
        expect(start.tooltip).toContain('Berechnet etwas');
        expect(eingabe.tooltip).toContain('Eingabewert');
        // Plain-Form (native Mermaid-Tooltips): $$…$$ → Unicode, kein rohes TeX.
        expect(start.tooltip).not.toContain('$$');
        expect(eingabe.tooltip).not.toContain('$$');
        // Roh-Form (für KaTeX im HTML-Emitter): $$…$$ bleibt erhalten.
        expect(start.tooltipRaw).toContain('$$');
    });

    it('publicOnly: interne _-Funktionen werden ausgelassen', async () => {
        const program = await parseSource(
            'fn F(a: Euro): Euro = a\n'
            + 'fn _Hilf(b: Euro): Euro = b\n',
        );
        const alle = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        expect(alle.graphs.map((g) => g.fnName).sort()).toEqual(['F', '_Hilf']);

        const pub = buildModuleGraphs(program, 'm', { detail: 'struktur', publicOnly: true });
        expect(pub.graphs.map((g) => g.fnName)).toEqual(['F']);
    });

    it('Datei ohne Funktion erzeugt keine Diagramme', async () => {
        const program = await parseSource('konst X: Ganzzahl = 1\n');
        expect(buildModuleGraphs(program, 'm', { detail: 'struktur' }).graphs).toHaveLength(0);
    });

    it('reine prüfe-Testdatei wird übersprungen (kein Modul ohne Inhalt)', async () => {
        const testFile = path.join(repoRoot, 'examples', 'est', 'est.test.findsl');
        const model = await buildPapModel([testFile], { detail: 'struktur' });
        expect(model).toHaveLength(0);
    });

    it('für jeden: Schleifen-Kopf + je-Element-Kante + Rückkante', async () => {
        const program = await parseSource(
            'fn Verdopple(xs: Liste<Ganzzahl>): Liste<Ganzzahl> = für jeden x aus xs { x * 2 }\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const g = graphs[0];
        const loop = g.nodes.find((n) => n.label.startsWith('für jeden'))!;

        expect(loop).toBeDefined();
        // Kante in den Schleifenkörper + „fertig"-Ausgang.
        expect(g.edges.some((e) => e.from === loop.id && e.label === 'je Element')).toBe(true);
        expect(g.edges.some((e) => e.from === loop.id && e.label === 'fertig')).toBe(true);
        // Rückkante: der Kopf hat ≥2 Eingänge (Eintritt + Body→Kopf).
        expect(g.edges.filter((e) => e.to === loop.id).length).toBeGreaterThanOrEqual(2);
    });

    it('ist deterministisch (Doppellauf byte-identisch)', async () => {
        const p1 = await parseSource(kstSource);
        const p2 = await parseSource(kstSource);
        const a = buildModuleGraphs(p1, 'kst', { detail: 'struktur' });
        const b = buildModuleGraphs(p2, 'kst', { detail: 'struktur' });
        expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    });
});

describe('papgen/model — Terminierungs-Randfälle', () => {
    it('abbruch-only fn erzeugt KEINEN verwaisten ende-Knoten (bug_002)', async () => {
        const program = await parseSource(
            'fn NichtImplementiert(a: Ganzzahl): Euro = abbruch("TODO: § X")\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const g = graphOf(graphs, 'NichtImplementiert');
        // Kein `ende`-Knoten, da der Rumpf auf allen Pfaden abbricht.
        expect(g.nodes.filter((n) => n.kind === 'ende')).toHaveLength(0);
        // Jeder Knoten ist erreichbar (eingehende Kante) oder Start/Eingabe
        // — kein verwaister Terminator.
        const withIncoming = new Set(g.edges.map((e) => e.to));
        for (const n of g.nodes) {
            if (n.kind === 'start' || n.kind === 'eingabe') continue;
            expect(withIncoming.has(n.id)).toBe(true);
        }
    });

    it('sonst-only wähle verdrahtet start zum Einstieg, nicht zu einem Ausgang (bug_003)', async () => {
        const program = await parseSource(
            'fn Groesseres(a: Ganzzahl, b: Ganzzahl): Ganzzahl = '
            + 'wähle { sonst -> wenn (a > b) a sonst b }\n',
        );
        const { graphs } = buildModuleGraphs(program, 'm', { detail: 'struktur' });
        const g = graphOf(graphs, 'Groesseres');
        const start = g.nodes.find((n) => n.kind === 'start')!;
        const fromStart = g.edges.find((e) => e.from === start.id && e.label === undefined)!;
        // start zeigt auf die Entscheidungs-Raute (Einstieg des sonst-
        // Fragments), nicht auf ein Blatt.
        const target = g.nodes.find((n) => n.id === fromStart.to)!;
        expect(target.kind).toBe('decision');
    });
});
