// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

import { describe, it, expect } from 'vitest';
import { reflowJava } from '../../src/codegen/emit-java/reflow.js';

const MAX = 120;
/** UTF-8-Byte-Breite — maßgeblich, weil das Gate (`awk`) Bytes zählt. */
const byteWidth = (l: string): number => new TextEncoder().encode(l).length;
const allWithin = (s: string): boolean =>
    s.split('\n').every((l) => byteWidth(l) <= MAX);

describe('reflowJava — Zeilen ≤ 120 Zeichen', () => {
    it('kurze Zeilen bleiben unverändert', () => {
        const src = 'class X {\n    int a = 1;\n}\n';
        expect(reflowJava(src)).toBe(src);
    });

    it('lange Methoden-Kette wird fluent umgebrochen', () => {
        const recv = 'h.entgelteSchulden()';
        const adds = Array.from({ length: 6 }, (_, i) => `.add(wert${i}())`).join('');
        const line = `        final FinDslNumber summe = ${recv}${adds}.withMoneyAnnotation(FinDslNumber.Type.EuroCent, "x");`;
        expect(line.length).toBeGreaterThan(MAX);

        const out = reflowJava(line);
        expect(allWithin(out)).toBe(true);
        // Erste Zeile enthält den Receiver, Folgeglieder eingerückt.
        const lines = out.split('\n');
        expect(lines[0]).toContain('h.entgelteSchulden()');
        expect(lines[1].trimStart().startsWith('.add(')).toBe(true);
        // Continuation-Einrückung = Original (8) + 4 = 12 Spaces.
        expect(lines[1].match(/^ */)![0].length).toBe(12);
    });

    it('lange Argument-Liste wird ein-Argument-pro-Zeile umgebrochen', () => {
        const args = Array.from({ length: 8 }, (_, i) => `argumentNummer${i}`).join(', ');
        const line = `        return FinDslListe.bereich(${args});`;
        expect(line.length).toBeGreaterThan(MAX);

        const out = reflowJava(line);
        expect(allWithin(out)).toBe(true);
        const lines = out.split('\n');
        expect(lines[0].trimEnd().endsWith('(')).toBe(true);
        expect(lines[lines.length - 1].trimEnd().endsWith(');')).toBe(true);
    });

    it('Punkt innerhalb eines String-Literals wird NICHT als Ketten-Punkt behandelt', () => {
        // Die "."-Zeichen in der URL dürfen keinen Umbruch triggern.
        const line = `        var x = foo("http://a.b.c/path").bar().baz().qux().quux().corge().grault();`;
        const out = reflowJava(line);
        // String-Literal bleibt intakt (kein Umbruch mitten in der URL).
        expect(out).toContain('"http://a.b.c/path"');
        expect(allWithin(out) || out === line).toBe(true);
    });

    it('Komma innerhalb eines String-Literals wird NICHT als Arg-Trenner behandelt', () => {
        const line = `        return f("a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u, v, w, x");`;
        const out = reflowJava(line);
        // Das String-Literal mit Kommas bleibt eine Einheit.
        expect(out).toContain('"a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p, q, r, s, t, u, v, w, x"');
    });

    it('idempotent: reflow(reflow(x)) == reflow(x)', () => {
        const recv = 'h.entgelteSchulden()';
        const adds = Array.from({ length: 6 }, (_, i) => `.add(wert${i}())`).join('');
        const line = `        final FinDslNumber summe = ${recv}${adds}.withMoneyAnnotation(FinDslNumber.Type.EuroCent, "x");`;
        const once = reflowJava(line);
        const twice = reflowJava(once);
        expect(twice).toBe(once);
    });

    it('keine künstlichen Umbrüche bei einfacher Methoden-Kette < 120', () => {
        const line = '        return h.a().b().c();';
        expect(reflowJava(line)).toBe(line);
    });

    it('verschachtelte Argument-Kommas (innere) lösen keinen falschen Top-Level-Split aus', () => {
        const line = `        final FinDslNumber x = ANTEIL.mul(h.mietePachtBeweglich()).cast(FinDslNumber.Type.EuroCent).add(zweiterWertHier()).add(dritterWertHier());`;
        const out = reflowJava(line);
        expect(allWithin(out)).toBe(true);
    });

    it('Zeile ohne sicheren Umbruchpunkt bleibt unverändert (besser zu lang als kaputt)', () => {
        // Ein einzelner sehr langer Identifier ohne Kette/Args.
        const line = '        ' + 'x'.repeat(150) + ';';
        expect(reflowJava(line)).toBe(line);
    });

    it('Single-Argument-Aufruf (f(g(…))) wird an der flachsten Klammer gebrochen', () => {
        // berechne(new Fahrzeug(a, b, c)) — die äußere Single-Arg-Klammer
        // ist flacher als die inneren Kommas und muss zuerst brechen,
        // sonst bleibt der unbalancierte Kopf zu lang.
        const line = `        final KraftfahrzeugsteuerErgebnis ergebnisDerBerechnung = service.berechneKraftfahrzeugsteuer(new Fahrzeug(eins, zwei, drei));`;
        expect(byteWidth(line)).toBeGreaterThan(MAX);
        const out = reflowJava(line);
        expect(allWithin(out)).toBe(true);
        // Kopf endet mit öffnender Klammer des äußeren Aufrufs.
        expect(out.split('\n')[0].trimEnd().endsWith('berechneKraftfahrzeugsteuer(')).toBe(true);
    });

    it('Single-Argument-Konstanten (EuroCent.von(x.add(y.mul(z)))) brechen', () => {
        const line = `    public static final EuroCent NR3_KUM_3000 = EuroCent.von(NR3_KUM_2000.add(NR3_2000_3000.mul(FinDslNumber.ganzzahl("500"))));`;
        expect(byteWidth(line)).toBeGreaterThan(MAX);
        expect(allWithin(reflowJava(line))).toBe(true);
    });

    it('boolesche Operator-Ketten (|| / &&) werden vor dem Operator gebrochen', () => {
        const line = `        if ((ausschluss == Freibetragsausschluss.Nr1KapitalLeistungen) || (ausschluss == Freibetragsausschluss.Nr2VereinNach25) || (ausschluss == Freibetragsausschluss.Nr3Investmentfonds)) {`;
        expect(byteWidth(line)).toBeGreaterThan(MAX);
        const out = reflowJava(line);
        expect(allWithin(out)).toBe(true);
        // Folgezeilen beginnen mit dem Operator (fluent-Stil).
        expect(out.split('\n').slice(1).some((l) => l.trimStart().startsWith('||'))).toBe(true);
    });

    it('String-Konkatenation (+) in throw-Meldung wird gebrochen', () => {
        const line = `            throw new FinDslAbort("ein recht ausführlicher Hinweistext zur Fehlersituation hier" + wert.asText() + " Ende");`;
        expect(byteWidth(line)).toBeGreaterThan(MAX);
        expect(allWithin(reflowJava(line))).toBe(true);
    });

    it('Inline-Lambda-Block ((x) -> { …; … }) wird Statement-weise gebrochen', () => {
        const line = `        return xs.zuordnen((x) -> { final FinDslNumber doppelt = x.mul(FinDslNumber.ganzzahl("2")); return doppelt.add(FinDslNumber.ganzzahl("1")); });`;
        expect(byteWidth(line)).toBeGreaterThan(MAX);
        const out = reflowJava(line);
        expect(allWithin(out)).toBe(true);
        const lines = out.split('\n');
        // Kopf endet mit '{', Abschluss-Zeile beginnt mit '}'.
        expect(lines[0].trimEnd().endsWith('-> {')).toBe(true);
        expect(lines[lines.length - 1].trimStart().startsWith('}')).toBe(true);
    });

    it('überlanges String-Literal wird in "a" + "b" aufgeteilt (Wert bleibt erhalten)', () => {
        const text = 'A'.repeat(160);
        const line = `        final String x = "${text}";`;
        expect(byteWidth(line)).toBeGreaterThan(MAX);
        const out = reflowJava(line);
        expect(allWithin(out)).toBe(true);
        // Die konkatenierten Teile ergeben wieder den Originaltext.
        const parts = [...out.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
        expect(parts).toBe(text);
    });

    it('String-Split schneidet nie mitten in einer Escape-Sequenz (\\n)', () => {
        const text = '\\n' + 'x'.repeat(150);   // \n + lange Folge
        const line = `        final String x = "${text}";`;
        const out = reflowJava(line);
        expect(allWithin(out)).toBe(true);
        // Kein "\" am Zeilenende vor dem schließenden Quote (zerteiltes \n).
        for (const l of out.split('\n')) {
            expect(/\\"$/.test(l)).toBe(false);
        }
    });

    it('Mehrbyte-Zeichen (§, Umlaute) zählen byte-genau (≤ 120 Bytes)', () => {
        const text = '§ '.repeat(80);     // jedes § = 2 Bytes
        const line = `        final String x = "${text}";`;
        const out = reflowJava(line);
        expect(allWithin(out)).toBe(true);   // Byte-Breite, nicht Zeichen
    });

    it('Generic-Kommas (Lambda1<A, B>) lösen keinen Argument-Split aus', () => {
        const line = `            final FinDslLambda1<FinDslNumber, FinDslNumber> additionsfunktion = service.machAddierer(Ganzzahl.von(FinDslNumber.ganzzahl("5")));`;
        expect(byteWidth(line)).toBeGreaterThan(MAX);
        const out = reflowJava(line);
        expect(allWithin(out)).toBe(true);
        // Der Generic-Typ bleibt als Einheit (kein Umbruch im <…>).
        expect(out).toContain('FinDslLambda1<FinDslNumber, FinDslNumber>');
    });

    it('idempotent über alle neuen Strategien', () => {
        const cases = [
            `        if ((a == Enum.WertEins) || (b == Enum.WertZwei) || (c == Enum.WertDrei) || (d == Enum.WertVier)) {`,
            `            throw new FinDslAbort("ein recht ausführlicher Hinweistext zur Fehlersituation hier" + wert.asText() + " Ende");`,
            `        return xs.zuordnen((x) -> { final FinDslNumber doppelt = x.mul(FinDslNumber.ganzzahl("2")); return doppelt.add(FinDslNumber.ganzzahl("1")); });`,
            `        final String x = "${'A'.repeat(160)}";`,
        ];
        for (const line of cases) {
            const once = reflowJava(line);
            expect(reflowJava(once)).toBe(once);
        }
    });
});
