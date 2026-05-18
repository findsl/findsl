// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * AST + aufgelöste Typen → target-neutrale IR (ADR1 `lower/`), Phase 1.
 *
 * Spiegelt das Interpreter-Orakel (`interpret/values.ts`/`interpreter.ts`)
 * für den `examples/kst`-Konstruktsatz. Die wert-/tag-tragende Semantik
 * (parseNumberLiteral, castNumeric/applyMoneyAnnotation, combine*) liegt
 * in der bereits verifizierten Runtime `FinDslNumber` (ADR2) — das
 * Lowering trifft nur die *statischen* Entscheidungen, die der
 * Interpreter zur Laufzeit per AST-Kontext fällt: das Rundungsziel von
 * `.abrunden()/.aufrunden()` (governingMoneyTarget, interpreter.ts:1008)
 * und die positionsaufgelöste Konstruktor-Argument-/Default-Reihenfolge
 * (constructRecord, interpreter.ts:1173).
 */

import { Decimal } from 'decimal.js';
import {
    type Program, type TopDecl, type Expr, type Type,
    type FunktionDecl, type DatensatzDecl, type WaehleExpr,
    isKonstDecl, isFunktionDecl, isDatensatzDecl, isAufzaehlungDecl,
    isNumberLiteral, isStringLiteral, isCallChain, isParenChain,
    isCall, isFieldAccess, isBinaryOp, isWaehleExpr, isFallArm,
    isSonstArm, isCast, isAbbruchExpr, isLetStmt, isFunktionBody,
    isNamedType,
} from '../../language/generated/ast.js';
import type {
    IrModule, IrDecl, IrExpr, IrArm, IrFnBody, IrField, IrParam,
    IrDoc, ZahlFactory, ZielTyp,
} from '../ir/nodes.js';

/** Roher `--…--`-Doc-Text + `@Quelle`-Argumente eines DeclPrefix übertragen. */
interface DeclPrefixLike {
    doc?: string;
    annotations?: ReadonlyArray<{ name: string; args: ReadonlyArray<Expr> }>;
}
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

/** Name eines NamedType-Atoms, sonst undefined (Teil-Parse-robust). */
function atomName(t: Type | undefined): string | undefined {
    const atom = t?.atom;
    return atom && isNamedType(atom) ? atom.name : undefined;
}

/** FinDSL-Typ → Java-Typ. Numerisch → FinDslNumber; sonst Record/Enum-Name. */
function javaType(t: Type | undefined): string {
    const n = atomName(t);
    if (n === undefined) return 'FinDslNumber';            // Teil-Parse: konservativ
    if (NUMERIC_NAMES.has(n)) return 'FinDslNumber';
    if (n === 'Wahrheitswert') return 'boolean';
    if (n === 'Text') return 'String';
    return n;                                              // Datensatz/Aufzählung
}

/** Geld-Annotationsname (`Euro|Cent|EuroCent`) einer Typ-Annotation. */
function moneyAnnotation(t: Type | undefined): 'Euro' | 'Cent' | 'EuroCent' | undefined {
    const n = atomName(t);
    return n && MONEY_NAMES.has(n) ? (n as 'Euro' | 'Cent' | 'EuroCent') : undefined;
}

/**
 * Spiegel von `values.ts parseNumberLiteral` (277-290): deutsche Notation
 * `.`=Tausender (entfernen), `,`=Dezimal (→`.`), `%`→Bruch (÷100, exakt
 * via decimal.js wie das Orakel). Keine Kontext-Annotation hier — die
 * macht die Runtime (`withMoneyAnnotation`), exakt wie der Interpreter.
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
 * Lokaler AST-Eltern-Walk, 1:1 zu `interpreter.ts governingMoneyTarget`
 * (1008-1029): nächste maßgebliche Geld-Annotation (`als`-Cast /
 * `konst`/`var`-Annotation / umschließender fn-Rückgabetyp) über
 * `$container`. `undefined` ⇒ kein Geld-Kontext.
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
            // Teil-Parse-Guard wie das Orakel (interpreter.ts:1020):
            // `LetStmt.type` kann bei Teil-Parse fehlen.
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

/** Modul-Registries: Enum-Wert→Enum-Name, Datensatz-Name→Decl, fn-Namen. */
interface Registry {
    readonly enumValues: ReadonlyMap<string, string>;
    readonly records: ReadonlyMap<string, DatensatzDecl>;
}

