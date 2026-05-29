/**
 * Bidirektionaler Check-Pfad (SPEC § 3.13).
 *
 * `checkAgainstAnnotation(expr, expected, …)` propagiert den erwarteten Typ
 * in Sub-Ausdrücke — z. B. nackte Number-Literale übernehmen ihren
 * Geld-Tag (`Euro`/`EuroCent`/`Cent`) aus dem Kontext, statt mit dem
 * Default `Ganzzahl`/`Dezimal` zu kollidieren.
 *
 * Aus `findsl-types.ts` extrahiert (Issue #72), damit die Typ-Datei
 * unter dem 1000-Zeilen-Limit bleibt. Funktional verhaltensgleich.
 */

import {
    isAusgabeStmt,
    isBinaryOp,
    isCallChain,
    isFallArm,
    isLambda,
    isLetStmt,
    isListLiteral,
    isNullLiteral,
    isNumberLiteral,
    isParenChain,
    isSonstArm,
    isUnaryOp,
    isWaehleExpr,
    isWennExpr,
    type Expr,
} from './generated/ast.js';
import {
    checkWaehleExhaustiveness,
    ensureWahrheit,
    infer,
    inferBlockExpr,
    inferCallChain,
    inferParenChain,
    refineEnvByCondition,
    simpleSubjectName,
} from './findsl-inference.js';
import {
    assignable,
    isGeld,
    isNumeric,
    resolveTypeAnnotation,
    TDezimal,
    TGanzzahl,
    TProzent,
    TText,
    TUnknown,
    typeToString,
    type Reporter,
    type Type,
    type TypeContext,
    type TypeEnv,
} from './findsl-types.js';

/**
 * Prüft `expr` gegen einen erwarteten Typ. Number-Literale im Geld-Kontext
 * werden als der erwartete Geldtyp akzeptiert (§ 3.13). Liefert den
 * effektiven Typ des Ausdrucks zurück (für nachgelagerte Bindings).
 */
export function checkAgainstAnnotation(
    expr: Expr, expected: Type, env: TypeEnv, ctx: TypeContext, report: Reporter,
): Type {
    const t = checkAgainstAnnotationImpl(expr, expected, env, ctx, report);
    // Kontextueller (erwarteter) Typ — gewinnt gegenüber Standalone-`infer`.
    ctx.recordType?.(expr, t);
    return t;
}

