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
import type { AstNode } from 'langium';

import {
    AbbruchSignal,
    BuiltinValue,
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
    formatGerman,
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
    isFunktionBody,
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
    type Lambda,
    type Program,
    type PruefeDecl,
    type Range,
    type WaehleExpr,
} from '../language/generated/ast.js';
import { resolveImportPath } from '../language/import-path.js';

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

function expectNumeric(op: string, v: Value): NumericValue {
    if (v.kind !== 'numeric') {
        throw new InterpretError(
            `Operator "${op}": erwarte numerischen Wert, erhalten ${valueToString(v)}.`,
        );
    }
    return v;
}

// --- Euro-kanonisches Geldmodell ------------------------------------------
// Geldwerte tragen ihre Zahl IMMER in Euro (1 ct = 0,01 €). Tag = Typ.
// Präzisions-Lattice (SPEC § 3.2.2): Euro → EuroCent → Cent.

const MONEY_RANK: Partial<Record<NumericValue['tag'], number>> = {
    Euro: 0, EuroCent: 1, Cent: 2,
};

function isMoneyTag(t: NumericValue['tag']): boolean {
    return t === 'Euro' || t === 'EuroCent' || t === 'Cent';
}

/**
 * `als`-Cast eines numerischen Werts. Geld-Ziel: ist die Quelle bereits
 * Geld, ist es ein reiner Tag-Wechsel (Wert schon Euro-kanonisch); ist
 * die Quelle eine nackte Zahl, wird sie als Betrag in der natürlichen
 * Einheit des Ziels gelesen (`Cent`-Eingang ÷ 100). `Prozent`-Ziel
 * normalisiert eine nackte Zahl zur Bruchzahl (`42 als Prozent` → 0.42,
 * konsistent zum `42%`-Literal).
 */
function castNumeric(inner: NumericValue, target: string): NumericValue {
    if (target === 'Euro' || target === 'EuroCent' || target === 'Cent') {
        if (isMoneyTag(inner.tag)) {
            return new NumericValue(inner.value, target);   // Euro-kanonisch
        }
        const euroWert = target === 'Cent' ? inner.value.div(100) : inner.value;
        return new NumericValue(euroWert, target);
    }
    if (target === 'Prozent') {
        const bruch = inner.tag === 'Prozent' ? inner.value : inner.value.div(100);
        return new NumericValue(bruch, 'Prozent');
    }
    if (target === 'Ganzzahl' || target === 'Dezimal') {
        return new NumericValue(inner.value, target);
    }
    return inner;
}

const MONEY_PRIM = new Set(['Euro', 'Cent', 'EuroCent']);

/** Geld-Primitiv-Name einer Typannotation (`: Euro|Cent|EuroCent`), sonst undefined. */
function moneyAnnotationName(type: unknown): string | undefined {
    const atom = (type as { atom?: { $type?: string; name?: string } } | undefined)?.atom;
    if (atom?.$type === 'NamedType' && atom.name && MONEY_PRIM.has(atom.name)) {
        return atom.name;
    }
    return undefined;
}

/**
 * Wendet eine Geld-Typannotation wie ein `als <Typ>`-Cast an: setzt Tag +
 * Euro-kanonische Skalierung (nackte Zahl `: Cent` → ÷100; bereits Geld →
 * reiner Tag-Wechsel, Wert schon Euro-kanonisch). Erzwingt zusätzlich die
 * Ganzzahligkeit von `Euro`/`Cent` AUCH bei berechneten Werten (SPEC
 * § 3.2.2: die Rückrichtung verlangt explizite Rundung) — fraktionale
 * Werte → `InterpretError`. `EuroCent` (präzise Mitte) ist ungeprüft.
 * Entscheidung 2026-05-16: Annotation = Einheits-Quelle (vorher No-Op).
 */
