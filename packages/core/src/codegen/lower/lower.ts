// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * AST + aufgelöste Typen → target-neutrale IR (ADR1 `lower/`).
 *
 * Phase 1: `examples/kst`-Konstruktsatz. Phase 2: erweitert um den
 * `examples/est`-Satz — `Liste<T>`/`[]<T>`, `.zuordnen`/`.summe`/`.länge`,
 * parametrisches Lambda+Closure, `als`-Cast, Division, String-
 * Interpolation+`abbruch`, Block-als-`wähle`-Arm. `Bereich`/`für jeden`/
 * Index/Text-Methoden/`oder`/`T?` bleiben bewusste Phase-3-Guards.
 *
 * Die wert-/tag-tragende Semantik (parseNumberLiteral, castNumeric/
 * applyMoneyAnnotation, combine*, §11.2-Methoden) liegt in der Runtime
 * (ADR2); das Lowering trifft nur die *statischen* Entscheidungen, die
 * der Interpreter zur Laufzeit per AST-Kontext fällt (governingMoney-
 * Target; constructRecord-Positionsauflösung; Interpolations-Slots).
 */

import { Decimal } from 'decimal.js';
import {
    type Program, type TopDecl, type Expr, type Type,
    type FunktionDecl, type DatensatzDecl, type WaehleExpr,
    isKonstDecl, isFunktionDecl, isDatensatzDecl, isAufzaehlungDecl,
    isNumberLiteral, isStringLiteral, isCallChain, isParenChain,
    isCall, isFieldAccess, isBinaryOp, isWaehleExpr, isFallArm,
    isSonstArm, isCast, isAbbruchExpr, isLetStmt, isFunktionBody,
    isNamedType, isListLiteral, isLambda, isIndex,
} from '../../language/generated/ast.js';
import type {
    IrModule, IrDecl, IrExpr, IrArm, IrBlockResult, IrFnBody, IrField,
    IrParam, IrLet, IrDoc, ZahlFactory, ZielTyp,
} from '../ir/nodes.js';

interface DeclPrefixLike {
    doc?: string;
    annotations?: ReadonlyArray<{ name: string; args: ReadonlyArray<Expr> }>;
}
/** Roher `--…--`-Doc-Text + `@Quelle`-Argumente eines DeclPrefix übertragen. */
function extractDoc(prefix: DeclPrefixLike | undefined): IrDoc {
    const quelle: string[] = [];
    for (const a of prefix?.annotations ?? []) {
        if (a.name !== 'Quelle') continue;
        const arg = a.args[0];
        if (arg && isStringLiteral(arg)) quelle.push(arg.value);
    }
    return { doc: prefix?.doc, quelle };
}

export interface LowerContext {
    readonly javaPackage: string;
    readonly className: string;
}

const NUMERIC_NAMES = new Set([
    'Ganzzahl', 'Dezimal', 'Prozent', 'Euro', 'EuroCent', 'Cent',
]);
const MONEY_NAMES = new Set(['Euro', 'Cent', 'EuroCent']);

interface NamedAtom { name: string; typeArgs?: { args: ReadonlyArray<Type> } }
function namedAtom(t: Type | undefined): NamedAtom | undefined {
    const atom = t?.atom;
    return atom && isNamedType(atom) ? (atom as NamedAtom) : undefined;
}

/** Name eines NamedType-Atoms, sonst undefined (Teil-Parse-robust). */
function atomName(t: Type | undefined): string | undefined {
    return namedAtom(t)?.name;
}

/** FinDSL-Typ → Java-Typ. `Liste<T>`→`FinDslListe<E>`; numerisch→FinDslNumber. */
function javaType(t: Type | undefined): string {
    const a = namedAtom(t);
    if (a === undefined) return 'FinDslNumber';            // Teil-Parse: konservativ
    if (a.name === 'Liste') {
        const elem = a.typeArgs?.args?.[0];
        return `FinDslListe<${javaType(elem)}>`;
    }
    if (NUMERIC_NAMES.has(a.name)) return 'FinDslNumber';
    if (a.name === 'Wahrheitswert') return 'boolean';
    if (a.name === 'Text') return 'String';
    return a.name;                                         // Datensatz/Aufzählung
}

