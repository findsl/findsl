/**
 * Empfänger-Methoden der § 11-Stdlib des Interpreters: Listen-/Bereich-
 * Methoden (§ 11.2), Skalar-Rundung/-Grenzen/-Stufen (§ 11.1 / § 11.6) und
 * Text-Methoden (§ 11.5).
 *
 * Abhängigkeit auf den Tree-Walker ist eine EINBAHNSTRASSE: `interpreter.ts`
 * importiert von hier (Dispatch in `applyChainOp`), nicht umgekehrt. Den
 * einzigen Rückgriff — das Anwenden eines Lambda/Builtins auf Wert-Argumente
 * (`zuordnen`/`filtern`/…) — bekommt `listMethodValue` als Funktions-
 * Parameter `applyValueFn` injiziert (Lehre aus PR #82: so entsteht kein
 * ESM-Init-Zyklus). Geld-Arithmetik kommt aus dem reinen `interpret-money`.
 */

import { Decimal } from 'decimal.js';
import type { AstNode } from 'langium';

import {
    BuiltinValue,
    FALSCH,
    InterpretError,
    ListValue,
    NumericValue,
    StringValue,
    WAHR,
    isTruthy,
    valuesCompare,
    valuesEqual,
    type Value,
} from './values.js';
import {
    isCast,
    isFunktionBody,
    isFunktionDecl,
    isKonstDecl,
    isLetStmt,
} from '../language/generated/ast.js';
import { moneyAnnotationName, numericArith } from './interpret-money.js';

/** Funktion/Lambda/Builtin auf bereits ausgewertete Wert-Argumente anwenden. */
export type ApplyValueFn = (fnVal: Value, argValues: ReadonlyArray<Value>) => Value;

function listAt(els: ReadonlyArray<Value>, idx: Value | undefined): Value {
    if (!idx || idx.kind !== 'numeric' || !idx.value.isInteger()) {
        throw new InterpretError('Liste.bei: Index muss eine Ganzzahl sein.');
    }
    const i = idx.value.toNumber();
    if (i < 0 || i >= els.length) {
        throw new InterpretError(
            `Liste.bei: Index ${i} außerhalb der Liste (Länge ${els.length}).`,
        );
    }
    return els[i];
}

/**
 * Listen-/Bereich-Methoden (SPEC § 11.2). Eigenschafts-Methoden
 * (`länge`/`leer`/`kopf`/`rest`) liefern direkt den Wert; Aufruf-Methoden
 * liefern einen `BuiltinValue` — das folgende `Call`-Kettenglied wird
 * dann über den bestehenden `applyCall`-Builtin-Pfad ausgeführt (Args
 * bereits ausgewertet). D1: leere `summe` → 0 (Ganzzahl); `kopf`/
 * `größtes`/`kleinstes` auf leerer Liste → `InterpretError` (Bug-Klasse).
 */
export function listMethodValue(
    list: ListValue, name: string, applyValueFn: ApplyValueFn,
): Value {
    const els = list.elements;
    switch (name) {
        case 'länge': return NumericValue.ganzzahl(els.length);
        case 'leer':  return els.length === 0 ? WAHR : FALSCH;
        case 'kopf':
            if (els.length === 0) {
                throw new InterpretError('Liste.kopf auf leerer Liste (SPEC § 11.2).');
            }
            return els[0];
        case 'rest':  return new ListValue(els.slice(1));
        case 'bei':
            return new BuiltinValue('Liste.bei', (a) => listAt(els, a[0]));
        case 'enthält':
            return new BuiltinValue('Liste.enthält', (a) =>
                els.some((e) => valuesEqual(e, a[0])) ? WAHR : FALSCH);
        case 'zuordnen':
            return new BuiltinValue('Liste.zuordnen', (a) =>
                new ListValue(els.map((e) => applyValueFn(a[0], [e]))));
        case 'filtern':
            return new BuiltinValue('Liste.filtern', (a) =>
                new ListValue(els.filter((e) => isTruthy(applyValueFn(a[0], [e])))));
        case 'zusammenfassen':
            return new BuiltinValue('Liste.zusammenfassen', (a) =>
                els.reduce((acc, e) => applyValueFn(a[1], [acc, e]), a[0]));
        case 'zähle':
            return new BuiltinValue('Liste.zähle', (a) =>
                NumericValue.ganzzahl(
                    a.length === 0
                        ? els.length
                        : els.filter((e) => isTruthy(applyValueFn(a[0], [e]))).length,
                ));
        case 'summe':
            return new BuiltinValue('Liste.summe', () =>
                els.length === 0
                    ? NumericValue.ganzzahl(0)                       // D1
                    : els.reduce((acc, e) => numericArith(acc, e, (x, y) => x.add(y))));
        case 'größtes':
        case 'kleinstes':
            return new BuiltinValue(`Liste.${name}`, () => {
                if (els.length === 0) {
                    throw new InterpretError(
                        `Liste.${name} auf leerer Liste (SPEC § 11.2).`,    // D1
                    );
                }
                return els.reduce((best, e) =>
                    (name === 'größtes'
                        ? valuesCompare(e, best) > 0
                        : valuesCompare(e, best) < 0) ? e : best);
            });
        default:
            throw new InterpretError(`Liste hat keine Methode "${name}" (SPEC § 11.2).`);
    }
}

