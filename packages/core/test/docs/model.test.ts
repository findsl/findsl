/**
 * Tests für das Doc-Generator-Zwischenmodell (`buildDocModel`):
 * Datei-/Decl-Doc, quelltext-treue Signaturen, `@Quelle`-Links,
 * `datensatz`-Feld-`//`-Doku (§ 4.15), Aufzählungs-Werte,
 * `prüfe`-Beispiele, abbruch-Anhang. Aggregiert + nach Pfad sortiert.
 *
 * Es gibt keinen `modul`-Header mehr — die Modul-Identität (`name`) ist
 * der Pfad relativ zur gemeinsamen Basis ALLER Dateien (ohne `.findsl`),
 * das Datei-Doc kommt aus dem führenden `--…--`-Block (`fileDoc`).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { buildDocModel, findFinFiles } from '../../src/docgen/model.js';

let dir: string;

const MOD_A = `--
# Tarif-Modul

Berechnet den Tarif.
--

--
Grundfreibetrag — § 32a EStG.
--
@Quelle("§ 32a Absatz 1 EStG")
konst GFB: Euro = 12.096

--
Tarifformel; lehnt negatives zvE ab.

@param zve  Zu versteuerndes Einkommen in Euro.
@rückgabe   Tarifliche Einkommensteuer.

## Hinweis

Nachgelagerter Prosa-Abschnitt.
--
@Quelle("§ 9a, § 10c EStG")
fn tarif(zve: Euro): Euro = wenn (zve < (0 als Euro)) abbruch("§ 32a: negativ") sonst zve

datensatz Bescheid(
    zve: Euro,    // zu versteuerndes Einkommen
    est: Euro,    // festgesetzte Steuer
)

--
@param zve  Erläuterung aus @param (überschreibt Trailing-//).
--
datensatz BescheidP(
    zve: Euro,    // §4.15-Trailing
    est: Euro,    // festgesetzte Steuer
)

aufzählung Tarifart { Grundtarif, Splitting }

prüfe "Knotenpunkte" {
    testfall "GFB ist 0" {
        tarif(12.096 als Euro) == (12.096 als Euro)
    }
    testfall "negativ lehnt ab" erwartet abbruch {
        tarif(-1 als Euro)
    }
}
`;

const MOD_B = '@Quelle("§ 8 KStG")\nkonst SATZ: Prozent = 15%\n';

beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'findsl-doc-'));
    await fs.mkdir(path.join(dir, 'sub'), { recursive: true });
    await fs.writeFile(path.join(dir, 'a.findsl'), MOD_A);
    await fs.writeFile(path.join(dir, 'sub', 'b.findsl'), MOD_B);
});

afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

// Datei-Identitäten relativ zur gemeinsamen Basis (= `dir`):
// a.findsl → "a", sub/b.findsl → "sub/b".
const NAME_A = 'a';
const NAME_B = 'sub/b';

describe('buildDocModel — Aggregation', () => {
    it('findet rekursiv alle .findsl und baut nach displayId-Pfad sortierte Module', async () => {
        const files = await findFinFiles(dir);
        expect(files.length).toBe(2);
        const model = await buildDocModel(files);
        expect(model.modules.map((m) => m.name)).toEqual([NAME_A, NAME_B]);
    });

    it('Datei-Doc-Kommentar aus führendem --…--Block (Markdown, Marker entfernt)', async () => {
        const model = await buildDocModel(await findFinFiles(dir));
        const a = model.modules.find((m) => m.name === NAME_A)!;
        expect(a.doc).toContain('# Tarif-Modul');
        expect(a.doc).toContain('Berechnet den Tarif.');
        expect(a.doc).not.toContain('--');
    });

    it('Datei ohne führenden Doc-Block → leeres Modul-Doc', async () => {
        const model = await buildDocModel(await findFinFiles(dir));
        const b = model.modules.find((m) => m.name === NAME_B)!;
        expect(b.doc).toBe('');
        expect(b.decls.find((d) => d.name === 'SATZ')).toBeDefined();
    });
});

describe('buildDocModel — Deklarationen', () => {
    let a: Awaited<ReturnType<typeof buildDocModel>>['modules'][number];
    beforeAll(async () => {
        a = (await buildDocModel(await findFinFiles(dir))).modules.find((m) => m.name === NAME_A)!;
    });

    it('konst: Signatur quelltext-treu inkl. Wert + @Quelle-Link', () => {
        const k = a.decls.find((d) => d.name === 'GFB')!;
        expect(k.kind).toBe('konst');
        expect(k.signature).toBe('konst GFB: Euro = 12.096');
        expect(k.doc).toContain('Grundfreibetrag');
        expect(k.quellen[0].refs[0].url)
            .toBe('https://www.gesetze-im-internet.de/estg/__32a.html');
    });

    it('fn: Signatur OHNE Body; mehrere §-Refs', () => {
        const f = a.decls.find((d) => d.name === 'tarif')!;
        expect(f.kind).toBe('fn');
        expect(f.signature).toBe('fn tarif(zve: Euro): Euro');
        const urls = f.quellen[0].refs.map((r) => r.url);
        expect(urls).toContain('https://www.gesetze-im-internet.de/estg/__9a.html');
        expect(urls).toContain('https://www.gesetze-im-internet.de/estg/__10c.html');
    });

    it('datensatz: Felder mit Typ + §4.15-Trailing-//-Doku', () => {
        const ds = a.decls.find((d) => d.name === 'Bescheid')!;
        expect(ds.fields?.map((x) => [x.name, x.type, x.doc])).toEqual([
            ['zve', 'Euro', 'zu versteuerndes Einkommen'],
            ['est', 'Euro', 'festgesetzte Steuer'],
        ]);
    });

    it('fn: @param/@rückgabe strukturiert extrahiert, aus Prosa entfernt', () => {
        const f = a.decls.find((d) => d.name === 'tarif')!;
        expect(f.params).toEqual([
            { name: 'zve', desc: 'Zu versteuerndes Einkommen in Euro.' },
        ]);
        expect(f.returns).toBe('Tarifliche Einkommensteuer.');
        // Prosa bleibt erhalten, Tag-Zeilen sind raus.
        expect(f.doc).toContain('Tarifformel');
        expect(f.doc).toContain('## Hinweis');
        expect(f.doc).toContain('Nachgelagerter Prosa-Abschnitt.');
        expect(f.doc).not.toContain('@param');
        expect(f.doc).not.toContain('@rückgabe');
    });

    it('datensatz: @param wird in die Feld-Tabelle eingewoben (kein Dup)', () => {
        const ds = a.decls.find((d) => d.name === 'BescheidP')!;
        expect(ds.fields?.map((x) => [x.name, x.doc])).toEqual([
            ['zve', 'Erläuterung aus @param (überschreibt Trailing-//).'],
            ['est', 'festgesetzte Steuer'],   // kein @param → Trailing-//
        ]);
        // Keine separate Parameter-Liste am Datensatz (in Felder gefaltet).
        expect(ds.params).toBeUndefined();
        expect(ds.doc).not.toContain('@param');
    });

    it('aufzählung: Werte', () => {
        const e = a.decls.find((d) => d.name === 'Tarifart')!;
        expect(e.values).toEqual(['Grundtarif', 'Splitting']);
    });

    it('prüfe: Beispiele mit Label + Block-Code + erwartetAbbruch', () => {
        const p = a.decls.find((d) => d.kind === 'prüfe')!;
        expect(p.examples?.map((x) => [x.label, x.erwartetAbbruch])).toEqual([
            ['GFB ist 0', false],
            ['negativ lehnt ab', true],
        ]);
        expect(p.examples?.[0].code).toContain('tarif(12.096 als Euro)');
    });

    it('Anhang: abbruch-Stelle erfasst', () => {
        expect(a.abbruchSites.length).toBe(1);
        expect(a.abbruchSites[0].enthaltenIn).toBe('tarif');
        expect(a.abbruchSites[0].begruendung).toContain('§ 32a: negativ');
    });
});
