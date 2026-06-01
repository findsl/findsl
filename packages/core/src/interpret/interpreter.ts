/**
 * Tree-Walking-Interpreter für FinDSL.
 *
 * Skelett-Variante:
 *   - Wertet Programm-Top-Decls aus: Konstanten, Funktionen, Datensätze,
 *     Aufzählungen werden in einer Modul-Environment registriert.
 *   - Wertet alle in den drei Beispieldateien tatsächlich verwendeten
 *     Expressions/Statements aus.
 *   - Ungebundene PascalCase-Identifier ohne folgenden Call werden als
 *     `SymbolValue` aufgelöst — Fallback für noch-nicht-deklarierte
 *     Aufzählungs-Werte (`Grundtarif`, `Splitting`, `I` … `VI`).
 *   - Cross-Modul-Imports sind im Skelett bewusst nicht aufgelöst; importierte
 *     Symbole bleiben ungebunden und liefern den entsprechenden Lookup-
 *     Fehler erst bei tatsächlicher Verwendung.
 *
 * Implementiert: Listen-Literal, numerischer Bereich (materialisiert),
 * `für jeden`, Index-Zugriff, parametrische Lambdas/Closures
 * (lexikalischer Capture), String-Interpolation (eingeschränkte
 * Slot-Form), Modul-Auflöser für `verwende`.
 *
 * Listen-Methoden SPEC § 11.2 implementiert (`.länge`/`.leer`/`.kopf`/
 * `.rest`/`.bei`/`.enthält`/`.zuordnen`/`.filtern`/`.zusammenfassen`/
 * `.zähle`/`.summe`/`.größtes`/`.kleinstes`).
 *
 * Noch offen: Aufzählungs-Bereiche (`I bis VI` — brauchen
 * Enum-Ordnungs-Kontext).
 */

import { Decimal } from 'decimal.js';

import {
    AbbruchSignal,
    FALSCH,
    FunctionValue,
    InterpretError,
    ListValue,
    NICHTS,
    NumericValue,
    RecordConstructorValue,
    RecordValue,
    StringValue,
    SymbolValue,
    WAHR,
    isTruthy,
    parseNumberLiteral,
    parseSlotPath,
    parseStringLiteral,
    valueToInterpolatedString,
    valueToString,
    valuesCompare,
    valuesEqual,
    type Value,
} from './values.js';
import { Environment, type AusgabeSink } from './environment.js';
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
    type Testfall,
    type BlockStmt,
    type CallArg,
    type ChainOp,
    type CallChain,
    type ParenChain,
    type DatensatzDecl,
    type Expr,
    type FuerExpr,
    type FunktionBody,
    type FunktionDecl,
    type Program,
    type PruefeDecl,
    type Range,
    type WaehleExpr,
} from '../language/generated/ast.js';
import { resolveImportPath } from '../language/import-path.js';
import {
    applyMoneyAnnotation,
    castNumeric,
    numericArith,
    numericDiv,
    numericMul,
} from './interpret-money.js';
import {
    conversionMethodValue,
    listMethodValue,
    scalarLimitValue,
    scalarRoundToMultipleValue,
    scalarRoundingValue,
    textMethodValue,
} from './interpret-stdlib.js';

// ---------------------------------------------------------------------------
// Modul-Initialisierung
// ---------------------------------------------------------------------------

export interface InterpretedModule {
    readonly env: Environment;
    readonly pruefen: ReadonlyArray<PruefeDecl>;
}

/**
 * Registry für bereits interpretierte Module — wird vom Modul-Auflöser
 * gefüllt und vom Interpreter beim Abarbeiten der `verwende`-Direktiven
 * konsultiert.
 */
export interface ModuleRegistry {
    /** Schlüssel ist der absolute, normalisierte Dateipfad der Quelldatei. */
    lookup(filePath: string | undefined): InterpretedModule | undefined;
}

/**
 * Registriert alle Top-Decls eines Programms in einer fresh erzeugten
 * Modul-Environment und liefert sie zusammen mit den `prüfe`-Blöcken zurück.
 *
 * Reihenfolge:
 *   1. Builtins
 *   2. Importierte Symbole (aus der Registry)
 *   3. Datensätze (Konstruktoren)
 *   4. Aufzählungs-Werte (als SymbolValues)
 *   5. Funktionen (als Closures, sehen sich gegenseitig)
 *   6. Konstanten (sequenziell, dürfen Funktionen und andere Konstanten
 *      desselben Moduls referenzieren)
 */