/** Geld-Annotationsname (`Euro|Cent|EuroCent`) einer Typ-Annotation. */
function moneyAnnotation(t: Type | undefined): 'Euro' | 'Cent' | 'EuroCent' | undefined {
    const n = atomName(t);
    return n && MONEY_NAMES.has(n) ? (n as 'Euro' | 'Cent' | 'EuroCent') : undefined;
}

/** `als <Ziel>`-Ziel; nur numerische Casts (est nutzt nur diese). */
function castTarget(t: Type | undefined): ZielTyp {
    const n = atomName(t);
    if (n && NUMERIC_NAMES.has(n)) return n as ZielTyp;
    throw new Error(`nicht-numerischer \`als\`-Cast (${n}) ist Phase-3-Scope.`);
}

/**
 * Spiegel `values.ts parseNumberLiteral` (277-290): deutsche Notation
 * `.`=Tausender, `,`=Dezimal, `%`→Bruch (÷100 exakt via decimal.js).
 */
function parseNumberLiteral(raw: string): { factory: ZahlFactory; arg: string } {
    const hasPercent = raw.endsWith('%');
    const body = hasPercent ? raw.slice(0, -1) : raw;
    const normalized = body.replace(/\./g, '').replace(',', '.');
    if (hasPercent) {
        return { factory: 'prozent', arg: new Decimal(normalized).div(100).toString() };
    }
    if (body.includes(',')) return { factory: 'dezimal', arg: normalized };
    return { factory: 'ganzzahl', arg: normalized };
}

/**
 * Slot-Pfad-Regex — 1:1-Spiegel von `values.ts:244` (Identifier-Kette,
 * Unicode): JEDES Segment (auch nach `.`) muss mit Buchstabe/Underscore
 * beginnen (kein Ziffern-Start), exakt wie das Orakel.
 */
const SLOT_PATH = /^\s*([A-Za-zäöüÄÖÜß_][A-Za-z0-9äöüÄÖÜß_]*)(\s*\.\s*[A-Za-zäöüÄÖÜß_][A-Za-z0-9äöüÄÖÜß_]*)*\s*$/u;

/**
 * Spiegel `values.ts parseStringLiteral` (212-235): `${…}`-Slots aus dem
 * (Langium-entquoteten) String-Wert; mehrzeilig `""…""` → 2 Quotes weg.
 * Slot-Pfad gegen dieselbe Regex; sonst harter Fehler (wie Interpreter).
 */
function lowerStringLiteral(raw: string, reg: Registry): IrExpr {
    const body = (raw.startsWith('""') && raw.endsWith('""'))
        ? raw.slice(2, -2) : raw;
    const parts: string[] = [];
    const slots: IrExpr[] = [];
    let i = 0;
    for (;;) {
        const start = body.indexOf('${', i);
        // Nicht geschlossenes `${` → Rest inkl. `${` als Literal-Text
        // (exakt wie das Orakel, values.ts:227-229; Lint diagnostiziert).
        if (start < 0) { parts.push(body.slice(i)); break; }
        const end = body.indexOf('}', start + 2);
        if (end < 0) { parts.push(body.slice(i)); break; }
        parts.push(body.slice(i, start));
        const slotText = body.slice(start + 2, end);
        if (!SLOT_PATH.test(slotText)) {
            throw new Error(
                `Interpolations-Slot "${slotText}": nur Identifier-Ketten `
                + `(name / name.feld) — komplexere Slots sind Phase-3-Scope.`);
        }
        const segs = slotText.split('.').map((s) => s.trim());
        let slot: IrExpr = { kind: 'ref', name: segs[0] };
        const en = reg.enumValues.get(segs[0]);
        if (en !== undefined) slot = { kind: 'enumVal', enumName: en, value: segs[0] };
        for (let k = 1; k < segs.length; k++) {
            slot = { kind: 'field', receiver: slot, name: segs[k] };
        }
        slots.push(slot);
        i = end + 1;
    }
    return { kind: 'strInterp', parts, slots };
}