/**
 * Skalar-Rundung (SPEC § 11.1) als Aufruf-Methode (`.abrunden()`/
 * `.aufrunden()`): liefert einen `BuiltinValue`, den das folgende `()`-
 * Kettenglied auswertet (gleiche Mechanik wie `listMethodValue`-Aufruf-
 * methoden). `Dezimal` → `Ganzzahl` (kontextfrei). `EuroCent` → Ziel
 * `Euro`/`Cent` aus dem lokalen AST-Kontext-Walk (Bindungs-/Cast-/fn-
 * Rückgabe-Annotation; Default `Euro`) — type-checker-unabhängig, der
 * statische Checker hat die Zielexistenz bereits verifiziert. Wert ist
 * Euro-kanonisch; `toDecimalPlaces` wie in `builtins.rundung`. Andere
 * Tags → `InterpretError` (Laufzeit-Netz; statisch schon verboten).
 */
export function scalarRoundingValue(
    recv: NumericValue, name: string, opNode: AstNode,
): Value {
    const mode = name === 'abrunden' ? Decimal.ROUND_FLOOR : Decimal.ROUND_CEIL;
    // Prozent → volle Prozent, Einheit bleibt (kontextfrei). Anders als
    // der EuroCent/Dezimal-Fall ist der `Prozent`-Tag hier zuverlässig:
    // ein statisch Prozent-typisierter Empfänger ist zur Laufzeit stets
    // Prozent (Prozent-Arithmetik erhält den Tag; kein leere-`summe()`-
    // Degenerat für einen Skalar). Intern Bruch → Magnitude (×100)
    // runden → zurück als Bruch (÷100), Tag `Prozent`.
    if (recv.tag === 'Prozent') {
        return new BuiltinValue(`Prozent.${name}`, () =>
            NumericValue.prozent(
                recv.value.mul(100).toDecimalPlaces(0, mode).div(100)));
    }
    // BEWUSST tag-agnostisch (≙ frühere freie `abrundenEuro`/`abrunden`):
    // der Interpreter ist abseits des Geldmodells untypisiert, der
    // Laufzeit-Tag des Empfängers kann (z. B. leere `.summe()` → D1
    // `Ganzzahl`, Prozent-Zwischen-Tags) vom statischen Typ abweichen.
    // Die Empfänger-Restriktion (`EuroCent`/`Dezimal`) ist bereits ein
    // STATISCHER Phase-1-Gate (Type-Checker); zur Laufzeit zählt nur der
    // Euro-kanonische `value` + das maßgebliche Ziel aus dem Kontext —
    // exakt die alte freie-Funktions-Semantik (`value.toDecimalPlaces`
    // + Ziel-Tag), daher wertgleich zum Vor-Migrations-Verhalten.
    const target = governingMoneyTarget(opNode);
    if (target === undefined) {
        // Kein Geld-Kontext ⇒ Dezimal-Empfänger-Fall → `Ganzzahl`.
        return new BuiltinValue(`Ganzzahl.${name}`, () =>
            NumericValue.ganzzahl(recv.value.toDecimalPlaces(0, mode)));
    }
    const nk = target === 'Cent' ? 2 : 0;
    const make = target === 'Cent' ? NumericValue.cent : NumericValue.euro;
    return new BuiltinValue(`${target}.${name}`, () =>
        make(recv.value.toDecimalPlaces(nk, mode)));
}

