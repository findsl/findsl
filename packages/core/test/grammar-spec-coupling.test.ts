/**
 * CI-Gate: Grammatik-Duo-Kopplung (Issue #205).
 *
 * Hintergrund: Die Sprache wird von ZWEI Artefakten zusammengehalten, die
 * laut CLAUDE.md bei jeder Sprachänderung synchron bleiben müssen:
 *
 *   1. `SPEC.md` Anhang A — kanonische EBNF (menschenlesbare Referenz)
 *   2. `packages/core/src/language/findsl.langium` — ausführbare Grammatik
 *
 * Früher gab es zusätzlich `grammar/findsl.ebnf` als dritte, NICHT
 * maschinell eingekoppelte Handkopie. Sie war bereits divergiert (doppelte
 * `lambda`-Produktion; `testfall` statt SPECs `prüfe_beispiel`) und wurde
 * mit #205 entfernt. Die zentrale Invariante hing damit allein an
 * menschlicher Disziplin — kein Test prüfte sie.
 *
 * Dieser Test koppelt das verbleibende Duo maschinell an der schmalsten,
 * verlässlichsten Naht: den KEYWORDS. Jedes alphabetische Keyword-Literal
 * der ausführbaren Grammatik MUSS in der kanonischen EBNF als Terminal-
 * Literal (`"keyword"`) auftauchen. Fängt den häufigsten realen Drift ab:
 * „Keyword zur Grammatik hinzugefügt, SPEC vergessen" (und umgekehrt das
 * Entfernen). Operatoren/Interpunktion (`->`, `==`, `{`, `!!`, …) sind
 * bewusst ausgenommen — ihre Schreibweise ist im Prosa-/EBNF-Kontext nicht
 * eindeutig token-suchbar; die Keywords sind der signaltragende Teil.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/core/test → Repo-Wurzel (drei Ebenen hoch), wie bundle-smoke.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const langiumPath = path.join(repoRoot, 'packages', 'core', 'src', 'language', 'findsl.langium');
const specPath = path.join(repoRoot, 'SPEC.md');

/**
 * Entfernt Langium-Zeilen- und Blockkommentare, damit keine in Prosa
 * vorkommenden Apostrophe als vermeintliche Keyword-Literale eingelesen
 * werden.
 */
function stripComments(src: string): string {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\n\r]*/g, ' ');
}

/**
 * Sammelt alle einfach-gequoteten Literale aus der Langium-Grammatik und
 * behält nur die, die mit einem Buchstaben beginnen (= Schlüsselwörter wie
 * `verwende`, `prüfe`, `für`; Unicode-Buchstaben inkl. Umlauten). Operatoren
 * und Interpunktion (`->`, `==`, `?.`, `{`) fallen damit heraus.
 */
function extractKeywords(langiumSrc: string): string[] {
    const body = stripComments(langiumSrc);
    const literals = body.match(/'([^']+)'/g) ?? [];
    const keywords = literals
        .map((lit) => lit.slice(1, -1))
        .filter((lit) => /^\p{L}/u.test(lit));
    return [...new Set(keywords)].sort();
}

/** Extrahiert den ```ebnf-Codeblock aus „## Anhang A" der SPEC. */
function extractAnhangAEbnf(specSrc: string): string {
    const anchor = specSrc.indexOf('## Anhang A');
    expect(anchor, 'SPEC.md: „## Anhang A" nicht gefunden').toBeGreaterThan(-1);
    const after = specSrc.slice(anchor);
    const block = /```ebnf\s*([\s\S]*?)```/.exec(after);
    expect(block, 'SPEC.md Anhang A: kein ```ebnf-Block gefunden').not.toBeNull();
    return block![1];
}

describe('Grammatik-Duo-Kopplung (CI-Gate, Issue #205)', () => {
    const langiumSrc = fs.readFileSync(langiumPath, 'utf-8');
    const specSrc = fs.readFileSync(specPath, 'utf-8');
    const keywords = extractKeywords(langiumSrc);
    const ebnf = extractAnhangAEbnf(specSrc);

    it('grammar/findsl.ebnf existiert nicht mehr (entfernt mit #205)', () => {
        expect(fs.existsSync(path.join(repoRoot, 'grammar', 'findsl.ebnf'))).toBe(false);
    });

    it('Extraktion liefert eine plausible Keyword-Menge', () => {
        // Sanity-Untergrenze: bricht laut, falls die Extraktion (z. B. nach
        // einer Grammatik-Refaktorierung) stillschweigend leerläuft.
        expect(keywords.length).toBeGreaterThanOrEqual(25);
        // Stichproben der bekannten Kern-Keywords.
        for (const k of ['verwende', 'konst', 'fn', 'datensatz', 'aufzählung', 'prüfe', 'wähle', 'für']) {
            expect(keywords, `Keyword „${k}" sollte extrahiert werden`).toContain(k);
        }
    });

    it('jedes Langium-Keyword ist als Terminal-Literal in SPEC Anhang A dokumentiert', () => {
        const fehlend = keywords.filter((k) => !ebnf.includes(`"${k}"`));
        expect(
            fehlend,
            'Diese Keywords stehen in findsl.langium, fehlen aber als '
            + '"keyword"-Terminal in SPEC.md Anhang A — Grammatik-Duo '
            + `divergiert: ${fehlend.join(', ')}`,
        ).toEqual([]);
    });
});