/**
 * Lokaler AST-Eltern-Walk, 1:1 zu `interpreter.ts governingMoneyTarget`
 * (1008-1029): nächste maßgebliche Geld-Annotation über `$container`.
 */
function governingMoneyTarget(node: object): 'Euro' | 'Cent' | undefined {
    let cur = node as { $container?: object };
    for (;;) {
        const c = cur.$container as
            | (object & { value?: unknown; type?: Type; targetType?: Type; $container?: unknown })
            | undefined;
        if (!c) return undefined;
        if (isCast(c) && c.value === cur) {
            const m = moneyAnnotation(c.targetType);
            if (m === 'Euro' || m === 'Cent') return m;
        } else if (isKonstDecl(c) && c.value === cur) {
            const m = moneyAnnotation(c.type);
            if (m === 'Euro' || m === 'Cent') return m;
        } else if (isLetStmt(c) && c.value === cur) {
            const m = c.type ? moneyAnnotation(c.type) : undefined;
            if (m === 'Euro' || m === 'Cent') return m;
        } else if (isFunktionBody(c)) {
            const fd = (c as { $container?: unknown }).$container;
            const m = isFunktionDecl(fd as object) ? moneyAnnotation((fd as FunktionDecl).returnType) : undefined;
            if (m === 'Euro' || m === 'Cent') return m;
        }
        cur = c as { $container?: object };
    }
}

interface Registry {
    readonly enumValues: ReadonlyMap<string, string>;
    readonly records: ReadonlyMap<string, DatensatzDecl>;
}

/** Eingebaute Sprach-Aufzählungen (SPEC § 8.5, kein Import) — Runtime-Enums. */
const BUILTIN_ENUMS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ['Tarifart', ['Grundtarif', 'Splitting']],
    ['Steuerklasse', ['I', 'II', 'III', 'IV', 'V', 'VI']],
];

function buildRegistry(program: Program): Registry {
    const enumValues = new Map<string, string>();
    for (const [enumName, values] of BUILTIN_ENUMS) {
        for (const v of values) enumValues.set(v, enumName);
    }
    const records = new Map<string, DatensatzDecl>();
    for (const d of program.decls as ReadonlyArray<TopDecl>) {
        if (isAufzaehlungDecl(d)) {
            for (const v of d.values) enumValues.set(v, d.name);
        } else if (isDatensatzDecl(d)) {
            records.set(d.name, d);
        }
    }
    return { enumValues, records };
}