/**
 * Grenzwert-Methoden (SPEC § 11.6): `.höchstens(grenze)` = Minimum,
 * `.mindestens(grenze)` = Maximum. Liefert einen `BuiltinValue`, dessen
 * folgendes `()`-Kettenglied das Grenz-Argument auswertet (gleiche Mechanik
 * wie `scalarRoundingValue`). Typ-erhaltend: das Ergebnis behält den
 * Empfänger-Tag; Werte sind Euro-kanonisch, also direkt vergleichbar.
 */
export function scalarLimitValue(recv: NumericValue, name: string): Value {
    return new BuiltinValue(`${recv.tag}.${name}`, (args) => {
        const grenze = args[0];
        if (grenze === undefined || grenze.kind !== 'numeric') {
            throw new InterpretError(
                `${recv.tag}.${name}: numerisches Argument erwartet, erhalten `
                + `${grenze === undefined ? 'keines' : grenze.kind}.`);
        }
        const keepRecv = name === 'höchstens'
            ? recv.value.lte(grenze.value)   // Minimum: kleineren behalten
            : recv.value.gte(grenze.value);  // Maximum: größeren behalten
        return new NumericValue(keepRecv ? recv.value : grenze.value, recv.tag);
    });
}

/**
 * Stufen-Methoden (SPEC § 11.6): `.abrundenAuf(vielfaches)` /
 * `.aufrundenAuf(vielfaches)` runden auf das nächste Vielfache von
 * `vielfaches` (floor/ceil). Typ-erhaltend (Empfänger-Tag bleibt; keine
 * Einheit gewechselt). `vielfaches <= 0` → `InterpretError` (Division durch
 * null bzw. unsinniger Schritt); statisch ist die Restriktion nicht
 * prüfbar, daher Laufzeit-Netz.
 */
export function scalarRoundToMultipleValue(recv: NumericValue, name: string): Value {
    const mode = name === 'abrundenAuf' ? Decimal.ROUND_FLOOR : Decimal.ROUND_CEIL;
    return new BuiltinValue(`${recv.tag}.${name}`, (args) => {
        const vielfaches = args[0];
        if (vielfaches === undefined || vielfaches.kind !== 'numeric') {
            throw new InterpretError(
                `${recv.tag}.${name}: numerisches Vielfaches erwartet, erhalten `
                + `${vielfaches === undefined ? 'keines' : vielfaches.kind}.`);
        }
        if (vielfaches.value.lte(0)) {
            throw new InterpretError(
                `${recv.tag}.${name}: Vielfaches muss größer als 0 sein, erhalten `
                + `${vielfaches.value.toString()}.`);
        }
        const stufen = recv.value.div(vielfaches.value).toDecimalPlaces(0, mode);
        return new NumericValue(stufen.mul(vielfaches.value), recv.tag);
    });
}

/**
 * Lokaler AST-Kontext-Walk: bestimmt das EuroCent-Rundungsziel
 * (`Euro`/`Cent`) aus der nächsten maßgeblichen Geld-Annotation —
 * `als`-Cast, Bindungs-Annotation (`konst`/`var`) oder Rückgabetyp der
 * umschließenden Funktion. Läuft durch ausdrucks-interne Eltern
 * (`BinaryOp`/`ParenChain`/`Wenn`/`wähle`-Arm/`UnaryOp`/`Cast`-Wert)
 * weiter hoch — auch transparent durch `CallArg`/`Call` (eine Rundung
 * als Funktionsargument findet so die umschließende Bindung/fn-Rückgabe).
 * `undefined` ⇒ keine maßgebliche Geld-Annotation gefunden (der Aufrufer
 * entscheidet den Default — EuroCent-Empfänger ⇒ `Euro` als dominanter
 * Fall; Ganzzahl-Empfänger ⇒ Ganzzahl-Identität). Bewusste, durch den
 * statischen Type-Checker abgesicherte Grenze: liegt der EINZIGE Kontext
 * im Parametertyp der aufgerufenen Funktion (nicht in einer sichtbaren
 * Annotation/Cast/fn-Rückgabe darüber), greift der Default — im realen
 * Korpus kommt das nicht vor (Aggregat 122/122).
 */
