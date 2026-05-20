/**
 * Typ-Repräsentation und bidirektionale Inferenz für FinDSL.
 *
 * Die Datenstruktur folgt SPEC § 3 und deckt im Skelett alles ab, was die
 * drei Beispieldateien verwenden: primitive Skalare, Geldtypen mit
 * Präzisions-Hierarchie, Prozent, Wahrheit, Text, Nullable T?, Datensätze,
 * Aufzählungen, Funktionstypen.
 *
 * Bidirektionale Inferenz (§ 3.13):
 *   - `infer(expr, env)` läuft bottom-up und liefert den natürlichen Typ
 *     eines Ausdrucks.
 *   - `check(expr, expected, env)` läuft top-down und propagiert den
 *     erwarteten Typ in Sub-Ausdrücke, damit nackte Number-Literale ihren
 *     Geld-Typ aus dem Kontext bekommen.
 *
 * Der Type-Checker hängt als zusätzlicher Validator-Layer ein. Findet er
 * einen Typkonflikt, ruft er die `report`-Callback mit (node, message);
 * der Aufrufer (z. B. `findsl-validator.ts`) übersetzt das in eine
 * Langium-Diagnose.
 */

import type { AstNode } from 'langium';
import { parseSlotPath, parseStringLiteral } from '../interpret/values.js';
import { InterpretError } from '../interpret/values.js';
import { BUILTIN_ENUM_DEFS, BUILTIN_FUNCTION_DEFS } from './findsl-stdlib.js';
import { collectImportBindings } from './import-path.js';
import {
    isAbbruchExpr,
    isAufzaehlungDecl,
    isBinaryOp,
    isBoolLiteral,
    isCall,
    isCallChain,
    isCast,
    isDatensatzDecl,
    isFallArm,
    isFieldAccess,
    isForceUnwrap,
    isFuerExpr,
    isFunktionDecl,
    isIndex,
    isKonstDecl,
    isAusgabeStmt,
    isLambda,
    isLetStmt,
    isListLiteral,
    isNullCheck,
    isNullLiteral,
    isNumberLiteral,
    isParenChain,
    isPruefeDecl,
    isRange,
    isSafeFieldAccess,
    isSonstArm,
    isStringLiteral,
    isUnaryOp,
    isWaehleExpr,
    isWennExpr,
    type BlockStmt,
    type CallArg,
    type DatensatzDecl,
    type Expr,
    type FunktionBody,
    type FunktionDecl,
    type KonstDecl,
    type Program,
    type Type as TypeAnnotation,
    type TypeAtom,
} from './generated/ast.js';

// ---------------------------------------------------------------------------
// Typ-Datenstruktur
// ---------------------------------------------------------------------------

export type Type =
    | PrimitiveType
    | NullableType
    | RecordType
    | EnumType
    | ListType
    | FunctionType
    | UnknownType
    | NichtsType
    | NeverType;

export type PrimitiveName =
    | 'Wahrheit'
    | 'Wahrheitswert'
    | 'Text'
    | 'Ganzzahl'
    | 'Dezimal'
    | 'Prozent'
    | 'Euro'
    | 'Cent'
    | 'EuroCent';

export interface PrimitiveType { readonly kind: 'primitive';   readonly name: PrimitiveName; }
export interface NullableType  { readonly kind: 'nullable';    readonly inner: Type; }
export interface RecordType    { readonly kind: 'record';      readonly name: string; readonly decl: DatensatzDecl; }
export interface EnumType      { readonly kind: 'enum';        readonly name: string; readonly values: ReadonlyArray<string>; }
export interface ListType      { readonly kind: 'list';        readonly element: Type; }
export interface FunctionType  {
    readonly kind: 'function';
    readonly params: ReadonlyArray<Type>;
    /** Bei benannten Quellen (FunktionDecl, DatensatzDecl-Konstruktor) liegen
     *  die Param-Namen positionsgleich vor. Anonyme Funktionstypen
     *  (`(Euro) -> Euro`) haben kein paramNames-Feld. */
    readonly paramNames?: ReadonlyArray<string>;
    /** Für jeden Parameter: hat er einen Default-Wert? Bestimmt, ob ein
     *  Argument weggelassen werden darf. Positionsgleich mit `params`. */
    readonly paramHasDefault?: ReadonlyArray<boolean>;
    readonly result: Type;
}
/** `unknown` ist der Fallback bei Inferenz-Fehlern — vermeidet Folge-Diagnosen. */
export interface UnknownType   { readonly kind: 'unknown'; }
/** Typ von `nichts` — zuweisungskompatibel mit jedem Nullable T?. */
export interface NichtsType    { readonly kind: 'nichts'; }
/**
 * Bottom-Typ (SPEC § 3.14): Typ eines Ausdrucks, der nie normal zu einem
 * Wert auswertet, sondern den Lauf terminiert. Einziger Erzeuger:
 * `abbruch` (§ 4.19). Subtyp von ALLEM, Supertyp von NICHTS — beim
 * Vereinen von Zweigtypen wird `never` übersprungen. Nicht schreibbar
 * (keine `: never`-Annotation), entsteht nur durch Inferenz.
 */