function lowerExpr(expr: Expr | undefined, reg: Registry): IrExpr {
    if (!expr) throw new Error('Teil-Parse: fehlender Ausdruck (Codegen).');

    if (isNumberLiteral(expr)) {
        const { factory, arg } = parseNumberLiteral(expr.value);
        return { kind: 'numLit', factory, arg };
    }
    if (isStringLiteral(expr)) {
        return lowerStringLiteral(expr.value, reg);
    }
    if (isAbbruchExpr(expr)) {
        if (!expr.grund) throw new Error('abbruch ohne Begründung (Teil-Parse).');
        return { kind: 'abort', reason: lowerExpr(expr.grund, reg) };
    }
    if (isCast(expr)) {
        return { kind: 'cast', value: lowerExpr(expr.value, reg), target: castTarget(expr.targetType) };
    }
    if (isListLiteral(expr)) {
        const elemType = expr.typeArgs?.args?.[0];
        return {
            kind: 'listLit',
            elementJavaType: elemType ? javaType(elemType) : 'FinDslNumber',
            items: expr.items.map((e) => lowerExpr(e, reg)),
        };
    }
    if (isBinaryOp(expr)) {
        const op = expr.op;
        if (op === 'und') {
            return { kind: 'and', left: lowerExpr(expr.left, reg), right: lowerExpr(expr.right, reg) };
        }
        if (op === '+' || op === '-' || op === '*') {
            return { kind: 'arith', op, left: lowerExpr(expr.left, reg), right: lowerExpr(expr.right, reg) };
        }
        if (op === '/') {
            return { kind: 'div', left: lowerExpr(expr.left, reg), right: lowerExpr(expr.right, reg) };
        }
        if (op === '==' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
            const left = lowerExpr(expr.left, reg);
            const right = lowerExpr(expr.right, reg);
            if (left.kind === 'enumVal' || right.kind === 'enumVal') {
                throw new Error('Enum-Vergleich als Ausdruck: Phase-3-Scope.');
            }
            return { kind: 'cmp', op, left, right };
        }
        if (op === 'oder') {
            throw new Error('`oder` ist Phase-3-Scope (est nutzt es nicht).');
        }
    }
    if (isWaehleExpr(expr)) {
        return lowerWaehle(expr, reg);
    }
    if (isParenChain(expr)) {
        return lowerChainOps(lowerExpr(expr.receiver, reg), expr.chain, reg);
    }
    if (isCallChain(expr)) {
        return lowerCallChain(expr, reg);
    }
    throw new Error(`Ausdruck ${(expr as { $type?: string }).$type} ist out-of-scope (Phase 3).`);
}

/**
 * Faltet eine Chevrotain-Kette (FieldAccess/Call/Index) über einen Basis-
 * Ausdruck: Skalar-Rundung (`.abrunden/.aufrunden` mit governingMoney-
 * Target), §-11.2-Listen-Methoden (`.zuordnen/.summe/.länge`), sonst
 * Record-Feldzugriff. Index = Phase-3-Guard.
 */
function lowerChainOps(
    base: IrExpr,
    chain: ReadonlyArray<object>,
    reg: Registry,
): IrExpr {
    let cur = base;
    let i = 0;
    while (i < chain.length) {
        const op = chain[i];
        if (isIndex(op)) {
            throw new Error('Listen-Index `[i]` ist Phase-3-Scope (est nutzt ihn nicht).');
        }
        if (!isFieldAccess(op) || !op.name) {
            throw new Error('Ketten-Glied außerhalb des Scopes (Phase 3).');
        }
        const fname = op.name;
        const next = chain[i + 1];
        const isMethodCall = next !== undefined && isCall(next);
        if (isMethodCall) {
            const call = next as { args: ReadonlyArray<{ name?: string; value: Expr }> };
            if (fname === 'abrunden' || fname === 'aufrunden') {
                const target = governingMoneyTarget(op) ?? 'Ganzzahl';
                cur = { kind: 'round', receiver: cur, mode: fname, target: target as ZielTyp };
            } else if (fname === 'zuordnen') {
                cur = { kind: 'listMap', receiver: cur, fn: lowerLambdaArg(call.args, reg) };
            } else if (fname === 'summe') {
                if (call.args.length !== 0) throw new Error('`.summe()` erwartet keine Argumente.');
                cur = { kind: 'listMethod', receiver: cur, method: 'summe' };
            } else {
                throw new Error(`Listen-/Skalar-Methode "${fname}" ist Phase-3-Scope (est nutzt sie nicht).`);
            }
            i += 2;
        } else {
            if (fname === 'länge') {
                cur = { kind: 'listMethod', receiver: cur, method: 'laenge' };
            } else {
                cur = { kind: 'field', receiver: cur, name: fname };
            }
            i += 1;
        }
    }
    return cur;
}