export function interpretProgram(
    program: Program,
    registry?: ModuleRegistry,
    sink?: AusgabeSink,
    filePath?: string,
): InterpretedModule {
    const env = new Environment(null, sink);
    // Keine freien Builtin-Funktionen mehr (seit 2026-05-18): § 11-Stdlib
    // ist Empfänger-Methode (Dispatch in `applyChainOp`/`scalarRoundingValue`
    // /`textMethodValue`/`listMethodValue`), kein Environment-Symbol.

    applyImports(program, env, registry, filePath);

    for (const decl of program.decls) {
        if (isDatensatzDecl(decl)) {
            env.define(decl.name, new RecordConstructorValue(decl.name, decl));
        }
    }

    for (const decl of program.decls) {
        if (isAufzaehlungDecl(decl)) {
            for (const v of decl.values) {
                if (!env.has(v)) env.define(v, new SymbolValue(v));
            }
        }
    }

    for (const decl of program.decls) {
        if (isFunktionDecl(decl)) {
            env.define(decl.name, makeFunctionValue(decl, env));
        }
    }

    for (const decl of program.decls) {
        if (isKonstDecl(decl)) {
            const value = applyMoneyAnnotation(
                evalExpr(decl.value, env), decl.type, `Konstante "${decl.name}"`,
            );
            env.define(decl.name, value);
        }
    }

    const pruefen = program.decls.filter(isPruefeDecl);
    return { env, pruefen };
}

/**
 * Spielt die importierten Symbole jedes `verwende { … } aus "…"`-Eintrags
 * in die Modul-Environment ein. Der relative Pfad-String wird gegen das
 * Verzeichnis von `filePath` (der importierenden Datei) aufgelöst und als
 * absoluter Pfad in der Registry nachgeschlagen.
 *
 * Fehlt die Quelldatei in der Registry (oder fehlt `filePath`), wird der
 * Import übersprungen — die eigentlichen Lookup-Fehler kommen beim
 * erstmaligen Zugriff auf das fehlende Symbol, damit Teilfehler-Diagnosen
 * pro Beispiel nutzbar bleiben.
 */
function applyImports(
    program: Program,
    env: Environment,
    registry?: ModuleRegistry,
    filePath?: string,
): void {
    if (!registry) return;
    for (const imp of program.imports ?? []) {
        if (!imp?.source) continue;
        const key = filePath ? resolveImportPath(filePath, imp.source) : undefined;
        const mod = registry.lookup(key);
        if (!mod) continue;
        for (const item of imp.items ?? []) {
            if (!item?.name) continue;
            const value = mod.env.lookup(item.name);
            if (value === undefined) continue;     // Fehler bei Verwendung
            env.define(item.alias ?? item.name, value);
        }
    }
}

function makeFunctionValue(decl: FunktionDecl, captured: Environment): FunctionValue {
    return new FunctionValue(
        decl.name,
        decl.params.map((p) => ({
            name: p.name, defaultExpr: p.default, typeAnnotation: p.type,
        })),
        decl.body,
        captured,
    );
}

// ---------------------------------------------------------------------------
// Expression-Auswertung
// ---------------------------------------------------------------------------

