/**
 * Bidirektionale Inferenz (SPEC § 3.13) — der Bottom-up-Pfad.
 *
 * `infer(expr, env, ctx, report)` liefert den natürlichen Typ eines
 * Ausdrucks. Komplementär zum Check-Pfad (`findsl-type-check.ts`), der
 * top-down propagiert. Beide Pfade rufen sich gegenseitig auf; in der
 * Modul-Hierarchie sind die Helper hier zentralisiert, damit
 * `findsl-types.ts` unter dem 1000-Zeilen-Limit bleibt (Issue #72).
 *
 * Architektur-Notiz (zyklische Importe):
 *  - findsl-inference → findsl-method-inference (Listen-/Skalar-/Text-Disp.)
 *  - findsl-inference → findsl-type-check (`checkAgainstAnnotation`)
 *  - findsl-method-inference → findsl-inference (`infer`)
 *  - findsl-type-check → findsl-inference (Helper)
 *  Alle Zyklen verlaufen ausschließlich über Funktions-Körper, NIE über
 *  Modul-Initialisierung — ESM-konform.
 */

import type { AstNode } from 'langium';
import {
    InterpretError,
    parseSlotPath,
    parseStringLiteral,
} from '../interpret/values.js';
import {
    isAbbruchExpr,
    isAusgabeStmt,
    isBinaryOp,
    isBoolLiteral,
    isCall,
    isCallChain,
    isCast,
    isFallArm,
    isFieldAccess,
    isForceUnwrap,
    isFuerExpr,
    isIndex,
    isLambda,
    isLetStmt,
    isListLiteral,
    isNullCheck,
    isNullLiteral,
    isNumberLiteral,
    isParenChain,
    isRange,
    isSafeFieldAccess,
    isSonstArm,
    isStringLiteral,
    isUnaryOp,
    isWaehleExpr,
    isWennExpr,
    type BlockStmt,
    type CallArg,
    type Expr,
} from './generated/ast.js';
import {
    listMethod,
    scalarArgMethod,
    scalarRoundingMethod,
    textMethod,
    SCALAR_ARG_METHODS,
    type ListMethodCallOp,
} from './findsl-method-inference.js';
import { checkAgainstAnnotation } from './findsl-type-check.js';
import {
    GELD_PRECISION,
    TDezimal,
    TEuroCent,
    TGanzzahl,
    TNever,
    TNichts,
    TNull,
    TProzent,
    TText,
    TUnknown,
    TWahrheit,
    assignable,
    isGeld,
    isNumeric,
    isWahrheit,
    resolveTypeAnnotation,
    typeEq,
    typeToString,
    type PrimitiveType,
    type Reporter,
    type Type,
    type TypeContext,
    type TypeEnv,
} from './findsl-types.js';

/**
 * Infer-Pfad: liefert den Typ eines Ausdrucks bottom-up. Bei Inferenz-Fehlern
 * wird ein Fehler über `report` gemeldet und `unknown` zurückgegeben — der
 * Aufrufer kann damit weiterarbeiten, ohne Diagnose-Lawinen auszulösen.
 */
export function infer(expr: Expr, env: TypeEnv, ctx: TypeContext, report: Reporter): Type {
    const t = inferImpl(expr, env, ctx, report);
    ctx.recordType?.(expr, t);
    return t;
}

