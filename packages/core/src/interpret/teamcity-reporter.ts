// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * TeamCity-Service-Message-Reporter für `prüfe`-Läufe (#256).
 *
 * IntelliJs Test-Runner-Fenster (`SMTRunnerConsoleView`) rendert keinen
 * Test-Baum aus einer API, sondern aus **TeamCity Service Messages**, die der
 * gestartete Prozess auf stdout schreibt (`##teamcity[testStarted …]` …). Dieser
 * Reporter übersetzt einen {@link PruefeReport} (aus der bestehenden
 * `runPruefe`-Ausführung — kein zweiter Testpfad) in solche Zeilen.
 *
 * Hierarchie:
 *   testSuiteStarted   <Datei/Suite>
 *     testSuiteStarted <prüfe-Block>
 *       testStarted / [testFailed] / testFinished   <testfall>
 *     testSuiteFinished
 *   testSuiteFinished
 *
 * Testfälle ohne `prüfe`-Block (leerer `pruefeName`, z. B. Modul-Init-Fehler)
 * hängen direkt unter der Datei-Suite.
 *
 * Format-Referenz: https://www.jetbrains.com/help/teamcity/service-messages.html
 */

import type { PruefeReport, TestfallReport } from './pruefe.js';

/**
 * Escaped einen Wert für ein `name='…'`/`message='…'`-Attribut einer
 * TeamCity-Service-Message (die „escaped value"-Regeln). Reihenfolge egal,
 * da disjunkte Zeichen — `|` wird zuerst ersetzt, damit die danach
 * eingefügten `|`-Präfixe nicht erneut escaped werden.
 */
export function escapeTeamCity(value: string): string {
    return value
        .replace(/\|/g, '||')
        .replace(/'/g, "|'")
        .replace(/\n/g, '|n')
        .replace(/\r/g, '|r')
        .replace(/\[/g, '|[')
        .replace(/\]/g, '|]');
}

export interface TeamCityOptions {
    /** Name der äußeren Suite — i. d. R. der angezeigte Dateiname/Pfad. */
    readonly suiteName: string;
    /** Absoluter Quell-Dateipfad für `locationHint` (Klick im Baum → Datei
     *  öffnen). Ohne Angabe kein locationHint. */
    readonly filePath?: string;
}

/** Baut eine `##teamcity[<name> <k='v'> …]`-Zeile mit escapten Werten. */
function message(name: string, attrs: Record<string, string | undefined>): string {
    const parts = Object.entries(attrs)
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([k, v]) => `${k}='${escapeTeamCity(v)}'`);
    return `##teamcity[${name}${parts.length ? ' ' + parts.join(' ') : ''}]`;
}

/** `file://<abs>`-locationHint (ohne Zeile — die Range liegt nicht im Report
 *  vor; IntelliJ öffnet immerhin die Datei). `undefined`, wenn kein Pfad. */
function fileHint(filePath?: string): string | undefined {
    return filePath ? `file://${filePath}` : undefined;
}

/**
 * Übersetzt einen {@link PruefeReport} EINER Datei in TeamCity-Service-Message-
 * Zeilen. Gruppiert die Testfälle nach `prüfe`-Block (Reihenfolge des ersten
 * Auftretens), sodass IntelliJ sie als verschachtelte Suiten zeigt.
 */
export function teamCityReport(report: PruefeReport, opts: TeamCityOptions): string[] {
    const hint = fileHint(opts.filePath);
    const lines: string[] = [];
    lines.push(message('testSuiteStarted', { name: opts.suiteName, locationHint: hint }));

    for (const group of groupByPruefe(report.results)) {
        const inSuite = group.pruefeName.length > 0;
        if (inSuite) lines.push(message('testSuiteStarted', { name: group.pruefeName, locationHint: hint }));
        for (const r of group.results) emitTestfall(lines, r, hint);
        if (inSuite) lines.push(message('testSuiteFinished', { name: group.pruefeName }));
    }

    lines.push(message('testSuiteFinished', { name: opts.suiteName }));
    return lines;
}

/** Eine `prüfe`-Gruppe (gleicher `pruefeName`), Reihenfolge stabil. */
interface PruefeGroup {
    readonly pruefeName: string;
    readonly results: TestfallReport[];
}

function groupByPruefe(results: ReadonlyArray<TestfallReport>): PruefeGroup[] {
    const groups: PruefeGroup[] = [];
    const byName = new Map<string, PruefeGroup>();
    for (const r of results) {
        let g = byName.get(r.pruefeName);
        if (!g) {
            g = { pruefeName: r.pruefeName, results: [] };
            byName.set(r.pruefeName, g);
            groups.push(g);
        }
        g.results.push(r);
    }
    return groups;
}

/** testStarted → (bei fail/error) testFailed → testFinished für einen Testfall. */
function emitTestfall(lines: string[], r: TestfallReport, hint?: string): void {
    lines.push(message('testStarted', { name: r.testfallLabel, locationHint: hint }));
    if (r.status !== 'pass') {
        // fail = Testfall ergab nicht `wahr` (detail = ausgewerteter Wert);
        // error = Laufzeitfehler (detail = Fehlermeldung). IntelliJ kennt nur
        // „fehlgeschlagen" — die Unterscheidung steckt in der Message.
        const prefix = r.status === 'error' ? 'Laufzeitfehler: ' : 'Erwartet wahr, war: ';
        lines.push(message('testFailed', { name: r.testfallLabel, message: prefix + r.detail }));
    }
    lines.push(message('testFinished', { name: r.testfallLabel }));
}