/** Einziges `.zuordnen`-Argument = einstelliges Ausdrucks-Lambda. */
function lowerLambdaArg(
    args: ReadonlyArray<{ name?: string; value: Expr }>,
    reg: Registry,
): IrExpr {
    if (args.length !== 1) throw new Error('`.zuordnen` erwartet genau ein Lambda.');
    const lam = args[0].value;
    if (!isLambda(lam) || lam.params.length !== 1) {
        throw new Error('`.zuordnen`-Argument muss ein einstelliges Lambda sein (Phase 2).');
    }
    if (!lam.result) throw new Error('Lambda ohne Ergebnis (Teil-Parse).');
    if (lam.stmts.length > 0) {
        throw new Error('Block-Lambda als `.zuordnen`-Argument ist Phase-3-Scope.');
    }
    return { kind: 'lambda1', param: lam.params[0].name, body: lowerExpr(lam.result, reg) };
}

function lowerCallChain(
    cc: { name?: string; chain: ReadonlyArray<object> },
    reg: Registry,
): IrExpr {
    const name = cc.name;
    if (name === undefined) throw new Error('Teil-Parse: CallChain ohne Name.');
    if (cc.chain.length === 0) {
        const enumName = reg.enumValues.get(name);
        return enumName !== undefined
            ? { kind: 'enumVal', enumName, value: name }
            : { kind: 'ref', name };
    }
    const first = cc.chain[0];
    if (isCall(first)) {
        const call = first;
        const rec = reg.records.get(name);
        const head: IrExpr = rec !== undefined
            ? { kind: 'ctor', typeName: name, args: resolveCtorArgs(rec, call.args, reg) }
            : { kind: 'call', name, args: call.args.map((a) => lowerExpr(a.value, reg)) };
        return cc.chain.length > 1
            ? lowerChainOps(head, cc.chain.slice(1), reg)
            : head;
    }
    const enumName = reg.enumValues.get(name);
    const head: IrExpr = enumName !== undefined
        ? { kind: 'enumVal', enumName, value: name }
        : { kind: 'ref', name };
    return lowerChainOps(head, cc.chain, reg);
}

/**
 * constructRecord-Spiegel (interpreter.ts:1173-1219): pro Feld in
 * Deklarationsreihenfolge — benanntes Arg ▸ positionales Arg ▸ Default
 * ▸ Pflichtfehler. Defaults OHNE applyMoneyAnnotation (wie Orakel).
 */
function resolveCtorArgs(
    rec: DatensatzDecl,
    args: ReadonlyArray<{ name?: string; value: Expr }>,
    reg: Registry,
): ReadonlyArray<IrExpr> {
    const named = new Map<string, Expr>();
    const positional: Expr[] = [];
    for (const a of args) {
        if (a.name) named.set(a.name, a.value);
        else positional.push(a.value);
    }
    let posIdx = 0;
    return rec.fields.map((f) => {
        const byName = named.get(f.name);
        if (byName) return lowerExpr(byName, reg);
        if (posIdx < positional.length) return lowerExpr(positional[posIdx++], reg);
        if (f.default) return lowerExpr(f.default, reg);
        throw new Error(`Pflichtfeld "${f.name}" fehlt bei ${rec.name}(…).`);
    });
}

/** Block-Lambda (`{ var …; ergebnis }`) als Arm-Ergebnis → IrBlockResult. */
function lowerBlockLambda(lam: { stmts: ReadonlyArray<object>; result?: Expr }, reg: Registry): IrBlockResult {
    if (!lam.result) throw new Error('Block-Arm ohne Ergebnis (Teil-Parse).');
    const lets: IrLet[] = lam.stmts
        .filter(isLetStmt)
        .map((s) => ({
            name: s.name,
            javaType: javaType(s.type),
            expr: maybeMoneyAnno(lowerExpr(s.value, reg), s.type, `var "${s.name}"`),
        }));
    return { kind: 'blockResult', lets, result: lowerExpr(lam.result, reg) };
}

function lowerArmResult(result: Expr | undefined, reg: Registry): IrExpr | IrBlockResult {
    if (!result) throw new Error('wähle-Arm ohne Ergebnis (Teil-Parse).');
    if (isLambda(result) && result.params.length === 0) {
        return lowerBlockLambda(result, reg);
    }
    return lowerExpr(result, reg);
}