export function evalExpr(expr: Expr, env: Environment): Value {
    if (isNumberLiteral(expr)) return parseNumberLiteral(expr.value);
    if (isStringLiteral(expr)) return evalStringLiteral(expr.value, env);
    if (isBoolLiteral(expr))   return expr.value === 'wahr' ? WAHR : FALSCH;
    if (isNullLiteral(expr))   return NICHTS;

    if (isUnaryOp(expr)) {
        const v = evalExpr(expr.operand, env);
        if (expr.op === '-') {
            if (v.kind !== 'numeric') {
                throw new InterpretError(
                    `Unäres "-" erwartet numerischen Wert, erhalten: ${valueToString(v)}.`,
                );
            }
            return new NumericValue(v.value.neg(), v.tag);
        }
        return isTruthy(v) ? FALSCH : WAHR;
    }

    if (isBinaryOp(expr)) return evalBinaryOp(expr.op, expr.left, expr.right, env);

    if (isWennExpr(expr)) {
        if (!expr.condition || !expr.then || !expr.else) {
            throw new InterpretError('Unvollständiger wenn-Ausdruck.');
        }
        const cond = evalExpr(expr.condition, env);
        return isTruthy(cond)
            ? evalExpr(expr.then,  env)
            : evalExpr(expr.else, env);
    }

    if (isWaehleExpr(expr)) return evalWaehle(expr, env);

    if (isCast(expr)) {
        const inner = evalExpr(expr.value, env);
        const targetName = expr.targetType.atom.$type === 'NamedType'
            ? expr.targetType.atom.name
            : undefined;
        if (inner.kind === 'numeric' && targetName) {
            return castNumeric(inner, targetName);
        }
        return inner;
    }

    if (isNullCheck(expr)) {
        const v = evalExpr(expr.value, env);
        const isNull = v.kind === 'null';
        return (isNull !== expr.negated) ? WAHR : FALSCH;
    }

    if (isAbbruchExpr(expr)) {
        if (!expr.grund) throw new InterpretError('abbruch ohne Begründung.');
        const g = evalExpr(expr.grund, env);
        const grund = g.kind === 'string' ? g.value : valueToString(g);
        // Nicht abfangbar: kein evalExpr-Pfad fängt AbbruchSignal — es
        // propagiert bis zur Lauf-Grenze (runPruefe).
        throw new AbbruchSignal(grund);
    }

    if (isCallChain(expr)) return evalCallChain(expr, env);

    if (isParenChain(expr)) return evalParenChain(expr, env);

    if (isLambda(expr)) {
        if (expr.params.length === 0) {
            // Param-loses Lambda ist syntaktisch der Block-Ausdruck
            // `{ (var|ausgabe)* ergebnis }` — die Grammatik routet Blöcke
            // durch die Lambda-Regel.
            if (!expr.result) throw new InterpretError('Block-Lambda ohne Ergebnis.');
            return runBlock(expr.stmts, expr.result, env.child());
        }
        // Parametrisches Lambda → Closure: fängt das aktuelle Environment
        // lexikalisch ein (single-assignment + P2 ⇒ kapselungssicher).
        return FunctionValue.lambda(
            expr.params.map((p) => ({ name: p.name, typeAnnotation: p.type })),
            expr,
            env,
        );
    }

    if (isListLiteral(expr)) {
        if (expr.items.some((i) => !i)) {
            throw new InterpretError('Unvollständiges Listen-Literal (Teil-Parse).');
        }
        return new ListValue(expr.items.map((e) => evalExpr(e, env)));
    }

    if (isRange(expr))    return evalRange(expr, env);
    if (isFuerExpr(expr)) return evalFuer(expr, env);

    throw new InterpretError(
        `Ausdruck-Form noch nicht implementiert: ${(expr as { $type: string }).$type}.`,
    );
}

/**
 * String-Literal-Auswertung mit Interpolation. Ohne `${...}`-Slots ist
 * das Ergebnis der Plain-Body; mit Slots wird jeder Slot als Identifier-
 * Kette gegen die Environment aufgelöst und stringifiziert. Slot-Inhalte
 * müssen der `parseSlotPath`-Form genügen — komplexere Ausdrücke werfen
 * eine InterpretError.
 */
function evalStringLiteral(raw: string, env: Environment): StringValue {
    const { parts, slots } = parseStringLiteral(raw);
    if (slots.length === 0) return new StringValue(parts[0] ?? '');

    let result = parts[0] ?? '';
    for (let i = 0; i < slots.length; i++) {
        const value = resolveSlot(slots[i], env);
        result += valueToInterpolatedString(value);
        result += parts[i + 1] ?? '';
    }
    return new StringValue(result);
}

function resolveSlot(slotText: string, env: Environment): Value {
    const path = parseSlotPath(slotText);
    let v = env.lookup(path[0]);
    if (v === undefined) {
        throw new InterpretError(`Slot "${slotText}": Unbekannter Identifier "${path[0]}".`);
    }
    for (let i = 1; i < path.length; i++) {
        if (v.kind !== 'record') {
            throw new InterpretError(
                `Slot "${slotText}": "${path.slice(0, i).join('.')}" ist kein Datensatz, `
                + `Feld-Zugriff auf "${path[i]}" nicht möglich.`,
            );
        }
        const field = v.fields.get(path[i]);
        if (field === undefined) {
            throw new InterpretError(
                `Slot "${slotText}": Feld "${path[i]}" nicht in Datensatz ${v.typeName}.`,
            );
        }
        v = field;
    }
    return v;
}