function checkAgainstAnnotationImpl(
    expr: Expr, expected: Type, env: TypeEnv, ctx: TypeContext, report: Reporter,
): Type {
    // Negatives Zahl-/Geld-Literal (#144): das Vorzeichen ändert den Typ
    // nicht — `-100` muss im Euro-Kontext genauso als Euro angenommen
    // werden wie `100` (bidirektionale Annahme, § 3.13). Geldwerte sind
    // vorzeichenbehaftet (Nachzahlung/Erstattung/Saldo). Auf den Operanden
    // (das Literal) propagieren; der Schreibweisen-Check (§ 2.7.3) bezieht
    // sich auf den Betrag. (`op === 'nicht'` ist boolesch, nicht betroffen.)
    if (isUnaryOp(expr) && expr.op === '-' && isNumberLiteral(expr.operand)) {
        return checkAgainstAnnotation(expr.operand, expected, env, ctx, report);
    }

    // Bidirektional: nackte Number-Literale annehmen Geldtyp aus Kontext.
    if (isNumberLiteral(expr)) {
        const raw = expr.value;
        const isPct = raw.endsWith('%');
        const isInt = !raw.includes(',') && !isPct;   // deutsches Dezimalkomma
        // Per-Typ-Schreibweise erzwingen (SPEC § 2.7.3): Euro/Cent
        // ganzzahlig, EuroCent genau zwei Nachkommastellen.
        const expPrimNote = unwrapNullable(expected);
        if (!isPct && expPrimNote.kind === 'primitive' && isGeld(expPrimNote)) {
            const n = expPrimNote.name;
            if ((n === 'Euro' || n === 'Cent') && raw.includes(',')) {
                report(expr, `${n}-Literal "${raw}" muss ganzzahlig sein — keine Nachkommastellen (SPEC § 2.7.3).`);
            } else if (n === 'EuroCent' && !/,[0-9]{2}$/.test(raw)) {
                report(expr, `EuroCent-Literal "${raw}" braucht genau zwei Nachkommastellen (z. B. 3.434,00; SPEC § 2.7.3).`);
            }
        }
        // Prozent-Literal nur als Prozent annehmen
        if (isPct) {
            if (!assignable(TProzent, expected) && expected.kind !== 'unknown') {
                report(expr, `Prozent-Literal passt nicht zu erwartetem Typ ${typeToString(expected)}.`);
            }
            return TProzent;
        }
        // Ganzzahl-/Dezimal-Literal nimmt jeden numerischen Erwartungstyp an
        const expectedPrim = unwrapNullable(expected);
        if (expectedPrim.kind === 'primitive' && (
            isGeld(expectedPrim) || expectedPrim.name === 'Ganzzahl' || expectedPrim.name === 'Dezimal'
        )) {
            // Ganzzahl-Literal kann nicht in Dezimal-Kontext zu Prozent werden
            // Dezimal-Literal akzeptiert keinen Ganzzahl-Kontext
            if (!isInt && expectedPrim.name === 'Ganzzahl') {
                report(expr, `Dezimal-Literal "${raw}" passt nicht zu Ganzzahl.`);
                return TGanzzahl;
            }
            return expectedPrim;
        }
        // Sonst Default-Inferenz + Subtyp-Check
        const def = isInt ? TGanzzahl : TDezimal;
        if (!assignable(def, expected) && expected.kind !== 'unknown') {
            report(expr, `Erwartet ${typeToString(expected)}, erhalten ${typeToString(def)}.`);
        }
        return def;
    }

    // Für arithmetische Ausdrücke +/- propagieren wir den erwarteten Typ in die
    // Operanden — so wird `GFB + 1` als Euro+Euro typisiert.
    if (isBinaryOp(expr)) {
        const expPrim = unwrapNullable(expected);
        if (expPrim.kind === 'primitive' && (expr.op === '+' || expr.op === '-') && isNumeric(expPrim)) {
            checkAgainstAnnotation(expr.left,  expPrim, env, ctx, report);
            checkAgainstAnnotation(expr.right, expPrim, env, ctx, report);
            return expPrim;
        }
    }

    // wenn/wähle: jeden Zweig gegen expected checken, mit Smart-Cast.
    if (isWennExpr(expr) && expr.then && expr.else) {
        if (expr.condition) {
            const cond = infer(expr.condition, env, ctx, report);
            ensureWahrheit(expr.condition, cond, report);
            const [thenEnv, elseEnv] = refineEnvByCondition(expr.condition, env);
            checkAgainstAnnotation(expr.then, expected, thenEnv, ctx, report);
            checkAgainstAnnotation(expr.else, expected, elseEnv, ctx, report);
        } else {
            checkAgainstAnnotation(expr.then, expected, env, ctx, report);
            checkAgainstAnnotation(expr.else, expected, env, ctx, report);
        }
        return expected;
    }
    if (isWaehleExpr(expr)) {
        checkWaehleExhaustiveness(expr, env, ctx, report);
        const refineName = expr.subject ? simpleSubjectName(expr.subject) : undefined;
        const subjectType = refineName ? env.lookup(refineName) : undefined;
        const canRefine = subjectType?.kind === 'nullable';
        for (const arm of expr.arms) {
            if (!(isFallArm(arm) || isSonstArm(arm)) || !arm.result) continue;
            let armEnv = env;
            if (canRefine && refineName) {
                const armHasNullPattern = isFallArm(arm)
                    && arm.patterns.some((p) => isNullLiteral(p));
                if (!armHasNullPattern) {
                    armEnv = env.child();
                    armEnv.define(refineName, (subjectType).inner);
                }
            }
            checkAgainstAnnotation(arm.result, expected, armEnv, ctx, report);
        }
        return expected;
    }

    // Lambda ohne Params (Block) — checke gegen result-Typ.
    if (isLambda(expr) && expr.params.length === 0 && expr.result) {
        const blockEnv = env.child();
        for (const stmt of expr.stmts) {
            if (isAusgabeStmt(stmt)) {
                if (stmt.text) checkAgainstAnnotation(stmt.text, TText, blockEnv, ctx, report);
                continue;
            }
            if (!isLetStmt(stmt)) continue;
            const valueT = stmt.type
                ? checkAgainstAnnotation(stmt.value, resolveTypeAnnotation(stmt.type, ctx), blockEnv, ctx, report)
                : infer(stmt.value, blockEnv, ctx, report);
            blockEnv.define(stmt.name, valueT);
        }
        return checkAgainstAnnotation(expr.result, expected, blockEnv, ctx, report);
    }

    // Listen-Literal gegen erwarteten Liste<T>/Bereich<T>: jedes Element
    // gegen T prüfen; leere Liste übernimmt den Kontext-Elementtyp.
    {
        const expL = unwrapNullable(expected);
        if (isListLiteral(expr) && expL.kind === 'list') {
            for (const it of expr.items ?? []) {
                if (it) checkAgainstAnnotation(it, expL.element, env, ctx, report);
            }
            return expL;
        }
    }

    // Parametrisches Lambda gegen erwarteten Funktionstyp `(T…)->R`:
    // Param-Typen aus dem Erwartungstyp binden (eigene Annotation hat
    // Vorrang), Rumpf gegen R prüfen. Liefert den INFERIERTEN Funktionstyp
    // zurück (Aufrufer wie der Listen-Methoden-Dispatch brauchen das
    // konkrete R).
    if (isLambda(expr) && expr.params.length > 0) {
        const expF = unwrapNullable(expected);
        if (expF.kind === 'function') {
            const lenv = env.child();
            const params = expr.params.map((p, i) => {
                const pt = p.type ? resolveTypeAnnotation(p.type, ctx)
                    : (expF.params[i] ?? TUnknown);
                lenv.define(p.name, pt);
                return pt;
            });
            let resultT: Type = TUnknown;
            if (expr.result) {
                resultT = inferBlockExpr(expr.stmts, expr.result, lenv, ctx, report);
                if (expF.result.kind !== 'unknown' && resultT.kind !== 'unknown'
                    && !assignable(resultT, expF.result)) {
                    report(expr.result,
                        `Lambda-Rückgabe ${typeToString(resultT)} passt nicht zu `
                        + `erwartetem ${typeToString(expF.result)}.`);
                }
            }
            return { kind: 'function', params, result: resultT };
        }
    }

    // CallChain/ParenChain: erwarteten Typ in die Kette fädeln, damit
    // die kontextgetriebene Skalar-Rundung (`EuroCent.abrunden()` →
    // `Euro`/`Cent`, SPEC § 11.1) das Ziel sieht. Für alle anderen
    // Ketten-Ops ist `expected` wirkungslos → verhaltensgleich zum
    // bisherigen Default-Pfad (rein additiv).
    if (isCallChain(expr) || isParenChain(expr)) {
        const t = isCallChain(expr)
            ? inferCallChain(expr, env, ctx, report, expected)
            : inferParenChain(expr, env, ctx, report, expected);
        if (!assignable(t, expected) && t.kind !== 'unknown' && expected.kind !== 'unknown') {
            report(expr, `Erwartet ${typeToString(expected)}, erhalten ${typeToString(t)}.`);
        }
        return t;
    }

    // Default: infer + Subtyp-Check
    const actual = infer(expr, env, ctx, report);
    if (!assignable(actual, expected) && actual.kind !== 'unknown' && expected.kind !== 'unknown') {
        report(expr, `Erwartet ${typeToString(expected)}, erhalten ${typeToString(actual)}.`);
    }
    return actual;
}

export function unwrapNullable(t: Type): Type {
    return t.kind === 'nullable' ? t.inner : t;
}
