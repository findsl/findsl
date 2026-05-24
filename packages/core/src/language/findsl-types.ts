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
import {
    listMethod,
    scalarRoundingMethod,
    textMethod,
} from './findsl-method-inference.js';
import { BUILTIN_ENUM_DEFS, BUILTIN_FUNCTION_DEFS } from './findsl-stdlib.js';
import { checkAgainstAnnotation } from './findsl-type-check.js';
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
export const GELD_PRECISION: Record<string, number> = { Euro: 0, EuroCent: 1, Cent: 2 };

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
//
// Die Implementierung lebt in findsl-inference.ts (infer/inferImpl/walkChain …)
// und findsl-type-check.ts (checkAgainstAnnotation). Aus findsl-types.ts wird
// `infer` zur Stabilität der externen API hier re-exportiert (Issue #72).

export type Reporter = (node: AstNode, message: string) => void;

export { infer } from './findsl-inference.js';
import { infer } from './findsl-inference.js';

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

    // `prüfe`/`testfall`-Ausdrücke werden wie ein fn-Rumpf geprüft (#147):
    // Setup-Env (`var`-Bindungen) aufbauen, dann die finale Assertion
    // inferieren. So melden `infer`/`checkAgainstAnnotation` auch hier
    // unaufgelöste Referenzen (unbekanntes Aufrufziel/Identifier) als
    // Diagnose — vorher wurde der Block nur im Tooling-Sammellauf mit
    // NOOP-Reporter durchlaufen, sodass Editor-Diagnosen ausblieben.
    // Im Sammellauf (recordType gesetzt) erfasst derselbe Pass weiterhin
    // die Ausdruckstypen für Inlay-Hints; report ist dort ein NOOP.
    for (const decl of program.decls) {
        if (!isPruefeDecl(decl)) continue;
        for (const b of decl.testfaelle) {
            const block = b.body;
            if (!block) continue;
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