// ---------------------------------------------------------------------------
// Binäre Operatoren
// ---------------------------------------------------------------------------

function evalBinaryOp(op: string, leftExpr: Expr, rightExpr: Expr, env: Environment): Value {
    if (op === 'und') {
        const l = evalExpr(leftExpr, env);
        if (!isTruthy(l)) return FALSCH;
        const r = evalExpr(rightExpr, env);
        return isTruthy(r) ? WAHR : FALSCH;
    }
    if (op === 'oder') {
        const l = evalExpr(leftExpr, env);
        if (l.kind === 'null') return evalExpr(rightExpr, env);
        if (l.kind === 'bool') {
            if (l.value) return WAHR;
            const r = evalExpr(rightExpr, env);
            return isTruthy(r) ? WAHR : FALSCH;
        }
        return l;
    }

    const l = evalExpr(leftExpr, env);
    const r = evalExpr(rightExpr, env);

    switch (op) {
        case '+':
            // Text + Text → Text-Konkatenation (SPEC § 3.6, § 11.5).
            if (l.kind === 'string' && r.kind === 'string') {
                return new StringValue(l.value + r.value);
            }
            return numericArith(l, r, (a, b) => a.add(b));
        case '-':  return numericArith(l, r, (a, b) => a.sub(b));
        case '*':  return numericMul(l, r);
        case '/':  return numericDiv(l, r);
        case '==': return valuesEqual(l, r)        ? WAHR : FALSCH;
        case '!=': return valuesEqual(l, r)        ? FALSCH : WAHR;
        case '<':  return valuesCompare(l, r) <  0 ? WAHR : FALSCH;
        case '<=': return valuesCompare(l, r) <= 0 ? WAHR : FALSCH;
        case '>':  return valuesCompare(l, r) >  0 ? WAHR : FALSCH;
        case '>=': return valuesCompare(l, r) >= 0 ? WAHR : FALSCH;
    }
    throw new InterpretError(`Unbekannter Operator: ${op}.`);
}

// ---------------------------------------------------------------------------
// Wähle-Ausdruck
// ---------------------------------------------------------------------------

function evalWaehle(expr: WaehleExpr, env: Environment): Value {
    const subject = expr.subject ? evalExpr(expr.subject, env) : undefined;

    for (const arm of expr.arms) {
        if (isFallArm(arm)) {
            const matched = subject === undefined
                ? arm.patterns.some((p) => isTruthy(evalExpr(p, env)))
                : arm.patterns.some((p) => valuesEqual(subject, evalExpr(p, env)));
            if (matched) {
                if (!arm.result) throw new InterpretError('falls-Arm ohne Ergebnis.');
                return evalExpr(arm.result, env);
            }
        } else if (isSonstArm(arm)) {
            if (!arm.result) throw new InterpretError('sonst-Arm ohne Ergebnis.');
            return evalExpr(arm.result, env);
        }
    }
    throw new InterpretError(
        subject === undefined
            ? 'Kein falls-Arm passte (subjektloser wähle-Block).'
            : `Kein falls-Arm passte zu Subjekt ${valueToString(subject)}.`,
    );
}

// ---------------------------------------------------------------------------
// Block / Liste / Bereich / für-jeden
// ---------------------------------------------------------------------------

/**
 * Wertet einen Block `{ (var|ausgabe)* ergebnis }` in der übergebenen,
 * bereits erzeugten Scope-Env aus. Geteilt von param-losem Lambda,
 * Lambda-Closure-Aufruf und `für jeden`-Body.
 */
function runBlock(
    stmts: ReadonlyArray<BlockStmt>,
    result: Expr,
    env: Environment,
): Value {
    for (const stmt of stmts) {
        if (isLetStmt(stmt)) {
            env.define(stmt.name, applyMoneyAnnotation(
                evalExpr(stmt.value, env), stmt.type, `var "${stmt.name}"`,
            ));
        } else if (isAusgabeStmt(stmt) && stmt.text) {
            emitAusgabe(stmt.text, env);
        }
    }
    return evalExpr(result, env);
}