function applyMoneyAnnotation(v: Value, type: unknown, was: string): Value {
    const name = moneyAnnotationName(type);
    if (!name || v.kind !== 'numeric') return v;
    const cast = castNumeric(v, name);
    if (name === 'Euro' && !cast.value.isInteger()) {
        throw new InterpretError(
            `${was}: Euro-Wert "${formatGerman(cast.value)}" ist nicht `
            + `ganzzahlig — explizite Rundung nötig (\`.abrunden()\`/`
            + `\`.aufrunden()\` mit Euro-Kontext, SPEC § 11.1).`,
        );
    }
    if (name === 'Cent' && !cast.value.mul(100).isInteger()) {
        throw new InterpretError(
            `${was}: Cent-Wert "${formatGerman(cast.value.mul(100))}" ist `
            + `nicht ganzzahlig — explizite Rundung nötig (\`.abrunden()\`/`
            + `\`.aufrunden()\` mit Cent-Kontext, SPEC § 11.1).`,
        );
    }
    return cast;
}

function numericArith(
    l: Value,
    r: Value,
    fn: (a: Decimal, b: Decimal) => Decimal,
): NumericValue {
    const a = expectNumeric('+/-', l);
    const b = expectNumeric('+/-', r);
    return new NumericValue(fn(a.value, b.value), combineAddSub(a.tag, b.tag));
}

/** SPEC § 3.2.3 / § 3.4: `Geld±Geld` → präzisere Seite; `Geld±Zahl` → Geld. */
function combineAddSub(a: NumericValue['tag'], b: NumericValue['tag']): NumericValue['tag'] {
    if (isMoneyTag(a) && isMoneyTag(b)) {
        return MONEY_RANK[a]! >= MONEY_RANK[b]! ? a : b;
    }
    if (isMoneyTag(a)) return a;
    if (isMoneyTag(b)) return b;
    if (a === 'Prozent' && b === 'Prozent') return 'Prozent';
    if (a === 'Ganzzahl' && b === 'Ganzzahl') return 'Ganzzahl';
    return 'Dezimal';
}

function numericMul(l: Value, r: Value): NumericValue {
    const a = expectNumeric('*', l);
    const b = expectNumeric('*', r);
    return new NumericValue(a.value.mul(b.value), combineMul(a.tag, b.tag));
}

/** SPEC § 3.2.3 / § 3.4: `Geld*Ganzzahl`→Geld; `Geld*{Dezimal,Prozent}`→EuroCent. */
function combineMul(a: NumericValue['tag'], b: NumericValue['tag']): NumericValue['tag'] {
    const aM = isMoneyTag(a), bM = isMoneyTag(b);
    if (aM && bM) return 'EuroCent';                       // statisch verboten
    if (aM || bM) {
        const other = aM ? b : a;
        const money = aM ? a : b;
        if (other === 'Ganzzahl') return money;            // Geld * Ganzzahl
        return 'EuroCent';                                 // Geld * Dezimal/Prozent
    }
    if ((a === 'Prozent' && b === 'Ganzzahl') || (a === 'Ganzzahl' && b === 'Prozent')) {
        return 'Prozent';
    }
    if (a === 'Prozent' && b === 'Prozent') return 'Dezimal';
    if (a === 'Ganzzahl' && b === 'Ganzzahl') return 'Ganzzahl';
    return 'Dezimal';
}

function numericDiv(l: Value, r: Value): NumericValue {
    const a = expectNumeric('/', l);
    const b = expectNumeric('/', r);
    if (b.value.isZero()) {
        throw new InterpretError('Division durch Null.');
    }
    return new NumericValue(a.value.div(b.value), combineDiv(a.tag, b.tag));
}

