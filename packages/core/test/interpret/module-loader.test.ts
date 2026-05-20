import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { URI } from 'langium';
import { NodeFileSystem } from 'langium/node';
import { createFindslServices } from '../../src/language/findsl-module.js';
import {
    listImportSources,
    loadModuleGraph,
    type ParseFile,
} from '../../src/interpret/module-loader.js';
import { InterpretError } from '../../src/interpret/values.js';
import type { Program } from '../../src/language/generated/ast.js';
import { parseSource } from '../helpers/parse.js';

// entfernt: keine Projekt-Wurzel/Modulnamen mehr —
// `resolveProjectRoot`/`moduleToFilePath` existieren nicht mehr; die
// Datei-Identität ist der absolute Dateipfad. Frühere Tests dafür
// (und der „Modul-Name-Inkonsistenz"-Test) sind gegenstandslos.

describe('listImportSources', () => {
    it('relativer Import-Pfad wird roh zurückgegeben', async () => {
        const program = await parseSource('verwende {x} aus "./a"\n');
        expect(listImportSources(program)).toEqual(['./a']);
    });

    it('Mehrfache Imports auf denselben Pfad werden dedupliziert', async () => {
        const program = await parseSource(
            'verwende {x} aus "./a"\nverwende {y} aus "./a"\nverwende {z} aus "../b"\n',
        );
        expect(listImportSources(program)).toEqual(['./a', '../b']);
    });

    it('Reihenfolge wie im Quelltext', async () => {
        const program = await parseSource(
            'verwende {x} aus "../tarif/tarif2025"\nverwende {y} aus "./lib"\n',
        );
        expect(listImportSources(program)).toEqual(['../tarif/tarif2025', './lib']);
    });

    it('Keine Imports → leeres Array', async () => {
        const program = await parseSource('konst K: Dezimal = 1\n');
        expect(listImportSources(program)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// loadModuleGraph — gegen einen echten temporären Verzeichnisbaum
// (.findsl-Dateien OHNE `modul`-Header, `verwende {…} aus "./dep"` relativ).
// ---------------------------------------------------------------------------

let tmpDir: string;

/** Parser über die echten Langium-Services auf einen Dateipfad. */
function buildParser(): ParseFile {
    const services = createFindslServices(NodeFileSystem).Findsl;
    return async (absPath) => {
        const content = await fs.readFile(absPath, 'utf-8');
        const document = services.shared.workspace.LangiumDocumentFactory.fromString(
            content,
            URI.file(absPath),
        );
        await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
        return document.parseResult.value as Program;
    };
}

async function write(rel: string, src: string): Promise<string> {
    const abs = path.join(tmpDir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, src);
    return abs;
}

const base = (m: { filePath: string }): string => path.basename(m.filePath);

beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'findsl-loader-'));
});
afterAll(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

describe('loadModuleGraph', () => {
    it('Entry ohne Imports liefert ein einelementiges Topo-Array', async () => {
        const dir = await fs.mkdtemp(path.join(tmpDir, 'solo-'));
        const entry = await write(path.join(path.basename(dir), 'solo.findsl'), 'konst K: Dezimal = 1\n');
        const order = await loadModuleGraph(entry, buildParser());
        expect(order).toHaveLength(1);
        expect(order[0].filePath).toBe(path.normalize(entry));
    });

    it('lineare Kette wird topologisch sortiert (Blätter zuerst)', async () => {
        const dir = await fs.mkdtemp(path.join(tmpDir, 'chain-'));
        const d = path.basename(dir);
        await write(path.join(d, 'a.findsl'), 'konst X: Dezimal = 1\n');
        await write(path.join(d, 'b.findsl'), 'verwende {X} aus "./a"\nkonst Y: Dezimal = 2\n');
        const c = await write(path.join(d, 'c.findsl'), 'verwende {Y} aus "./b"\nkonst Z: Dezimal = 3\n');
        const order = await loadModuleGraph(c, buildParser());
        expect(order.map(base)).toEqual(['a.findsl', 'b.findsl', 'c.findsl']);
    });

    it('Relativimport über Verzeichnisgrenze ("../")', async () => {
        const dir = await fs.mkdtemp(path.join(tmpDir, 'rel-'));
        const d = path.basename(dir);
        await write(path.join(d, 'tarif', 'tarif2025.findsl'), 'konst T: Dezimal = 1\n');
        const entry = await write(
            path.join(d, 'veranlagung', 'berechnung.findsl'),
            'verwende {T} aus "../tarif/tarif2025"\nkonst B: Dezimal = 2\n',
        );
        const order = await loadModuleGraph(entry, buildParser());
        expect(order.map(base)).toEqual(['tarif2025.findsl', 'berechnung.findsl']);
    });

    it('Diamond — gemeinsame Abhängigkeit erscheint nur einmal', async () => {
        const dir = await fs.mkdtemp(path.join(tmpDir, 'diamond-'));
        const d = path.basename(dir);
        await write(path.join(d, 'base.findsl'), 'konst V: Dezimal = 1\n');
        await write(path.join(d, 'left.findsl'), 'verwende {V} aus "./base"\nkonst L: Dezimal = 2\n');
        await write(path.join(d, 'right.findsl'), 'verwende {V} aus "./base"\nkonst R: Dezimal = 3\n');
        const top = await write(
            path.join(d, 'top.findsl'),
            'verwende {L} aus "./left"\nverwende {R} aus "./right"\nkonst T: Dezimal = 4\n',
        );
        const order = await loadModuleGraph(top, buildParser());
        const names = order.map(base);
        expect(names[0]).toBe('base.findsl');
        expect(names[names.length - 1]).toBe('top.findsl');
        expect(names).toContain('left.findsl');
        expect(names).toContain('right.findsl');
        expect(names.filter((n) => n === 'base.findsl')).toHaveLength(1);
        expect(names.indexOf('base.findsl')).toBeLessThan(names.indexOf('left.findsl'));
        expect(names.indexOf('base.findsl')).toBeLessThan(names.indexOf('right.findsl'));
    });

    it('Zyklus wird erkannt', async () => {
        const dir = await fs.mkdtemp(path.join(tmpDir, 'cycle-'));
        const d = path.basename(dir);
        await write(path.join(d, 'a.findsl'), 'verwende {Y} aus "./b"\nkonst X: Dezimal = 1\n');
        const a = path.join(tmpDir, d, 'a.findsl');
        await write(path.join(d, 'b.findsl'), 'verwende {X} aus "./a"\nkonst Y: Dezimal = 2\n');
        await expect(loadModuleGraph(a, buildParser()))
            .rejects.toThrow(/Zyklisch/);
    });

    it('Fehlende Datei wird mit aussagekräftiger Diagnose gemeldet', async () => {
        const dir = await fs.mkdtemp(path.join(tmpDir, 'missing-'));
        const d = path.basename(dir);
        const a = await write(path.join(d, 'a.findsl'), 'verwende {x} aus "./fehlt"\nkonst K: Dezimal = 1\n');
        await expect(loadModuleGraph(a, buildParser()))
            .rejects.toThrow(/Import "\.\/fehlt" kann nicht geladen werden/);
        await expect(loadModuleGraph(a, buildParser()))
            .rejects.toThrow(InterpretError);
    });

    it('Entry selbst nicht vorhanden → Parse-Fehler propagiert', async () => {
        const ghost = path.join(tmpDir, 'gibt-es-nicht.findsl');
        await expect(loadModuleGraph(ghost, buildParser())).rejects.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Path-Traversal-Schutz (Issue #73): `allowedRoot` lehnt Imports außerhalb
// des erlaubten Projektverzeichnisses ab. Ohne `allowedRoot` bleibt das
// historische Verhalten erhalten (s. Tests oben).
// ---------------------------------------------------------------------------

describe('loadModuleGraph allowedRoot', () => {
    it('Import innerhalb des Roots ist zulässig', async () => {
        const dir = await fs.mkdtemp(path.join(tmpDir, 'within-'));
        const d = path.basename(dir);
        await write(path.join(d, 'a.findsl'), 'konst X: Dezimal = 1\n');
        const b = await write(
            path.join(d, 'b.findsl'),
            'verwende {X} aus "./a"\nkonst Y: Dezimal = 2\n',
        );
        const order = await loadModuleGraph(b, buildParser(), {
            allowedRoot: dir,
        });
        expect(order.map(base)).toEqual(['a.findsl', 'b.findsl']);
    });

    it('Import außerhalb des Roots wird mit InterpretError abgelehnt', async () => {
        // Aufbau: zwei Geschwister-Verzeichnisse `inside` und `outside`
        // unter `tmpDir`. Root = `inside/`. Eine bösartige Datei in
        // `inside/` versucht über `../outside/secret` herauszubrechen.
        const inside = await fs.mkdtemp(path.join(tmpDir, 'inside-'));
        const outsideDir = await fs.mkdtemp(path.join(tmpDir, 'outside-'));
        await fs.writeFile(
            path.join(outsideDir, 'secret.findsl'),
            'konst S: Dezimal = 1\n',
        );
        const evilName = path.basename(outsideDir);
        const evil = path.join(inside, 'evil.findsl');
        await fs.writeFile(
            evil,
            `verwende {S} aus "../${evilName}/secret"\nkonst E: Dezimal = 2\n`,
        );
        await expect(
            loadModuleGraph(evil, buildParser(), { allowedRoot: inside }),
        ).rejects.toThrow(InterpretError);
        await expect(
            loadModuleGraph(evil, buildParser(), { allowedRoot: inside }),
        ).rejects.toThrow(/außerhalb des erlaubten Projektverzeichnisses/);
    });

    it('Entry außerhalb des Roots wird abgelehnt', async () => {
        const root = await fs.mkdtemp(path.join(tmpDir, 'root-'));
        const elsewhere = await fs.mkdtemp(path.join(tmpDir, 'elsewhere-'));
        const entry = path.join(elsewhere, 'foo.findsl');
        await fs.writeFile(entry, 'konst K: Dezimal = 1\n');
        await expect(
            loadModuleGraph(entry, buildParser(), { allowedRoot: root }),
        ).rejects.toThrow(/Einstiegsdatei .* liegt außerhalb/);
    });

    it('Ohne allowedRoot bleibt Verhalten unverändert (kein Check)', async () => {
        // Regressionsschutz: die existierende Cross-Dir-Test-Suite (oben)
        // ruft ohne Optionen auf — hier exemplarisch dasselbe Muster.
        const dir = await fs.mkdtemp(path.join(tmpDir, 'nocheck-'));
        const d = path.basename(dir);
        await write(path.join(d, 'sub', 'a.findsl'), 'konst X: Dezimal = 1\n');
        const entry = await write(
            path.join(d, 'b.findsl'),
            'verwende {X} aus "./sub/a"\nkonst Y: Dezimal = 2\n',
        );
        const order = await loadModuleGraph(entry, buildParser());
        expect(order.map(base)).toEqual(['a.findsl', 'b.findsl']);
    });
});