/**
 * Bereich → materialisierte `ListValue` (SPEC § 3.11; Steuer-Bereiche
 * sind beschränkt, Materialisierung unkritisch). Nur numerische
 * Bereiche; Aufzählungs-Bereiche (`I bis VI`) folgen separat (brauchen
 * Enum-Ordnungs-Kontext). Schrittweite default 1, muss > 0 sein;
 * `from > to` ⇒ leere Liste; `bis unter` schließt `to` aus. Element-Tag
 * = Tag der unteren Grenze. Exaktes Decimal-Stepping (kein Float-Drift).
 */
const RANGE_MAX = 10_000_000;
function evalRange(expr: Range, env: Environment): ListValue {
    if (!expr.from || !expr.to) {
        throw new InterpretError('Unvollständiger Bereich (Teil-Parse).');
    }
    const from = evalExpr(expr.from, env);
    const to = evalExpr(expr.to, env);
    if (from.kind !== 'numeric' || to.kind !== 'numeric') {
        throw new InterpretError(
            'Aufzählungs-Bereiche (z. B. `I bis VI`) sind noch nicht '
            + 'ausführbar — nur numerische Bereiche.',
        );
    }
    const step = expr.step ? evalExpr(expr.step, env) : NumericValue.ganzzahl(1);
    if (step.kind !== 'numeric') {
        throw new InterpretError('Bereich: Schrittweite ist nicht numerisch.');
    }
    if (step.value.lte(0)) {
        throw new InterpretError('Bereich: Schrittweite muss positiv sein.');
    }
    const within = expr.exclusive
        ? (v: Decimal) => v.lt(to.value)
        : (v: Decimal) => v.lte(to.value);
    const elements: Value[] = [];
    for (let cur = from.value; within(cur); cur = cur.add(step.value)) {
        elements.push(new NumericValue(cur, from.tag));
        if (elements.length > RANGE_MAX) {
            throw new InterpretError('Bereich zu groß (> 10 Mio. Elemente).');
        }
    }
    return new ListValue(elements);
}

/**
 * `für jeden x aus quelle { body }` — eager, Elementreihenfolge
 * links→rechts; liefert die `ListValue` der Body-Werte (SPEC § 5.3,
 * semantisch ≡ `quelle.zuordnen { x -> body }`). Verschachtelt ⇒
 * `Liste<Liste<…>>`. Jede Iteration eigener Kind-Scope.
 */
function evalFuer(expr: FuerExpr, env: Environment): ListValue {
    if (!expr.iter || !expr.source || !expr.body || !expr.body.result) {
        throw new InterpretError('Unvollständige für-jeden-Schleife (Teil-Parse).');
    }
    const src = evalExpr(expr.source, env);
    if (src.kind !== 'list') {
        throw new InterpretError(
            'für jeden: Quelle ist keine Liste/kein Bereich, erhalten '
            + `${valueToString(src)}.`,
        );
    }
    const out: Value[] = [];
    for (const element of src.elements) {
        const iterEnv = env.child();
        iterEnv.define(expr.iter, element);
        out.push(runBlock(expr.body.stmts, expr.body.result, iterEnv));
    }
    return new ListValue(out);
}

// ---------------------------------------------------------------------------
// CallChain — Variable, Aufruf, Feldzugriff, Force-Unwrap
// ---------------------------------------------------------------------------

function evalCallChain(cc: CallChain, env: Environment): Value {
    if (!cc.name) {
        throw new InterpretError('CallChain ohne Wurzel-Identifier.');
    }
    return evalChainOps(resolveAtom(cc.name, env), cc.chain, env);
}

/**
 * Geklammerter Ausdruck mit Postfix-Kette (`(a * b).abrunden()`). Der
 * Empfänger ist ein beliebiger Ausdruck; die Ketten-Auswertung ist
 * identisch zu `evalCallChain` (eine Ketten-Logik, SPEC `paren_expr`).
 */
function evalParenChain(pc: ParenChain, env: Environment): Value {
    if (!pc.receiver) {
        throw new InterpretError('ParenChain ohne Empfänger-Ausdruck.');
    }
    return evalChainOps(evalExpr(pc.receiver, env), pc.chain, env);
}

