/**
 * Interpreter-/prüfe-Tests für `abbruch` (SPEC § 4.19, D2).
 *
 * Sichert: Abbruch ist nicht abfangbar (propagiert auch über
 * Funktionsaufruf-Grenzen bis zur Lauf-Grenze), normaler testfall mit
 * Abbruch = fail mit Begründung, `erwartet abbruch` = pass gdw. Abbruch.
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { runPruefe } from '../../src/interpret/pruefe.js';

async function pruefe(source: string) {
    const program = await parseSource(source);
    return runPruefe(program);
}

describe('abbruch im prüfe-Runner', () => {
    it('normaler testfall mit Abbruch → fail mit Begründung', async () => {
        const r = await pruefe(`modul m
fn t(zve: Euro): Euro = abbruch("§ 32a EStG: negatives zvE unzulässig")
prüfe "p" {
    testfall "loest aus" { t(-1 als Euro) == 0 als Euro }
}
`);
        expect(r.failed).toBe(1);
        expect(r.passed).toBe(0);
        expect(r.errored).toBe(0);
        expect(r.results[0].detail).toContain('abbruch: "§ 32a EStG: negatives zvE unzulässig"');
    });

    it('erwartet abbruch + Abbruch → pass', async () => {
        const r = await pruefe(`modul m
fn t(zve: Euro): Euro = abbruch("§ 32a EStG: unzulässig")
prüfe "p" {
    testfall "Ablehnung" erwartet abbruch { t(-1 als Euro) }
}
`);
        expect(r.passed).toBe(1);
        expect(r.failed).toBe(0);
        expect(r.results[0].detail).toContain('Abbruch wie erwartet');
    });

    it('erwartet abbruch, aber normaler Wert → fail', async () => {
        const r = await pruefe(`modul m
fn t(zve: Euro): Euro = 0 als Euro
prüfe "p" {
    testfall "sollte abbrechen" erwartet abbruch { t(5 als Euro) == 0 als Euro }
}
`);
        expect(r.failed).toBe(1);
        expect(r.passed).toBe(0);
        expect(r.results[0].detail).toContain('erwartete abbruch');
    });

    it('Abbruch propagiert unabfangbar über Funktionsaufruf-Grenzen', async () => {
        const r = await pruefe(`modul m
fn boom(x: Euro): Euro = abbruch("§ X: bumm bei \${x}")
fn ruft(x: Euro): Euro = boom(x) + 1 als Euro
prüfe "p" {
    testfall "indirekt" erwartet abbruch { ruft(7 als Euro) }
}
`);
        expect(r.passed).toBe(1);
        expect(r.results[0].detail).toContain('bumm bei 7');
    });

    it('gemischtes wähle: gültiger Pfad pass, Abbruch-Pfad fail', async () => {
        const r = await pruefe(`modul m
fn tarif(zve: Euro): Euro = wähle {
    falls zve < 0 als Euro -> abbruch("§ 32a: negativ")
    sonst                  -> 0 als Euro
}
prüfe "p" {
    testfall "gueltig" { tarif(100 als Euro) == 0 als Euro }
    testfall "ablehnung" erwartet abbruch { tarif(-5 als Euro) }
}
`);
        expect(r.passed).toBe(2);
        expect(r.failed).toBe(0);
        expect(r.errored).toBe(0);
    });
});