export interface NeverType     { readonly kind: 'never'; }

// Konstruktoren
export const TUnknown: UnknownType = { kind: 'unknown' };
export const TNichts:  NichtsType  = { kind: 'nichts' };
export const TNever:   NeverType   = { kind: 'never' };
export const TPrim = (name: PrimitiveName): PrimitiveType => ({ kind: 'primitive', name });
export const TNull = (inner: Type): NullableType => inner.kind === 'nullable'
    ? inner                                         // T?? ≡ T?
    : { kind: 'nullable', inner };

// Häufig verwendet
export const TWahrheit = TPrim('Wahrheitswert');
export const TText     = TPrim('Text');
export const TGanzzahl = TPrim('Ganzzahl');
export const TDezimal  = TPrim('Dezimal');
export const TProzent  = TPrim('Prozent');
export const TEuro     = TPrim('Euro');
export const TCent     = TPrim('Cent');
export const TEuroCent = TPrim('EuroCent');

const GELD_NAMES: ReadonlyArray<PrimitiveName> = ['Euro', 'EuroCent', 'Cent'];
const GELD_PRECISION: Record<string, number> = { Euro: 0, EuroCent: 1, Cent: 2 };

export function isGeld(t: Type): boolean {
    return t.kind === 'primitive' && (GELD_NAMES as ReadonlyArray<string>).includes(t.name);
}
export function isWahrheit(t: Type): boolean {
    return t.kind === 'primitive' && (t.name === 'Wahrheitswert' || t.name === 'Wahrheit');
}
export function isNumeric(t: Type): boolean {
    return t.kind === 'primitive' && (
        t.name === 'Ganzzahl' || t.name === 'Dezimal' || t.name === 'Prozent' || isGeld(t)
    );
}

export function typeToString(t: Type): string {
    switch (t.kind) {
        case 'primitive': return t.name;
        case 'nullable':  return `${typeToString(t.inner)}?`;
        case 'record':    return t.name;
        case 'enum':      return t.name;
        case 'list':      return `Liste<${typeToString(t.element)}>`;
        case 'function':  return `(${t.params.map(typeToString).join(', ')}) -> ${typeToString(t.result)}`;
        case 'unknown':   return '?';
        case 'nichts':    return 'nichts';
        case 'never':     return 'never';
    }
}

export function typeEq(a: Type, b: Type): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
        case 'primitive': return (b as PrimitiveType).name === a.name
            || (isWahrheit(a) && isWahrheit(b));        // Wahrheit ≡ Wahrheitswert
        case 'nullable':  return typeEq(a.inner, (b as NullableType).inner);
        case 'record':    return (b as RecordType).name === a.name;
        case 'enum':      return (b as EnumType).name === a.name;
        case 'list':      return typeEq(a.element, (b as ListType).element);
        case 'function': {
            const fb = b as FunctionType;
            if (fb.params.length !== a.params.length) return false;
            if (!typeEq(a.result, fb.result)) return false;
            return a.params.every((p, i) => typeEq(p, fb.params[i]));
        }
        case 'unknown':
        case 'nichts':
        case 'never':     return true;
    }
}

/**
 * `from` ist zuweisungs-kompatibel mit `to`. Folgt SPEC § 3.2.2 (implizite
 * Geld-Promotion in Richtung höherer Präzision) und § 3.9 (T <: T?).
 */