function lowerWaehle(w: WaehleExpr, reg: Registry): IrExpr {
    const arms: IrArm[] = w.arms.map((arm) => {
        if (isFallArm(arm)) {
            return {
                patterns: arm.patterns.map((p) => lowerExpr(p as Expr, reg)),
                result: lowerArmResult(arm.result, reg),
                isSonst: false,
            };
        }
        if (isSonstArm(arm)) {
            return { patterns: [], result: lowerArmResult(arm.result, reg), isSonst: true };
        }
        throw new Error('Unbekannter wähle-Arm.');
    });
    return {
        kind: 'waehle',
        subject: w.subject ? lowerExpr(w.subject, reg) : undefined,
        arms,
    };
}

function lowerFn(fd: FunktionDecl, reg: Registry): IrDecl {
    const params: IrParam[] = fd.params.map((p) => ({ name: p.name, javaType: javaType(p.type) }));
    const returnJavaType = javaType(fd.returnType);
    let body: IrFnBody;
    if (fd.body.expr) {
        const ex = fd.body.expr;
        if (isLambda(ex) && ex.params.length === 0) {
            // `fn … = { var …; ergebnis }` — Block-Lambda als ganzer Body.
            const blk = lowerBlockLambda(ex, reg);
            body = { kind: 'block', lets: blk.lets, result: blk.result };
        } else {
            body = { kind: 'expr', expr: lowerExpr(ex, reg) };
        }
    } else if (fd.body.block) {
        const blk = fd.body.block;
        const lets = blk.stmts
            .filter(isLetStmt)
            .map((s) => ({
                name: s.name,
                javaType: javaType(s.type),
                expr: maybeMoneyAnno(lowerExpr(s.value, reg), s.type, `var "${s.name}"`),
            }));
        body = { kind: 'block', lets, result: lowerExpr(blk.result, reg) };
    } else {
        throw new Error(`fn ${fd.name}: leerer Body (Teil-Parse).`);
    }
    return {
        kind: 'fn',
        name: fd.name,
        internal: fd.name.startsWith('_'),
        params,
        returnJavaType,
        body,
        info: extractDoc(fd.docPrefix),
    };
}

/**
 * `var`/`konst` mit Euro/Cent/EuroCent-Annotation → Runtime-
 * `withMoneyAnnotation` (= applyMoneyAnnotation). Prozent/Ganzzahl/
 * Dezimal/Liste → No-Op (moneyAnnotationName undefined).
 */
function maybeMoneyAnno(expr: IrExpr, t: Type | undefined, what: string): IrExpr {
    const m = moneyAnnotation(t);
    if (!m) return expr;
    return { kind: 'moneyAnno', expr, target: m, what };
}

export function lowerProgram(program: Program, ctx: LowerContext): IrModule {
    const reg = buildRegistry(program);
    const decls: IrDecl[] = [];
    for (const d of program.decls as ReadonlyArray<TopDecl>) {
        if (isKonstDecl(d)) {
            decls.push({
                kind: 'konst',
                name: d.name,
                expr: maybeMoneyAnno(lowerExpr(d.value, reg), d.type, `Konstante "${d.name}"`),
                info: extractDoc(d.docPrefix),
            });
        } else if (isAufzaehlungDecl(d)) {
            decls.push({ kind: 'enum', name: d.name, values: d.values, info: extractDoc(d.docPrefix) });
        } else if (isDatensatzDecl(d)) {
            const fields: IrField[] = d.fields.map((f) => ({
                name: f.name,
                javaType: javaType(f.type),
            }));
            decls.push({ kind: 'record', name: d.name, fields, info: extractDoc(d.docPrefix) });
        } else if (isFunktionDecl(d)) {
            decls.push(lowerFn(d, reg));
        }
        // PruefeDecl: Phase 3 (prüfe→JUnit).
    }
    return {
        javaPackage: ctx.javaPackage,
        className: ctx.className,
        decls,
        info: extractDoc(program.fileDoc),
    };
}