/** Wendet eine Kette von ChainOps nacheinander auf den Empfängerwert an. */
function evalChainOps(
    start: Value, chain: ReadonlyArray<ChainOp>, env: Environment,
): Value {
    let current = start;
    for (const op of chain) {
        current = applyChainOp(current, op, env);
    }
    return current;
}

/**
 * Wurzel-Lookup mit Symbol-Fallback. Wenn der Name in der Environment
 * gebunden ist, gewinnt die Bindung. Sonst: PascalCase-Identifier werden
 * als SymbolValue zurückgegeben (Aufzählungs-artige Werte), camelCase und
 * UPPER_SNAKE-Identifier sind echte Fehler.
 */
function resolveAtom(name: string, env: Environment): Value {
    const bound = env.lookup(name);
    if (bound !== undefined) return bound;

    if (isPascalCase(name)) return new SymbolValue(name);
    throw new InterpretError(`Unbekannter Identifier: "${name}".`);
}

function isPascalCase(name: string): boolean {
    return /^[A-Z]/.test(name);
}

function applyChainOp(base: Value, op: ChainOp, env: Environment): Value {
    if (isCall(op)) return applyCall(base, op.args, env);

    if (isFieldAccess(op)) {
        if (!op.name) throw new InterpretError('FieldAccess ohne Namen.');
        if (base.kind === 'numeric'
            && (op.name === 'abrunden' || op.name === 'aufrunden')) {
            return scalarRoundingValue(base, op.name, op);
        }
        if (base.kind === 'numeric'
            && (op.name === 'alsProzent' || op.name === 'alsDezimal')) {
            return conversionMethodValue(base, op.name);
        }
        if (base.kind === 'numeric'
            && (op.name === 'höchstens' || op.name === 'mindestens')) {
            return scalarLimitValue(base, op.name);
        }
        if (base.kind === 'numeric'
            && (op.name === 'abrundenAuf' || op.name === 'aufrundenAuf')) {
            return scalarRoundToMultipleValue(base, op.name);
        }
        if (base.kind === 'string') {
            const tm = textMethodValue(base, op.name);
            if (tm === undefined) {
                throw new InterpretError(
                    `Text hat keine Methode "${op.name}" (SPEC § 11.5).`,
                );
            }
            return tm;
        }
        if (base.kind === 'list') return listMethodValue(base, op.name, applyValueFn);
        return readField(base, op.name);
    }
    if (isSafeFieldAccess(op)) {
        if (!op.name) throw new InterpretError('SafeFieldAccess ohne Namen.');
        if (base.kind === 'null') return NICHTS;
        return readField(base, op.name);
    }
    if (isForceUnwrap(op)) {
        if (base.kind === 'null') {
            throw new InterpretError('Force-Unwrap ("!!") auf nichts.');
        }
        return base;
    }
    if (isIndex(op)) {
        if (!op.index) throw new InterpretError('Index ohne Ausdruck (Teil-Parse).');
        if (base.kind !== 'list') {
            throw new InterpretError(
                `Index-Zugriff auf nicht-Liste: ${valueToString(base)}.`,
            );
        }
        const idx = evalExpr(op.index, env);
        if (idx.kind !== 'numeric' || !idx.value.isInteger()) {
            throw new InterpretError('Index muss eine Ganzzahl sein.');
        }
        const i = idx.value.toNumber();
        if (i < 0 || i >= base.elements.length) {
            // Bug-Klasse wie `!!` — kein abbruch (D2; SPEC § 11.2
            // „Fehler bei leer"); ein Indexfehler ist ein Programmierfehler.
            throw new InterpretError(
                `Index ${i} außerhalb der Liste (Länge ${base.elements.length}).`,
            );
        }
        return base.elements[i];
    }
    throw new InterpretError(
        `Kettenglied-Form noch nicht implementiert: ${(op as { $type: string }).$type}.`,
    );
}

function readField(base: Value, name: string): Value {
    if (base.kind !== 'record') {
        throw new InterpretError(
            `Feldzugriff "${name}" auf nicht-Datensatz: ${valueToString(base)}.`,
        );
    }
    const v = base.fields.get(name);
    if (v === undefined) {
        throw new InterpretError(`Feld "${name}" nicht im Datensatz ${base.typeName}.`);
    }
    return v;
}

