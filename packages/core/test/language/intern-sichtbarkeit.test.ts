/**
 * `_`-Präfix = modul-intern (SPEC § 4.16, verschärft). Top-Level-Decls
 * (fn/konst/datensatz/aufzählung) mit führendem `_` dürfen NICHT
 * cross-file mit `verwende` importiert werden — Ausnahme: eine
 * `<basis>.test.findsl` darf die Interna ihrer zugehörigen Quelldatei
 * `<basis>.findsl` importieren. Außerdem erscheinen `_`-Interne NICHT in
 * der generierten Doku.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseSource } from '../helpers/parse.js';
import { buildDocModel, findFinFiles } from '../../src/docgen/model.js';
import { renderMarkdown } from '../../src/docgen/markdown.js';

async function internErrors(src: string, uri: string): Promise<string[]> {
    const program = await parseSource(src, { validate: true, uri });
    const doc = (program as {
        $document?: { diagnostics?: { severity?: number; code?: string; message: string }[] };
    }).$document;
    return (doc?.diagnostics ?? [])
        .filter((d) => d.severity === 1 && d.code === 'findsl.import-intern')
        .map((d) => d.message);
}

const TESTDATEI = 'file:///pfad/quelle.test.findsl';
const ANDERE = 'file:///pfad/anderes.findsl';

describe('Intern-Import: Verstöße sind Fehler', () => {
    it('Quelldatei importiert _Funktion → Fehler', async () => {
        const e = await internErrors(
            'verwende { _Helfer } aus "./quelle"\n'
            + 'fn F(x: Euro): Euro = _Helfer(x)\n',
            ANDERE,
        );
        expect(e.some((m) => /_Helfer.*modul-intern/.test(m))).toBe(true);
    });

    it('Alias ändert nichts (Quellname zählt)', async () => {
        const e = await internErrors(
            'verwende { _Helfer als h } aus "./quelle"\n'
            + 'fn F(x: Euro): Euro = h(x)\n',
            ANDERE,
        );
        expect(e.some((m) => /_Helfer.*modul-intern/.test(m))).toBe(true);
    });

    it('gilt auch für _konst / _datensatz (alle Top-Level-Decls)', async () => {
        const e = await internErrors(
            'verwende { _GFB, _Satz } aus "./quelle"\n'
            + 'konst K: Euro = _GFB\n',
            ANDERE,
        );
        expect(e.some((m) => /_GFB.*modul-intern/.test(m))).toBe(true);
        expect(e.some((m) => /_Satz.*modul-intern/.test(m))).toBe(true);
    });

    it('Test-Datei importiert _Interna einer FREMDEN Datei → Fehler', async () => {
        const e = await internErrors(
            'verwende { _Fremd } aus "./anderes"\n'
            + 'prüfe "p" { testfall "t" { _Fremd(1 als Euro) == (1 als Euro) } }\n',
            TESTDATEI,
        );
        expect(e.some((m) => /_Fremd.*modul-intern/.test(m))).toBe(true);
    });
});

describe('Intern-Import: erlaubte Fälle (kein Fehler)', () => {
    it('öffentlicher Name ist normal importierbar', async () => {
        expect(await internErrors(
            'verwende { Helfer } aus "./quelle"\n'
            + 'fn F(x: Euro): Euro = Helfer(x)\n',
            ANDERE,
        )).toEqual([]);
    });

    it('Test-Datei darf _Interna ihrer zugehörigen Quelldatei importieren', async () => {
        expect(await internErrors(
            'verwende { _Helfer } aus "./quelle"\n'
            + 'prüfe "p" { testfall "t" { _Helfer(1 als Euro) == (1 als Euro) } }\n',
            TESTDATEI,
        )).toEqual([]);
    });
});

describe('Doc-Generator: _-Interne werden NICHT generiert', () => {
    let dir: string;

    beforeAll(async () => {
        dir = await fs.mkdtemp(path.join(os.tmpdir(), 'findsl-intern-'));
        await fs.writeFile(path.join(dir, 'm.findsl'), `--
# Modul
--

--
Öffentliche Funktion.
--
fn Oeffentlich(x: Euro): Euro = x * 2

--
Interner Helfer — darf NICHT in der Doku erscheinen.
--
fn _Intern(x: Euro): Euro = x + x

@Quelle("§ 1 EStG")
konst _SATZ_INTERN: Euro = 5

@Quelle("§ 2 EStG")
konst SATZ: Euro = 10
`);
    });
    afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

    it('öffentliche Decls drin, _-Interne raus', async () => {
        const model = await buildDocModel(await findFinFiles(dir));
        const md = renderMarkdown(model);
        expect(md).toContain('Oeffentlich');
        expect(md).toContain('SATZ');
        expect(md).not.toContain('_Intern');
        expect(md).not.toContain('_SATZ_INTERN');
        expect(md).not.toContain('Interner Helfer');
    });
});