function buildRegistry(program: Program): Registry {
    const enumValues = new Map<string, string>();
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
    if (!expr) throw new Error('Teil-Parse: fehlender Ausdruck (Codegen Phase 1).');

    if (isNumberLiteral(expr)) {
        const { factory, arg } = parseNumberLiteral(expr.value);
        return { kind: 'numLit', factory, arg };
    }
    if (isStringLiteral(expr)) {
        // Strings (inkl. abbruch-Begründung/Interpolation) sind Phase-2-
        // Scope; kst nutzt keine. Klarer Guard statt irreführendem Hack.
        throw new Error('String-Literale sind Phase-2-Scope (kst nutzt keine).');
    }
    if (isAbbruchExpr(expr)) {
        // abbruch braucht eine Text-Begründung → Phase-2 (siehe oben).
        throw new Error('abbruch ist Phase-2-Scope (kst nutzt es nicht).');
    }
    if (isBinaryOp(expr)) {
        const op = expr.op;
        if (op === 'und') {
            return { kind: 'and', left: lowerExpr(expr.left, reg), right: lowerExpr(expr.right, reg) };
        }
        if (op === '+' || op === '-' || op === '*') {
            return { kind: 'arith', op, left: lowerExpr(expr.left, reg), right: lowerExpr(expr.right, reg) };
        }
        if (op === '==' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
            const left = lowerExpr(expr.left, reg);
            const right = lowerExpr(expr.right, reg);
            if (left.kind === 'enumVal' || right.kind === 'enumVal') {
                // Enum-Gleichheit als Ausdruck ist Phase-2-Scope; kst nutzt
                // Enum-Vergleich nur als `wähle`-Pattern (siehe lowerWaehle).
                throw new Error('Enum-Vergleich als Ausdruck: Phase-2-Scope.');
            }
            return { kind: 'cmp', op, left, right };
        }
        if (op === 'oder') {
            throw new Error('`oder` ist Phase-2-Scope (kst nutzt es nicht).');
        }
    }
    if (isWaehleExpr(expr)) {
        return lowerWaehle(expr, reg);
    }
    if (isParenChain(expr)) {
        // kst: ausschließlich `(expr).abrunden()/.aufrunden()`.
        const fa = expr.chain[0];
        if (expr.chain.length === 2 && fa && isFieldAccess(fa)
            && (fa.name === 'abrunden' || fa.name === 'aufrunden') && isCall(expr.chain[1])) {
            const target = governingMoneyTarget(fa) ?? 'Ganzzahl';
            return {
                kind: 'round',
                receiver: lowerExpr(expr.receiver, reg),
                mode: fa.name,
                target: target as ZielTyp,
            };
        }
        throw new Error('ParenChain-Form außerhalb des Phase-1-Scopes.');
    }
    if (isCallChain(expr)) {
        return lowerCallChain(expr, reg);
    }
    throw new Error(`Ausdruck ${(expr as { $type?: string }).$type} ist Phase-1-out-of-scope.`);
}

function lowerCallChain(
    cc: { name?: string; chain: ReadonlyArray<object> },
    reg: Registry,
): IrExpr {
    const name = cc.name;
    if (name === undefined) throw new Error('Teil-Parse: CallChain ohne Name.');

    if (cc.chain.length === 0) {
        const enumName = reg.enumValues.get(name);
        if (enumName !== undefined) return { kind: 'enumVal', enumName, value: name };
        return { kind: 'ref', name };
    }
    const first = cc.chain[0];
    if (isCall(first)) {
        const call = first;
        const rec = reg.records.get(name);
        if (rec !== undefined) {
            return { kind: 'ctor', typeName: name, args: resolveCtorArgs(rec, call.args, reg) };
        }
        return { kind: 'call', name, args: call.args.map((a) => lowerExpr(a.value, reg)) };
    }
    // Feldzugriff-Kette: name.f1.f2 …  → Record-Accessoren.
    let receiver: IrExpr;
    const enumName = reg.enumValues.get(name);
    receiver = enumName !== undefined
        ? { kind: 'enumVal', enumName, value: name }
        : { kind: 'ref', name };
    for (const op of cc.chain) {
        if (isFieldAccess(op) && op.name) {
            receiver = { kind: 'field', receiver, name: op.name };
        } else {
            throw new Error('Ketten-Glied außerhalb des Phase-1-Scopes.');
        }
    }
    return receiver;
}

/**
 * constructRecord-Spiegel (interpreter.ts:1173-1219): pro Feld in
 * Deklarationsreihenfolge — benanntes Arg (per Name) ▸ positionales Arg
 * ▸ Feld-Default ▸ Fehler (Pflichtfeld). Defaults werden OHNE
 * applyMoneyAnnotation gelowert (constructRecord ruft es nicht — Risk 5).
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

function lowerWaehle(w: WaehleExpr, reg: Registry): IrExpr {
    const arms: IrArm[] = w.arms.map((arm) => {
        if (isFallArm(arm)) {
            if (!arm.result) throw new Error('falls-Arm ohne Ergebnis (Teil-Parse).');
            return {
                patterns: arm.patterns.map((p) => lowerExpr(p as Expr, reg)),
                result: lowerExpr(arm.result, reg),
                isSonst: false,
            };
        }
        if (isSonstArm(arm)) {
            if (!arm.result) throw new Error('sonst-Arm ohne Ergebnis (Teil-Parse).');
            return { patterns: [], result: lowerExpr(arm.result, reg), isSonst: true };
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
    const params: IrParam[] = fd.params.map((p) => ({
        name: p.name,
        javaType: javaType(p.type),
    }));
    const returnJavaType = javaType(fd.returnType);
    let body: IrFnBody;
    if (fd.body.expr) {
        body = { kind: 'expr', expr: lowerExpr(fd.body.expr, reg) };
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
 * `withMoneyAnnotation` (= Interpreter applyMoneyAnnotation: Tag-Setzung
 * + Ganzzahligkeits-Erzwingung). Prozent/Ganzzahl/Dezimal → No-Op
 * (moneyAnnotationName liefert undefined, interpreter.ts:482).
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
        // PruefeDecl: Phase 3 (prüfe→JUnit). In Phase 1 ignoriert.
    }
    return {
        javaPackage: ctx.javaPackage,
        className: ctx.className,
        decls,
        info: extractDoc(program.fileDoc),
    };
}