export function assignable(from: Type, to: Type): boolean {
    if (from.kind === 'unknown' || to.kind === 'unknown') return true;
    // Bottom-Typ: `never` ist Subtyp von allem (SPEC § 3.14). Umgekehrt ist
    // nichts ausser `never` selbst zu `never` zuweisbar (typeEq deckt das).
    if (from.kind === 'never') return true;
    if (typeEq(from, to)) return true;

    // `nichts` passt in jedes Nullable.
    if (from.kind === 'nichts' && to.kind === 'nullable') return true;

    // T <: T?
    if (to.kind === 'nullable' && assignable(from, to.inner)) return true;

    // Geld-Präzision: Euro → EuroCent → Cent
    if (from.kind === 'primitive' && to.kind === 'primitive' && isGeld(from) && isGeld(to)) {
        return GELD_PRECISION[from.name] <= GELD_PRECISION[to.name];
    }

    return false;
}

// ---------------------------------------------------------------------------
// Type-Environment + Resolver für Type-Annotationen
// ---------------------------------------------------------------------------

export interface TypeBinding {
    readonly type: Type;
    /** Bei `unknown` (z. B. ungeprüfte Importe) wird der Konsument tolerant. */
}

export class TypeEnv {
    private readonly bindings = new Map<string, Type>();
    constructor(readonly parent: TypeEnv | null = null) {}

    define(name: string, type: Type): void { this.bindings.set(name, type); }
    lookup(name: string): Type | undefined {
        return this.bindings.get(name) ?? this.parent?.lookup(name);
    }
    child(): TypeEnv { return new TypeEnv(this); }
}

/**
 * Eingebaute Aufzählungen gemäß SPEC § 3.7 — gemappt aus der kanonischen
 * `builtins.json` (via findsl-stdlib). Werden in jeden Modul-Scope
 * eingespielt, bevor die TopDecls verarbeitet werden.
 */
export const BUILTIN_ENUMS: ReadonlyArray<EnumType> = BUILTIN_ENUM_DEFS.map(
    (e) => ({ kind: 'enum', name: e.name, values: [...e.values] }),
);

/**
 * Eingebaute Funktionen (Rundungen). Param-Typ ist `unknown` (mehrere
 * Eingangstypen erlaubt); Rückgabetyp aus dem `result`-Feld der kanonischen
 * Quelle.
 */
const BUILTIN_FUNCTIONS: ReadonlyArray<{ name: string; result: Type }> =
    BUILTIN_FUNCTION_DEFS.map((f) => ({
        name: f.name,
        result: TPrim(f.result as PrimitiveName),
    }));

export interface TypeContext {
    /** Typ pro Top-Level-Name (Konstanten, Funktionen, Datensätze, Aufzählungen). */
    readonly globals: TypeEnv;
    /** Datensatz-Decls per Name — nötig für Field-Zugriff in `infer`. */
    readonly records: ReadonlyMap<string, DatensatzDecl>;
    /** Aufzählungen per Name — inkl. Builtin-Set, plus alle deklarierten. */
    readonly enums:   ReadonlyMap<string, EnumType>;
    /** Aufzählungs-Werte → ihr Aufzählungs-Typ, für `Grundtarif` etc. */
    readonly enumValues: ReadonlyMap<string, EnumType>;
    /**
     * Optionaler Tooling-Observer: wird mit jedem Ausdrucks-Knoten und
     * seinem EFFEKTIVEN Typ aufgerufen (kontextuell aus
     * `checkAgainstAnnotation`, sonst aus `infer`). Nur für `collectExpressionTypes`
     * (Inlay-Hints) — der Validator setzt ihn NICHT.
     */
    recordType?: (node: AstNode, type: Type) => void;
}

/**
 * Beim Editieren liefert der fehlertolerante Parser unvollständige ASTs:
 * eine Pflicht-Annotation (`type=Type`) kann `undefined` sein, ebenso ihr
 * `atom`. Wir behandeln das als `unknown` (etablierter toleranter
 * Fallback) statt zu crashen — sonst stirbt der gesamte Validierungslauf.
 */
export function resolveTypeAnnotation(
    t: TypeAnnotation | undefined, ctx: TypeContext,
): Type {
    if (!t || !t.atom) return TUnknown;
    const inner = resolveTypeAtom(t.atom, ctx);
    return t.optional ? TNull(inner) : inner;
}

