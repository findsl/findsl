// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Tests für den TeamCity-Service-Message-Reporter (#256): IntelliJ rendert
 * seinen Test-Baum aus diesen Zeilen, daher müssen Hierarchie, Escaping und
 * Suite-Balance exakt stimmen.
 */

import { describe, it, expect } from 'vitest';
import { escapeTeamCity, teamCityReport } from '../../src/interpret/teamcity-reporter.js';
import type { PruefeReport, TestfallReport } from '../../src/interpret/pruefe.js';

function report(results: TestfallReport[]): PruefeReport {
    return {
        total: results.length,
        passed: results.filter((r) => r.status === 'pass').length,
        failed: results.filter((r) => r.status === 'fail').length,
        errored: results.filter((r) => r.status === 'error').length,
        results,
        ausgaben: [],
    };
}

describe('escapeTeamCity', () => {
    it('escaped die TeamCity-Sonderzeichen', () => {
        expect(escapeTeamCity("a'b")).toBe("a|'b");
        expect(escapeTeamCity('a\nb')).toBe('a|nb');
        expect(escapeTeamCity('a\rb')).toBe('a|rb');
        expect(escapeTeamCity('x[y]z')).toBe('x|[y|]z');
    });

    it('verdoppelt den Pipe zuerst (kein Doppel-Escape der eingefügten Pipes)', () => {
        expect(escapeTeamCity('a|b')).toBe('a||b');
        expect(escapeTeamCity("|'")).toBe("|||'");
    });

    it('lässt deutsche Umlaute unangetastet (UTF-8 erlaubt)', () => {
        expect(escapeTeamCity('Grundtarif für zvE')).toBe('Grundtarif für zvE');
    });
});

describe('teamCityReport', () => {
    it('verschachtelt prüfe-Block als Suite, Testfälle als Tests', () => {
        const lines = teamCityReport(report([
            { pruefeName: 'Grundtarif', testfallLabel: 'zvE=10000', status: 'pass', detail: 'wahr' },
            { pruefeName: 'Grundtarif', testfallLabel: 'zvE=20000', status: 'fail', detail: 'falsch' },
        ]), { suiteName: 'kst.test.findsl' });
        const j = lines.join('\n');
        expect(j).toContain("##teamcity[testSuiteStarted name='kst.test.findsl'");
        expect(j).toContain("##teamcity[testSuiteStarted name='Grundtarif'");
        expect(j).toContain("##teamcity[testStarted name='zvE=10000'");
        expect(j).toContain("##teamcity[testFinished name='zvE=10000']");
        expect(j).toContain("##teamcity[testFailed name='zvE=20000' message='Erwartet wahr, war: falsch']");
        expect(j).toContain("##teamcity[testSuiteFinished name='Grundtarif']");
        expect(j).toContain("##teamcity[testSuiteFinished name='kst.test.findsl']");
    });

    it('meldet pass-Testfälle ohne testFailed', () => {
        const lines = teamCityReport(report([
            { pruefeName: 'P', testfallLabel: 't', status: 'pass', detail: 'wahr' },
        ]), { suiteName: 's' });
        expect(lines.some((l) => l.includes('testFailed'))).toBe(false);
        // genau ein testStarted (der Testfall) — testSuiteStarted matcht nicht.
        expect(lines.filter((l) => l.includes('testStarted')).length).toBe(1);
        expect(lines.filter((l) => l.includes('testFinished')).length).toBe(1);
    });

    it('error-Status wird als testFailed mit Laufzeitfehler-Präfix gemeldet', () => {
        const lines = teamCityReport(report([
            { pruefeName: 'P', testfallLabel: 't', status: 'error', detail: 'Division durch Null' },
        ]), { suiteName: 's' });
        expect(lines.join('\n')).toContain("testFailed name='t' message='Laufzeitfehler: Division durch Null'");
    });

    it('Testfälle ohne prüfe-Block (leerer Name) hängen direkt unter der Datei-Suite', () => {
        const lines = teamCityReport(report([
            { pruefeName: '', testfallLabel: '<modul-initialisierung>', status: 'error', detail: 'kaputt' },
        ]), { suiteName: 'mod.findsl' });
        // Genau zwei Suite-Tags (nur die Datei-Suite), keine leere prüfe-Suite.
        expect(lines.filter((l) => l.includes('testSuiteStarted')).length).toBe(1);
        expect(lines.filter((l) => l.includes('testSuiteFinished')).length).toBe(1);
        expect(lines.join('\n')).toContain("testStarted name='<modul-initialisierung>'");
    });

    it('Suite-Tags sind balanciert (jede started hat ein finished)', () => {
        const lines = teamCityReport(report([
            { pruefeName: 'A', testfallLabel: 'a1', status: 'pass', detail: 'wahr' },
            { pruefeName: 'B', testfallLabel: 'b1', status: 'fail', detail: 'x' },
            { pruefeName: 'A', testfallLabel: 'a2', status: 'pass', detail: 'wahr' },
        ]), { suiteName: 's' });
        const started = lines.filter((l) => l.includes('testSuiteStarted')).length;
        const finished = lines.filter((l) => l.includes('testSuiteFinished')).length;
        expect(started).toBe(finished);
        // gleicher prüfe-Name A taucht nur als EINE Suite auf (Gruppierung).
        expect(lines.filter((l) => l.includes("testSuiteStarted name='A'")).length).toBe(1);
    });

    it('setzt locationHint auf file://<pfad>, wenn filePath gegeben (ohne Position)', () => {
        const lines = teamCityReport(report([
            { pruefeName: 'P', testfallLabel: 't', status: 'pass', detail: 'wahr' },
        ]), { suiteName: 's', filePath: '/abs/kst.test.findsl' });
        expect(lines.join('\n')).toContain("locationHint='file:///abs/kst.test.findsl'");
    });

    it('setzt zeilengenauen locationHint, wenn der Testfall eine Position hat', () => {
        const lines = teamCityReport(report([
            { pruefeName: 'P', testfallLabel: 't', status: 'pass', detail: 'wahr', line: 12, column: 5 },
        ]), { suiteName: 's', filePath: '/abs/kst.test.findsl' });
        // Der testStarted-Hint zeigt auf Zeile:Spalte; die Datei-Suite bleibt ohne.
        expect(lines.join('\n')).toContain("testStarted name='t' locationHint='file:///abs/kst.test.findsl:12:5'");
        expect(lines.join('\n')).toContain("testSuiteStarted name='s' locationHint='file:///abs/kst.test.findsl'");
    });

    it('escaped Sonderzeichen in Test-/Suite-Namen und Messages', () => {
        const lines = teamCityReport(report([
            { pruefeName: "P'1", testfallLabel: 'a[b]', status: 'fail', detail: "wert='x'" },
        ]), { suiteName: 's' });
        const j = lines.join('\n');
        expect(j).toContain("testSuiteStarted name='P|'1'");
        expect(j).toContain("testStarted name='a|[b|]'");
        expect(j).toContain("message='Erwartet wahr, war: wert=|'x|''");
    });
});