function governingMoneyTarget(node: AstNode): 'Euro' | 'Cent' | undefined {
    let cur: AstNode = node;
    for (;;) {
        const c = cur.$container;
        if (!c) return undefined;
        if (isCast(c) && c.value === cur) {
            const m = moneyAnnotationName(c.targetType);
            if (m === 'Euro' || m === 'Cent') return m;
        } else if (isKonstDecl(c) && c.value === cur) {
            const m = moneyAnnotationName(c.type);
            if (m === 'Euro' || m === 'Cent') return m;
        } else if (isLetStmt(c) && c.value === cur) {
            const m = c.type ? moneyAnnotationName(c.type) : undefined;
            if (m === 'Euro' || m === 'Cent') return m;
        } else if (isFunktionBody(c)) {
            const fd = c.$container;
            const m = isFunktionDecl(fd) ? moneyAnnotationName(fd.returnType) : undefined;
            if (m === 'Euro' || m === 'Cent') return m;
        }
        cur = c;
    }
}

/** Gemeinsamen führenden Whitespace-Prefix nicht-leerer Zeilen entfernen. */
function dedentText(s: string): string {
    const lines = s.split('\n');
    let min: number | undefined;
    for (const ln of lines) {
        if (ln.trim() === '') continue;
        const lead = ln.length - ln.replace(/^[ \t]+/, '').length;
        min = min === undefined ? lead : Math.min(min, lead);
    }
    if (min === undefined || min === 0) return s;       // all-blank bzw. keine Einrückung
    return lines.map((ln) => (ln.trim() === '' ? ln : ln.slice(min))).join('\n');
}

/**
 * Text-Argument einer § 11.5-Aufruf-Methode. `v` kann bei Teil-Parse
 * (FinDSLs häufigste Bug-Quelle) oder fehlendem Argument `undefined`
 * sein — dann ein geordneter `InterpretError` statt eines nativen
 * `TypeError` (der den InterpretError-Pfad umginge).
 */
function asText(name: string, v: Value | undefined): string {
    if (!v || v.kind !== 'string') {
        throw new InterpretError(
            `Text.${name}: Text-Argument erwartet, erhalten ${v ? v.kind : 'keines'}.`,
        );
    }
    return v.value;
}

/**
 * Text-Methoden (SPEC § 11.5). `länge`/`leer`/`alsText` sind
 * Eigenschaften (direkter Wert); der Rest sind Aufruf-Methoden
 * (`BuiltinValue`, vom folgenden `()` ausgeführt). `undefined` ⇒
 * unbekannte Methode (Aufrufer wirft „Text hat keine Methode …").
 * `.alsText(format = …)` ist v1.0 nicht implementiert (SPEC § 11.5).
 */
export function textMethodValue(s: StringValue, name: string): Value | undefined {
    switch (name) {
        case 'länge':   return NumericValue.ganzzahl([...s.value].length);
        case 'leer':    return s.value.length === 0 ? WAHR : FALSCH;
        case 'alsText': return s;
        case 'einrückungEntfernen':
            return new BuiltinValue('Text.einrückungEntfernen', () =>
                new StringValue(dedentText(s.value)));
        case 'alsGroßbuchstaben':
            return new BuiltinValue('Text.alsGroßbuchstaben', () =>
                new StringValue(s.value.toUpperCase()));
        case 'alsKleinbuchstaben':
            return new BuiltinValue('Text.alsKleinbuchstaben', () =>
                new StringValue(s.value.toLowerCase()));
        case 'beginntMit':
            return new BuiltinValue('Text.beginntMit', (a) =>
                s.value.startsWith(asText(name, a[0])) ? WAHR : FALSCH);
        case 'endetMit':
            return new BuiltinValue('Text.endetMit', (a) =>
                s.value.endsWith(asText(name, a[0])) ? WAHR : FALSCH);
        case 'enthält':
            return new BuiltinValue('Text.enthält', (a) =>
                s.value.includes(asText(name, a[0])) ? WAHR : FALSCH);
        case 'geteiltAn':
            return new BuiltinValue('Text.geteiltAn', (a) =>
                new ListValue(s.value.split(asText(name, a[0])).map((p) => new StringValue(p))));
        default:
            return undefined;
    }
}