/** SPEC § 3.2.3 / § 3.4: `Geld/…`→Dezimal; `Prozent/Ganzzahl`→Prozent. */
function combineDiv(a: NumericValue['tag'], b: NumericValue['tag']): NumericValue['tag'] {
    if (isMoneyTag(a)) return 'Dezimal';
    if (a === 'Prozent' && b === 'Ganzzahl') return 'Prozent';
    return 'Dezimal';
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
        if (base.kind === 'list') return listMethodValue(base, op.name);
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

function listAt(els: ReadonlyArray<Value>, idx: Value | undefined): Value {
    if (!idx || idx.kind !== 'numeric' || !idx.value.isInteger()) {
        throw new InterpretError('Liste.bei: Index muss eine Ganzzahl sein.');
    }
    const i = idx.value.toNumber();
    if (i < 0 || i >= els.length) {
        throw new InterpretError(
            `Liste.bei: Index ${i} außerhalb der Liste (Länge ${els.length}).`,
        );
    }
    return els[i];
}

/**
 * Listen-/Bereich-Methoden (SPEC § 11.2). Eigenschafts-Methoden
 * (`länge`/`leer`/`kopf`/`rest`) liefern direkt den Wert; Aufruf-Methoden
 * liefern einen `BuiltinValue` — das folgende `Call`-Kettenglied wird
 * dann über den bestehenden `applyCall`-Builtin-Pfad ausgeführt (Args
 * bereits ausgewertet). D1: leere `summe` → 0 (Ganzzahl); `kopf`/
 * `größtes`/`kleinstes` auf leerer Liste → `InterpretError` (Bug-Klasse).
 */
function listMethodValue(list: ListValue, name: string): Value {
    const els = list.elements;
    switch (name) {
        case 'länge': return NumericValue.ganzzahl(els.length);
        case 'leer':  return els.length === 0 ? WAHR : FALSCH;
        case 'kopf':
            if (els.length === 0) {
                throw new InterpretError('Liste.kopf auf leerer Liste (SPEC § 11.2).');
            }
            return els[0];
        case 'rest':  return new ListValue(els.slice(1));
        case 'bei':
            return new BuiltinValue('Liste.bei', (a) => listAt(els, a[0]));
        case 'enthält':
            return new BuiltinValue('Liste.enthält', (a) =>
                els.some((e) => valuesEqual(e, a[0])) ? WAHR : FALSCH);
        case 'zuordnen':
            return new BuiltinValue('Liste.zuordnen', (a) =>
                new ListValue(els.map((e) => applyValueFn(a[0], [e]))));
        case 'filtern':
            return new BuiltinValue('Liste.filtern', (a) =>
                new ListValue(els.filter((e) => isTruthy(applyValueFn(a[0], [e])))));
        case 'zusammenfassen':
            return new BuiltinValue('Liste.zusammenfassen', (a) =>
                els.reduce((acc, e) => applyValueFn(a[1], [acc, e]), a[0]));
        case 'zähle':
            return new BuiltinValue('Liste.zähle', (a) =>
                NumericValue.ganzzahl(
                    a.length === 0
                        ? els.length
                        : els.filter((e) => isTruthy(applyValueFn(a[0], [e]))).length,
                ));
        case 'summe':
            return new BuiltinValue('Liste.summe', () =>
                els.length === 0
                    ? NumericValue.ganzzahl(0)                       // D1
                    : els.reduce((acc, e) => numericArith(acc, e, (x, y) => x.add(y))));
        case 'größtes':
        case 'kleinstes':
            return new BuiltinValue(`Liste.${name}`, () => {
                if (els.length === 0) {
                    throw new InterpretError(
                        `Liste.${name} auf leerer Liste (SPEC § 11.2).`,    // D1
                    );
                }
                return els.reduce((best, e) =>
                    (name === 'größtes'
                        ? valuesCompare(e, best) > 0
                        : valuesCompare(e, best) < 0) ? e : best);
            });
        default:
            throw new InterpretError(`Liste hat keine Methode "${name}" (SPEC § 11.2).`);
    }
}

/**
 * Skalar-Rundung (SPEC § 11.1) als Aufruf-Methode (`.abrunden()`/
 * `.aufrunden()`): liefert einen `BuiltinValue`, den das folgende `()`-
 * Kettenglied auswertet (gleiche Mechanik wie `listMethodValue`-Aufruf-
 * methoden). `Dezimal` → `Ganzzahl` (kontextfrei). `EuroCent` → Ziel
 * `Euro`/`Cent` aus dem lokalen AST-Kontext-Walk (Bindungs-/Cast-/fn-
 * Rückgabe-Annotation; Default `Euro`) — type-checker-unabhängig, der
 * statische Checker hat die Zielexistenz bereits verifiziert. Wert ist
 * Euro-kanonisch; `toDecimalPlaces` wie in `builtins.rundung`. Andere
 * Tags → `InterpretError` (Laufzeit-Netz; statisch schon verboten).
 */
function scalarRoundingValue(
    recv: NumericValue, name: string, opNode: AstNode,
): Value {
    const mode = name === 'abrunden' ? Decimal.ROUND_FLOOR : Decimal.ROUND_CEIL;
    // Prozent → volle Prozent, Einheit bleibt (kontextfrei). Anders als
    // der EuroCent/Dezimal-Fall ist der `Prozent`-Tag hier zuverlässig:
    // ein statisch Prozent-typisierter Empfänger ist zur Laufzeit stets
    // Prozent (Prozent-Arithmetik erhält den Tag; kein leere-`summe()`-
    // Degenerat für einen Skalar). Intern Bruch → Magnitude (×100)
    // runden → zurück als Bruch (÷100), Tag `Prozent`.
    if (recv.tag === 'Prozent') {
        return new BuiltinValue(`Prozent.${name}`, () =>
            NumericValue.prozent(
                recv.value.mul(100).toDecimalPlaces(0, mode).div(100)));
    }
    // BEWUSST tag-agnostisch (≙ frühere freie `abrundenEuro`/`abrunden`):
    // der Interpreter ist abseits des Geldmodells untypisiert, der
    // Laufzeit-Tag des Empfängers kann (z. B. leere `.summe()` → D1
    // `Ganzzahl`, Prozent-Zwischen-Tags) vom statischen Typ abweichen.
    // Die Empfänger-Restriktion (`EuroCent`/`Dezimal`) ist bereits ein
    // STATISCHER Phase-1-Gate (Type-Checker); zur Laufzeit zählt nur der
    // Euro-kanonische `value` + das maßgebliche Ziel aus dem Kontext —
    // exakt die alte freie-Funktions-Semantik (`value.toDecimalPlaces`
    // + Ziel-Tag), daher wertgleich zum Vor-Migrations-Verhalten.
    const target = governingMoneyTarget(opNode);
    if (target === undefined) {
        // Kein Geld-Kontext ⇒ Dezimal-Empfänger-Fall → `Ganzzahl`.
        return new BuiltinValue(`Ganzzahl.${name}`, () =>
            NumericValue.ganzzahl(recv.value.toDecimalPlaces(0, mode)));
    }
    const nk = target === 'Cent' ? 2 : 0;
    const make = target === 'Cent' ? NumericValue.cent : NumericValue.euro;
    return new BuiltinValue(`${target}.${name}`, () =>
        make(recv.value.toDecimalPlaces(nk, mode)));
}

/**
 * Grenzwert-Methoden (SPEC § 11.6): `.höchstens(grenze)` = Minimum,
 * `.mindestens(grenze)` = Maximum. Liefert einen `BuiltinValue`, dessen
 * folgendes `()`-Kettenglied das Grenz-Argument auswertet (gleiche Mechanik
 * wie `scalarRoundingValue`). Typ-erhaltend: das Ergebnis behält den
 * Empfänger-Tag; Werte sind Euro-kanonisch, also direkt vergleichbar.
 */
function scalarLimitValue(recv: NumericValue, name: string): Value {
    return new BuiltinValue(`${recv.tag}.${name}`, (args) => {
        const grenze = args[0];
        if (grenze === undefined || grenze.kind !== 'numeric') {
            throw new InterpretError(
                `${recv.tag}.${name}: numerisches Argument erwartet, erhalten `
                + `${grenze === undefined ? 'keines' : grenze.kind}.`);
        }
        const keepRecv = name === 'höchstens'
            ? recv.value.lte(grenze.value)   // Minimum: kleineren behalten
            : recv.value.gte(grenze.value);  // Maximum: größeren behalten
        return new NumericValue(keepRecv ? recv.value : grenze.value, recv.tag);
    });
}

/**
 * Stufen-Methoden (SPEC § 11.6): `.abrundenAuf(vielfaches)` /
 * `.aufrundenAuf(vielfaches)` runden auf das nächste Vielfache von
 * `vielfaches` (floor/ceil). Typ-erhaltend (Empfänger-Tag bleibt; keine
 * Einheit gewechselt). `vielfaches <= 0` → `InterpretError` (Division durch
 * null bzw. unsinniger Schritt); statisch ist die Restriktion nicht
 * prüfbar, daher Laufzeit-Netz.
 */
function scalarRoundToMultipleValue(recv: NumericValue, name: string): Value {
    const mode = name === 'abrundenAuf' ? Decimal.ROUND_FLOOR : Decimal.ROUND_CEIL;
    return new BuiltinValue(`${recv.tag}.${name}`, (args) => {
        const vielfaches = args[0];
        if (vielfaches === undefined || vielfaches.kind !== 'numeric') {
            throw new InterpretError(
                `${recv.tag}.${name}: numerisches Vielfaches erwartet, erhalten `
                + `${vielfaches === undefined ? 'keines' : vielfaches.kind}.`);
        }
        if (vielfaches.value.lte(0)) {
            throw new InterpretError(
                `${recv.tag}.${name}: Vielfaches muss größer als 0 sein, erhalten `
                + `${vielfaches.value.toString()}.`);
        }
        const stufen = recv.value.div(vielfaches.value).toDecimalPlaces(0, mode);
        return new NumericValue(stufen.mul(vielfaches.value), recv.tag);
    });
}

/**
 * Lokaler AST-Kontext-Walk: bestimmt das EuroCent-Rundungsziel
 * (`Euro`/`Cent`) aus der nächsten maßgeblichen Geld-Annotation —
 * `als`-Cast, Bindungs-Annotation (`konst`/`var`) oder Rückgabetyp der
 * umschließenden Funktion. Läuft durch ausdrucks-interne Eltern
 * (`BinaryOp`/`ParenChain`/`Wenn`/`wähle`-Arm/`UnaryOp`/`Cast`-Wert)
 * weiter hoch — auch transparent durch `CallArg`/`Call` (eine Rundung
 * als Funktionsargument findet so die umschließende Bindung/fn-Rückgabe).
 * `undefined` ⇒ keine maßgebliche Geld-Annotation gefunden (der Aufrufer
 * entscheidet den Default — EuroCent-Empfänger ⇒ `Euro` als dominanter
 * Fall; Ganzzahl-Empfänger ⇒ Ganzzahl-Identität). Bewusste, durch den
 * statischen Type-Checker abgesicherte Grenze: liegt der EINZIGE Kontext
 * im Parametertyp der aufgerufenen Funktion (nicht in einer sichtbaren
 * Annotation/Cast/fn-Rückgabe darüber), greift der Default — im realen
 * Korpus kommt das nicht vor (Aggregat 122/122).
 */
function governingMoneyTarget(node: AstNode): 'Euro' | 'Cent' | undefined {
    let cur: AstNode = node;
    for (;;) {
        const c = cur.$container as AstNode | undefined;
        if (!c) return undefined;
        if (isCast(c) && c.value === cur) {
            const m = moneyAnnotationName(c.targetType);
            if (m === 'Euro' || m === 'Cent') return m;
        } else if (isKonstDecl(c) && c.value === cur) {
            const m = moneyAnnotationName(c.type);
            if (m === 'Euro' || m === 'Cent') return m;
        } else if (isLetStmt(c) && c.value === cur) {
            const m = c.type ? moneyAnnotationName(c.type) : undefined;
            if (m === 'Euro' || m === 'Cent') return m;
        } else if (isFunktionBody(c)) {
            const fd = c.$container;
            const m = isFunktionDecl(fd) ? moneyAnnotationName(fd.returnType) : undefined;
            if (m === 'Euro' || m === 'Cent') return m;
        }
        cur = c;
    }
}

/** Gemeinsamen führenden Whitespace-Prefix nicht-leerer Zeilen entfernen. */
function dedentText(s: string): string {
    const lines = s.split('\n');
    let min: number | undefined;
    for (const ln of lines) {
        if (ln.trim() === '') continue;
        const lead = ln.length - ln.replace(/^[ \t]+/, '').length;
        min = min === undefined ? lead : Math.min(min, lead);
    }
    if (min === undefined || min === 0) return s;       // all-blank bzw. keine Einrückung
    return lines.map((ln) => (ln.trim() === '' ? ln : ln.slice(min))).join('\n');
}

/**
 * Text-Argument einer § 11.5-Aufruf-Methode. `v` kann bei Teil-Parse
 * (FinDSLs häufigste Bug-Quelle) oder fehlendem Argument `undefined`
 * sein — dann ein geordneter `InterpretError` statt eines nativen
 * `TypeError` (der den InterpretError-Pfad umginge).
 */
function asText(name: string, v: Value | undefined): string {
    if (!v || v.kind !== 'string') {
        throw new InterpretError(
            `Text.${name}: Text-Argument erwartet, erhalten ${v ? v.kind : 'keines'}.`,
        );
    }
    return v.value;
}

/**
 * Text-Methoden (SPEC § 11.5). `länge`/`leer`/`alsText` sind
 * Eigenschaften (direkter Wert); der Rest sind Aufruf-Methoden
 * (`BuiltinValue`, vom folgenden `()` ausgeführt). `undefined` ⇒
 * unbekannte Methode (Aufrufer wirft „Text hat keine Methode …").
 * `.alsText(format = …)` ist v1.0 nicht implementiert (SPEC § 11.5).
 */
function textMethodValue(s: StringValue, name: string): Value | undefined {
    switch (name) {
        case 'länge':   return NumericValue.ganzzahl([...s.value].length);
        case 'leer':    return s.value.length === 0 ? WAHR : FALSCH;
        case 'alsText': return s;
        case 'einrückungEntfernen':
            return new BuiltinValue('Text.einrückungEntfernen', () =>
                new StringValue(dedentText(s.value)));
        case 'alsGroßbuchstaben':
            return new BuiltinValue('Text.alsGroßbuchstaben', () =>
                new StringValue(s.value.toUpperCase()));
        case 'alsKleinbuchstaben':
            return new BuiltinValue('Text.alsKleinbuchstaben', () =>
                new StringValue(s.value.toLowerCase()));
        case 'beginntMit':
            return new BuiltinValue('Text.beginntMit', (a) =>
                s.value.startsWith(asText(name, a[0])) ? WAHR : FALSCH);
        case 'endetMit':
            return new BuiltinValue('Text.endetMit', (a) =>
                s.value.endsWith(asText(name, a[0])) ? WAHR : FALSCH);
        case 'enthält':
            return new BuiltinValue('Text.enthält', (a) =>
                s.value.includes(asText(name, a[0])) ? WAHR : FALSCH);
        case 'geteiltAn':
            return new BuiltinValue('Text.geteiltAn', (a) =>
                new ListValue(s.value.split(asText(name, a[0])).map((p) => new StringValue(p))));
        default:
            return undefined;
    }
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
