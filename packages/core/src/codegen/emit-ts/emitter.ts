// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * IR → TypeScript-Quelltext (ADR1/ADR11 `emit-ts/`, Issue #41/#99).
 *
 * Schwester-Emitter zu {@link ../emit-java/emitter.ts} — dieselbe
 * target-neutrale IR, andere Zielsyntax. Reiner, deterministischer
 * Pretty-Printer (Risiko R9). Ein FinDSL-Modul → EINE `.ts`-Datei mit
 * Top-Level-Deklarationen (`export function`/`const`/`enum`/`class`); ein
 * `*.test.findsl` → eine Vitest-Spec (`describe`/`it`/`expect`).
 *
 * Modulform (statt Java-Interface+Impl): Funktionen/Konstanten/Enums/
 * Records liegen top-level im Modul-File. Lokale Referenzen sind bloße
 * Bezeichner; Cross-Modul-Referenzen laufen über einen Namespace-Import
 * (`import * as <Klasse>`) — passt 1:1 auf die IR-Owner-Qualifikation
 * (`enumVal.ownerClass`/`ctor.ownerClass`/`crossRef.ownerClass` und
 * `crossCall.fieldName`→Klasse via {@link IrModule.composedModules}).
 *
 * Diese Namespace-Import-Kante IST die Mocking-Naht für Konsumenten
 * (`vi.mock('./Owner.js')`, Issue #142) — das ESM-idiomatische Äquivalent
 * zur Java-Konstruktor-Injektion (#141). Die strukturelle Asymmetrie zu #141
 * ist BEABSICHTIGT: FinDSL-Module sind reine, zustandslose Funktionen ohne
 * Injektions-Zustand; ein Umbau auf Closure-/Klassen-Factory ist bewusst
 * verworfen (KISS/YAGNI, Drift-Risiko). Siehe `docs/codegen-ts-js-mocking.md`
 * und den Regressions-/Smoke-Test `test/codegen/ts-mock-seam.test.ts`.
 *
 * Sicht-Wrapper (Euro/…) sind decimal.js-FinDslNumber-Subtypen (IS-A,
 * Runtime `runtimes/ts/`): Box = `Wrapper.von(kern)`, Unbox = No-op.
 * Walking-Skeleton-Umfang (#99): genau der `examples/kst`-Konstruktsatz
 * (konst/aufzählung/datensatz/fn, wähle, +−*, Vergleich, Rundung, Cast,
 * Geld-Annotation, Cross-Modul). Listen/Lambda/Interpolation/Nullable
 * folgen mit Issue #100 — bis dahin wirft der Emitter dafür eine klare
 * Out-of-Scope-Meldung (Modul wird vom CLI übersprungen, nicht der Batch).
 */

import type {
    IrModule, IrDecl, IrExpr, IrArm, IrBlockResult, IrDoc,
    IrTestModule, IrTestCase, IrType, IrComposedModule, IrLet,
} from '../ir/nodes.js';
import { fnName as tsFnName } from '../shared-names.js';
import { stripDocBody, wrapDoc } from '../shared-doc.js';

const IND = '    ';

/** Alle vom Runtime-`index.ts` exportierten Wert-Symbole (für bedarfs-
 *  gesteuerte Imports). Reihenfolge = deterministische Import-Reihenfolge. */
const RUNTIME_SYMBOLS = [
    'FinDslNumber', 'FinDslRuntimeError', 'FinDslAbort', 'FinDslListe', 'nichtNull',
    'Euro', 'EuroCent', 'Cent', 'Prozent', 'Ganzzahl', 'Dezimal',
    'Steuerklasse', 'Tarifart',
] as const;

/**
 * Cross-Modul-Auflösung für `crossCall`: `fieldName` → Klassenname (=
 * Namespace-Import-Alias). Wird je Modul aus {@link IrModule.composedModules}
 * gebaut und als expliziter Parameter durch die Emit-Funktionen gereicht
 * (kein Module-Level-Zustand, Issue #211).
 */
type Cross = ReadonlyMap<string, string>;

function buildFieldToClass(composed: ReadonlyArray<IrComposedModule>): Cross {
    const m = new Map<string, string>();
    for (const c of composed) m.set(c.fieldName, c.className);
    return m;
}

// --- Typ-Mapping --------------------------------------------------------

/**
 * Hängt ` | null` an, wenn der Typ nullable ist (`Text?`/`Person?`, #117);
 * Funktionstypen werden geklammert (`(…=>R) | null`), damit nicht der
 * Rückgabetyp nullable wird. Sonst kein Drift (nullable nur wo `?` steht).
 */
function withNull(t: IrType, base: string): string {
    if (t.nullable !== true) return base;
    return t.kind === 'lambda' ? `(${base}) | null` : `${base} | null`;
}

/**
 * {@link IrType} → TS-Kern-Typ (Rechen-Schicht): numerisch → `FinDslNumber`;
 * `Liste<T>` → `FinDslListe<Kern-Elem>`; Funktionstyp → native Pfeil-
 * signatur `(a0: P0, …) => R` (TS-Funktionstypen sind strukturell, keine
 * `FinDslLambda`-Klasse nötig); benannt → `Owner.Name`/`Name`. Nullable →
 * ` | null` (verschachtelte Typen über die Wrapper, eigene Nullability).
 */
function irTypeToTsCore(t: IrType): string {
    return withNull(t, coreBase(t));
}

function coreBase(t: IrType): string {
    switch (t.kind) {
        case 'number': return 'FinDslNumber';
        case 'bool': return 'boolean';
        case 'text': return 'string';
        case 'list': return `FinDslListe<${irTypeToTsCore(t.elem)}>`;
        case 'lambda': {
            const params = t.params
                .map((p, i) => `a${i}: ${irTypeToTsCore(p)}`).join(', ');
            return `(${params}) => ${irTypeToTsCore(t.ret)}`;
        }
        case 'named': return t.owner !== undefined ? `${t.owner}.${t.name}` : t.name;
    }
}

/**
 * {@link IrType} → TS-API-Typ (Deklarationsgrenze): numerisch-skalar →
 * sprechender Wrapper (`Euro` …; Teil-Parse ohne Wrapper → `FinDslNumber`);
 * `Liste<T>` bleibt `FinDslListe<Kern-Elem>`; alles übrige = Kern-Typ.
 * Nullable → ` | null`.
 */
function irTypeToTsApi(t: IrType): string {
    return withNull(t, apiBase(t));
}

function apiBase(t: IrType): string {
    switch (t.kind) {
        case 'number': return t.wrapper ?? 'FinDslNumber';
        case 'list': return `FinDslListe<${irTypeToTsCore(t.elem)}>`;
        default: return coreBase(t);           // Basistyp (kein doppeltes ` | null`)
    }
}

/** Öffentliches Typ-Mapping (vom Index re-exportiert, Symmetrie zu Java). */
export function irTypeToTs(t: IrType): string {
    return irTypeToTsApi(t);
}

// --- String-/Namens-Helfer ----------------------------------------------

/** FinDSL-String → TS-Double-Quote-Literal (vollständig escaped). */
function tsString(s: string): string {
    return JSON.stringify(s);
}

/**
 * FinDSL-Doc + `@Quelle` → JSDoc-Zeilen (oder leer). Strip-Logik geteilt mit
 * dem Java-Emitter ({@link stripDocBody}); `@Quelle` kommt hier inline ins
 * JSDoc (Java nutzt stattdessen echte `@Quelle`-Annotationen, #156).
 */
function tsdoc(info: IrDoc, indent: string): string[] {
    const body = stripDocBody(info.doc, '@returns');
    for (const q of info.quelle) {
        body.push(` * @Quelle ${q.replace(/\*\//g, '* /')}`);
    }
    return wrapDoc(body, indent);
}

// --- Ausdrucks-Emission --------------------------------------------------

/** (#44 Text-`+`) Arithmetik: Text → TS-String-Konkat; numerisch → Runtime-Method. */
function emitArith(e: Extract<IrExpr, { kind: 'arith' }>, cross: Cross): string {
    if (e.isText) {
        return `(${emitExpr(e.left, cross)}) + (${emitExpr(e.right, cross)})`;
    }
    const m = e.op === '+' ? 'add' : e.op === '-' ? 'sub' : 'mul';
    return `${emitExpr(e.left, cross)}.${m}(${emitExpr(e.right, cross)})`;
}

/**
 * Vergleich: Text → `===`/`!==` (JS-Strings sind wertverglichen, primitiv);
 * numerisch → `.equalsValue`/`.compareValue` (decimal.js-Runtime, skalen-
 * unabhängig). Ordnungsvergleiche auf Text fängt das Lowering vorab ab.
 */
function emitCmp(e: Extract<IrExpr, { kind: 'cmp' }>, cross: Cross): string {
    const l = emitExpr(e.left, cross), r = emitExpr(e.right, cross);
    const op: string = e.op;
    if (e.isText) {
        return op === '==' ? `${l} === ${r}` : `${l} !== ${r}`;
    }
    switch (op) {
        case '==': return `${l}.equalsValue(${r})`;
        case '!=': return `!${l}.equalsValue(${r})`;
        case '<':  return `${l}.compareValue(${r}) < 0`;
        case '<=': return `${l}.compareValue(${r}) <= 0`;
        case '>':  return `${l}.compareValue(${r}) > 0`;
        case '>=': return `${l}.compareValue(${r}) >= 0`;
        default:
            throw new Error(`Emit: unbekannter Vergleichsoperator "${op}".`);
    }
}

/**
 * Listen-Literale + Bereich-Konstruktoren. Leeres Literal → typisiertes
 * `FinDslListe.empty<E>()`; sonst `FinDslListe.of([…])`. Bereich/Enum-
 * Bereich → `FinDslListe.bereich/enumBereich(…)` (Schritt fehlend → `null`).
 * Bei `enumBereich` entfällt das Java-`Enum.class`-Argument: generierte
 * `enum`-Werte sind ihre Ordinalzahl (numerische Iteration genügt).
 */
function emitListExpr(
    e: Extract<IrExpr, { kind: 'listLit' | 'listRange' | 'listEnumRange' }>,
    cross: Cross,
): string {
    if (e.kind === 'listLit') {
        return e.items.length === 0
            ? `FinDslListe.empty<${irTypeToTsCore(e.elementType)}>()`
            : `FinDslListe.of([${e.items.map((x) => emitExpr(x, cross)).join(', ')}])`;
    }
    const step = e.step !== undefined ? emitExpr(e.step, cross) : 'null';
    if (e.kind === 'listRange') {
        return `FinDslListe.bereich(${emitExpr(e.from, cross)}, ${emitExpr(e.to, cross)}, ${e.exclusive ? 'true' : 'false'}, ${step})`;
    }
    return `FinDslListe.enumBereich(${emitExpr(e.from, cross)}, ${emitExpr(e.to, cross)}, ${e.exclusive ? 'true' : 'false'}, ${step})`;
}

/**
 * Einstelliges Lambda → native Pfeilfunktion. Mit `lets` (Block-Lambda)
 * → `(p) => { const n: T = e; …; return body; }`; sonst kompakt
 * `(p) => body`. Parameter sind kontextuell getypt (Listen-Methoden-
 * Signatur), daher keine Param-Annotation.
 */
function emitLambda1(e: Extract<IrExpr, { kind: 'lambda1' }>, cross: Cross): string {
    if (e.lets !== undefined && e.lets.length > 0) {
        const decls = e.lets
            .map((l) => `const ${l.name}: ${irTypeToTsCore(l.type)} = ${emitExpr(l.expr, cross)};`)
            .join(' ');
        return `(${e.param}) => { ${decls} return ${emitExpr(e.body, cross)}; }`;
    }
    return `(${e.param}) => ${emitExpr(e.body, cross)}`;
}

/**
 * String-Interpolation `"…${slot}…"` → TS-String-Konkatenation. Text-Slots
 * direkt; numerische Slots über `.asText()` (bit-genaue Zahl→Text-Konversion
 * via Runtime, identisch zum Java-Emitter).
 */
function emitStrInterp(e: Extract<IrExpr, { kind: 'strInterp' }>, cross: Cross): string {
    const terms: string[] = [];
    for (let k = 0; k < e.slots.length; k++) {
        terms.push(tsString(e.parts[k]));
        const isText = e.slotIsText?.[k] ?? false;
        terms.push(isText ? emitExpr(e.slots[k], cross) : `${emitExpr(e.slots[k], cross)}.asText()`);
    }
    terms.push(tsString(e.parts[e.parts.length - 1]));
    return terms.join(' + ');
}

/** Ausdruck → TS-Ausdrucks-String (seiteneffektfrei, P2). Dispatch-Switch. */
function emitExpr(e: IrExpr, cross: Cross): string {
    switch (e.kind) {
        case 'numLit':
            return `FinDslNumber.${e.factory}(${tsString(e.arg)})`;
        case 'ref':
            return e.name;
        case 'enumVal':
            // Cross-modul: Enum über Namespace-Import-Alias der Owner-Klasse.
            return e.ownerClass !== undefined
                ? `${e.ownerClass}.${e.enumName}.${e.value}`
                : `${e.enumName}.${e.value}`;
        case 'field':
            // Record = TS-Klasse mit `readonly`-Feldern → Property-Zugriff
            // (kein Java-Accessor `()`); Sicht-Subtyp IS-A FinDslNumber.
            return `${emitExpr(e.receiver, cross)}.${e.name}`;
        case 'call':
            // Lokaler Top-Level-Funktionsaufruf (hoisted im Modul).
            return `${tsFnName(e.name)}(${e.args.map((a) => emitExpr(a, cross)).join(', ')})`;
        case 'box':
            // Sicht-Adapter an Schreibgrenze (rein nominal, Wert/Tag bleiben).
            return `${e.wrapper}.von(${emitExpr(e.expr, cross)})`;
        case 'unbox':
            // IS-A — Unboxing entfällt; defensiver Durchgriff.
            return emitExpr(e.expr, cross);
        case 'ctor': {
            const qual = e.ownerClass !== undefined ? `${e.ownerClass}.` : '';
            return `new ${qual}${e.typeName}(${e.args.map((a) => emitExpr(a, cross)).join(', ')})`;
        }
        case 'crossCall': {
            const owner = cross.get(e.fieldName);
            if (owner === undefined) {
                throw new Error(
                    `Emit: Cross-Modul-Feld "${e.fieldName}" ohne Klasse `
                    + '(composedModules unvollständig).');
            }
            return `${owner}.${tsFnName(e.methodName)}`
                + `(${e.args.map((a) => emitExpr(a, cross)).join(', ')})`;
        }
        case 'crossRef':
            return `${e.ownerClass}.${e.memberName}`;
        case 'enumCmp': {
            // TS verengt Enum-Member zu Literal-Typen → ein direkter
            // `Rot !== Grün` triggert sonst TS2367 ("no overlap", als
            // vermeintlicher Fehler). Linken Operanden auf den Enum-Typ
            // weiten (sicherer Upcast); Identitäts-Semantik unverändert.
            // Nur einen Enum-LITERAL-Operanden (enumVal) weiten — bei einem
            // `ref` (bereits voller Enum-Typ) wäre der Cast ein No-op, und
            // TS2367 entsteht ohnehin nur bei Literal-Beteiligung links.
            const et = e.left.kind === 'enumVal'
                ? (e.left.ownerClass !== undefined
                    ? `${e.left.ownerClass}.${e.left.enumName}` : e.left.enumName)
                : undefined;
            const lRaw = emitExpr(e.left, cross);
            const l = et !== undefined ? `(${lRaw} as ${et})` : lRaw;
            const r = emitExpr(e.right, cross);
            return e.op === '==' ? `${l} === ${r}` : `${l} !== ${r}`;
        }
        case 'arith':           return emitArith(e, cross);
        case 'div':             return `${emitExpr(e.left, cross)}.div(${emitExpr(e.right, cross)})`;
        case 'cmp':             return emitCmp(e, cross);
        case 'and':             return `(${emitExpr(e.left, cross)}) && (${emitExpr(e.right, cross)})`;
        case 'or':              return `(${emitExpr(e.left, cross)}) || (${emitExpr(e.right, cross)})`;
        case 'nullLit':         return 'null';
        case 'nullCheck':
            return `${emitExpr(e.value, cross)} ${e.negated ? '!==' : '==='} null`;
        case 'bool':            return e.value ? 'true' : 'false';
        case 'neg':             return `${emitExpr(e.value, cross)}.neg()`;
        case 'not':             return `!(${emitExpr(e.value, cross)})`;
        case 'round':           return `${emitExpr(e.receiver, cross)}.${e.mode}(${tsString(e.target)})`;
        case 'scalarLimit':     return `${emitExpr(e.receiver, cross)}.${e.op}(${emitExpr(e.arg, cross)})`;
        case 'scalarRoundTo':   return `${emitExpr(e.receiver, cross)}.${e.op}(${emitExpr(e.arg, cross)})`;
        case 'cast':            return `${emitExpr(e.value, cross)}.cast(${tsString(e.target)})`;
        case 'moneyAnno':
            return `${emitExpr(e.expr, cross)}.withMoneyAnnotation(`
                + `${tsString(e.target)}, ${tsString(e.what)})`;
        // --- Listen (§ 11.2) ---
        case 'listLit':         return emitListExpr(e, cross);
        case 'listRange':       return emitListExpr(e, cross);
        case 'listEnumRange':   return emitListExpr(e, cross);
        case 'listMethod':      return `${emitExpr(e.receiver, cross)}.${e.method}()`;
        case 'listMap':         return `${emitExpr(e.receiver, cross)}.zuordnen(${emitExpr(e.fn, cross)})`;
        case 'listFilter':      return `${emitExpr(e.receiver, cross)}.filtern(${emitExpr(e.fn, cross)})`;
        case 'listCountWhere':  return `${emitExpr(e.receiver, cross)}.zaehleMit(${emitExpr(e.fn, cross)})`;
        case 'listContains':    return `${emitExpr(e.receiver, cross)}.enthaelt(${emitExpr(e.value, cross)})`;
        case 'listAt':          return `${emitExpr(e.receiver, cross)}.bei(${emitExpr(e.index, cross)})`;
        case 'listFold':        return `${emitExpr(e.receiver, cross)}.zusammenfassen(${emitExpr(e.start, cross)}, ${emitExpr(e.fn, cross)})`;
        // --- Lambdas (native Pfeilfunktionen) ---
        case 'lambda1':         return emitLambda1(e, cross);
        case 'lambda2':         return `(${e.param1}, ${e.param2}) => ${emitExpr(e.body, cross)}`;
        case 'lambdaCall':
            // First-class Lambda-Wert: direkter Aufruf (kein Java `.apply`).
            return `${emitExpr(e.fn, cross)}(${e.args.map((a) => emitExpr(a, cross)).join(', ')})`;
        // --- String-Interpolation ---
        case 'strInterp':       return emitStrInterp(e, cross);
        // --- Nullable (#117): Java-Pendant `emitNullable`. `nichts` → null;
        //     P2 (seiteneffektfrei) → Doppel-Evaluation in Elvis/Safe-Access
        //     unkritisch. Force-Unwrap wirft `FinDslRuntimeError` (kein
        //     Abbruch), spiegelt `interpreter.ts` (InterpretError auf null). ---
        case 'elvis': {
            const l = emitExpr(e.left, cross);
            return `(${l} !== null) ? ${l} : ${emitExpr(e.right, cross)}`;
        }
        case 'forceUnwrap':
            return `nichtNull(${emitExpr(e.value, cross)}, ${tsString(e.hint)})`;
        case 'safeFieldAccess': {
            const r = emitExpr(e.receiver, cross);
            return `(${r} !== null) ? ${r}.${e.name} : null`;
        }
        case 'abort':
            throw new Error('abbruch nur in Ergebnis-Position (emitResult), nicht als Sub-Ausdruck.');
        case 'waehle':
            throw new Error('wähle nur in Ergebnis-Position (emitResult), nicht als Sub-Ausdruck.');
    }
    throw new Error(`Emit: unbekannter IR-Knoten ${(e as { kind: string }).kind}.`);
}

// --- Statement-Lowering (Ergebnis-Position) -----------------------------

/** Ziel eines Statement-gelowerten Ergebnisses: `return` oder `let`-Zuweisung. */
type Sink = { readonly kind: 'return' } | { readonly kind: 'assign'; readonly name: string };
const RETURN_SINK: Sink = { kind: 'return' };

/**
 * `const <name>: <T> = <expr>;`; ein `var x = wähle{…}` wird zu
 * `let <name>: <T>;` + Statement-gelowertem `wähle` als Zuweisungs-Sink
 * (TS-Definite-Assignment via erschöpfendem if/else + throw).
 */
function emitLet(l: IrLet, indent: string, cross: Cross): string {
    const e = l.expr;
    const tt = irTypeToTsCore(l.type);
    if (e.kind === 'waehle') {
        return `${indent}let ${l.name}: ${tt};\n`
            + emitResult(e, indent, cross, { kind: 'assign', name: l.name });
    }
    return `${indent}const ${l.name}: ${tt} = ${emitExpr(e, cross)};`;
}

function emitResult(
    r: IrExpr | IrBlockResult, indent: string, cross: Cross, sink: Sink = RETURN_SINK,
): string {
    if (r.kind === 'blockResult') {
        const lines = r.lets.map((l) => emitLet(l, indent, cross));
        lines.push(emitResult(r.result, indent, cross, sink));
        return lines.join('\n');
    }
    if (r.kind === 'waehle') {
        return emitWaehle(r, indent, cross, sink);
    }
    if (r.kind === 'abort') {
        return `${indent}throw new FinDslAbort(${emitExpr(r.reason, cross)});`;
    }
    return sink.kind === 'assign'
        ? `${indent}${sink.name} = ${emitExpr(r, cross)};`
        : `${indent}return ${emitExpr(r, cross)};`;
}

function emitArmCondition(arm: IrArm, subject: IrExpr | undefined, cross: Cross): string {
    if (arm.patterns.length === 0) {
        throw new Error('falls-Arm ohne Pattern (Teil-Parse, Codegen).');
    }
    const terms = arm.patterns.map((p) => {
        if (subject === undefined) return emitExpr(p, cross);
        if (p.kind !== 'enumVal') {
            throw new Error('Subjekt-wähle erwartet Enum-Pattern (Codegen).');
        }
        return `${emitExpr(subject, cross)} === ${emitExpr(p, cross)}`;
    });
    return terms.length === 1 ? terms[0] : terms.map((t) => `(${t})`).join(' || ');
}

function emitWaehle(
    w: Extract<IrExpr, { kind: 'waehle' }>,
    indent: string,
    cross: Cross,
    sink: Sink = RETURN_SINK,
): string {
    const noMatch = `${indent}throw new FinDslRuntimeError(`
        + `${tsString('Kein falls-Arm passte (wähle, Codegen).')});`;

    // Return-Sink: sequenzielle `if (cond) { return … }` (return bricht ab,
    // kein Durchfall); fehlt `sonst`, terminiert ein `throw`.
    if (sink.kind === 'return') {
        const lines: string[] = [];
        let hasSonst = false;
        for (const arm of w.arms) {
            if (arm.isSonst) {
                hasSonst = true;
                lines.push(emitResult(arm.result, indent, cross, sink));
                break;
            }
            lines.push(`${indent}if (${emitArmCondition(arm, w.subject, cross)}) {`);
            lines.push(emitResult(arm.result, indent + IND, cross, sink));
            lines.push(`${indent}}`);
        }
        if (!hasSonst) lines.push(noMatch);
        return lines.join('\n');
    }

    // Assign-Sink (`var x = wähle{…}`): echte if / else if / else-Kette —
    // jeder Pfad weist genau einmal zu oder wirft (TS-Definite-Assignment).
    if (w.arms.length === 1 && w.arms[0].isSonst) {
        return emitResult(w.arms[0].result, indent, cross, sink);
    }
    const lines: string[] = [];
    let hasSonst = false;
    for (let i = 0; i < w.arms.length; i++) {
        const arm = w.arms[i];
        if (arm.isSonst) {
            hasSonst = true;
            lines.push(`${indent}} else {`);
            lines.push(emitResult(arm.result, indent + IND, cross, sink));
            break;
        }
        const head = i === 0 ? `${indent}if (` : `${indent}} else if (`;
        lines.push(`${head}${emitArmCondition(arm, w.subject, cross)}) {`);
        lines.push(emitResult(arm.result, indent + IND, cross, sink));
    }
    lines.push(hasSonst
        ? `${indent}}`
        : `${indent}} else {\n${noMatch.replace(indent, indent + IND)}\n${indent}}`);
    return lines.join('\n');
}

function emitFnBody(decl: Extract<IrDecl, { kind: 'fn' }>, cross: Cross): string {
    const b = decl.body;
    if (b.kind === 'expr') {
        return emitResult(b.expr, IND, cross);
    }
    const out = b.lets.map((l) => emitLet(l, IND, cross));
    out.push(emitResult(b.result, IND, cross));
    return out.join('\n');
}

// --- Deklarations-Emission ----------------------------------------------

/** `aufzählung` → `export enum`. */
function emitEnumDecl(d: Extract<IrDecl, { kind: 'enum' }>): string {
    const doc = tsdoc(d.info, '');
    const head = doc.length ? doc.join('\n') + '\n' : '';
    return head + `export enum ${d.name} {\n`
        + d.values.map((v) => `${IND}${v},`).join('\n')
        + '\n}';
}

/** `datensatz` → `export class` mit `readonly`-Konstruktor-Parametern. */
function emitRecordDecl(d: Extract<IrDecl, { kind: 'record' }>): string {
    const doc = tsdoc(d.info, '');
    const head = doc.length ? doc.join('\n') + '\n' : '';
    const params = d.fields
        .map((f) => `${IND}${IND}readonly ${f.name}: ${irTypeToTsApi(f.type)},`)
        .join('\n');
    return head + `export class ${d.name} {\n`
        + `${IND}constructor(\n${params}\n${IND}) {}\n}`;
}

/** `konst` → `export const`; numerisch → Wrapper-getypt, Kern-Ausdruck geboxt. */
function emitKonstDecl(d: Extract<IrDecl, { kind: 'konst' }>, cross: Cross): string {
    const doc = tsdoc(d.info, '');
    const head = doc.length ? doc.join('\n') + '\n' : '';
    const w = d.type.kind === 'number' ? d.type.wrapper : undefined;
    const init = w !== undefined ? `${w}.von(${emitExpr(d.expr, cross)})` : emitExpr(d.expr, cross);
    return head + `export const ${d.name}: ${irTypeToTsApi(d.type)} = ${init};`;
}

/**
 * `fn` → Top-Level-Funktion. Öffentlich: `export function`, Wrapper-getypte
 * Signatur (Rückgabe wird vom Lowering an der Ergebnisposition geboxt).
 * Intern (`_`): nicht exportiert, Kern-Signatur (`FinDslNumber`).
 */
function emitFnDecl(d: Extract<IrDecl, { kind: 'fn' }>, cross: Cross): string {
    const doc = tsdoc(d.info, '');
    const head = doc.length ? doc.join('\n') + '\n' : '';
    if (d.internal) {
        const params = d.params
            .map((p) => `${p.name}: ${irTypeToTsCore(p.type)}`).join(', ');
        return head + `function ${tsFnName(d.name)}(${params}): `
            + `${irTypeToTsCore(d.returnType)} {\n` + emitFnBody(d, cross) + '\n}';
    }
    const params = d.params
        .map((p) => `${p.name}: ${irTypeToTsApi(p.type)}`).join(', ');
    return head + `export function ${tsFnName(d.name)}(${params}): `
        + `${irTypeToTsApi(d.returnType)} {\n` + emitFnBody(d, cross) + '\n}';
}

/**
 * Sammelt alle cross-modul referenzierten Owner-Klassennamen via
 * generischen IR-Walk: `ownerClass` (enumVal/ctor/crossRef) und der
 * `owner` benannter Typen. In ESM braucht JEDE cross-Datei-Referenz
 * einen Import — anders als in Java, wo gleiches-Package-Referenzen
 * ohne Import auflösen. Die IR ist ein Baum (kein Zyklus → terminiert).
 */
function collectOwners(node: unknown, into: Set<string>): void {
    if (node === null || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.ownerClass === 'string') into.add(obj.ownerClass);
    if (obj.kind === 'named' && typeof obj.owner === 'string') into.add(obj.owner);
    for (const v of Object.values(obj)) {
        if (Array.isArray(v)) {
            for (const x of v) collectOwners(x, into);
        } else if (v !== null && typeof v === 'object') {
            collectOwners(v, into);
        }
    }
}

/**
 * Bedarfsgesteuerte Runtime-Importe + Cross-Modul-Namespace-Importe für
 * ein emittiertes Modul. Importiert ALLE referenzierten Fremd-Module
 * (Funktionen UND Typen/Enums/Konstanten) — `composedModules` deckt nur
 * die per `fn` aufgerufenen ab. Paket aus `composedModules`, sonst
 * gleiches Paket (Default für reine Typ-Importe). Reihenfolge sortiert
 * → deterministisch.
 */
function importHeader(
    code: string,
    m: IrModule | IrTestModule,
    extraImports: ReadonlyArray<string> = [],
): string[] {
    const pkg = m.javaPackage;
    const used = RUNTIME_SYMBOLS.filter((s) => new RegExp(`\\b${s}\\b`).test(code));
    const lines: string[] = [...extraImports];
    if (used.length > 0) {
        lines.push(`import { ${used.join(', ')} } from '${relRuntimeImport(pkg)}';`);
    }
    const owners = new Set<string>();
    collectOwners(m, owners);
    const pkgOf = new Map<string, string | undefined>();
    for (const c of m.composedModules) {
        owners.add(c.className);
        pkgOf.set(c.className, c.javaPackage);
    }
    owners.delete(m.className);                       // nie sich selbst importieren
    for (const owner of [...owners].sort()) {
        const ownerPkg = pkgOf.has(owner) ? pkgOf.get(owner) : pkg;
        lines.push(`import * as ${owner} from `
            + `'${relModuleImport(pkg, ownerPkg, owner)}';`);
    }
    return lines;
}

/** Relativer ESM-Import vom Paket-Verzeichnis zur Runtime (`<root>/runtime/`). */
function relRuntimeImport(pkg: string | undefined): string {
    const depth = pkg ? pkg.split('.').length : 0;
    const up = depth === 0 ? './' : '../'.repeat(depth);
    return `${up}runtime/index.js`;
}

/**
 * Relativer ESM-Import vom aktuellen Paket zum Ziel-Modul-File —
 * kanonisch über den gemeinsamen Paket-Präfix (zwei Module im selben
 * Package → `./Foo.js`, nicht `../../pkg/Foo.js`).
 */
function relModuleImport(
    fromPkg: string | undefined, toPkg: string | undefined, className: string,
): string {
    const from = fromPkg ? fromPkg.split('.') : [];
    const to = toPkg ? toPkg.split('.') : [];
    let i = 0;
    while (i < from.length && i < to.length && from[i] === to[i]) i++;
    const ups = from.length - i;                 // hoch bis zum gemeinsamen Vorfahren
    const downs = to.slice(i);                    // dann runter ins Ziel-Package
    const prefix = ups > 0 ? '../'.repeat(ups) : './';
    return `${prefix}${downs.length ? downs.join('/') + '/' : ''}${className}.js`;
}

/** Datei-Doc (`Program.fileDoc`) → Modul-Kopf-Block (JSDoc). */
function moduleDoc(info: IrDoc): string[] {
    const doc: string[] = [
        '/**',
        ' * Generiert aus FinDSL — NICHT manuell editieren.',
        ' * Semantik-Orakel: der FinDSL-Interpreter (bit-genau).',
    ];
    const fileDoc = tsdoc(info, '');
    if (fileDoc.length) doc.push(' *', ...fileDoc.slice(1, -1));
    doc.push(' */');
    return doc;
}

export interface TsModuleFile {
    readonly fileName: string;
    readonly code: string;
}

/**
 * Rendert ein `IrModule` zu EINER `.ts`-Datei (deterministisch). Decl-
 * Reihenfolge: `enum` → `class` (Record) → `const` → `function`, je Gruppe
 * Quellreihenfolge. Diese Ordnung respektiert TS-TDZ (Klassen/Enums vor
 * Konstanten-Initialisierern); Funktionen sind hoisted und stehen zuletzt.
 */
export function emitTsModule(m: IrModule): TsModuleFile {
    const cross = buildFieldToClass(m.composedModules);

    const order = { enum: 0, record: 1, konst: 2, fn: 3 } as const;
    const members = [...m.decls]
        .map((d, i) => ({ d, i }))
        .sort((a, b) => order[a.d.kind] - order[b.d.kind] || a.i - b.i)
        .map(({ d }) => emitDecl(d, cross))
        .join('\n\n');

    const header = importHeader(members, m);
    const code = [
        ...header,
        '',
        ...moduleDoc(m.info),
        '',
        members,
        '',
    ].join('\n');

    return { fileName: `${m.className}.ts`, code };
}

function emitDecl(d: IrDecl, cross: Cross): string {
    switch (d.kind) {
        case 'enum':   return emitEnumDecl(d);
        case 'record': return emitRecordDecl(d);
        case 'konst':  return emitKonstDecl(d, cross);
        case 'fn':     return emitFnDecl(d, cross);
    }
    // Exhaustiveness-Guard (wie emitExpr): eine künftige IrDecl-Variante
    // wird mit Codegen-Diagnose abgewiesen statt still `undefined` zu
    // emittieren (das `tsc`-Gate fängt das sonst erst spät).
    d satisfies never;
    throw new Error(`Emit: unbekannte IrDecl-Variante "${(d as { kind: string }).kind}".`);
}

// --- `prüfe`-Blöcke → Vitest --------------------------------------------

/** Plattet eine Top-Level-`und`-Kette in ihre Konjunkte (Quellreihenfolge). */
function flattenAnd(e: IrExpr): IrExpr[] {
    return e.kind === 'and'
        ? [...flattenAnd(e.left), ...flattenAnd(e.right)]
        : [e];
}

/** Ein `testfall` → ein `it(...)` (Spiegel runPruefeDecl). */
function emitTestCase(c: IrTestCase, indent: string, cross: Cross): string {
    const I1 = indent + IND;            // it-Rumpf
    let bodyLines: string[];
    if (c.erwartetAbbruch) {
        // Abbruch erwartet → gesamte Auswertung im toThrow-Callback (lets
        // tiefer eingerückt, daher hier separat gerendert).
        const I2 = I1 + IND;
        bodyLines = [
            `${I1}expect(() => {`,
            ...c.lets.map((l) => emitLet(l, I2, cross)),
            `${I2}${emitExpr(c.assertion, cross)};`,
            `${I1}}).toThrow(FinDslAbort);`,
        ];
    } else {
        // Top-Level-`und` → je Konjunkt ein `expect(...).toBe(true)`.
        bodyLines = [
            ...c.lets.map((l) => emitLet(l, I1, cross)),
            ...flattenAnd(c.assertion).map(
                (t) => `${I1}expect(${emitExpr(t, cross)}).toBe(true);`),
        ];
    }
    return [
        `${indent}it(${tsString(c.label)}, () => {`,
        ...bodyLines,
        `${indent}});`,
    ].join('\n');
}

/**
 * Rendert ein `IrTestModule` zu einer Vitest-Spec (`*.test.ts`,
 * deterministisch). `prüfe` → `describe`, `testfall` → `it`; das SUT wird
 * per Namespace-Import (`import * as <SUT>`) eingebunden.
 */
export function emitTsTestModule(m: IrTestModule): TsModuleFile {
    const cross = buildFieldToClass(m.composedModules);

    const suites = m.suites.map((s) => {
        const cases = s.cases.map((c) => emitTestCase(c, IND, cross)).join('\n\n');
        return `describe(${tsString(s.suiteName)}, () => {\n${cases}\n});`;
    });
    const body = suites.join('\n\n');

    const header = importHeader(
        body, m,
        ["import { describe, it, expect } from 'vitest';"],
    );
    const code = [
        ...header,
        '',
        ...moduleDoc(m.info),
        '',
        body,
        '',
    ].join('\n');

    // `*.test.ts` — von Vitests Standard-Glob erfasst.
    return { fileName: `${m.className}.test.ts`, code };
}