function applyCall(callee: Value, args: ReadonlyArray<CallArg>, env: Environment): Value {
    if (callee.kind === 'function')           return invokeUserFunction(callee, args, env);
    if (callee.kind === 'builtin')            return callee.impl(args.map((a) => evalExpr(a.value, env)));
    if (callee.kind === 'record-constructor') return constructRecord(callee, args, env);
    throw new InterpretError(`Aufrufziel ist nicht aufrufbar: ${valueToString(callee)}.`);
}

function invokeUserFunction(
    fn: FunctionValue,
    args: ReadonlyArray<CallArg>,
    callerEnv: Environment,
): Value {
    const captured = fn.captured as Environment;
    const callEnv = captured.child();
    const params = fn.params as ReadonlyArray<{ name: string; defaultExpr?: Expr }>;
    bindParams(fn.name, params, args, callerEnv, callEnv);
    return runFunctionBody(fn, callEnv);
}

/** Führt den Rumpf eines FunctionValue aus (FunktionDecl-Body ODER
 *  parametrisches Lambda — Unterscheidung per `isLambda`). */
function runFunctionBody(fn: FunctionValue, callEnv: Environment): Value {
    const body = fn.body;
    if (isLambda(body)) {
        if (!body.result) throw new InterpretError('Lambda-Closure ohne Ergebnis.');
        return runBlock(body.stmts, body.result, callEnv);
    }
    return evalFunctionBody(body as FunktionBody, callEnv);
}

/**
 * Wendet eine Closure auf bereits ausgewertete Wert-Argumente an
 * (Listen-Methoden geben dem Lambda Werte, keine AST-Argumente). Param-
 * Bindung mit Geld-Annotation wie bei `bindParams`.
 */
function callClosure(fn: FunctionValue, argValues: ReadonlyArray<Value>): Value {
    const captured = fn.captured as Environment;
    const callEnv = captured.child();
    const params = fn.params as ReadonlyArray<{ name: string; typeAnnotation?: unknown }>;
    if (argValues.length !== params.length) {
        throw new InterpretError(
            `${fn.name}: erwartet ${params.length} Argument(e), `
            + `erhalten ${argValues.length}.`,
        );
    }
    params.forEach((p, i) => callEnv.define(
        p.name,
        applyMoneyAnnotation(argValues[i], p.typeAnnotation, `Parameter "${p.name}"`),
    ));
    return runFunctionBody(fn, callEnv);
}

/** Funktion/Lambda ODER Builtin auf Wert-Argumente anwenden. */
function applyValueFn(fnVal: Value, argValues: ReadonlyArray<Value>): Value {
    if (fnVal.kind === 'function') return callClosure(fnVal, argValues);
    if (fnVal.kind === 'builtin')  return fnVal.impl(argValues);
    throw new InterpretError(
        `Erwarte Funktion/Lambda, erhalten ${valueToString(fnVal)}.`,
    );
}

/**
 * Wertet die `ausgabe`-Anweisung aus (SPEC § 5.4): Text-Argument
 * auswerten, an den Environment-Sink schreiben. Kein Rückgabewert
 * (Anweisung, kein Ausdruck) — der Sink ist die einzige zugelassene
 * Effekt-Senke (bewusste P2-Ausnahme, § 4.18 CLAUDE).
 */
function emitAusgabe(text: Expr, env: Environment): void {
    const v = evalExpr(text, env);
    env.sink(v.kind === 'string' ? v.value : valueToString(v));
}

function evalFunctionBody(body: FunktionBody, env: Environment): Value {
    if (body.expr)  return evalExpr(body.expr, env);
    if (body.block) {
        for (const stmt of body.block.stmts) {
            if (isLetStmt(stmt)) {
                env.define(stmt.name, applyMoneyAnnotation(
                    evalExpr(stmt.value, env), stmt.type, `var "${stmt.name}"`,
                ));
            } else if (isAusgabeStmt(stmt) && stmt.text) {
                emitAusgabe(stmt.text, env);
            }
        }
        return evalExpr(body.block.result, env);
    }
    throw new InterpretError('Funktion ohne Body.');
}

/**
 * Bindet positionale und benannte Argumente an Parameter. Defaults werden im
 * Call-Scope ausgewertet (zugriff auf bisher gebundene Parameter).
 */
