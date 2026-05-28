// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * IR → Java-21-Quelltext (ADR1 `emit-java/`).
 *
 * Reiner, deterministischer Pretty-Printer (Risiko R9). Ein FinDSL-Modul
 * → ZWEI Dateien: `public interface <Name>` (Datei-Doc, öffentliche
 * Methodensignaturen, nested `enum`/`record`, `public static final`
 * Konstanten) + paket-private `class <Name>Impl implements <Name>` (nur
 * Methodenrümpfe; Abhängigkeiten per Konstruktor injiziert). `_`-interne
 * `fn` → `protected` (nur in der Impl). Methoden-Namen lowerCamel.
 * Erzeugung/Verdrahtung der Module lebt in der `<Package>Factory`
 * ({@link emitJavaPackageFactory}, Issue #141). `wähle`/`abbruch`/Block-Arm
 * → Statement-Lowering (ADR4). FinDSL-Doc + `@Quelle` → Javadoc.
 */

import type {
    IrModule, IrDecl, IrExpr, IrArm, IrBlockResult, IrDoc,
    IrTestModule, IrTestCase, IrType,
} from '../ir/nodes.js';
import { reflowJava } from './reflow.js';

const IND = '    ';

/**
 * {@link IrType} → Java-Kern-Typ (Rechen-Schicht). Numerisch →
 * `FinDslNumber`; `Liste<T>` → `FinDslListe<Kern-Elem>`; Funktionstyp →
 * `FinDslLambda1/2<…>` (Generics-Boxing `boolean`→`Boolean`); benannt →
 * `Owner.Name`/`Name`. Byte-genauer Ersatz des früheren `javaType()`.
 */
function irTypeToJavaCore(t: IrType): string {
    switch (t.kind) {
        case 'number': return 'FinDslNumber';
        case 'bool': return 'boolean';
        case 'text': return 'String';
        case 'list': return `FinDslListe<${irTypeToJavaCore(t.elem)}>`;
        case 'lambda': {
            const boxed = (j: string): string => j === 'boolean' ? 'Boolean' : j;
            const ps = t.params.map((p) => boxed(irTypeToJavaCore(p)));
            const r = boxed(irTypeToJavaCore(t.ret));
            if (ps.length === 1) return `FinDslLambda1<${ps[0]}, ${r}>`;
            if (ps.length === 2) return `FinDslLambda2<${ps[0]}, ${ps[1]}, ${r}>`;
            throw new Error(
                `Funktions-Typ mit ${ps.length} Parametern ist out-of-scope `
                + `(nur 1- und 2-stellig per FinDslLambda1/2).`);
        }
        case 'named': return t.owner !== undefined ? `${t.owner}.${t.name}` : t.name;
    }
}

/**
 * {@link IrType} → Java-API-Typ (Fassade/Deklarationsgrenze). Numerisch-
 * skalar → sprechender Wrapper (`Euro` …; Teil-Parse ohne Wrapper →
 * `FinDslNumber`); `Liste<T>` bleibt `FinDslListe<Kern-Elem>`; alles
 * übrige = {@link irTypeToJavaCore}. Byte-genauer Ersatz von `apiJavaType()`.
 */
function irTypeToJavaApi(t: IrType): string {
    switch (t.kind) {
        case 'number': return t.wrapper ?? 'FinDslNumber';
        case 'list': return `FinDslListe<${irTypeToJavaCore(t.elem)}>`;
        default: return irTypeToJavaCore(t);
    }
}

function javaString(s: string): string {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        .replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
}

/**
 * FinDSL-`fn`-Name → Java-Methodenname: erster Buchst. (nach optionalem
 * führendem `_`) klein. Deterministisch, konsistent an Decl UND Aufruf.
 */
function javaMethodName(name: string): string {
    return name.replace(/^(_*)(\p{L})/u, (_m, us: string, c: string) => us + c.toLowerCase());
}

/**
 * FinDSL-`--…--`-Doc → Javadoc-Zeilen (oder leer). `@Quelle` gehört NICHT
 * mehr hierher (war ein unbekanntes Javadoc-Tag → Warnung) — es wird über
 * {@link quelleAnnotations} zur echten `@Quelle`-Annotation (#156).
 */
function javadoc(info: IrDoc, indent: string): string[] {
    const body: string[] = [];
    if (info.doc && info.doc.trim() !== '') {
        const stripped = info.doc.replace(/\r/g, '').trim()
            .replace(/^--/, '').replace(/--$/, '');
        for (const raw of stripped.split('\n')) {
            if (raw.trim() === '--') continue;
            const ln = raw.replace(/@rückgabe\b/g, '@return').replace(/\*\//g, '* /');
            body.push(ln.length ? ` * ${ln}` : ' *');
        }
        while (body.length && body[0] === ' *') body.shift();
        while (body.length && body[body.length - 1] === ' *') body.pop();
    }
    if (body.length === 0) return [];
    return [`${indent}/**`, ...body.map((l) => indent + l), `${indent} */`];
}

/**
 * `@Quelle("…")` → echte `org.findsl.runtime.Quelle`-Annotationen (#156),
 * eine je Norm-Verweis. `@Repeatable` ⇒ mehrere sind zulässig; der Java-
 * Compiler bündelt sie in `@Quellen`. RUNTIME-Retention ⇒ später auswertbar.
 */
function quelleAnnotations(info: IrDoc, indent: string): string[] {
    return info.quelle.map((q) => `${indent}@Quelle(${javaString(q)})`);
}

/**
 * (#44 Text-`+`) Arithmetik: Text-Operand → Java-String-Konkat (Klammern
 * für Präzedenz). Numerisch → Runtime-Method (`add`/`sub`/`mul`).
 */
function emitArith(e: Extract<IrExpr, { kind: 'arith' }>): string {
    if (e.isText) {
        return `(${emitExpr(e.left)}) + (${emitExpr(e.right)})`;
    }
    const m = e.op === '+' ? 'add' : e.op === '-' ? 'sub' : 'mul';
    return `${emitExpr(e.left)}.${m}(${emitExpr(e.right)})`;
}

/**
 * Vergleich: (#44 Lücke 12) Text-Vergleich → `Objects.equals` (primitiver
 * `String` hat kein `.equalsValue`). Ordnungsvergleiche auf Text werden
 * im Lowering bereits abgefangen — `isText` impliziert `==`/`!=`.
 * Numerische Vergleiche delegieren an `.equalsValue`/`.compareValue`.
 */
function emitCmp(e: Extract<IrExpr, { kind: 'cmp' }>): string {
    const l = emitExpr(e.left), r = emitExpr(e.right);
    const op: string = e.op;
    if (e.isText) {
        return op === '=='
            ? `java.util.Objects.equals(${l}, ${r})`
            : `!java.util.Objects.equals(${l}, ${r})`;
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
 * Listen-Literale + Bereich-Konstruktoren (`a bis b [schritt s]`,
 * Enum-Bereich `Tag.Mo bis Tag.Fr`). Bei fehlendem Schritt-Argument
 * wird `null` an die Runtime gereicht (substituiert Schritt 1).
 */
function emitListExpr(
    e: Extract<IrExpr, { kind: 'listLit' | 'listRange' | 'listEnumRange' }>,
): string {
    if (e.kind === 'listLit') {
        return e.items.length === 0
            ? `FinDslListe.<${irTypeToJavaCore(e.elementType)}>empty()`
            : `FinDslListe.of(java.util.List.of(${e.items.map(emitExpr).join(', ')}))`;
    }
    const step = e.step !== undefined ? emitExpr(e.step) : 'null';
    if (e.kind === 'listRange') {
        return `FinDslListe.bereich(${emitExpr(e.from)}, ${emitExpr(e.to)}, ${e.exclusive ? 'true' : 'false'}, ${step})`;
    }
    // listEnumRange: Java-Enum-`ordinal()` als Reihenfolge; `Enum.class`
    // muss explizit übergeben werden (Type-Erasure → kein Class-Lookup
    // zur Laufzeit).
    return `FinDslListe.enumBereich(${irTypeToJavaCore(e.enumType)}.class, ${emitExpr(e.from)}, ${emitExpr(e.to)}, ${e.exclusive ? 'true' : 'false'}, ${step})`;
}

/**
 * (#44 Block-Lambda) Mit `lets` → Block-Form:
 * `(p) -> { final T name = expr; …; return body; }`.
 * Ohne `lets` → kompakte Ausdrucks-Form: `(p) -> body`.
 */
function emitLambda1(e: Extract<IrExpr, { kind: 'lambda1' }>): string {
    if (e.lets !== undefined && e.lets.length > 0) {
        const decls = e.lets
            .map((l) => `final ${irTypeToJavaCore(l.type)} ${l.name} = ${emitExpr(l.expr)};`)
            .join(' ');
        return `(${e.param}) -> { ${decls} return ${emitExpr(e.body)}; }`;
    }
    return `(${e.param}) -> ${emitExpr(e.body)}`;
}

/**
 * (#44 Lücke 11) String-Interpolation `"…${slot}…"` → Java-String-Konkat.
 * Text-Slots werden direkt angehängt (primitiver Java-`String` hat kein
 * `.asText()`); numerische Slots laufen über `.asText()` für die bit-
 * genaue Zahl→Text-Konversion via Runtime.
 */
function emitStrInterp(e: Extract<IrExpr, { kind: 'strInterp' }>): string {
    const terms: string[] = [];
    for (let k = 0; k < e.slots.length; k++) {
        terms.push(javaString(e.parts[k]));
        const isText = e.slotIsText?.[k] ?? false;
        terms.push(isText
            ? emitExpr(e.slots[k])
            : `${emitExpr(e.slots[k])}.asText()`);
    }
    terms.push(javaString(e.parts[e.parts.length - 1]));
    return terms.join(' + ');
}

/**
 * (#44 Nullable) Nullable-Operatoren: Elvis (`oder` auf Nullable),
 * Force-Unwrap (`!!` → `Objects.requireNonNull`) und Safe-FieldAccess
 * (`?.feld`). Doppel-Evaluation des Receivers in Elvis/Safe-Access ist
 * in FinDSL P2 (seiteneffektfrei) unkritisch.
 */
function emitNullable(
    e: Extract<IrExpr, { kind: 'elvis' | 'forceUnwrap' | 'safeFieldAccess' }>,
): string {
    if (e.kind === 'elvis') {
        const l = emitExpr(e.left);
        return `(${l} != null) ? ${l} : ${emitExpr(e.right)}`;
    }
    if (e.kind === 'forceUnwrap') {
        return `java.util.Objects.requireNonNull(${emitExpr(e.value)}, ${javaString(e.hint)})`;
    }
    // safeFieldAccess
    const r = emitExpr(e.receiver);
    return `(${r} != null) ? ${r}.${e.name}() : null`;
}

/** Ausdruck → Java-Ausdrucks-String (seiteneffektfrei, P2). Dispatch-Switch. */
function emitExpr(e: IrExpr): string {
    switch (e.kind) {
        case 'numLit':
            return `FinDslNumber.${e.factory}(${javaString(e.arg)})`;
        case 'ref':
            return e.name;
        case 'enumVal':
            // Cross-modul: Enum ist nested-static der Owner-Klasse.
            return e.ownerClass !== undefined
                ? `${e.ownerClass}.${e.enumName}.${e.value}`
                : `${e.enumName}.${e.value}`;
        case 'field':
            // Sicht-Subtyp IST-EIN FinDslNumber → kein Unboxing nötig.
            return `${emitExpr(e.receiver)}.${e.name}()`;
        case 'call':
            return `${javaMethodName(e.name)}(${e.args.map(emitExpr).join(', ')})`;
        case 'box':
            // Sicht-Adapter an Schreibgrenze (fn-Rückgabe/ctor/konst/
            // Aufruf-Argument); rein nominal, Wert/Tag bleiben.
            return `${e.wrapper}.von(${emitExpr(e.expr)})`;
        case 'unbox':
            // (C): IS-A — Unboxing entfällt; defensiver Durchgriff.
            return emitExpr(e.expr);
        case 'ctor': {
            const qual = e.ownerClass !== undefined ? `${e.ownerClass}.` : '';
            return `new ${qual}${e.typeName}(${e.args.map(emitExpr).join(', ')})`;
        }
        case 'crossCall':
            return `${e.fieldName}.${javaMethodName(e.methodName)}`
                + `(${e.args.map(emitExpr).join(', ')})`;
        case 'crossRef':
            return `${e.ownerClass}.${e.memberName}`;
        case 'enumCmp': {
            const l = emitExpr(e.left), r = emitExpr(e.right);
            return e.op === '==' ? `${l} == ${r}` : `${l} != ${r}`;
        }
        case 'arith':           return emitArith(e);
        case 'div':             return `${emitExpr(e.left)}.div(${emitExpr(e.right)})`;
        case 'cmp':             return emitCmp(e);
        case 'and':             return `(${emitExpr(e.left)}) && (${emitExpr(e.right)})`;
        case 'or':
            // (#44 L3a) Boolean-Disjunktion. Elvis (`oder` auf Nullable)
            // ist ein anderer Knoten (`elvis`).
            return `(${emitExpr(e.left)}) || (${emitExpr(e.right)})`;
        case 'nullLit':
            // (#44 L2) `nichts` → `null`. Nullable-Typen = Java-Reference-Type.
            return 'null';
        case 'nullCheck':
            // (#44 L2) `x ist nichts` / `x ist nicht nichts`.
            return `${emitExpr(e.value)} ${e.negated ? '!=' : '=='} null`;
        case 'elvis':           return emitNullable(e);
        case 'forceUnwrap':     return emitNullable(e);
        case 'safeFieldAccess': return emitNullable(e);
        case 'bool':            return e.value ? 'true' : 'false';
        case 'neg':             return `${emitExpr(e.value)}.neg()`;
        case 'not':             return `!(${emitExpr(e.value)})`;
        case 'round':           return `${emitExpr(e.receiver)}.${e.mode}(FinDslNumber.Type.${e.target})`;
        case 'scalarLimit':     return `${emitExpr(e.receiver)}.${e.op}(${emitExpr(e.arg)})`;
        case 'scalarRoundTo':   return `${emitExpr(e.receiver)}.${e.op}(${emitExpr(e.arg)})`;
        case 'cast':            return `${emitExpr(e.value)}.cast(FinDslNumber.Type.${e.target})`;
        case 'moneyAnno':
            return `${emitExpr(e.expr)}.withMoneyAnnotation(`
                + `FinDslNumber.Type.${e.target}, ${javaString(e.what)})`;
        case 'listLit':         return emitListExpr(e);
        case 'listRange':       return emitListExpr(e);
        case 'listEnumRange':   return emitListExpr(e);
        case 'listMethod':      return `${emitExpr(e.receiver)}.${e.method}()`;
        case 'listMap':         return `${emitExpr(e.receiver)}.zuordnen(${emitExpr(e.fn)})`;
        case 'listFilter':      return `${emitExpr(e.receiver)}.filtern(${emitExpr(e.fn)})`;
        case 'listCountWhere':  return `${emitExpr(e.receiver)}.zaehleMit(${emitExpr(e.fn)})`;
        case 'listContains':    return `${emitExpr(e.receiver)}.enthaelt(${emitExpr(e.value)})`;
        case 'listAt':          return `${emitExpr(e.receiver)}.bei(${emitExpr(e.index)})`;
        case 'listFold':        return `${emitExpr(e.receiver)}.zusammenfassen(${emitExpr(e.start)}, ${emitExpr(e.fn)})`;
        case 'lambda2':         return `(${e.param1}, ${e.param2}) -> ${emitExpr(e.body)}`;
        case 'lambdaCall':
            // (#44 L5) Aufruf eines first-class Lambda-Werts:
            // `FinDslLambda1.apply(arg)` (kein Java-Method-Call).
            return `${emitExpr(e.fn)}.apply(${e.args.map(emitExpr).join(', ')})`;
        case 'lambda1':         return emitLambda1(e);
        case 'strInterp':       return emitStrInterp(e);
        case 'abort':
            throw new Error('abbruch nur in Ergebnis-Position (emitResult), nicht als Sub-Ausdruck.');
        case 'waehle':
            throw new Error('wähle nur in Ergebnis-Position (emitResult), nicht als Sub-Ausdruck.');
    }
    throw new Error(`Emit: unbekannter IR-Knoten ${(e as { kind: string }).kind}.`);
}

/**
 * Ergebnis-Position (fn-Body, `wähle`-Arm): Statement-Lowering von
 * Block (`{var…;ergebnis}`) / verschachteltem `wähle` / `abbruch` /
 * Ausdruck (ADR4 — kein Ternär).
 */
/**
 * Ziel eines Statement-gelowerten Ergebnisses: `return` (fn-Body/
 * `wähle`-Arm) ODER Zuweisung an eine `final`-Variable (`var x = wähle`
 * — Phase 4). `abbruch` ist sink-unabhängig (`throw`).
 */
type Sink = { readonly kind: 'return' } | { readonly kind: 'assign'; readonly name: string };
const RETURN_SINK: Sink = { kind: 'return' };

/**
 * `final <T> <name>;`-Deklaration + Statement-gelowerter `wähle` als
 * Zuweisungs-Sink (`var x = wähle{…}`, Phase 4); sonst schlichtes
 * `final <T> <name> = <expr>;`. (`IrLet.expr` ist ein `IrExpr` — ein
 * `blockResult` kann hier nie stehen; ein `wähle`-`var`-Wert schon.)
 */
function emitLet(l: { type: IrType; name: string; expr: IrExpr }, indent: string): string {
    const e = l.expr;
    const jt = irTypeToJavaCore(l.type);
    if (e.kind === 'waehle') {
        return `${indent}final ${jt} ${l.name};\n`
            + emitResult(e, indent, { kind: 'assign', name: l.name });
    }
    return `${indent}final ${jt} ${l.name} = ${emitExpr(e)};`;
}

function emitResult(
    r: IrExpr | IrBlockResult, indent: string, sink: Sink = RETURN_SINK,
): string {
    if (r.kind === 'blockResult') {
        const lines = r.lets.map((l) => emitLet(l, indent));
        lines.push(emitResult(r.result, indent, sink));
        return lines.join('\n');
    }
    if (r.kind === 'waehle') {
        return emitWaehle(r, indent, sink);
    }
    if (r.kind === 'abort') {
        return `${indent}throw new FinDslAbort(${emitExpr(r.reason)});`;
    }
    return sink.kind === 'assign'
        ? `${indent}${sink.name} = ${emitExpr(r)};`
        : `${indent}return ${emitExpr(r)};`;
}

function emitArmCondition(arm: IrArm, subject: IrExpr | undefined): string {
    if (arm.patterns.length === 0) {
        throw new Error('falls-Arm ohne Pattern (Teil-Parse, Codegen).');
    }
    const terms = arm.patterns.map((p) => {
        if (subject === undefined) return emitExpr(p);
        if (p.kind !== 'enumVal') {
            throw new Error('Subjekt-wähle erwartet Enum-Pattern (Codegen).');
        }
        return `${emitExpr(subject)} == ${emitExpr(p)}`;
    });
    return terms.length === 1 ? terms[0] : terms.map((t) => `(${t})`).join(' || ');
}

function emitWaehle(
    w: Extract<IrExpr, { kind: 'waehle' }>,
    indent: string,
    sink: Sink = RETURN_SINK,
): string {
    const noMatch = `${indent}throw new FinDslRuntimeError(`
        + `"Kein falls-Arm passte (wähle, Codegen).");`;

    // Return-Sink: unverändert (sequenzielle `if (cond) { return … }` —
    // `return` bricht ab, daher kein Durchfall). Byte-identisch zu
    // bisher ⇒ Differential-Gate für kst/est/kraftst unberührt.
    if (sink.kind === 'return') {
        const lines: string[] = [];
        let hasSonst = false;
        for (const arm of w.arms) {
            if (arm.isSonst) {
                hasSonst = true;
                lines.push(emitResult(arm.result, indent, sink));
                break;
            }
            lines.push(`${indent}if (${emitArmCondition(arm, w.subject)}) {`);
            lines.push(emitResult(arm.result, indent + IND, sink));
            lines.push(`${indent}}`);
        }
        if (!hasSonst) lines.push(noMatch);
        return lines.join('\n');
    }

    // Assign-Sink (`var x = wähle{…}`): echte if / else if / else-Kette
    // — KEIN Durchfall (eine Zuweisung pro Pfad, sonst Überschreiben);
    // `final`-Variable ist definit zugewiesen (jeder Pfad weist zu oder
    // wirft: abbruch/Endwurf).
    // Nur `sonst` (kein `falls`) → unbedingte Zuweisung, kein `if`.
    if (w.arms.length === 1 && w.arms[0].isSonst) {
        return emitResult(w.arms[0].result, indent, sink);
    }
    const lines: string[] = [];
    let hasSonst = false;
    for (let i = 0; i < w.arms.length; i++) {
        const arm = w.arms[i];
        if (arm.isSonst) {
            hasSonst = true;
            lines.push(`${indent}} else {`);
            lines.push(emitResult(arm.result, indent + IND, sink));
            break;
        }
        const head = i === 0 ? `${indent}if (` : `${indent}} else if (`;
        lines.push(`${head}${emitArmCondition(arm, w.subject)}) {`);
        lines.push(emitResult(arm.result, indent + IND, sink));
    }
    lines.push(hasSonst
        ? `${indent}}`
        : `${indent}} else {\n${noMatch.replace(indent, indent + IND)}\n${indent}}`);
    return lines.join('\n');
}

function emitFnBody(decl: Extract<IrDecl, { kind: 'fn' }>): string {
    const b = decl.body;
    if (b.kind === 'expr') {
        return emitResult(b.expr, IND + IND);
    }
    const out = b.lets.map((l) => emitLet(l, IND + IND));
    out.push(emitResult(b.result, IND + IND));
    return out.join('\n');
}

/**
 * Interface-Member: `enum`/`record`/`konst` mit Javadoc; öffentliche
 * `fn` als abstrakte Signatur (Javadoc, kein Rumpf). `_`-interne `fn`
 * gehören NICHT ins Interface (nur in die Implementierung) → `undefined`.
 */
function emitInterfaceMember(d: IrDecl): string | undefined {
    const lines = [...javadoc(d.info, IND), ...quelleAnnotations(d.info, IND)];
    const head = lines.length ? lines.join('\n') + '\n' : '';
    switch (d.kind) {
        case 'enum':
            return head + `${IND}public enum ${d.name} {\n`
                + d.values.map((v) => `${IND}${IND}${v}`).join(',\n')
                + `\n${IND}}`;
        case 'record': {
            const params = d.fields
                .map((f) => `${IND}${IND}${irTypeToJavaApi(f.type)} ${f.name}`)
                .join(',\n');
            return head + `${IND}public record ${d.name}(\n${params}\n${IND}) {}`;
        }
        case 'konst': {
            // API-Konstante: numerisch → Wrapper-getypt, Kern-Ausdruck
            // geboxt (`W.von(expr)`); nicht-numerisch (Text/Bool/Liste)
            // → echter API-Typ aus `d.type` (#44 Lücke 10 — vorher
            // wurde fälschlich auf `FinDslNumber` zurückgefallen).
            const w = d.type.kind === 'number' ? d.type.wrapper : undefined;
            const init = w !== undefined ? `${w}.von(${emitExpr(d.expr)})` : emitExpr(d.expr);
            return head + `${IND}public static final ${irTypeToJavaApi(d.type)} ${d.name} = ${init};`;
        }
        case 'fn': {
            if (d.internal) return undefined;        // `_` nur in der Impl
            // Fassaden-Signatur: sprechende API-Typen (Wrapper).
            const params = d.params.map((p) => `${irTypeToJavaApi(p.type)} ${p.name}`).join(', ');
            return head + `${IND}${irTypeToJavaApi(d.returnType)} ${javaMethodName(d.name)}(${params});`;
        }
    }
}

/**
 * Implementierungs-Methode (EINE Methode, keine Fassade/`_kern`-Doppe-
 * lung). Öffentliche `fn`: `@Override public <WrapperRet> name(<Wrapper-
 * Params>)` — Parameter sind Sicht-Subtypen (IS-A FinDslNumber → im
 * Rumpf direkt ohne `.zahl()` rechenbar); die Rückgabe wird vom Lowering
 * an der Ergebnisposition auf den Sicht-Typ geboxt (`Euro.von(…)`).
 * `_`-interne `fn`: `protected FinDslNumber _name(<FinDslNumber>)` mit
 * Javadoc (Kern-Signatur, NICHT im Interface).
 */
function emitImplFn(d: IrDecl): string | undefined {
    if (d.kind !== 'fn') return undefined;
    if (d.internal) {
        const lines = [...javadoc(d.info, IND), ...quelleAnnotations(d.info, IND)];
        const head = lines.length ? lines.join('\n') + '\n' : '';
        const kernParams = d.params.map((p) => `${irTypeToJavaCore(p.type)} ${p.name}`).join(', ');
        const sig = `${irTypeToJavaCore(d.returnType)} ${javaMethodName(d.name)}(${kernParams})`;
        return head + `${IND}protected ${sig} {\n` + emitFnBody(d) + `\n${IND}}`;
    }
    const apiParams = d.params.map((p) => `${irTypeToJavaApi(p.type)} ${p.name}`).join(', ');
    // `@Quelle` auch an der Impl-Methode (#156): Java vererbt Methoden-
    // Annotationen NICHT vom Interface → Reflection auf der konkreten Klasse
    // soll die Norm-Verweise ebenfalls finden.
    const head = quelleAnnotations(d.info, IND).map((a) => a + '\n').join('');
    return head + `${IND}@Override\n`
        + `${IND}public ${irTypeToJavaApi(d.returnType)} ${javaMethodName(d.name)}(${apiParams}) {\n`
        + emitFnBody(d) + `\n${IND}}`;
}

/** Klassen-Javadoc (Datei-Doc) — identisch für Interface und Impl. */
function moduleClassDoc(info: IrDoc): string[] {
    const classDoc: string[] = [
        '/**',
        ' * Generiert aus FinDSL — NICHT manuell editieren.',
        ' * Semantik-Orakel: der FinDSL-Interpreter (bit-genau).',
    ];
    const fileDoc = javadoc(info, '');
    if (fileDoc.length) classDoc.push(' *', ...fileDoc.slice(1, -1));
    classDoc.push(' */');
    return classDoc;
}

/** Bedarfsgesteuerte `org.findsl.runtime.*`-Importe für einen Code-Block. */
function runtimeImportsFor(code: string): string[] {
    return [
        'FinDslNumber', 'FinDslListe', 'FinDslLambda1', 'FinDslLambda2',
        'Tarifart', 'Steuerklasse',
        'FinDslAbort', 'FinDslRuntimeError',
        'Euro', 'EuroCent', 'Cent', 'Prozent', 'Ganzzahl', 'Dezimal',
        // #156: `@Quelle(...)`-Annotation. `\bQuelle\b` matcht NICHT `Quellen`
        // (Compiler-Container) — der braucht keinen expliziten Import.
        'Quelle',
    ]
        .filter((t) => new RegExp(`\\b${t}\\b`).test(code))
        .map((t) => `import org.findsl.runtime.${t};`);
}

function packageHeader(javaPackage: string | undefined): string[] {
    return (javaPackage !== undefined && javaPackage !== '')
        ? [`package ${javaPackage};`, '']
        : [];
}

export interface JavaModuleFiles {
    readonly interfaceName: string;
    readonly interfaceCode: string;
    readonly implName: string;
    readonly implCode: string;
}

/**
 * Rendert ein `IrModule` zu ZWEI Java-Dateien (deterministisch): das
 * öffentliche `interface <Name>` (Datei-Doc, öffentliche Methoden-
 * signaturen, nested `enum`/`record`, `public static final` Konstanten)
 * und die paket-private `class <Name>Impl implements <Name>` (nur
 * Methodenrümpfe; Cross-Modul-Abhängigkeiten per Konstruktor injiziert,
 * verdrahtet durch die `<Package>Factory`).
 */
export function emitJavaModuleFiles(m: IrModule): JavaModuleFiles {
    const interfaceName = m.className;
    const implName = `${m.className}Impl`;
    const classDoc = moduleClassDoc(m.info);
    const pkgHeader = packageHeader(m.javaPackage);
    const generated = '@Generated(value = "findsl.Generator")';

    // --- Interface: öffentliche fn-Signaturen ▸ enum ▸ record ▸ konst
    //     (Quellreihenfolge je Gruppe, deterministisch). ---
    const ifaceOrder = { fn: 0, enum: 1, record: 2, konst: 3 } as const;
    const ifaceMembers = [...m.decls]
        .map((d, i) => ({ d, i }))
        .sort((a, b) => ifaceOrder[a.d.kind] - ifaceOrder[b.d.kind] || a.i - b.i)
        .map(({ d }) => emitInterfaceMember(d))
        .filter((s): s is string => s !== undefined);
    // Issue #141: `newInstance()` entfällt — die Erzeugung lebt
    // ausschließlich in der `<Package>Factory` (emitJavaPackageFactory).
    const interfaceBody = ifaceMembers.join('\n\n');

    // --- Impl: nur `fn` in QUELLREIHENFOLGE (interne `_` an Ort und
    //     Stelle); Cross-Modul-Komposition via Konstruktor-Injektion. ---
    const implFns = m.decls
        .map(emitImplFn)
        .filter((s): s is string => s !== undefined);
    const implBody = implFns.join('\n\n');

    // Cross-Modul: `import` NUR bei abweichendem Package; Komposition via
    // Konstruktor-Injektion (`final`-Felder; die `<Package>Factory`
    // verdrahtet die Instanzen). Die Impl des Zielmoduls bleibt paket-
    // privat — instanziiert wird sie nur in der Factory.
    const crossImports = m.composedModules
        .filter((c) => c.javaPackage !== undefined && c.javaPackage !== m.javaPackage)
        .map((c) => `import ${c.javaPackage}.${c.className};`);
    const ctorParams = m.composedModules
        .map((c) => `${c.className} ${c.fieldName}`).join(', ');
    const composedFields = m.composedModules.length > 0
        ? [
            ...m.composedModules.map(
                (c) => `${IND}private final ${c.className} ${c.fieldName};`),
            '',
            `${IND}${implName}(${ctorParams}) {`,
            ...m.composedModules.map(
                (c) => `${IND}${IND}this.${c.fieldName} = ${c.fieldName};`),
            `${IND}}`,
            '',
        ]
        : [];

    // Datei-Doc-`@Quelle` → Annotation am Typ (Modul-Ebene), an Interface UND
    // Impl (beide tragen das Klassen-Doc). #156.
    const fileQuelle = quelleAnnotations(m.info, '');
    const interfaceCode = [
        ...pkgHeader,
        ...runtimeImportsFor([interfaceBody, ...fileQuelle].join('\n')),
        ...crossImports,
        'import javax.annotation.processing.Generated;',
        '',
        ...classDoc,
        generated,
        ...fileQuelle,
        `public interface ${interfaceName} {`,
        '',
        interfaceBody,
        '}',
        '',
    ].join('\n');

    const implCode = [
        ...pkgHeader,
        ...runtimeImportsFor([implBody, ...fileQuelle].join('\n')),
        ...crossImports,
        'import javax.annotation.processing.Generated;',
        '',
        ...classDoc,
        generated,
        ...fileQuelle,
        `class ${implName} implements ${interfaceName} {`,
        '',
        ...composedFields,
        implBody,
        '}',
        '',
    ].join('\n');

    // Issue #86: Zeilen ≤ 120 Zeichen — der Emitter baut flache Strings,
    // der Reflow bricht überlange Methoden-Ketten/Argument-Listen um.
    return {
        interfaceName,
        interfaceCode: reflowJava(interfaceCode),
        implName,
        implCode: reflowJava(implCode),
    };
}

/** PascalCase-className → `SCREAMING_SNAKE_CASE` (static-final-Feldname). */
function screamingSnake(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .toUpperCase();
}

/**
 * Letztes Package-Segment → PascalCase-Basis des `<Basis>Factory`-Namens
 * (`kraftst` → `Kraftst` ⇒ `KraftstFactory`). Unbenanntes (Default-)Package
 * → `''`, die Factory-Klasse heißt dann schlicht `Factory` (Wurzelverzeichnis).
 */
function factoryBaseName(javaPackage: string | undefined): string {
    if (javaPackage === undefined || javaPackage === '') return '';
    const last = javaPackage.split('.').pop() ?? '';
    return last.length ? last.charAt(0).toUpperCase() + last.slice(1) : '';
}

/**
 * Topologische Modul-Reihenfolge (Abhängigkeit VOR Nutzer) über die
 * Same-Package-`composedModules`-Kanten. Nötig, weil die Factory die
 * Instanzen als eager `private static final` hält (Init in Deklarations-
 * reihenfolge — eine Abhängigkeit nach ihrem Nutzer ⇒ NPE). DFS-Postorder
 * in Eingangsreihenfolge ⇒ stabiler Tie-Break (Determinismus R9). Cross-
 * Package-Kanten zählen nicht (die fremde Factory initialisiert sie).
 * Zyklus ⇒ klarer Fehler (`verwende` ist ein DAG; stille NPE vermeiden).
 */
function topoSortModules(modules: ReadonlyArray<IrModule>): IrModule[] {
    const byName = new Map(modules.map((m) => [m.className, m] as const));
    const result: IrModule[] = [];
    const done = new Set<string>();
    const onStack = new Set<string>();
    const visit = (m: IrModule): void => {
        if (done.has(m.className)) return;
        if (onStack.has(m.className)) {
            throw new Error(
                `Zyklische Modul-Abhängigkeit in der Factory erkannt `
                + `("${m.className}") — \`verwende\` muss azyklisch sein.`);
        }
        onStack.add(m.className);
        for (const c of m.composedModules) {
            const dep = byName.get(c.className);
            if (dep !== undefined) visit(dep);          // nur Same-Package
        }
        onStack.delete(m.className);
        done.add(m.className);
        result.push(m);
    };
    for (const m of modules) visit(m);
    return result;
}

/**
 * Globaler Zyklus-Finder über den Kompositionsgraphen (`composedModules`),
 * **paket-qualifiziert** — fängt damit auch Cross-Package-Zyklen, die der
 * per-Paket-{@link topoSortModules} NICHT sieht. Nötig, weil die
 * `<Package>Factory`-Singletons eager `static final` sind: ein Zyklus
 * (auch über Paketgrenzen) gäbe still eine `null`-Dependency (JLS §12.4.2).
 * Liefert den Zyklus-Pfad (paket-qualifiziert) oder `undefined`. Der CLI
 * ruft das VOR der Factory-Generierung über alle Module auf.
 */
export function findCompositionCycle(
    modules: ReadonlyArray<IrModule>,
): readonly string[] | undefined {
    const qual = (pkg: string | undefined, cls: string): string => `${pkg ?? ''}.${cls}`;
    const byKey = new Map(modules.map((m) => [qual(m.javaPackage, m.className), m] as const));
    const state = new Map<string, 'visiting' | 'done'>();
    const stack: string[] = [];
    let found: string[] | undefined;
    const visit = (m: IrModule): void => {
        if (found) return;
        const k = qual(m.javaPackage, m.className);
        if (state.get(k) === 'done') return;
        if (state.get(k) === 'visiting') {
            found = [...stack.slice(stack.indexOf(k)), k];      // der geschlossene Zyklus
            return;
        }
        state.set(k, 'visiting');
        stack.push(k);
        for (const c of m.composedModules) {
            const dep = byKey.get(qual(c.javaPackage, c.className));
            if (dep !== undefined) visit(dep);
            if (found) return;
        }
        stack.pop();
        state.set(k, 'done');
    };
    for (const m of modules) {
        visit(m);
        if (found) break;
    }
    return found;
}

export interface JavaFactoryFile {
    readonly factoryName: string;
    readonly code: string;
}

/**
 * Rendert die `<Package>Factory` eines Java-Packages (= Gesetzes-Modul):
 * die Komposition-Wurzel. Hält jede generierte Klasse als prozessweites,
 * geteiltes Singleton (`private static final`, topologisch initialisiert)
 * und exponiert sie via `public static create<Klasse>()`. Same-Package-
 * Abhängigkeiten werden direkt verdrahtet, Cross-Package über die Ziel-
 * Factory. `newInstance()` (früher im Interface) entfällt — `new …Impl()`
 * lebt ausschließlich hier. Deterministisch (Risiko R9).
 */
export function emitJavaPackageFactory(
    javaPackage: string | undefined,
    modules: ReadonlyArray<IrModule>,
): JavaFactoryFile {
    const factoryName = `${factoryBaseName(javaPackage)}Factory`;
    const ordered = topoSortModules(modules);

    // SCREAMING_SNAKE-Feldnamen müssen injektiv sein — sonst doppeltes
    // `static final`-Feld + doppelte `create…()` (javac „duplicate field").
    // Klare Diagnose hier statt eines kryptischen Compile-Fehlers.
    const snakeNames = new Set(ordered.map((m) => screamingSnake(m.className)));
    if (snakeNames.size !== ordered.length) {
        throw new Error(
            `Factory-Feldnamen-Kollision in Package "${javaPackage ?? '(default)'}": `
            + `mehrere Klassen ergeben denselben SCREAMING_SNAKE-Namen `
            + `(${ordered.map((m) => m.className).join(', ')}).`);
    }

    // `new <Impl>(<deps>)` je Abhängigkeit: same-package → geteiltes
    // Singleton-Feld; cross-package → Ziel-Factory-`create…()`.
    const ctorArg = (c: { className: string; javaPackage: string | undefined }): string =>
        c.javaPackage !== undefined && c.javaPackage !== javaPackage
            ? `${factoryBaseName(c.javaPackage)}Factory.create${c.className}()`
            : screamingSnake(c.className);
    const fields = ordered.map((m) => {
        const args = m.composedModules.map(ctorArg).join(', ');
        return `${IND}private static final ${m.className} ${screamingSnake(m.className)} `
            + `= new ${m.className}Impl(${args});`;
    });
    const creators = ordered.map((m) =>
        `${IND}public static ${m.className} create${m.className}() {\n`
        + `${IND}${IND}return ${screamingSnake(m.className)};\n${IND}}`);

    // Cross-Package-Factory-Importe (dedupliziert, sortiert → determ.).
    const crossFactoryImports = [...new Set(
        modules
            .flatMap((m) => m.composedModules)
            .filter((c) => c.javaPackage !== undefined && c.javaPackage !== javaPackage)
            .map((c) => `import ${c.javaPackage}.${factoryBaseName(c.javaPackage)}Factory;`),
    )].sort();

    const code = [
        ...packageHeader(javaPackage),
        ...crossFactoryImports,
        'import javax.annotation.processing.Generated;',
        '',
        '/**',
        ' * Komposition-Wurzel (generiert) — erzeugt die Modul-Instanzen dieses',
        ' * Pakets und verdrahtet ihre Abhängigkeiten per Konstruktor-Injektion.',
        ' * Geteilte, prozessweite Singletons. NICHT manuell editieren.',
        ' */',
        '@Generated(value = "findsl.Generator")',
        `public final class ${factoryName} {`,
        '',
        `${IND}private ${factoryName}() {}`,
        '',
        ...fields,
        '',
        creators.join('\n\n'),
        '}',
        '',
    ].join('\n');

    return { factoryName, code: reflowJava(code) };
}

/** `var`-Bindungen eines testfall → `final <T> <n> …;` (auch `= wähle`). */
function emitTestLets(c: IrTestCase, indent: string): string[] {
    return c.lets.map((l) => emitLet(l, indent));
}

/**
 * Plattet eine Top-Level-`und`-Kette in ihre Konjunkte (Quellreihen-
 * folge). `a und b und c` ⇒ `[a,b,c]`. Semantik-erhaltend: alle müssen
 * wahr sein (= `runPruefeDecl`-Pass); je Konjunkt ein `assertTrue`
 * lokalisiert den ersten fehlschlagenden Teil in CI. Nur `and`-Knoten
 * werden zerlegt — kein Abstieg in `not`/`cmp`/… (P2, kein Seiteneffekt).
 */
function flattenAnd(e: IrExpr): IrExpr[] {
    return e.kind === 'and'
        ? [...flattenAnd(e.left), ...flattenAnd(e.right)]
        : [e];
}

/** Ein `testfall` → eine `@Test`-Methode (Spiegel runPruefeDecl). */
function emitTestCase(c: IrTestCase, idx: number): string[] {
    const I2 = IND + IND;       // Methoden-Ebene (in @Nested-Klasse)
    const I3 = I2 + IND;        // Methodenrumpf
    const head = [
        `${I2}@Test`,
        `${I2}@DisplayName(${javaString(c.label)})`,
        `${I2}void testfall_${idx}() {`,
    ];
    let bodyLines: string[];
    if (c.erwartetAbbruch) {
        // Abbruch erwartet → gesamte Auswertung (lets + Ergebnis) im
        // assertThrows-Lambda; Ergebnis als Ausdrucks-Statement (i. d. R.
        // der abbrechende Aufruf), KEIN assertTrue.
        const I4 = I3 + IND;
        bodyLines = [
            `${I3}assertThrows(FinDslAbort.class, () -> {`,
            ...emitTestLets(c, I4),
            `${I4}${emitExpr(c.assertion)};`,
            `${I3}});`,
        ];
    } else {
        // Top-Level-`und` → je Konjunkt ein assertTrue (Diagnose; alle
        // müssen wahr sein = identische Pass/Fail-Semantik wie das eine
        // boolesche Ergebnis im Orakel).
        bodyLines = [
            ...emitTestLets(c, I3),
            ...flattenAnd(c.assertion).map((t) => `${I3}assertTrue(${emitExpr(t)});`),
        ];
    }
    return [...head, ...bodyLines, `${I2}}`];
}

/** Rendert ein `IrTestModule` zu einer JUnit5-Java-Klasse (deterministisch). */
export function emitJavaTestModule(m: IrTestModule): string {
    const suites = m.suites.map((s, i) => {
        const cases = s.cases.flatMap((c, j) => [
            ...emitTestCase(c, j),
            '',
        ]);
        if (cases.length > 0) cases.pop();          // letzte Leerzeile
        return [
            `${IND}@Nested`,
            `${IND}@DisplayName(${javaString(s.suiteName)})`,
            `${IND}class Pruefe_${i} {`,
            '',
            ...cases,
            `${IND}}`,
        ].join('\n');
    });

    const classDoc: string[] = [
        '/**',
        ' * Generierte JUnit5-Akzeptanztests aus FinDSL-`prüfe` — NICHT',
        ' * manuell editieren. Soll-Verhalten = der FinDSL-Interpreter',
        ' * (`pruefe.ts runPruefeDecl`); pass/fail/abbruch bit-genau.',
    ];
    const fileDoc = javadoc(m.info, '');
    if (fileDoc.length) {
        classDoc.push(' *', ...fileDoc.slice(1, -1));
    }
    classDoc.push(' */');

    const code = suites.join('\n\n');
    const hasAssert = m.suites.some((s) => s.cases.some((c) => !c.erwartetAbbruch));
    const hasAbbruch = m.suites.some((s) => s.cases.some((c) => c.erwartetAbbruch));

    // Bedarfsgesteuerte Runtime-Importe (wie emitJavaModule): nur was im
    // Testrumpf namentlich vorkommt. `FinDslAbort` über `assertThrows`.
    const runtimeImports = [
        'FinDslNumber', 'FinDslListe', 'FinDslLambda1', 'FinDslLambda2',
        'Tarifart', 'Steuerklasse',
        'FinDslAbort', 'FinDslRuntimeError',
        'Euro', 'EuroCent', 'Cent', 'Prozent', 'Ganzzahl', 'Dezimal',
    ]
        .filter((t) => new RegExp(`\\b${t}\\b`).test(code))
        .map((t) => `import org.findsl.runtime.${t};`);

    const junitImports = [
        'import org.junit.jupiter.api.DisplayName;',
        'import org.junit.jupiter.api.Nested;',
        'import org.junit.jupiter.api.Test;',
    ];
    if (hasAssert) junitImports.push('import static org.junit.jupiter.api.Assertions.assertTrue;');
    if (hasAbbruch) junitImports.push('import static org.junit.jupiter.api.Assertions.assertThrows;');

    // SUT-Komposition: `import` nur bei abweichendem Package (Testklasse
    // liegt im selben Package wie das SUT → kein Import, `protected`
    // `_`-Methoden erreichbar).
    // SUT-Komposition über die `<Package>Factory` (Issue #141): bei
    // abweichendem Package Interface UND Factory importieren; same-package
    // (Regelfall: Test liegt beim SUT) kein Import, einfacher Name.
    const crossImports = m.composedModules
        .filter((c) => c.javaPackage !== undefined && c.javaPackage !== m.javaPackage)
        .flatMap((c) => [
            `import ${c.javaPackage}.${c.className};`,
            `import ${c.javaPackage}.${factoryBaseName(c.javaPackage)}Factory;`,
        ]);
    const composedFields = m.composedModules.length > 0
        ? [
            ...m.composedModules.map(
                (c) => `${IND}private final ${c.className} ${c.fieldName} `
                    + `= ${factoryBaseName(c.javaPackage)}Factory.create${c.className}();`),
            '',
        ]
        : [];

    const pkgHeader = (m.javaPackage !== undefined && m.javaPackage !== '')
        ? [`package ${m.javaPackage};`, '']
        : [];

    return reflowJava([
        ...pkgHeader,
        'import javax.annotation.processing.Generated;',
        ...junitImports,
        ...runtimeImports,
        ...crossImports,
        '',
        ...classDoc,
        '@Generated(value = "findsl.Generator")',
        `public final class ${m.className} {`,
        '',
        ...composedFields,
        code,
        '}',
        '',
    ].join('\n'));
}
