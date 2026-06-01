/**
 * Empfänger-Methoden-Dispatch für SPEC § 11 (Stdlib): Listen-Methoden
 * (§ 11.2), Skalar-Rundungs-Methoden (§ 11.1) und Text-Methoden (§ 11.5).
 *
 * Aus `findsl-types.ts` extrahiert (Issue #72), damit die Typ-Datei
 * unter dem 1000-Zeilen-Limit bleibt. Die hier exportierten Funktionen
 * werden vom Ketten-Walker (`walkChain` in `findsl-inference.ts`)
 * aufgerufen und liefern Ergebnistyp + ob das nachfolgende `Call`-
 * Kettenglied konsumiert wurde.
 */

import type { AstNode } from 'langium';
import { infer } from './findsl-inference.js';
import { checkAgainstAnnotation } from './findsl-type-check.js';
import {
    TDezimal,
    TGanzzahl,
    TProzent,
    TText,
    TUnknown,
    TWahrheit,
    isNumeric,
    type FunctionType,
    type Reporter,
    type Type,
    type TypeContext,
    type TypeEnv,
    typeToString,
} from './findsl-types.js';
import type { CallArg, Expr } from './generated/ast.js';

/** Minimaler strukturaler Argument-Typ, den `listMethod` konsumiert.
 *  Reicht für echtes `CallArg` (hat `value: Expr` + optional `name`) und
 *  für das synthetische Trailing-Lambda-Wrap `{ value: lam }` (Lambda ⊆ Expr).
 *  Frühere `(… as unknown as { args: ReadonlyArray<CallArg> })`-Lüge
 *  wurde durch diesen Mindesttyp ersetzt — `listMethod` greift nie auf
 *  `$type`/`$container`/`$cstNode` zu. */
export type ListMethodCallOp = { args: ReadonlyArray<{ value: Expr; name?: string }> };

/**
 * Typ-Substitution für die Listen-Methoden aus SPEC § 11.2 — bewusst ein
 * Spezialfall (Element-Typ T, U/A aus Lambda-Inferenz), KEINE allgemeine
 * Generics-Engine (YAGNI). `callOp` ist das folgende `(...)`-Kettenglied
 * (für Argument-Methoden); `consumedCall` signalisiert dem Aufrufer, es
 * zu überspringen. `undefined` ⇒ unbekannte Methode.
 */
export function listMethod(
    elem: Type,
    name: string,
    callOp: ListMethodCallOp | undefined,
    env: TypeEnv, ctx: TypeContext, report: Reporter,
): { type: Type; consumedCall: boolean } | undefined {
    const args = callOp?.args ?? [];
    const had = !!callOp;
    const fn = (params: ReadonlyArray<Type>, result: Type): FunctionType =>
        ({ kind: 'function', params, result });
    switch (name) {
        case 'länge': return { type: TGanzzahl, consumedCall: false };
        case 'leer':  return { type: TWahrheit, consumedCall: false };
        case 'kopf':  return { type: elem, consumedCall: false };
        case 'rest':  return { type: { kind: 'list', element: elem }, consumedCall: false };
        case 'bei': {
            if (args[0]) checkAgainstAnnotation(args[0].value, TGanzzahl, env, ctx, report);
            return { type: elem, consumedCall: had };
        }
        case 'enthält': {
            if (args[0]) checkAgainstAnnotation(args[0].value, elem, env, ctx, report);
            return { type: TWahrheit, consumedCall: had };
        }
        case 'zuordnen': {
            const fT = args[0]
                ? checkAgainstAnnotation(args[0].value, fn([elem], TUnknown), env, ctx, report)
                : TUnknown;
            const u = fT.kind === 'function' ? fT.result : TUnknown;
            return { type: { kind: 'list', element: u }, consumedCall: had };
        }
        case 'filtern': {
            if (args[0]) checkAgainstAnnotation(args[0].value, fn([elem], TWahrheit), env, ctx, report);
            return { type: { kind: 'list', element: elem }, consumedCall: had };
        }
        case 'zusammenfassen': {
            const accT = args[0] ? infer(args[0].value, env, ctx, report) : TUnknown;
            if (args[1]) checkAgainstAnnotation(args[1].value, fn([accT, elem], accT), env, ctx, report);
            return { type: accT, consumedCall: had };
        }
        case 'zähle': {
            if (args[0]) checkAgainstAnnotation(args[0].value, fn([elem], TWahrheit), env, ctx, report);
            return { type: TGanzzahl, consumedCall: had };
        }
        case 'summe':
        case 'größtes':
        case 'kleinstes':
            return { type: elem, consumedCall: had };
        default:
            return undefined;
    }
}