function bindParams(
    name: string,
    params: ReadonlyArray<{ name: string; defaultExpr?: Expr; typeAnnotation?: unknown }>,
    args: ReadonlyArray<CallArg>,
    callerEnv: Environment,
    callEnv: Environment,
): void {
    const namedArgs = new Map<string, Expr>();
    const positional: Expr[] = [];
    for (const a of args) {
        if (a.name) namedArgs.set(a.name, a.value);
        else        positional.push(a.value);
    }

    let posIdx = 0;
    for (const p of params) {
        let valueExpr: Expr;
        let evalIn: Environment = callerEnv;
        const named = namedArgs.get(p.name);
        if (named !== undefined) {
            valueExpr = named;
            namedArgs.delete(p.name);
        } else if (posIdx < positional.length) {
            valueExpr = positional[posIdx++];
        } else if (p.defaultExpr) {
            valueExpr = p.defaultExpr;
            evalIn = callEnv;
        } else {
            throw new InterpretError(`Fehlendes Argument für Parameter "${p.name}" von ${name}.`);
        }
        callEnv.define(p.name, applyMoneyAnnotation(
            evalExpr(valueExpr, evalIn), p.typeAnnotation, `Parameter "${p.name}"`,
        ));
    }

    if (posIdx < positional.length) {
        throw new InterpretError(`Zu viele positionale Argumente für ${name}.`);
    }
    if (namedArgs.size > 0) {
        const unknown = [...namedArgs.keys()].join(', ');
        throw new InterpretError(`Unbekannte benannte Argumente für ${name}: ${unknown}.`);
    }
}

function constructRecord(
    ctor: RecordConstructorValue,
    args: ReadonlyArray<CallArg>,
    callerEnv: Environment,
): Value {
    const decl = ctor.decl as DatensatzDecl;
    const callEnv = callerEnv.child();

    const namedArgs = new Map<string, Expr>();
    const positional: Expr[] = [];
    for (const a of args) {
        if (a.name) namedArgs.set(a.name, a.value);
        else        positional.push(a.value);
    }

    const fields = new Map<string, Value>();
    let posIdx = 0;
    for (const field of decl.fields) {
        let value: Value;
        if (namedArgs.has(field.name)) {
            value = evalExpr(namedArgs.get(field.name) as Expr, callerEnv);
            namedArgs.delete(field.name);
        } else if (posIdx < positional.length) {
            value = evalExpr(positional[posIdx++], callerEnv);
        } else if (field.default) {
            value = evalExpr(field.default, callEnv);
        } else {
            throw new InterpretError(
                `Datensatz ${ctor.typeName}: Pflichtfeld "${field.name}" fehlt.`,
            );
        }
        fields.set(field.name, value);
        callEnv.define(field.name, value);
    }

    if (posIdx < positional.length) {
        throw new InterpretError(`Datensatz ${ctor.typeName}: zu viele positionale Felder.`);
    }
    if (namedArgs.size > 0) {
        const unknown = [...namedArgs.keys()].join(', ');
        throw new InterpretError(
            `Datensatz ${ctor.typeName}: unbekannte Felder ${unknown}.`,
        );
    }

    return new RecordValue(ctor.typeName, fields);
}

// ---------------------------------------------------------------------------
// Testfall-Auswertung (für prüfe-Blöcke)
// ---------------------------------------------------------------------------

export function evalTestfall(testfall: Testfall, env: Environment): Value {
    // `testfall "L" { (var …)* assertion }` — gleiche Blockform wie ein
    // `fn`-Rumpf: Setup-Anweisungen in einer Kind-Env, dann die finale
    // Assertion auswerten.
    const block = testfall.body;
    if (!block || !block.result) {
        throw new InterpretError('testfall ohne Block-Ergebnis (Teil-Parse).');
    }
    const blockEnv = env.child();
    for (const stmt of block.stmts) {
        if (isLetStmt(stmt)) {
            blockEnv.define(stmt.name, applyMoneyAnnotation(
                evalExpr(stmt.value, blockEnv), stmt.type, `var "${stmt.name}"`,
            ));
        } else if (isAusgabeStmt(stmt) && stmt.text) {
            emitAusgabe(stmt.text, blockEnv);
        }
    }
    return evalExpr(block.result, blockEnv);
}