function resolveTypeAtom(atom: TypeAtom, ctx: TypeContext): Type {
    if (atom.$type === 'NamedType') {
        const name = atom.name;
        // Primitives
        switch (name) {
            case 'Wahrheit':
            case 'Wahrheitswert':
            case 'Text':
            case 'Ganzzahl':
            case 'Dezimal':
            case 'Prozent':
            case 'Euro':
            case 'Cent':
            case 'EuroCent':
                return TPrim(name);
        }
        // Listen + Bereiche mit TypeArgs. `Bereich<T>` ist laut SPEC § 3.11
        // Liste-kompatibel (alle Listen-Methoden gelten auch auf Bereichen);
        // wir modellieren ihn als `ListType` — das hält Zuweisbarkeit und
        // Methoden-Dispatch uniform und spiegelt die Interpreter-Entscheidung
        // (Bereich → materialisierte Liste).
        if ((name === 'Liste' || name === 'Bereich')
            && atom.typeArgs && atom.typeArgs.args.length === 1) {
            return { kind: 'list', element: resolveTypeAnnotation(atom.typeArgs.args[0], ctx) };
        }
        // Aufzählung
        const enumType = ctx.enums.get(name);
        if (enumType) return enumType;
        // Datensatz
        const recordDecl = ctx.records.get(name);
        if (recordDecl) return { kind: 'record', name, decl: recordDecl };
        // Unbekannt — toleranter Fallback
        return TUnknown;
    }
    // Funktions-Typ (T1, T2) -> R — paramTypes/returnType können im
    // Teil-Parse fehlen.
    const params = (atom.paramTypes ?? []).map((p) => resolveTypeAnnotation(p, ctx));
    const result = atom.returnType ? resolveTypeAnnotation(atom.returnType, ctx) : TUnknown;
    return { kind: 'function', params, result };
}

// ---------------------------------------------------------------------------
// Programm-Kontext aufbauen
// ---------------------------------------------------------------------------

export function buildContext(program: Program): TypeContext {
    const records = new Map<string, DatensatzDecl>();
    const enums   = new Map<string, EnumType>();
    const enumValues = new Map<string, EnumType>();

    for (const e of BUILTIN_ENUMS) {
        enums.set(e.name, e);
        for (const v of e.values) enumValues.set(v, e);
    }

    for (const decl of program.decls) {
        if (isDatensatzDecl(decl)) {
            records.set(decl.name, decl);
        } else if (isAufzaehlungDecl(decl)) {
            const e: EnumType = { kind: 'enum', name: decl.name, values: [...decl.values] };
            enums.set(e.name, e);
            for (const v of e.values) enumValues.set(v, e);
        }
    }

    const globals = new TypeEnv();
    // Builtin-Funktionen registrieren (Rundungen)
    for (const b of BUILTIN_FUNCTIONS) {
        globals.define(b.name, { kind: 'function', params: [TUnknown], result: b.result });
    }
    // Datensätze als Konstruktor-Funktionstypen registrieren — mit Field-
    // Namen als Param-Namen, damit benannte Konstruktor-Argumente strikt
    // typgeprüft werden können.
    for (const [name, decl] of records) {
        const ctx: TypeContext = { globals, records, enums, enumValues };
        const params = decl.fields.map((f) => resolveTypeAnnotation(f.type, ctx));
        const paramNames = decl.fields.map((f) => f.name);
        const paramHasDefault = decl.fields.map((f) => !!f.default);
        const result: RecordType = { kind: 'record', name, decl };
        globals.define(name, { kind: 'function', params, paramNames, paramHasDefault, result });
    }
    // Aufzählungs-Werte als globale Bindings
    for (const [valueName, enumType] of enumValues) {
        if (!globals.lookup(valueName)) globals.define(valueName, enumType);
    }
    return { globals, records, enums, enumValues };
}

// ---------------------------------------------------------------------------
// Bidirektionale Inferenz
// ---------------------------------------------------------------------------