/**
 * Skalar-Rundung (SPEC § 11.1). `recv` = Empfängertyp. Vertrag:
 *  - `Dezimal`  → `Ganzzahl` (kontextfrei, einziges sinnvolles Ziel).
 *  - `EuroCent` → `Euro` ODER `Cent`, bestimmt aus `expected`
 *    (bidirektionale Inferenz). Fehlt der Kontext → Fehler.
 *  - sonst → Empfänger-Fehler (keine Nachkommastellen — nichts zu runden).
 *  - `unknown` (Teil-Parse) → `unknown`, kein Folge-Diagnose-Rauschen.
 */
export function scalarRoundingMethod(
    recv: Type, name: string, expected: Type | undefined,
    node: AstNode, report: Reporter,
): Type {
    if (recv.kind === 'unknown') return TUnknown;
    if (recv.kind === 'primitive' && recv.name === 'Dezimal') return TGanzzahl;
    // Prozent → volle Prozent (Einheit bleibt, kontextfrei — analog
    // EuroCent→Euro, nur ein sinnvolles Ziel; SPEC § 11.1).
    if (recv.kind === 'primitive' && recv.name === 'Prozent') return TProzent;
    if (recv.kind === 'primitive' && recv.name === 'EuroCent') {
        const tgt = roundingTarget(expected);
        if (tgt) return tgt;
        report(node,
            `Zielgenauigkeit unbestimmt — \`.${name}()\` auf EuroCent `
            + `braucht einen Euro-/Cent-Kontext (\`: Euro\`/\`: Cent\` `
            + `annotieren oder \`als\` casten; SPEC § 11.1).`);
        return TUnknown;
    }
    report(node,
        `\`.${name}()\` nur auf EuroCent, Dezimal oder Prozent (Werte mit `
        + `Nachkommastellen), erhalten ${typeToString(recv)} (SPEC § 11.1).`);
    return TUnknown;
}

/**
 * Umwandlungs-Methoden (SPEC § 11.7) — Methoden-Form des `als`-Casts (§ 4.8):
 *  - `.alsProzent()` auf `Ganzzahl`/`Dezimal` → `Prozent` (Zahl als Prozentangabe).
 *  - `.alsDezimal()` auf `Prozent` → `Dezimal` (Bruchwert).
 *  - sonst → Empfänger-Fehler. `unknown` (Teil-Parse) → `unknown`.
 */
export function conversionMethod(
    recv: Type, name: string, node: AstNode, report: Reporter,
): Type {
    if (recv.kind === 'unknown') return TUnknown;
    const rn = recv.kind === 'primitive' ? recv.name : null;
    if (name === 'alsProzent') {
        if (rn === 'Ganzzahl' || rn === 'Dezimal') return TProzent;
        report(node,
            `\`.alsProzent()\` nur auf Ganzzahl/Dezimal, erhalten `
            + `${typeToString(recv)} (SPEC § 11.7).`);
        return TUnknown;
    }
    // name === 'alsDezimal'
    if (rn === 'Prozent') return TDezimal;
    report(node,
        `\`.alsDezimal()\` nur auf Prozent, erhalten ${typeToString(recv)} `
        + `(SPEC § 11.7).`);
    return TUnknown;
}

/** Euro/Cent aus dem erwarteten Typ als Rundungsziel; sonst `undefined`. */
function roundingTarget(expected: Type | undefined): Type | undefined {
    if (!expected) return undefined;
    const e = expected.kind === 'nullable' ? expected.inner : expected;
    if (e.kind === 'primitive' && (e.name === 'Euro' || e.name === 'Cent')) return e;
    return undefined;
}

