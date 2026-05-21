// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * `wähle`-Lowering + Statement-Hub für FinDSL → IR (ADR1 `lower/`).
 *
 * Aus `lower.ts` ausgelagert (Issue #72, Teil 2/3 — File-Size-Split).
 * Enthält:
 *  - `lowerWaehle` / `lowerArmResult` / `lowerBlockLambda` — `wähle`-Arme
 *    und Block-Lambda-Ergebnisse.
 *  - `boxReturn` / `boxReturnExpr` — Sicht-Adapter an der `fn`-Rückgabe
 *    (rekursiv durch `wähle`-Arme).
 *  - `floatWaehle` / `pushCtx*` / `floatLets` / `floatResult` /
 *    `floatValue` / `isChoice` — `wähle` aus reinem Ausdruckskontext
 *    heraushebzig, damit der Emitter immer auf Ergebnisposition trifft
 *    (ADR4 — Java hat kein Ausdrucks-`if`).
 *
 * Statement-Lowering selbst macht der Emitter (`emitWaehle`); diese
 * Datei normalisiert nur die IR so, dass `wähle` ausschließlich in
 * Ergebnisposition steht.
 *
 * ESM-Init-Zyklus vermeiden: `lowerExpr`/`javaType`/`maybeMoneyAnno`
 * werden NICHT direkt importiert (zirkulär mit `lower.ts`), sondern
 * per Dep-Injection als Arrow-Wrap übergeben — der Funktionswert wird
 * zur Call-Zeit gelesen, nicht zur Modul-Init-Zeit. Lehre aus PR #82.
 */

import {
    isFallArm,
    isLambda,
    isLetStmt,
    isSonstArm,
    type Expr,
    type Type,
    type WaehleExpr,
} from '../../language/generated/ast.js';
import type {
    IrArm,
    IrBlockResult,
    IrExpr,
    IrLet,
    IrType,
} from '../ir/nodes.js';

/**
 * Minimale Registry-Sicht, die das `wähle`-/Block-Lambda-Lowering
 * braucht (nur `scopeTypes` für Per-Lambda-Variablen-Sichtbarkeit).
 * Vollständige `Registry` lebt in `lower.ts`; sie erfüllt dieses
 * Interface strukturell.
 */
export interface WaehleLowerRegistry {
    scopeTypes: Map<string, Type | undefined>;
}

/**
 * Dep-Injection-Bundle: Aufruf-Wrapper für die in `lower.ts` lebenden
 * Hilfen `lowerExpr` / `javaType` / `maybeMoneyAnno`. Per Konvention
 * werden diese als Arrow-Wraps (`(...a) => lowerExpr(...a)`) übergeben,
 * sodass der Funktionswert zur CALL-Zeit aufgelöst wird — ESM lädt
 * `lower-waehle.ts` während der Init von `lower.ts`, ein direkter Alias
 * wäre dort ggf. noch `undefined`.
 */
export interface WaehleLowerDeps {
    lowerExpr: (expr: Expr | undefined, reg: WaehleLowerRegistry) => IrExpr;
    irType:    (t: Type | undefined, reg: WaehleLowerRegistry) => IrType;
    maybeMoneyAnno: (expr: IrExpr, t: Type | undefined, what: string) => IrExpr;
}

// ---------------------------------------------------------------------------
// `wähle` / Block-Lambda — Arm-Ergebnisse + Block-Lets
// ---------------------------------------------------------------------------

/** Block-Lambda (`{ var …; ergebnis }`) als Arm-Ergebnis → IrBlockResult. */
export function lowerBlockLambda(
    lam: { stmts: ReadonlyArray<object>; result?: Expr },
    reg: WaehleLowerRegistry,
    deps: WaehleLowerDeps,
): IrBlockResult {
    if (!lam.result) throw new Error('Block-Arm ohne Ergebnis (Teil-Parse).');
    for (const s of lam.stmts.filter(isLetStmt)) {
        reg.scopeTypes.set(s.name, s.type);          // Sicht für Feld-Unbox
    }
    const lets: IrLet[] = lam.stmts
        .filter(isLetStmt)
        .map((s) => ({
            name: s.name,
            type: deps.irType(s.type, reg),
            expr: deps.maybeMoneyAnno(deps.lowerExpr(s.value, reg), s.type, `var "${s.name}"`),
        }));
    return { kind: 'blockResult', lets, result: deps.lowerExpr(lam.result, reg) };
}

export function lowerArmResult(
    result: Expr | undefined,
    reg: WaehleLowerRegistry,
    deps: WaehleLowerDeps,
): IrExpr | IrBlockResult {
    if (!result) throw new Error('wähle-Arm ohne Ergebnis (Teil-Parse).');
    if (isLambda(result) && result.params.length === 0) {
        return lowerBlockLambda(result, reg, deps);
    }
    return deps.lowerExpr(result, reg);
}

export function lowerWaehle(
    w: WaehleExpr,
    reg: WaehleLowerRegistry,
    deps: WaehleLowerDeps,
): IrExpr {
    const arms: IrArm[] = w.arms.map((arm) => {
        if (isFallArm(arm)) {
            return {
                patterns: arm.patterns.map((p) => deps.lowerExpr(p as Expr, reg)),
                result: lowerArmResult(arm.result, reg, deps),
                isSonst: false,
            };
        }
        if (isSonstArm(arm)) {
            return { patterns: [], result: lowerArmResult(arm.result, reg, deps), isSonst: true };
        }
        throw new Error('Unbekannter wähle-Arm.');
    });
    return {
        kind: 'waehle',
        subject: w.subject ? deps.lowerExpr(w.subject, reg) : undefined,
        arms,
    };
}

// ---------------------------------------------------------------------------
// Sicht-Boxing der `fn`-Rückgabe
// ---------------------------------------------------------------------------

/**
 * Boxt die RÜCKGABE einer öffentlichen `fn` auf den Sicht-Subtyp:
 * jede Ergebnisposition (`wähle`-Arm, Block-Ergebnis, schlichter
 * Ausdruck) wird in `box{wrapper}` gehüllt; `abbruch` (wirft, kein
 * Wert) und bereits geboxte Ausdrücke bleiben unberührt. Rein
 * strukturell (Wert/Tag unverändert) → bit-genau.
 */
export function boxReturn(r: IrExpr | IrBlockResult, wrapper: string): IrExpr | IrBlockResult {
    return r.kind === 'blockResult'
        ? { ...r, result: boxReturnExpr(r.result, wrapper) }
        : boxReturnExpr(r, wrapper);
}

export function boxReturnExpr(e: IrExpr, wrapper: string): IrExpr {
    if (e.kind === 'waehle') {
        return { ...e, arms: e.arms.map((a) => ({ ...a, result: boxReturn(a.result, wrapper) })) };
    }
    if (e.kind === 'abort' || e.kind === 'box') return e;
    return { kind: 'box', wrapper, expr: e };
}

// ---------------------------------------------------------------------------
// `wähle` aus reinem Ausdruckskontext herausziehen (Phase 3)
// ---------------------------------------------------------------------------
//
// Der Emitter lowert `wähle` ausschließlich in Ergebnisposition zu
// if/return (ADR4 — Java hat kein Ausdrucks-`if`). FinDSL erlaubt aber
// `wähle` als Teilausdruck (kraftst `_SteuerPkwB = sockel + wähle {…}`).
// Da FinDSL-Ausdrücke seiteneffektfrei sind (P2), ist das Verteilen des
// umgebenden reinen Kontexts in JEDEN Arm semantik-erhaltend:
//   `f(wähle { p->r ; sonst->s })` ≡ `wähle { p->f(r) ; sonst->f(s) }`.
// `floatWaehle` bubbelt jedes eingebettete `wähle` nach oben; das
// Resultat ist entweder `wähle`-frei oder ein `wähle`, dessen Arm-
// Ergebnisse rekursiv normalisiert sind (emitResult kann verschachtelte
// `wähle` in Ergebnisposition).
//
// Mehrere `wähle`-Kinder eines Knotens (z. B. `wähle{…} + wähle{…}`):
// es wird zuerst das LINKE gehoben; das rechte `wähle` bleibt in der
// Closure als fester Operand und wird durch das erneute `floatWaehle`
// in `pushCtxExpr` (auf dem rekonstruierten Knoten) anschließend
// herausgehoben. Terminiert: jeder Schritt operiert auf strikt
// kleineren Teilbäumen.

export function isChoice(e: IrExpr): e is Extract<IrExpr, { kind: 'waehle' }> {
    return e.kind === 'waehle';
}

/** Reinen unären Kontext `k` in eine Ergebnisposition (Arm/Block/Leaf) drücken. */
export function pushCtx(
    r: IrExpr | IrBlockResult,
    k: (leaf: IrExpr) => IrExpr,
): IrExpr | IrBlockResult {
    if (r.kind === 'blockResult') {
        return { ...r, lets: floatLets(r.lets), result: pushCtxExpr(r.result, k) };
    }
    if (r.kind === 'waehle') {
        return { ...r, arms: r.arms.map((a) => ({ ...a, result: pushCtx(a.result, k) })) };
    }
    return pushCtxExpr(r, k);
}

export function floatLets(lets: ReadonlyArray<IrLet>): IrLet[] {
    // `var` darf einen `wähle`-Wert tragen (Phase 4) — der Emitter
    // statement-lowert ihn (blank `final` + Zuweisungs-Sink). Daher
    // floatWaehle (hebt eingebettete `wähle`), NICHT floatValue (wirft).
    return lets.map((l) => ({ ...l, expr: floatWaehle(l.expr) }));
}

export function pushCtxExpr(e: IrExpr, k: (leaf: IrExpr) => IrExpr): IrExpr {
    const f = floatWaehle(e);
    if (isChoice(f)) {
        return { ...f, arms: f.arms.map((a) => ({ ...a, result: pushCtx(a.result, k) })) };
    }
    // `abbruch` wirft (kein Wert) → umgebenden Kontext (moneyAnno/box/
    // cast/…) NICHT anwenden (wäre semantisch leer & emit-invalide),
    // wie boxReturn.
    if (f.kind === 'abort') return f;
    return floatWaehle(k(f));
}

/** Arm-/Block-Ergebnis selbst normalisieren (verschachtelte `wähle`). */
export function floatResult(r: IrExpr | IrBlockResult): IrExpr | IrBlockResult {
    if (r.kind === 'blockResult') {
        return { ...r, lets: floatLets(r.lets), result: floatWaehle(r.result) };
    }
    return floatWaehle(r);
}

/**
 * Hebt jedes eingebettete `wähle` durch reine Operator-/Aufruf-/Cast-/
 * Feld-/Interpolations-Knoten nach außen. Deterministisch, terminierend
 * (strukturelle Rekursion; jeder Knoten endlich tief).
 */
export function floatWaehle(e: IrExpr): IrExpr {
    switch (e.kind) {
        case 'waehle':
            return { ...e, arms: e.arms.map((a) => ({ ...a, result: floatResult(a.result) })) };
        case 'arith': case 'div': case 'cmp': case 'enumCmp': case 'and': {
            const L = floatWaehle(e.left);
            const R = floatWaehle(e.right);
            if (isChoice(L)) return pushCtxExpr(L, (l) => ({ ...e, left: l, right: R }));
            if (isChoice(R)) return pushCtxExpr(R, (r) => ({ ...e, left: L, right: r }));
            return { ...e, left: L, right: R };
        }
        case 'cast': case 'neg': case 'not': {
            const v = floatWaehle(e.value);
            return isChoice(v) ? pushCtxExpr(v, (x) => ({ ...e, value: x })) : { ...e, value: v };
        }
        case 'round': case 'listMethod': {
            const rc = floatWaehle(e.receiver);
            return isChoice(rc) ? pushCtxExpr(rc, (x) => ({ ...e, receiver: x })) : { ...e, receiver: rc };
        }
        case 'listMap': {
            const rc = floatWaehle(e.receiver);
            return isChoice(rc) ? pushCtxExpr(rc, (x) => ({ ...e, receiver: x })) : { ...e, receiver: rc };
        }
        case 'moneyAnno': case 'box': case 'unbox': {
            const x = floatWaehle(e.expr);
            return isChoice(x) ? pushCtxExpr(x, (y) => ({ ...e, expr: y })) : { ...e, expr: x };
        }
        case 'field': {
            const rc = floatWaehle(e.receiver);
            return isChoice(rc) ? pushCtxExpr(rc, (x) => ({ ...e, receiver: x })) : { ...e, receiver: rc };
        }
        case 'abort': {
            const x = floatWaehle(e.reason);
            return isChoice(x) ? pushCtxExpr(x, (y) => ({ ...e, reason: y })) : { ...e, reason: x };
        }
        case 'call': case 'crossCall': case 'ctor': {
            // Discriminated-Union-Narrowing: alle drei haben `args` — kein
            // dynamischer Key, kein Record-Lie.
            const xs = e.args.map(floatWaehle);
            const idx = xs.findIndex(isChoice);
            if (idx < 0) return { ...e, args: xs };
            const w = xs[idx] as Extract<IrExpr, { kind: 'waehle' }>;
            return pushCtxExpr(w, (leaf) => {
                const next = xs.slice();
                next[idx] = leaf;
                return { ...e, args: next };
            });
        }
        case 'listLit': {
            const xs = e.items.map(floatWaehle);
            const idx = xs.findIndex(isChoice);
            if (idx < 0) return { ...e, items: xs };
            const w = xs[idx] as Extract<IrExpr, { kind: 'waehle' }>;
            return pushCtxExpr(w, (leaf) => {
                const next = xs.slice();
                next[idx] = leaf;
                return { ...e, items: next };
            });
        }
        case 'strInterp': {
            const xs = e.slots.map(floatWaehle);
            const idx = xs.findIndex(isChoice);
            if (idx < 0) return { ...e, slots: xs };
            const w = xs[idx] as Extract<IrExpr, { kind: 'waehle' }>;
            return pushCtxExpr(w, (leaf) => {
                const next = xs.slice();
                next[idx] = leaf;
                return { ...e, slots: next };
            });
        }
        // Blätter ohne `wähle`-Kinder: numLit/ref/enumVal/crossRef/lambda1.
        default:
            return e;
    }
}

/** Floatet einen Wert; `wähle` als var-/konst-Wert ist Phase-4-Scope. */
export function floatValue(e: IrExpr, what: string): IrExpr {
    const f = floatWaehle(e);
    if (isChoice(f)) {
        throw new Error(`\`wähle\` als Wert von ${what} ist Phase-4-Scope `
            + '(Statement-Zuweisung nötig; kraftst nutzt es nicht).');
    }
    return f;
}