function inferImpl(expr: Expr, env: TypeEnv, ctx: TypeContext, report: Reporter): Type {
    if (isNumberLiteral(expr)) {
        const raw = expr.value;
        if (raw.endsWith('%')) return TProzent;
        if (raw.includes(','))  return TDezimal;   // deutsches Dezimalkomma
        return TGanzzahl;
    }
    if (isStringLiteral(expr)) {
        checkStringInterpolationSlots(expr.value, expr, env, report);
        return TText;
    }
    if (isBoolLiteral(expr))   return TWahrheit;
    if (isNullLiteral(expr))   return TNichts;

    if (isUnaryOp(expr)) {
        const inner = infer(expr.operand, env, ctx, report);
        if (expr.op === 'nicht') {
            if (!isWahrheit(inner) && inner.kind !== 'unknown') {
                report(expr, `Operator "nicht" erwartet Wahrheitswert, erhalten ${typeToString(inner)}.`);
            }
            return TWahrheit;
        }
        // Unäres "-"
        if (!isNumeric(inner) && inner.kind !== 'unknown') {
            report(expr, `Unäres "-" erwartet numerischen Wert, erhalten ${typeToString(inner)}.`);
            return TUnknown;
        }
        return inner;
    }

    if (isBinaryOp(expr)) return inferBinary(expr, env, ctx, report);

    if (isWennExpr(expr)) {
        if (!expr.condition || !expr.then || !expr.else) return TUnknown;
        const cond = infer(expr.condition, env, ctx, report);
        if (!isWahrheit(cond) && cond.kind !== 'unknown') {
            report(expr.condition, `wenn-Bedingung muss Wahrheitswert sein, erhalten ${typeToString(cond)}.`);
        }
        // Smart-Cast für `wenn (x ist [nicht] nichts) then sonst`:
        // im positiven Zweig wird `x` als non-null verfeinert, im negativen
        // als `nichts`. Liefert ein Paar von Sub-Envs für die zwei Zweige.
        const [thenEnv, elseEnv] = refineEnvByCondition(expr.condition, env);
        const thenT = infer(expr.then, thenEnv, ctx, report);
        const elseT = infer(expr.else, elseEnv, ctx, report);
        return joinBranches(thenT, elseT, expr, report);
    }

    if (isWaehleExpr(expr)) {
        checkWaehleExhaustiveness(expr, env, ctx, report);

        // Smart-Cast für `wähle (subject) { falls nichts -> … ; sonst -> … }`:
        // im sonst-Arm wird `subject` (sofern es ein einfacher Identifier
        // ist) als non-null verfeinert. Auch in falls-Arms ohne nichts-
        // Pattern gilt die Verfeinerung.
        const refineName = expr.subject ? simpleSubjectName(expr.subject) : undefined;
        const subjectType = expr.subject && refineName
            ? env.lookup(refineName)
            : undefined;
        const canRefine = subjectType?.kind === 'nullable';

        let result: Type | undefined;
        for (const arm of expr.arms) {
            let armEnv = env;
            if (canRefine && refineName) {
                const armHasNullPattern = isFallArm(arm)
                    && arm.patterns.some((p) => isNullLiteral(p));
                if (!armHasNullPattern) {
                    armEnv = env.child();
                    armEnv.define(refineName, (subjectType).inner);
                }
            }
            const armResult = isFallArm(arm) || isSonstArm(arm) ? arm.result : undefined;
            if (!armResult) continue;
            const armT = infer(armResult, armEnv, ctx, report);
            result = result === undefined ? armT : joinBranches(result, armT, expr, report);
        }
        return result ?? TUnknown;
    }

    if (isCast(expr)) {
        const target = resolveTypeAnnotation(expr.targetType, ctx);
        // `als`-Cast ist SPEC-§11.1-Kontextquelle 2: das Cast-Ziel in
        // eine Ketten-Empfänger-Rundung fädeln (`e.abrunden() als Cent`).
        // Nur für Ketten — sonst `infer` unverändert (keine Cast-
        // Semantik-Änderung; `checkCastLegal` bleibt maßgeblich).
        const inner = isCallChain(expr.value)
            ? inferCallChain(expr.value, env, ctx, report, target)
            : isParenChain(expr.value)
                ? inferParenChain(expr.value, env, ctx, report, target)
                : infer(expr.value, env, ctx, report);
        checkCastLegal(inner, target, expr, report);
        return target;
    }

    if (isNullCheck(expr)) {
        const inner = infer(expr.value, env, ctx, report);
        if (inner.kind !== 'nullable' && inner.kind !== 'nichts' && inner.kind !== 'unknown') {
            report(expr.value, `"ist nichts" verlangt einen Nullable-Operanden, erhalten ${typeToString(inner)}.`);
        }
        return TWahrheit;
    }

    if (isAbbruchExpr(expr)) {
        // Begründung muss `Text` sein (SPEC § 4.19). checkAgainstAnnotation
        // erzwingt das und löst nebenbei die String-Interpolations-Slot-
        // Checks aus. `abbruch` selbst hat den Bottom-Typ `never`.
        if (expr.grund) checkAgainstAnnotation(expr.grund, TText, env, ctx, report);
        return TNever;
    }

    if (isCallChain(expr)) return inferCallChain(expr, env, ctx, report);

    if (isParenChain(expr)) return inferParenChain(expr, env, ctx, report);

    if (isLambda(expr)) {
        if (expr.params.length === 0) {
            // Param-loses Lambda = Block-Ausdruck → Typ aus dem Ergebnis.
            if (!expr.result) return TUnknown;
            return inferBlockExpr(expr.stmts, expr.result, env.child(), ctx, report);
        }
        // Parametrisches Lambda ohne Kontext: Param-Typen aus Annotationen
        // (sonst unknown), Rumpf inferiert ⇒ Funktionstyp. Die kontextuelle
        // (bidirektionale) Bindung an `(T)->R` macht checkAgainstAnnotation.
        const lenv = env.child();
        const params = expr.params.map((p) => {
            const pt = p.type ? resolveTypeAnnotation(p.type, ctx) : TUnknown;
            lenv.define(p.name, pt);
            return pt;
        });
        const result = expr.result
            ? inferBlockExpr(expr.stmts, expr.result, lenv, ctx, report)
            : TUnknown;
        return { kind: 'function', params, result };
    }

    if (isListLiteral(expr)) {
        const items = expr.items ?? [];
        if (items.some((i) => !i)) return TUnknown;
        if (items.length === 0) return { kind: 'list', element: TUnknown };
        const elem = items
            .map((e) => infer(e, env, ctx, report))
            .reduce((acc, t) => joinBranches(acc, t, expr, report));
        return { kind: 'list', element: elem };
    }

    if (isRange(expr)) {
        if (!expr.from || !expr.to) return TUnknown;
        const fromT = infer(expr.from, env, ctx, report);
        infer(expr.to, env, ctx, report);
        if (expr.step) infer(expr.step, env, ctx, report);
        // Bereich ≡ Liste<Element> (SPEC § 3.11); Element = Typ der
        // unteren Grenze (numerisch oder Aufzählung).
        return { kind: 'list', element: fromT.kind === 'unknown' ? TUnknown : fromT };
    }

    if (isFuerExpr(expr)) {
        if (!expr.iter || !expr.source || !expr.body || !expr.body.result) return TUnknown;
        const srcT = infer(expr.source, env, ctx, report);
        let elemT: Type;
        if (srcT.kind === 'list') {
            elemT = srcT.element;
        } else if (srcT.kind === 'unknown') {
            elemT = TUnknown;
        } else {
            report(expr, `für jeden: Quelle ist keine Liste/kein Bereich `
                + `(Typ ${typeToString(srcT)}).`);
            elemT = TUnknown;
        }
        const bodyEnv = env.child();
        bodyEnv.define(expr.iter, elemT);
        // SPEC § 5.3: `für jeden` liefert die Liste der Body-Werte.
        return {
            kind: 'list',
            element: inferBlockExpr(expr.body.stmts, expr.body.result, bodyEnv, ctx, report),
        };
    }

    return TUnknown;
}