/**
 * Text-Methoden (SPEC § 11.5). `länge`/`leer`/`alsText` sind
 * Eigenschaften (kein `()`), der Rest Aufruf-Methoden. Die
 * `.alsText(format = …)`-Variante ist in v1.0 nicht implementiert
 * (Argumente → Hinweis, Ergebnis bleibt `Text`). `undefined` ⇒
 * unbekannte Methode (Aufrufer meldet „Text hat keine Methode …").
 */
export function textMethod(
    name: string,
    callOp: { args: ReadonlyArray<CallArg> } | undefined,
    node: AstNode,
    env: TypeEnv, ctx: TypeContext, report: Reporter,
): { type: Type; consumedCall: boolean } | undefined {
    const args = callOp?.args ?? [];
    const had = !!callOp;
    switch (name) {
        case 'länge': return { type: TGanzzahl, consumedCall: false };
        case 'leer':  return { type: TWahrheit, consumedCall: false };
        case 'alsText':
            if (args.length > 0) {
                report(node,
                    '`.alsText(format = …)` ist in v1.0 noch nicht '
                    + 'implementiert; nur das parameterlose `.alsText` '
                    + '(SPEC § 11.5).');
            }
            return { type: TText, consumedCall: had };
        case 'einrückungEntfernen':
        case 'alsGroßbuchstaben':
        case 'alsKleinbuchstaben':
            return { type: TText, consumedCall: had };
        case 'beginntMit':
        case 'endetMit':
        case 'enthält':
            if (args[0]) checkAgainstAnnotation(args[0].value, TText, env, ctx, report);
            return { type: TWahrheit, consumedCall: had };
        case 'geteiltAn':
            if (args[0]) checkAgainstAnnotation(args[0].value, TText, env, ctx, report);
            return { type: { kind: 'list', element: TText }, consumedCall: had };
        default:
            return undefined;
    }
}

/** Methodennamen, die `scalarArgMethod` bedient (SPEC § 11.6). Der
 *  Ketten-Walker gated darauf, bevor er die Funktion ruft. */
export const SCALAR_ARG_METHODS: ReadonlySet<string> =
    new Set(['höchstens', 'mindestens', 'abrundenAuf', 'aufrundenAuf']);

/**
 * Grenzwert- und Stufen-Methoden (SPEC § 11.6) auf numerischem Empfänger:
 *  - `.höchstens(grenze)` / `.mindestens(grenze)` — Min/Max (Ober-/Untergrenze).
 *  - `.abrundenAuf(vielfaches)` / `.aufrundenAuf(vielfaches)` — Rundung auf ein
 *    Vielfaches.
 *
 * Alle vier sind **typ-erhaltend** (Ergebnis = Empfängertyp) und
 * **kontextfrei** — anders als `scalarRoundingMethod` ist kein `expected`-
 * Walk nötig, weil keine Einheit gewechselt wird. Das Argument wird via
 * `checkAgainstAnnotation` gegen den Empfängertyp geprüft (löst dieselbe
 * Geld-Literal-Promotion aus wie ein Vergleich, so dass `betrag.höchstens(0,00)`
 * mit nacktem Literal trägt). Nicht-numerischer Empfänger → Empfänger-Fehler
 * (analog `scalarRoundingMethod`). Der Aufrufer gated bereits auf
 * `SCALAR_ARG_METHODS`, daher kein `undefined`-Rückgabezweig.
 */
export function scalarArgMethod(
    recv: Type, name: string,
    callOp: ListMethodCallOp | undefined,
    node: AstNode,
    env: TypeEnv, ctx: TypeContext, report: Reporter,
): { type: Type; consumedCall: boolean } {
    const had = !!callOp;
    if (recv.kind === 'unknown') return { type: TUnknown, consumedCall: had };
    if (!isNumeric(recv)) {
        report(node,
            `\`.${name}()\` nur auf numerischen Typen (Geld, Ganzzahl, `
            + `Dezimal, Prozent), erhalten ${typeToString(recv)} (SPEC § 11.6).`);
        return { type: TUnknown, consumedCall: had };
    }
    const arg = callOp?.args[0];
    if (arg) checkAgainstAnnotation(arg.value, recv, env, ctx, report);
    return { type: recv, consumedCall: had };
}
