/**
 * E2E-Tests für den bidirektionalen Type-Checker: kleine FinDSL-Snippets
 * werden geparst, typgeprüft und die gesammelten Diagnosen geprüft.
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { typeCheckProgram } from '../../src/language/findsl-types.js';

async function typecheck(source: string): Promise<string[]> {
    const program = await parseSource(source);
    const msgs: string[] = [];
    typeCheckProgram(program, (_node, message) => { msgs.push(message); });
    return msgs;
}

describe('Positivfälle (keine Diagnosen)', () => {
    it('Konstanten mit passender Annotation', async () => {
        const msgs = await typecheck(
            `modul m
konst GFB: Euro = 12.096
konst ZONE_4_SATZ: Prozent = 42%
konst PI: Dezimal = 3,14
konst N: Ganzzahl = 5
`);
        expect(msgs).toEqual([]);
    });

    it('Bidirektionale Inferenz: Literal wird Euro im Euro-Kontext', async () => {
        const msgs = await typecheck(
            `modul m
konst GFB: Euro = 12.096
konst R: Euro = GFB + 1
`);
        expect(msgs).toEqual([]);
    });

    it('Elvis-Fallback: Literal "0" wird im Euro-Kontext zu Euro', async () => {
        const msgs = await typecheck(
            `modul m
konst N: Euro? = nichts
konst R: Euro = N oder 0
`);
        expect(msgs).toEqual([]);
    });

    it('Geld-Arithmetik: Prozent * Euro = EuroCent', async () => {
        const msgs = await typecheck(
            `modul m
konst SATZ: Prozent = 42%
konst BETRAG: Euro = 100.000
konst R: EuroCent = SATZ * BETRAG
`);
        expect(msgs).toEqual([]);
    });

    it('Funktion mit Block-Body und Let-Bindung', async () => {
        const msgs = await typecheck(
            `modul m
fn f(zve: Euro): Dezimal {
    var y: Dezimal = (zve - 12.096) / 10.000
    932,30 * y + 1.400
}
`);
        expect(msgs).toEqual([]);
    });

    it('Aufzählungs-Wert in Wähle (Builtin-Tarifart)', async () => {
        const msgs = await typecheck(
            `modul m
fn f(art: Tarifart): Ganzzahl = wähle (art) {
    falls Grundtarif -> 1
    falls Splitting  -> 2
}
`);
        expect(msgs).toEqual([]);
    });

    it('Nullable Feldzugriff mit Sicher-Zugriff', async () => {
        const msgs = await typecheck(
            `modul m
datensatz Adresse(straße: Text)
datensatz Person(adresse: Adresse?)
konst P: Person = Person(adresse = nichts)
konst R: Text? = P.adresse?.straße
`);
        expect(msgs).toEqual([]);
    });
});

describe('Negative Geld-Literale (#144) — vorzeichenbehaftet', () => {
    it('negatives Euro-Literal im Euro-Kontext (fn-Rückgabe)', async () => {
        const msgs = await typecheck(
            `modul m
fn nachzahlung(): Euro = -100
`);
        expect(msgs).toEqual([]);
    });

    it('negatives Euro-Literal als Konstante', async () => {
        const msgs = await typecheck(
            `modul m
konst MIN_SALDO: Euro = -500
`);
        expect(msgs).toEqual([]);
    });

    it('negatives EuroCent-Literal (zwei Nachkommastellen)', async () => {
        const msgs = await typecheck(
            `modul m
konst ERSTATTUNG: EuroCent = -3,23
`);
        expect(msgs).toEqual([]);
    });

    it('negatives Geld-Literal als Parameter-Default', async () => {
        const msgs = await typecheck(
            `modul m
fn f(korrektur: Euro = -50): Euro = korrektur
`);
        expect(msgs).toEqual([]);
    });

    it('negatives Geld-Literal als Record-Feld-Default', async () => {
        const msgs = await typecheck(
            `modul m
datensatz Bescheid(saldo: Euro = -100)
`);
        expect(msgs).toEqual([]);
    });

    it('negatives Ganzzahl-Literal bleibt zulässig', async () => {
        const msgs = await typecheck(
            `modul m
konst DELTA: Ganzzahl = -7
`);
        expect(msgs).toEqual([]);
    });

    it('Schreibweisen-Check greift auf den Betrag: negatives EuroCent mit 3 Nachkommastellen ist Fehler', async () => {
        const msgs = await typecheck(
            `modul m
konst X: EuroCent = -3,234
`);
        expect(msgs.some((m) => /EuroCent-Literal.*zwei Nachkommastellen/.test(m))).toBe(true);
    });

    it('Schreibweisen-Check greift auf den Betrag: negatives Euro mit Nachkommastellen ist Fehler', async () => {
        const msgs = await typecheck(
            `modul m
konst X: Euro = -3,50
`);
        expect(msgs.some((m) => /Euro-Literal.*ganzzahlig/.test(m))).toBe(true);
    });
});

describe('Negativfälle (erwartete Diagnosen)', () => {
    it('Geld * Geld ist verboten (SPEC § 3.2.3)', async () => {
        const msgs = await typecheck(
            `modul m
konst A: Euro = 10
konst B: Euro = 20
konst R: Euro = A * B
`);
        expect(msgs.some((m) => m.includes('Geld * Geld ist verboten'))).toBe(true);
    });

    it('Prozent + Geld wird als Mismatch erkannt', async () => {
        const msgs = await typecheck(
            `modul m
konst SATZ: Prozent = 10%
konst BETRAG: Euro = 100
konst R: Euro = SATZ + BETRAG
`);
        expect(msgs.some((m) => /Prozent/.test(m))).toBe(true);
    });

    it('Prozent + Geld im Vergleichs-Kontext: arithResult-Pfad meldet Spec-Regel wörtlich', async () => {
        const msgs = await typecheck(
            `modul m
konst SATZ: Prozent = 10%
konst BETRAG: Euro = 100
fn f(): Wahrheitswert = (SATZ + BETRAG) > 0
`);
        expect(msgs.some((m) => m.includes('nicht erlaubt'))).toBe(true);
    });

    it('Cast in niedrigere Geld-Präzision ist Fehler', async () => {
        const msgs = await typecheck(
            `modul m
konst X: Cent = 100
konst R: Euro = X als Euro
`);
        expect(msgs.some((m) => m.includes('niedrigere Geld-Präzision'))).toBe(true);
    });

    it('Konstante-Annotation passt nicht zum Wert', async () => {
        const msgs = await typecheck(
            `modul m
konst T: Text = "abc"
konst R: Ganzzahl = T
`);
        expect(msgs.some((m) => m.includes('Erwartet Ganzzahl, erhalten Text'))).toBe(true);
    });

    it('wenn-Bedingung muss Wahrheitswert sein', async () => {
        const msgs = await typecheck(
            `modul m
konst R: Ganzzahl = wenn (5) 1 sonst 2
`);
        expect(msgs.some((m) => m.includes('Wahrheitswert'))).toBe(true);
    });

    it('"ist nichts" auf non-nullable ist Fehler', async () => {
        const msgs = await typecheck(
            `modul m
konst X: Euro = 10
konst R: Wahrheitswert = X ist nichts
`);
        expect(msgs.some((m) => m.includes('Nullable-Operanden'))).toBe(true);
    });

    it('Force-Unwrap auf non-nullable ist Fehler', async () => {
        const msgs = await typecheck(
            `modul m
konst X: Euro = 10
konst R: Euro = X!!
`);
        expect(msgs.some((m) => m.includes('Force-Unwrap'))).toBe(true);
    });

    it('Sicher-Zugriff auf non-nullable ist Fehler', async () => {
        const msgs = await typecheck(
            `modul m
datensatz Pt(x: Ganzzahl)
konst P: Pt = Pt(1)
konst R: Ganzzahl? = P?.x
`);
        expect(msgs.some((m) => m.includes('Sicher-Zugriff'))).toBe(true);
    });

    it('Datensatz-Feldzugriff auf unbekanntes Feld', async () => {
        const msgs = await typecheck(
            `modul m
datensatz Pt(x: Ganzzahl)
konst P: Pt = Pt(1)
konst R: Ganzzahl = P.unbekannt
`);
        expect(msgs.some((m) => m.includes('Feld "unbekannt" existiert nicht'))).toBe(true);
    });

    it('Funktions-Rückgabetyp passt nicht', async () => {
        const msgs = await typecheck(
            `modul m
fn f(x: Ganzzahl): Text = x
`);
        expect(msgs.some((m) => m.includes('Erwartet Text'))).toBe(true);
    });

    it('Field-Default-Typ-Mismatch', async () => {
        const msgs = await typecheck(
            `modul m
datensatz Cfg(name: Text = 42)
`);
        expect(msgs.some((m) => m.includes('Erwartet Text'))).toBe(true);
    });

    it('Elvis-Fallback mit falschem Typ wird via bidirektionaler Inferenz erkannt', async () => {
        const msgs = await typecheck(
            `modul m
konst N: Euro? = nichts
konst R: Euro = N oder "fallback"
`);
        expect(msgs.some((m) => /Erwartet Euro, erhalten Text/.test(m))).toBe(true);
    });
});

describe('Benannte Argumente — strikte Param-Prüfung', () => {
    it('Benanntes Argument mit unbekanntem Param-Name → Diagnose', async () => {
        const msgs = await typecheck(`modul m
fn f(a: Ganzzahl, b: Ganzzahl): Ganzzahl = a + b
konst R: Ganzzahl = f(a = 1, xyz = 2)
`);
        expect(msgs.some((m) => /Unbekanntes benanntes Argument "xyz"/.test(m))).toBe(true);
    });

    it('Benanntes Argument doppelt → Diagnose', async () => {
        const msgs = await typecheck(`modul m
fn f(a: Ganzzahl): Ganzzahl = a
konst R: Ganzzahl = f(a = 1, a = 2)
`);
        expect(msgs.some((m) => /"a" wurde bereits übergeben/.test(m))).toBe(true);
    });

    it('Benanntes Argument mit falschem Typ wird strikt erkannt', async () => {
        const msgs = await typecheck(`modul m
fn f(zve: Euro, name: Text): Euro = zve
konst R: Euro = f(zve = "kein-Geld" als Euro, name = "Anna")
`);
        // "kein-Geld" als Euro: Text ist nicht zu Euro castbar — Cast-Diagnose
        expect(msgs.some((m) => /Cast nicht definiert/.test(m))).toBe(true);
    });

    it('Fehlendes Pflicht-Argument (kein Default) → Diagnose', async () => {
        const msgs = await typecheck(`modul m
fn f(a: Ganzzahl, b: Ganzzahl): Ganzzahl = a + b
konst R: Ganzzahl = f(1)
`);
        expect(msgs.some((m) => /Fehlendes Pflicht-Argument "b"/.test(m))).toBe(true);
    });

    it('Argument mit Default darf weggelassen werden — keine Diagnose', async () => {
        const msgs = await typecheck(`modul m
fn f(a: Ganzzahl, b: Ganzzahl = 10): Ganzzahl = a + b
konst R: Ganzzahl = f(1)
`);
        expect(msgs).toEqual([]);
    });

    it('Datensatz-Konstruktor: Pflichtfeld fehlt → Diagnose', async () => {
        const msgs = await typecheck(`modul m
datensatz Pt(x: Ganzzahl, y: Ganzzahl)
konst P: Pt = Pt(x = 1)
`);
        expect(msgs.some((m) => /Fehlendes Pflicht-Argument "y"/.test(m))).toBe(true);
    });

    it('Zu viele positionale Argumente → Diagnose', async () => {
        const msgs = await typecheck(`modul m
fn f(a: Ganzzahl): Ganzzahl = a
konst R: Ganzzahl = f(1, 2, 3)
`);
        expect(msgs.some((m) => /Zu viele positionale Argumente/.test(m))).toBe(true);
    });
});

describe('wähle-Vollständigkeit bei Aufzählungs-Subjekten', () => {
    it('Alle Werte abgedeckt, kein sonst nötig — keine Diagnose', async () => {
        const msgs = await typecheck(`modul m
fn f(art: Tarifart): Ganzzahl = wähle (art) {
    falls Grundtarif -> 1
    falls Splitting  -> 2
}
`);
        expect(msgs).toEqual([]);
    });

    it('Fehlender Aufzählungs-Wert → Diagnose', async () => {
        const msgs = await typecheck(`modul m
fn f(art: Tarifart): Ganzzahl = wähle (art) {
    falls Grundtarif -> 1
}
`);
        expect(msgs.some((m) =>
            /wähle ist nicht vollständig.*Splitting/.test(m),
        )).toBe(true);
    });

    it('Vollständig auch über Multi-Pattern-Arme', async () => {
        const msgs = await typecheck(`modul m
fn f(s: Steuerklasse): Ganzzahl = wähle (s) {
    falls I, II      -> 0
    falls III        -> 1
    falls IV, V, VI  -> 2
}
`);
        expect(msgs).toEqual([]);
    });

    it('Mit sonst ist immer vollständig (auch wenn Werte fehlen)', async () => {
        const msgs = await typecheck(`modul m
fn f(art: Tarifart): Ganzzahl = wähle (art) {
    falls Grundtarif -> 1
    sonst -> 0
}
`);
        expect(msgs).toEqual([]);
    });

    it('Nullable-Subjekt: nichts muss abgedeckt sein', async () => {
        const msgs = await typecheck(`modul m
fn f(art: Tarifart?): Ganzzahl = wähle (art) {
    falls Grundtarif -> 1
    falls Splitting  -> 2
}
`);
        expect(msgs.some((m) => /nichts.*nicht abgedeckt/.test(m))).toBe(true);
    });

    it('Nullable-Subjekt mit `falls nichts` und allen Werten — OK', async () => {
        const msgs = await typecheck(`modul m
fn f(art: Tarifart?): Ganzzahl = wähle (art) {
    falls nichts     -> 0
    falls Grundtarif -> 1
    falls Splitting  -> 2
}
`);
        expect(msgs).toEqual([]);
    });
});

describe('Smart-Cast für Nullable', () => {
    it('wenn (x ist nicht nichts) verfeinert x im then-Zweig zu non-null', async () => {
        const msgs = await typecheck(`modul m
fn f(x: Euro?): Euro = wenn (x ist nicht nichts) x sonst 0 als Euro
`);
        // x im then-Zweig ist Euro, also passt zum Euro-Returntyp.
        expect(msgs).toEqual([]);
    });

    it('wenn (x ist nichts) verfeinert x im sonst-Zweig zu non-null', async () => {
        const msgs = await typecheck(`modul m
fn f(x: Euro?): Euro = wenn (x ist nichts) 0 als Euro sonst x
`);
        expect(msgs).toEqual([]);
    });

    it('Ohne Smart-Cast: Euro? passt nicht zu Euro-Return → Diagnose', async () => {
        const msgs = await typecheck(`modul m
fn f(x: Euro?): Euro = x
`);
        expect(msgs.some((m) => /Erwartet Euro, erhalten Euro\?/.test(m))).toBe(true);
    });

    it('wähle (subject) mit falls nichts: sonst-Arm sieht non-null Subjekt', async () => {
        const msgs = await typecheck(`modul m
fn f(x: Euro?): Euro = wähle (x) {
    falls nichts -> 0 als Euro
    sonst        -> x
}
`);
        expect(msgs).toEqual([]);
    });

    it('Smart-Cast greift nur bei reinem Identifier — nicht bei f(x)', async () => {
        const msgs = await typecheck(`modul m
fn g(): Euro? = nichts
fn f(): Euro = wenn (g() ist nicht nichts) g() sonst 0 als Euro
`);
        // g() ist ein Call, keine Variable → kein Smart-Cast → g() bleibt Euro?
        expect(msgs.some((m) => /Erwartet Euro, erhalten Euro\?/.test(m))).toBe(true);
    });
});

describe('Tolerantes Verhalten bei Inferenz-Lücken', () => {
    it('Unbekannter Identifier in non-PascalCase wird gemeldet', async () => {
        const msgs = await typecheck(
            `modul m
konst R: Ganzzahl = unbekannt + 1
`);
        expect(msgs.some((m) => m.includes('Unbekannter Identifier'))).toBe(true);
    });

    it('Cross-Modul-Import-Symbol wird als unknown getypt → keine Folge-Diagnose', async () => {
        const msgs = await typecheck(
            `modul m
verwende {fremd} aus a.b
konst R: Euro = fremd
`);
        const realErrors = msgs.filter((m) => !m.includes('Unbekannter'));
        expect(realErrors).toEqual([]);
    });

    it('PascalCase-Identifier ohne Bindung wird zu Symbol (kein Fehler)', async () => {
        const msgs = await typecheck(
            `modul m
fn f(): Tarifart = Grundtarif
`);
        expect(msgs).toEqual([]);
    });
});

describe('abbruch / never (Bottom-Typ, SPEC § 3.14 / § 4.19)', () => {
    it('abbruch als Funktionsbody erfüllt jeden Rückgabetyp', async () => {
        const msgs = await typecheck(
            `modul m
fn f(zve: Euro): Euro = abbruch("§ 32a: unzulässig")
`);
        expect(msgs).toEqual([]);
    });

    it('abbruch-Zweig in wähle: andere Zweige bestimmen den Typ', async () => {
        const msgs = await typecheck(
            `modul m
fn t(zve: Euro): Euro = wähle {
    falls zve < 0 als Euro -> abbruch("negatives zvE: \${zve}")
    sonst                  -> 0 als Euro
}
`);
        expect(msgs).toEqual([]);
    });

    it('abbruch-Zweig in wenn neben Euro-Zweig', async () => {
        const msgs = await typecheck(
            `modul m
fn g(b: Wahrheitswert): Euro = wenn (b) abbruch("x") sonst 0 als Euro
`);
        expect(msgs).toEqual([]);
    });

    it('never maskiert keinen echten Typkonflikt im anderen Zweig', async () => {
        const msgs = await typecheck(
            `modul m
fn t(zve: Euro): Euro = wähle {
    falls zve < 0 als Euro -> abbruch("neg")
    sonst                  -> "kein Euro"
}
`);
        expect(msgs.length).toBeGreaterThanOrEqual(1);
        expect(msgs.join(' ')).toMatch(/Erwartet Euro|erhalten Text/);
    });

    it('Nicht-Text-Begründung ist ein Typfehler', async () => {
        const msgs = await typecheck(
            `modul m
fn f(): Euro = abbruch(123)
`);
        expect(msgs.join(' ')).toMatch(/Erwartet Text|erhalten Ganzzahl/);
    });

    it('String-Interpolations-Slots in der Begründung werden geprüft', async () => {
        const msgs = await typecheck(
            `modul m
fn f(): Euro = abbruch("Wert: \${unbekannt}")
`);
        expect(msgs.join(' ')).toMatch(/Unbekannter Identifier "unbekannt"/);
    });

    it('wähle, in dem ALLE Zweige abbrechen, ist überall einsetzbar', async () => {
        const msgs = await typecheck(
            `modul m
fn f(zve: Euro): Euro = wähle {
    falls zve < 0 als Euro -> abbruch("a")
    sonst                  -> abbruch("b")
}
`);
        expect(msgs).toEqual([]);
    });
});