/**
 * Inferiert einen Block `{ (var|ausgabe)* ergebnis }` in der übergebenen
 * (bereits erzeugten) Kind-Env. Geteilt von param-losem Lambda,
 * Lambda-Closure-Rumpf und `für jeden`-Body.
 */
export function inferBlockExpr(
    stmts: ReadonlyArray<BlockStmt>,
    result: Expr,
    blockEnv: TypeEnv,
    ctx: TypeContext,
    report: Reporter,
): Type {
    for (const stmt of stmts) {
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
    return infer(result, blockEnv, ctx, report);
}

/**
 * Prüft die `${...}`-Slots eines String-Literals: jeder Slot muss eine
 * einfache CallChain-Form sein, der Wurzel-Identifier muss im Scope
 * existieren, und Field-Access-Schritte müssen gegen Record-Typen laufen.
 * Slot-Wert selbst darf jeden Skalar-Typ haben (Numeric, Bool, Text, Symbol,
 * Aufzählung, Nullable davon) — Records und Funktionen sind nicht
 * stringifizierbar.
 */
function checkStringInterpolationSlots(
    raw: string,
    node: AstNode,
    env: TypeEnv,
    report: Reporter,
): void {
    const { slots } = parseStringLiteral(raw);
    for (const slot of slots) {
        let path: string[];
        try {
            path = parseSlotPath(slot);
        } catch (err) {
            report(node, err instanceof InterpretError ? err.message : String(err));
            continue;
        }
        let t: Type | undefined = env.lookup(path[0]);
        if (t === undefined) {
            report(node, `Slot "${slot}": Unbekannter Identifier "${path[0]}".`);
            continue;
        }
        let bad = false;
        for (let i = 1; i < path.length; i++) {
            const unwrapped = t.kind === 'nullable' ? t.inner : t;
            if (unwrapped.kind !== 'record') {
                report(node, `Slot "${slot}": "${path.slice(0, i).join('.')}" `
                    + `ist ${typeToString(t)}, kein Datensatz.`);
                bad = true;
                break;
            }
            const field = unwrapped.decl.fields.find((f) => f.name === path[i]);
            if (!field) {
                report(node, `Slot "${slot}": Feld "${path[i]}" nicht in Datensatz `
                    + `${unwrapped.name}.`);
                bad = true;
                break;
            }
            // Wir können den Field-Typ ohne ctx nicht auflösen, daher
            // pragmatisch unknown. Strikteres Check folgt in einer
            // späteren Iteration mit propagiertem TypeContext.
            t = TUnknown;
        }
        if (bad) continue;
        // Slot-Endwert auf Druckbarkeit prüfen (nur wenn vollständig
        // aufgelöst — bei `unknown` tolerant durchlassen).
        if (t.kind === 'record') {
            report(node, `Slot "${slot}": Datensatz-Werte können nicht in Text `
                + `interpoliert werden — greife auf ein Feld zu.`);
        }
        if (t.kind === 'function') {
            report(node, `Slot "${slot}": Funktions-Werte können nicht in Text `
                + `interpoliert werden.`);
        }
    }
}

/**
 * Liefert den Wurzel-Identifier eines einfachen CallChain-Ausdrucks
 * (`x`, nicht `x.feld` oder `f(x)`). Wird für Smart-Cast benötigt — wir
 * verfeinern nur, wenn das Subjekt eine reine Variable ist, damit die
 * Verfeinerung sichtbar in der Environment ankommt.
 */
export function simpleSubjectName(expr: Expr): string | undefined {
    if (isCallChain(expr) && expr.name && expr.chain.length === 0) {
        return expr.name;
    }
    return undefined;
}

/**
 * Smart-Cast für `wenn (cond) then sonst`: erkennt Bedingungen der Form
 * `x ist nichts` bzw. `x ist nicht nichts` und liefert ein Env-Paar für
 * den then- und sonst-Zweig, in denen `x` entsprechend verfeinert ist.
 *
 * Bei jeder anderen Condition-Form wird das gleiche Env beidseitig genutzt
 * (keine Verfeinerung).
 */
export function refineEnvByCondition(cond: Expr, env: TypeEnv): [TypeEnv, TypeEnv] {
    if (!isNullCheck(cond)) return [env, env];
    const target = simpleSubjectName(cond.value);
    if (!target) return [env, env];
    const t = env.lookup(target);
    if (!t || t.kind !== 'nullable') return [env, env];

    const nonNull = t.inner;
    const thenEnv = env.child();
    const elseEnv = env.child();
    // `cond.negated === true` heißt `ist nicht nichts` → then = non-null
    if (cond.negated) {
        thenEnv.define(target, nonNull);
        elseEnv.define(target, TNichts);
    } else {
        // `x ist nichts` → then = nichts, else = non-null
        thenEnv.define(target, TNichts);
        elseEnv.define(target, nonNull);
    }
    return [thenEnv, elseEnv];
}

/**
 * Vollständigkeits-Analyse für `wähle (subject) { … }` mit Aufzählungs-
 * Subjekt: SPEC § 4.10.2 erlaubt das Weglassen des `sonst`-Arms nur, wenn
 * alle Aufzählungs-Werte durch `falls`-Patterns abgedeckt sind. Fehlende
 * Werte werden als Error gemeldet, damit Sachbearbeiter:innen nicht
 * versehentlich auf einen Laufzeit-Fehler stoßen.
 *
 * Bei Nullable-Subjekt (`T?`) wird zusätzlich `nichts` als impliziter
 * "Aufzählungs-Wert" gezählt, sofern der Subjekt-Typ eine Aufzählung wrappt.
 */
export function checkWaehleExhaustiveness(
    expr: { subject?: Expr; arms: ReadonlyArray<unknown> },
    env: TypeEnv, ctx: TypeContext, report: Reporter,
): void {
    if (!expr.subject) return;        // subjektlose Form: `sonst` ist ohnehin Pflicht
    const hasSonst = expr.arms.some((a) => isSonstArm(a));
    if (hasSonst) return;              // wenn `sonst` da: garantiert vollständig

    const subjectType = infer(expr.subject, env, ctx, report);
    const unwrapped = subjectType.kind === 'nullable' ? subjectType.inner : subjectType;
    if (unwrapped.kind !== 'enum') return;     // nur für Aufzählungs-Subjekte

    const allValues = new Set<string>(unwrapped.values);
    const needsNichts = subjectType.kind === 'nullable';

    let sawNichts = false;
    for (const arm of expr.arms) {
        if (!isFallArm(arm)) continue;
        for (const pat of arm.patterns) {
            if (isNullLiteral(pat)) { sawNichts = true; continue; }
            if (isCallChain(pat) && pat.name && pat.chain.length === 0) {
                allValues.delete(pat.name);
            }
        }
    }

    const missing: string[] = [...allValues];
    if (needsNichts && !sawNichts) missing.push('nichts');

    if (missing.length > 0) {
        report(expr.subject,
            `wähle ist nicht vollständig: ${missing.join(', ')} `
            + `${missing.length === 1 ? 'ist' : 'sind'} nicht abgedeckt. `
            + `Füge entweder die fehlenden falls-Arme oder einen sonst-Arm hinzu.`);
    }
}

function inferBinary(
    expr: { op: string; left: Expr; right: Expr },
    env: TypeEnv, ctx: TypeContext, report: Reporter,
): Type {
    const op = expr.op;
    if (op === 'und') {
        const l = infer(expr.left, env, ctx, report);
        const r = infer(expr.right, env, ctx, report);
        ensureWahrheit(expr.left,  l, report);
        ensureWahrheit(expr.right, r, report);
        return TWahrheit;
    }
    if (op === 'oder') {
        const l = infer(expr.left, env, ctx, report);
        if (l.kind === 'nullable') {
            // Bidirektional: rechter Operand erbt den Nicht-Null-Typ als
            // Erwartung, damit nackte Literale (`oder 0`) ihren Geld-Tag aus
            // dem Kontext bekommen.
            checkAgainstAnnotation(expr.right, l.inner, env, ctx, report);
            return l.inner;
        }
        const r = infer(expr.right, env, ctx, report);
        if (isWahrheit(l) && isWahrheit(r)) return TWahrheit;
        if (l.kind === 'unknown' || r.kind === 'unknown') return TUnknown;
        report(expr.left, `oder verlangt Wahrheitswert oder Nullable-Operand, erhalten ${typeToString(l)}.`);
        return TUnknown;
    }

    if (op === '==' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
        const l = infer(expr.left, env, ctx, report);
        const r = infer(expr.right, env, ctx, report);
        // Bidirektional (SPEC § 3.13): ein nacktes Zahl-Literal gegen
        // einen Geldwert verglichen übernimmt dessen Geldtyp — wie bei
        // Annotation/`oder`. Bewirkt korrekten Geld-Tag (und Inlay-Symbol).
        if (isGeld(l) && isNumberLiteral(expr.right)) {
            checkAgainstAnnotation(expr.right, l, env, ctx, report);
        } else if (isGeld(r) && isNumberLiteral(expr.left)) {
            checkAgainstAnnotation(expr.left, r, env, ctx, report);
        }
        if (l.kind === 'unknown' || r.kind === 'unknown') return TWahrheit;
        if (!comparable(l, r)) {
            report(expr as unknown as AstNode,
                `Vergleich nicht definiert: ${typeToString(l)} ${op} ${typeToString(r)}.`);
        }
        return TWahrheit;
    }

    // Arithmetik
    const lt = infer(expr.left, env, ctx, report);
    const rt = infer(expr.right, env, ctx, report);
    return arithResult(op, lt, rt, expr as unknown as AstNode, report);
}

function arithResult(op: string, lt: Type, rt: Type, node: AstNode, report: Reporter): Type {
    if (lt.kind === 'unknown' || rt.kind === 'unknown') return TUnknown;

    const l = lt.kind === 'primitive' ? lt.name : null;
    const r = rt.kind === 'primitive' ? rt.name : null;
    if (!l || !r) {
        report(node, `Arithmetik nur auf numerischen Typen: ${typeToString(lt)} ${op} ${typeToString(rt)}.`);
        return TUnknown;
    }

    const lIsGeld = isGeld(lt), rIsGeld = isGeld(rt);
    const both = `${l}|${r}`;

    if (op === '+' || op === '-') {
        // Text + Text → Text (Konkatenation, SPEC § 3.6, § 11.5).
        // Subtraktion auf Text bleibt ungültig.
        if (op === '+' && l === 'Text' && r === 'Text') return TText;
        if (lIsGeld && rIsGeld) {
            return GELD_PRECISION[l] >= GELD_PRECISION[r] ? lt : rt;     // präzisere Seite
        }
        if (l === 'Prozent' && r === 'Prozent') return TProzent;
        if (l === 'Prozent' || r === 'Prozent') {
            report(node, `Prozent ${op} ${l === 'Prozent' ? r : l} ist nicht erlaubt — Prozent kombiniert nur mit Prozent (siehe SPEC § 3.4).`);
            return TUnknown;
        }
        // Ganzzahl + Ganzzahl → Ganzzahl; gemischt → Dezimal
        if (l === 'Ganzzahl' && r === 'Ganzzahl') return TGanzzahl;
        if ((l === 'Ganzzahl' || l === 'Dezimal') && (r === 'Ganzzahl' || r === 'Dezimal')) return TDezimal;
        // Geld ± zahliges Literal — Geld-Seite dominiert (bidirektionale
        // Inferenz: das Literal nimmt den Geld-Tag aus dem Kontext der
        // anderen Seite an, gemäß SPEC § 3.13).
        if (lIsGeld && (r === 'Ganzzahl' || r === 'Dezimal')) return lt;
        if (rIsGeld && (l === 'Ganzzahl' || l === 'Dezimal')) return rt;
        report(node, `Arithmetik nicht definiert: ${l} ${op} ${r}.`);
        return TUnknown;
    }

    if (op === '*') {
        if (lIsGeld && rIsGeld) {
            report(node, `Geld * Geld ist verboten (SPEC § 3.2.3).`);
            return TUnknown;
        }
        if (lIsGeld && r === 'Ganzzahl')  return lt;
        if (rIsGeld && l === 'Ganzzahl')  return rt;
        if (lIsGeld && (r === 'Dezimal' || r === 'Prozent')) return TEuroCent;
        if (rIsGeld && (l === 'Dezimal' || l === 'Prozent')) return TEuroCent;
        if (l === 'Prozent' && r === 'Prozent') return TProzent;
        if (l === 'Prozent' && r === 'Ganzzahl') return TProzent;
        if (r === 'Prozent' && l === 'Ganzzahl') return TProzent;
        if (l === 'Prozent' || r === 'Prozent') {
            report(node, `Prozent * ${l === 'Prozent' ? r : l} ist nicht definiert.`);
            return TUnknown;
        }
        if (l === 'Ganzzahl' && r === 'Ganzzahl') return TGanzzahl;
        return TDezimal;
    }

    if (op === '/') {
        if (lIsGeld && rIsGeld) return TDezimal;
        if (lIsGeld && r === 'Ganzzahl') return TDezimal;      // SPEC § 3.2.3 Anmerkung
        if (l === 'Prozent' && r === 'Prozent') return TDezimal;
        if (l === 'Prozent' && r === 'Ganzzahl') return TProzent;
        if (l === 'Ganzzahl' && r === 'Ganzzahl') return TGanzzahl;
        if (l === 'Dezimal' || r === 'Dezimal') return TDezimal;
        if (rIsGeld) {
            report(node, `Division durch Geldtyp nur sinnvoll Geld/Geld; ${l} / ${r} ist nicht definiert.`);
            return TUnknown;
        }
        return TDezimal;
    }

    report(node, `Unbekannter Arithmetik-Operator: ${op} (${both}).`);
    return TUnknown;
}

function comparable(l: Type, r: Type): boolean {
    if (assignable(l, r) || assignable(r, l)) return true;
    if (isNumeric(l) && isNumeric(r)) return true;
    return false;
}

function joinBranches(a: Type, b: Type, _node: AstNode, _report: Reporter): Type {
    if (typeEq(a, b)) return a;
    if (a.kind === 'unknown') return b;
    if (b.kind === 'unknown') return a;
    // `never`-Zweig (z. B. `-> abbruch(...)`) trägt nichts zum Ergebnistyp
    // bei: der andere Zweig bestimmt den Typ (SPEC § 3.14).
    if (a.kind === 'never') return b;
    if (b.kind === 'never') return a;
    if (a.kind === 'nichts' && b.kind === 'nullable') return b;
    if (b.kind === 'nichts' && a.kind === 'nullable') return a;
    if (a.kind === 'nichts')   return TNull(b);
    if (b.kind === 'nichts')   return TNull(a);
    if (assignable(a, b)) return b;
    if (assignable(b, a)) return a;
    // Konflikt — wir melden hier nicht, weil der Check-Pfad das später
    // gegen den erwarteten Typ noch genauer macht.
    return TUnknown;
}

export function ensureWahrheit(node: AstNode, t: Type, report: Reporter): void {
    if (!isWahrheit(t) && t.kind !== 'unknown') {
        report(node, `Wahrheitswert erwartet, erhalten ${typeToString(t)}.`);
    }
}

export function inferCallChain(
    cc: { name?: string; chain: ReadonlyArray<AstNode & { $type: string }> },
    env: TypeEnv, ctx: TypeContext, report: Reporter,
    expected?: Type,
): Type {
    if (!cc.name) return TUnknown;
    let current = env.lookup(cc.name) ?? ctx.globals.lookup(cc.name);
    if (current === undefined) {
        // PascalCase-Namen als Symbol-Fallback (Aufzählungs-Wert) — der
        // Interpreter macht das gleiche. Hier melden wir keinen Fehler,
        // weil viele Beispieldateien diesen Fallback nutzen.
        if (/^[A-Z]/.test(cc.name)) {
            const ev = ctx.enumValues.get(cc.name);
            if (ev === undefined && cc.chain.length > 0 && isCall(cc.chain[0])) {
                // Unbekannter PascalCase-Name als AUFRUFZIEL (z. B. eine
                // Datensatz-Konstruktor- oder Funktions-Anwendung): das
                // ist KEIN Aufzählungs-Wert (die werden nie aufgerufen)
                // → echter Fehler. Weder lokale Deklaration, noch
                // `verwende`-Import, noch Builtin. Spiegelt den
                // Laufzeitfehler „Aufrufziel ist nicht aufrufbar".
                report(cc as unknown as AstNode,
                    `Aufrufziel "${cc.name}" ist nicht definiert oder nicht `
                    + `importiert (weder lokale Deklaration noch `
                    + `\`verwende\`-Import noch Builtin).`);
            }
            current = ev ?? TUnknown;
        } else {
            report(cc as unknown as AstNode, `Unbekannter Identifier: "${cc.name}".`);
            return TUnknown;
        }
    }

    return walkChain(current, cc.chain, cc as unknown as AstNode, env, ctx, report, expected);
}

/**
 * Geklammerter Ausdruck mit Postfix-Kette (`(a * b).abrunden()`). Der
 * Empfänger ist ein beliebiger Ausdruck statt eines Namens; der
 * Ketten-Walker ist identisch zu `inferCallChain` (eine Ketten-Logik,
 * SPEC `paren_expr`). Teil-Parse: fehlender `receiver` → `unknown`.
 */
export function inferParenChain(
    pc: { receiver?: Expr; chain: ReadonlyArray<AstNode & { $type: string }> },
    env: TypeEnv, ctx: TypeContext, report: Reporter,
    expected?: Type,
): Type {
    if (!pc.receiver) return TUnknown;
    const start = infer(pc.receiver, env, ctx, report);
    return walkChain(start, pc.chain, pc as unknown as AstNode, env, ctx, report, expected);
}

/**
 * Gemeinsamer Ketten-Walker für `CallChain` (Namens-Empfänger) und
 * `ParenChain` (geklammerter Ausdruck als Empfänger). `start` ist der
 * Typ des Empfängers; `node` dient nur der Diagnose-Verortung beim
 * Aufruf-Glied.
 */
function walkChain(
    start: Type,
    chain: ReadonlyArray<AstNode & { $type: string }>,
    node: AstNode,
    env: TypeEnv, ctx: TypeContext, report: Reporter,
    expected?: Type,
): Type {
    let current = start;
    for (let k = 0; k < chain.length; k++) {
        const op = chain[k];

        // Listen-/Bereich-Methoden (SPEC § 11.2): nur wenn der Empfänger
        // eine Liste ist — Record-/Enum-/unknown-Basen laufen unverändert
        // durch die bestehenden Zweige. Call-Methoden konsumieren das
        // unmittelbar folgende Call-Kettenglied.
        if (current.kind === 'list' && isFieldAccess(op) && op.name) {
            const next = chain[k + 1];
            // Trailing-Lambda-Syntax (`xs.zuordnen { k -> body }`) ist
            // semantisch identisch zu `xs.zuordnen({ k -> body })` und
            // muss vom Type-Checker als Lambda-Argument behandelt werden,
            // damit der Lambda-Param den Element-Typ erbt (bidirektionale
            // Inferenz via `checkAgainstAnnotation`). Analog zum Lower-
            // Pfad (`codegen/lower/lower.ts`).
            // `op` ist nach `isFieldAccess(op)` schon FieldAccess →
            // `trailingLambda?: Lambda` ohne Cast. Das synthetische
            // CallOp erfüllt strukturell die `ListMethodCallOp`-Form
            // (siehe Signatur in findsl-method-inference.ts) — kein
            // `as unknown as`-Lie nötig.
            const trailing = op.trailingLambda;
            const callOp: ListMethodCallOp | undefined = next && isCall(next)
                ? next
                : trailing !== undefined
                    ? { args: [{ value: trailing }] }
                    : undefined;
            const r = listMethod(current.element, op.name, callOp, env, ctx, report);
            if (r === undefined) {
                report(op,
                    `Liste hat keine Methode "${op.name}" (SPEC § 11.2).`);
                current = TUnknown;
            } else {
                current = r.type;
                // `consumedCall` bezieht sich nur auf das nächste reale
                // `Call`-Chain-Glied; das synthetische Trailing-Call-
                // Objekt verbraucht KEIN Chain-Glied.
                if (r.consumedCall && next && isCall(next)) k++;
            }
            continue;
        }

        // Skalar-Rundungs-Methoden (SPEC § 11.1): `.abrunden()`/
        // `.aufrunden()` auf primitivem Empfänger. EuroCent → Ziel
        // Euro/Cent aus `expected` (nur wenn diese Methode das LETZTE
        // wertgebende Kettenglied ist — sonst ist der Kontext nicht der
        // der Rundung). Dezimal → immer Ganzzahl. Sonstige Primitive →
        // Empfänger-Fehler. Record-/Listen-Felder namens „abrunden"
        // bleiben unberührt (nur `current.kind === 'primitive'`).
        if (current.kind === 'primitive' && isFieldAccess(op)
            && (op.name === 'abrunden' || op.name === 'aufrunden')) {
            const next = chain[k + 1];
            const callOp = next && isCall(next) ? next : undefined;
            const afterIdx = callOp ? k + 2 : k + 1;
            const isTerminal = afterIdx >= chain.length;
            current = scalarRoundingMethod(
                current, op.name, isTerminal ? expected : undefined,
                op, report,
            );
            if (callOp) k++;                      // folgendes () konsumieren
            continue;
        }

        // Grenzwert-/Stufen-Methoden (SPEC § 11.6): `.höchstens`/`.mindestens`
        // (Min/Max) und `.abrundenAuf`/`.aufrundenAuf` (Rundung auf ein
        // Vielfaches) auf numerischem Empfänger. Typ-erhaltend, kontextfrei.
        // Vor dem Text-Zweig, damit `.höchstens` auf Text die präzise
        // Empfänger-Diagnose („nur auf numerischen Typen") bekommt statt
        // „Text hat keine Methode". Record-/Listen-Felder bleiben unberührt
        // (nur `current.kind === 'primitive'`).
        if (current.kind === 'primitive' && isFieldAccess(op) && op.name
            && SCALAR_ARG_METHODS.has(op.name)) {
            const next = chain[k + 1];
            const callOp = next && isCall(next) ? next : undefined;
            const r = scalarArgMethod(
                current, op.name, callOp, op, env, ctx, report);
            current = r.type;
            if (r.consumedCall && next && isCall(next)) k++;
            continue;
        }

        // Text-Methoden (SPEC § 11.5). Nach der Skalar-Rundung, damit
        // `.abrunden` auf Text die präzise Empfänger-Diagnose bekommt
        // (nicht „Text hat keine Methode abrunden").
        if (current.kind === 'primitive' && current.name === 'Text'
            && isFieldAccess(op) && op.name) {
            const next = chain[k + 1];
            const callOp = next && isCall(next) ? next : undefined;
            const r = textMethod(op.name, callOp, op, env, ctx, report);
            if (r === undefined) {
                report(op,
                    `Text hat keine Methode "${op.name}" (SPEC § 11.5).`);
                current = TUnknown;
            } else {
                current = r.type;
                if (r.consumedCall) k++;
            }
            continue;
        }

        if (isCall(op)) {
            current = applyCall(current, op.args, env, ctx, report, node);
        } else if (isIndex(op)) {
            if (op.index) checkAgainstAnnotation(op.index, TGanzzahl, env, ctx, report);
            if (current.kind === 'list') {
                current = current.element;
            } else if (current.kind !== 'unknown') {
                report(op,
                    `Index-Zugriff "[…]" auf nicht-Liste (Typ ${typeToString(current)}).`);
                current = TUnknown;
            }
        } else if (isFieldAccess(op)) {
            current = accessField(current, op.name, op, ctx, report);
        } else if (isSafeFieldAccess(op)) {
            // T?.feld → fieldType?
            if (current.kind === 'nullable') {
                const inner = accessField(current.inner, op.name, op, ctx, report);
                current = TNull(inner);
            } else if (current.kind === 'unknown') {
                current = TUnknown;
            } else {
                report(op, `Sicher-Zugriff "?." verlangt Nullable-Operanden, erhalten ${typeToString(current)}.`);
                current = TUnknown;
            }
        } else if (isForceUnwrap(op)) {
            if (current.kind === 'nullable') {
                current = current.inner;
            } else if (current.kind !== 'unknown') {
                report(op, `Force-Unwrap "!!" verlangt Nullable-Operanden, erhalten ${typeToString(current)}.`);
            }
        }
    }
    return current;
}

function applyCall(
    callee: Type, args: ReadonlyArray<CallArg>,
    env: TypeEnv, ctx: TypeContext, report: Reporter, node: AstNode,
): Type {
    if (callee.kind === 'unknown') return TUnknown;
    if (callee.kind !== 'function') {
        report(node, `Aufrufziel ist nicht aufrufbar (Typ ${typeToString(callee)}).`);
        return TUnknown;
    }

    // Wenn paramNames bekannt: strikt mappen (named und positional), sonst
    // tolerant nur positional.
    const namedMap = new Map<string, number>();
    if (callee.paramNames) {
        for (let i = 0; i < callee.paramNames.length; i++) {
            namedMap.set(callee.paramNames[i], i);
        }
    }

    const bound = new Set<number>();        // Param-Indices, die schon ein Argument haben
    let posIdx = 0;
    for (const arg of args) {
        let expected: Type;
        let paramIdx: number;
        if (arg.name) {
            if (!callee.paramNames) {
                expected = TUnknown;
                paramIdx = -1;
            } else {
                const idx = namedMap.get(arg.name);
                if (idx === undefined) {
                    const known = callee.paramNames.join(', ');
                    report(arg,
                        `Unbekanntes benanntes Argument "${arg.name}" `
                        + `(erwartet eines von: ${known}).`);
                    expected = TUnknown;
                    paramIdx = -1;
                } else if (bound.has(idx)) {
                    report(arg,
                        `Argument "${arg.name}" wurde bereits übergeben.`);
                    expected = TUnknown;
                    paramIdx = -1;
                } else {
                    expected = callee.params[idx] ?? TUnknown;
                    paramIdx = idx;
                }
            }
        } else {
            // Positional: nächster noch nicht gebundener Slot.
            while (bound.has(posIdx)) posIdx++;
            expected = callee.params[posIdx] ?? TUnknown;
            paramIdx = posIdx;
            posIdx++;
        }
        if (paramIdx >= 0) bound.add(paramIdx);
        if (expected.kind !== 'unknown') {
            checkAgainstAnnotation(arg.value, expected, env, ctx, report);
        } else {
            infer(arg.value, env, ctx, report);
        }
    }

    // Fehlende Pflicht-Argumente (Param ohne Default, das nicht gebunden ist)
    if (callee.paramNames && callee.paramHasDefault) {
        for (let i = 0; i < callee.paramNames.length; i++) {
            if (!bound.has(i) && !callee.paramHasDefault[i]) {
                report(node,
                    `Fehlendes Pflicht-Argument "${callee.paramNames[i]}" `
                    + `(Typ ${typeToString(callee.params[i])}).`);
            }
        }
        // Zu viele positionale Argumente
        if (posIdx > callee.paramNames.length) {
            report(node,
                `Zu viele positionale Argumente: erwartet maximal `
                + `${callee.paramNames.length}, erhalten ${args.length}.`);
        }
    }
    return callee.result;
}

function accessField(base: Type, name: string | undefined, node: AstNode, ctx: TypeContext, report: Reporter): Type {
    if (!name)               return TUnknown;
    if (base.kind === 'unknown') return TUnknown;
    if (base.kind !== 'record') {
        report(node, `Feldzugriff "${name}" auf nicht-Datensatz (Typ ${typeToString(base)}).`);
        return TUnknown;
    }
    const field = base.decl.fields.find((f) => f.name === name);
    if (!field) {
        report(node, `Feld "${name}" existiert nicht in Datensatz ${base.name}.`);
        return TUnknown;
    }
    return resolveTypeAnnotation(field.type, ctx);
}

function checkCastLegal(from: Type, to: Type, node: AstNode, report: Reporter): void {
    if (from.kind === 'unknown' || to.kind === 'unknown') return;
    if (typeEq(from, to)) return;
    // erlaubt: numerisch ↔ numerisch
    if (isNumeric(from) && isNumeric(to)) {
        if (isGeld(from) && isGeld(to)
            && GELD_PRECISION[(from as PrimitiveType).name] > GELD_PRECISION[(to as PrimitiveType).name]) {
            report(node, `Cast in niedrigere Geld-Präzision (${typeToString(from)} → ${typeToString(to)}) `
                + `ist nicht erlaubt — explizit runden mit abrundenEuro/aufrundenEuro/abrundenCent.`);
        }
        return;
    }
    report(node, `Cast nicht definiert: ${typeToString(from)} als ${typeToString(to)}.`);
}