export type Reporter = (node: AstNode, message: string) => void;

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
                    armEnv.define(refineName, (subjectType as NullableType).inner);
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
function inferBlockExpr(
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
function simpleSubjectName(expr: Expr): string | undefined {
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
function refineEnvByCondition(cond: Expr, env: TypeEnv): [TypeEnv, TypeEnv] {
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
function checkWaehleExhaustiveness(
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

function ensureWahrheit(node: AstNode, t: Type, report: Reporter): void {
    if (!isWahrheit(t) && t.kind !== 'unknown') {
        report(node, `Wahrheitswert erwartet, erhalten ${typeToString(t)}.`);
    }
}

function inferCallChain(
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
function inferParenChain(
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
            const trailing = (op as { trailingLambda?: AstNode }).trailingLambda;
            const callOp = next && isCall(next)
                ? next
                : trailing !== undefined
                    ? ({ args: [{ value: trailing }] } as unknown as { args: ReadonlyArray<CallArg> })
                    : undefined;
            const r = listMethod(current.element, op.name, callOp, env, ctx, report);
            if (r === undefined) {
                report(op as unknown as AstNode,
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
                op as unknown as AstNode, report,
            );
            if (callOp) k++;                      // folgendes () konsumieren
            continue;
        }

        // Text-Methoden (SPEC § 11.5). Nach der Skalar-Rundung, damit
        // `.abrunden` auf Text die präzise Empfänger-Diagnose bekommt
        // (nicht „Text hat keine Methode abrunden").
        if (current.kind === 'primitive' && current.name === 'Text'
            && isFieldAccess(op) && op.name) {
            const next = chain[k + 1];
            const callOp = next && isCall(next) ? next : undefined;
            const r = textMethod(op.name, callOp, op as unknown as AstNode, env, ctx, report);
            if (r === undefined) {
                report(op as unknown as AstNode,
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
                report(op as unknown as AstNode,
                    `Index-Zugriff "[…]" auf nicht-Liste (Typ ${typeToString(current)}).`);
                current = TUnknown;
            }
        } else if (isFieldAccess(op)) {
            current = accessField(current, op.name, op as unknown as AstNode, ctx, report);
        } else if (isSafeFieldAccess(op)) {
            // T?.feld → fieldType?
            if (current.kind === 'nullable') {
                const inner = accessField(current.inner, op.name, op as unknown as AstNode, ctx, report);
                current = TNull(inner);
            } else if (current.kind === 'unknown') {
                current = TUnknown;
            } else {
                report(op as unknown as AstNode, `Sicher-Zugriff "?." verlangt Nullable-Operanden, erhalten ${typeToString(current)}.`);
                current = TUnknown;
            }
        } else if (isForceUnwrap(op)) {
            if (current.kind === 'nullable') {
                current = current.inner;
            } else if (current.kind !== 'unknown') {
                report(op as unknown as AstNode, `Force-Unwrap "!!" verlangt Nullable-Operanden, erhalten ${typeToString(current)}.`);
            }
        }
    }
    return current;
}

/**
 * Typ-Substitution für die Listen-Methoden aus SPEC § 11.2 — bewusst ein
 * Spezialfall (Element-Typ T, U/A aus Lambda-Inferenz), KEINE allgemeine
 * Generics-Engine (YAGNI). `callOp` ist das folgende `(...)`-Kettenglied
 * (für Argument-Methoden); `consumedCall` signalisiert dem Aufrufer, es
 * zu überspringen. `undefined` ⇒ unbekannte Methode.
 */
function listMethod(
    elem: Type,
    name: string,
    callOp: { args: ReadonlyArray<CallArg> } | undefined,
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
function scalarRoundingMethod(
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

/** Euro/Cent aus dem erwarteten Typ als Rundungsziel; sonst `undefined`. */
function roundingTarget(expected: Type | undefined): Type | undefined {
    if (!expected) return undefined;
    const e = unwrapNullable(expected);
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
function textMethod(
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
                    report(arg as unknown as AstNode,
                        `Unbekanntes benanntes Argument "${arg.name}" `
                        + `(erwartet eines von: ${known}).`);
                    expected = TUnknown;
                    paramIdx = -1;
                } else if (bound.has(idx)) {
                    report(arg as unknown as AstNode,
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

// ---------------------------------------------------------------------------
// Check-Pfad (bidirektional)
// ---------------------------------------------------------------------------

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
                    armEnv.define(refineName, (subjectType as NullableType).inner);
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

function unwrapNullable(t: Type): Type {
    return t.kind === 'nullable' ? t.inner : t;
}

// ---------------------------------------------------------------------------
// Top-Level: ganzes Programm typchecken
// ---------------------------------------------------------------------------

/**
 * Cross-Module-Auflöser: liefert für ein importiertes Symbol seinen Typ
 * aus dem Quell-Modul oder `undefined`, wenn das Symbol oder das Modul
 * fehlt. Implementierung lebt in `findsl-scope.ts`; um zyklische Imports
 * zu vermeiden, akzeptieren wir hier nur ein schlankes Interface.
 */
export interface ImportResolver {
    /** Liefert den Typ des Symbols `sourceName` in der Datei mit
     *  Registry-Schlüssel `sourceKey` (absoluter Pfad) — `rawSource` ist
     *  der relative Pfad-String für Diagnose-Texte. Ruft `report` bei
     *  „Symbol nicht exportiert" und liefert `unknown`. Datei fehlt →
     *  tolerant `unknown` (kein Report). */
    resolve(
        sourceKey: string | undefined,
        sourceName: string,
        rawSource: string,
        node: AstNode,
        report: Reporter,
    ): Type;
}

export interface TypeCheckOptions {
    readonly importResolver?: ImportResolver;
    /**
     * Tooling-Observer (Inlay-Hints). Gesetzt → zusätzlich werden
     * `prüfe`/`testfall`-Ausdrücke inferiert (sonst nie typgeprüft) und
     * jeder Ausdruckstyp gemeldet. Der Validator setzt das NICHT →
     * Diagnose-Verhalten unverändert.
     */
    readonly recordType?: (node: AstNode, type: Type) => void;
}

/**
 * Wertet alle Top-Decls eines Programms typsemantisch aus. Ohne
 * `importResolver` werden Importe tolerant als `unknown` gebunden — der
 * Single-Module-Modus, der vom Validator (VS-Code-Live-Diagnostics) genutzt
 * wird. Mit Resolver werden Cross-Module-Symbole gegen echte Typen
 * aufgelöst und liefern „nicht exportiert"-Diagnosen.
 */
export function typeCheckProgram(
    program: Program,
    report: Reporter,
    options: TypeCheckOptions = {},
): void {
    const ctx = buildContext(program);
    ctx.recordType = options.recordType;

    // Funktionen vorab als Funktions-Typen binden, damit Konstanten sie
    // referenzieren können.
    const funcDecls: FunktionDecl[] = [];
    const konstDecls: KonstDecl[] = [];
    for (const decl of program.decls) {
        if (isFunktionDecl(decl)) {
            funcDecls.push(decl);
            const params = decl.params.map((p) => resolveTypeAnnotation(p.type, ctx));
            const paramNames = decl.params.map((p) => p.name);
            const paramHasDefault = decl.params.map((p) => !!p.default);
            const result = resolveTypeAnnotation(decl.returnType, ctx);
            ctx.globals.define(decl.name, {
                kind: 'function', params, paramNames, paramHasDefault, result,
            });
        } else if (isKonstDecl(decl)) {
            konstDecls.push(decl);
        }
    }

    // Importe binden — mit Resolver echt typisiert, sonst tolerant als unknown.
    bindImports(program, ctx, options.importResolver, report);

    // Konstanten checken — gegen Annotation
    for (const decl of konstDecls) {
        const expected = resolveTypeAnnotation(decl.type, ctx);
        const actual = checkAgainstAnnotation(decl.value, expected, ctx.globals, ctx, report);
        // Update global mit dem effektiven (engeren) Typ
        ctx.globals.define(decl.name, actual.kind === 'unknown' ? expected : expected);
    }

    // Param-Defaults und Field-Defaults checken
    for (const decl of program.decls) {
        if (isDatensatzDecl(decl)) {
            for (const f of decl.fields) {
                if (f.default) {
                    const expected = resolveTypeAnnotation(f.type, ctx);
                    checkAgainstAnnotation(f.default, expected, ctx.globals, ctx, report);
                }
            }
        }
    }

    // Funktions-Bodies checken
    for (const decl of funcDecls) {
        const callEnv = ctx.globals.child();
        for (const p of decl.params) {
            callEnv.define(p.name, resolveTypeAnnotation(p.type, ctx));
            if (p.default) {
                checkAgainstAnnotation(p.default, resolveTypeAnnotation(p.type, ctx), callEnv, ctx, report);
            }
        }
        const returnType = resolveTypeAnnotation(decl.returnType, ctx);
        checkFunctionBody(decl.body, returnType, callEnv, ctx, report);
    }

    // `prüfe`/`testfall` werden vom Validator NICHT typgeprüft. Nur für
    // den Tooling-Sammellauf (recordType gesetzt) inferieren wir die
    // Ausdrücke — so kennen Inlay-Hints auch Geld-Typen in Vergleichen
    // (`… == 9.600`). report ist im Sammellauf ein NOOP → keine
    // zusätzlichen Diagnosen.
    if (options.recordType) {
        for (const decl of program.decls) {
            if (!isPruefeDecl(decl)) continue;
            for (const b of decl.beispiele) {
                const block = b.body;
                if (!block) continue;
                // Blockform wie ein fn-Rumpf: Setup-Env aufbauen, dann
                // die finale Assertion inferieren (recordType erfasst sie).
                const env = ctx.globals.child();
                for (const stmt of block.stmts ?? []) {
                    if (isAusgabeStmt(stmt)) {
                        if (stmt.text) checkAgainstAnnotation(stmt.text, TText, env, ctx, report);
                        continue;
                    }
                    if (!isLetStmt(stmt)) continue;
                    const annot = resolveTypeAnnotation(stmt.type, ctx);
                    if (stmt.value) checkAgainstAnnotation(stmt.value, annot, env, ctx, report);
                    env.define(stmt.name, annot);
                }
                if (block.result) infer(block.result, env, ctx, report);
            }
        }
    }
}

/**
 * Tooling-Helfer (Inlay-Hints): führt dieselben Typ-Pässe wie
 * `typeCheckProgram` aus PLUS `testfall`-Inferenz, mit NOOP-Reporter
 * (keine Diagnosen). Liefert eine Map Ausdruck-Knoten → effektiver Typ.
 * Ohne `importResolver` sind importierte Symbole `unknown` (lokaler
 * Best-Effort) — ausreichend, da Geld-Berechnungen i. d. R. lokal sind.
 */
export function collectExpressionTypes(
    program: Program, options: { importResolver?: ImportResolver } = {},
): Map<AstNode, Type> {
    const map = new Map<AstNode, Type>();
    typeCheckProgram(program, () => { /* NOOP: keine Diagnosen */ }, {
        importResolver: options.importResolver,
        recordType: (node, type) => { map.set(node, type); },
    });
    return map;
}

/**
 * Verarbeitet alle `verwende`-Direktiven eines Programms. Mit Resolver wird
 * jedes importierte Symbol gegen den fremden Modul-Header aufgelöst; ohne
 * Resolver bekommt jeder Import den toleranten `unknown`-Typ.
 *
 * Doppel-Bindungen mit demselben lokalen Namen werden hier still überschrieben
 * — die spezifische Konflikt-Diagnose kommt aus `findsl-scope.reportImportIssues`.
 */
function bindImports(
    program: Program,
    ctx: TypeContext,
    resolver: ImportResolver | undefined,
    report: Reporter,
): void {
    for (const b of collectImportBindings(program)) {
        if (!b.localName) continue;
        const type = resolver
            ? resolver.resolve(b.resolvedPath, b.sourceName, b.rawSource, b.node, report)
            : TUnknown;
        ctx.globals.define(b.localName, type);
    }
}

function checkFunctionBody(
    body: FunktionBody | undefined, expected: Type, env: TypeEnv, ctx: TypeContext, report: Reporter,
): void {
    // Teil-Parse beim Tippen (`fn ` / `fn f(): T`): noch kein Body.
    if (!body) return;
    if (body.expr) {
        checkAgainstAnnotation(body.expr, expected, env, ctx, report);
        return;
    }
    if (body.block) {
        const blockEnv = env.child();
        for (const stmt of body.block.stmts ?? []) {
            if (isAusgabeStmt(stmt)) {
                if (stmt.text) checkAgainstAnnotation(stmt.text, TText, blockEnv, ctx, report);
                continue;
            }
            if (!isLetStmt(stmt)) continue;
            const annot = resolveTypeAnnotation(stmt.type, ctx);
            if (stmt.value) checkAgainstAnnotation(stmt.value, annot, blockEnv, ctx, report);
            blockEnv.define(stmt.name, annot);
        }
        if (body.block.result) {
            checkAgainstAnnotation(body.block.result, expected, blockEnv, ctx, report);
        }
    }
}

