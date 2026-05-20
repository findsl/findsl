// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * IR → Java-21-Quelltext (ADR1 `emit-java/`).
 *
 * Reiner, deterministischer Pretty-Printer (Risiko R9). Ein FinDSL-Modul
 * → ZWEI Dateien: `public interface <Name>` (Datei-Doc, `newInstance()`,
 * öffentliche Methodensignaturen, nested `enum`/`record`, `public static
 * final` Konstanten) + paket-private `class <Name>Impl implements
 * <Name>` (nur Methodenrümpfe). `_`-interne `fn` → `protected` (nur in
 * der Impl). Methoden-Namen lowerCamel.
 * `wähle`/`abbruch`/Block-Arm → Statement-Lowering (ADR4). FinDSL-Doc +
 * `@Quelle` → Javadoc. Wert-/Tag-/Listen-Semantik liegt in der Runtime.
 */

import type {
    IrModule, IrDecl, IrExpr, IrArm, IrBlockResult, IrDoc,
    IrTestModule, IrTestCase,
} from '../ir/nodes.js';

const IND = '    ';

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

/** FinDSL-Doc + `@Quelle` → Javadoc-Zeilen (oder leer). */
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
    for (const q of info.quelle) {
        body.push(` * @Quelle ${q.replace(/\*\//g, '* /')}`);
    }
    if (body.length === 0) return [];
    return [`${indent}/**`, ...body.map((l) => indent + l), `${indent} */`];
}

/** Ausdruck → Java-Ausdrucks-String (seiteneffektfrei, P2). */
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
        case 'arith': {
            const m = e.op === '+' ? 'add' : e.op === '-' ? 'sub' : 'mul';
            return `${emitExpr(e.left)}.${m}(${emitExpr(e.right)})`;
        }
        case 'div':
            return `${emitExpr(e.left)}.div(${emitExpr(e.right)})`;
        case 'cmp': {
            const l = emitExpr(e.left), r = emitExpr(e.right);
            const op: string = e.op;
            // (#44 Lücke 12) Text-Vergleich → `Objects.equals` /
            // `!Objects.equals` (primitiver `String` hat kein
            // `.equalsValue`). Ordnungsvergleiche auf Text werden im
            // Lowering schon abgefangen — `isText` impliziert `==`/`!=`.
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
        case 'and':
            return `(${emitExpr(e.left)}) && (${emitExpr(e.right)})`;
        case 'bool':
            return e.value ? 'true' : 'false';
        case 'neg':
            return `${emitExpr(e.value)}.neg()`;
        case 'not':
            return `!(${emitExpr(e.value)})`;
        case 'round':
            return `${emitExpr(e.receiver)}.${e.mode}(FinDslNumber.Type.${e.target})`;
        case 'cast':
            return `${emitExpr(e.value)}.cast(FinDslNumber.Type.${e.target})`;
        case 'moneyAnno':
            return `${emitExpr(e.expr)}.withMoneyAnnotation(`
                + `FinDslNumber.Type.${e.target}, ${javaString(e.what)})`;
        case 'listLit':
            return e.items.length === 0
                ? `FinDslListe.<${e.elementJavaType}>empty()`
                : `FinDslListe.of(java.util.List.of(${e.items.map(emitExpr).join(', ')}))`;
        case 'listMethod':
            return `${emitExpr(e.receiver)}.${e.method}()`;
        case 'listMap':
            return `${emitExpr(e.receiver)}.zuordnen(${emitExpr(e.fn)})`;
        case 'listFilter':
            return `${emitExpr(e.receiver)}.filtern(${emitExpr(e.fn)})`;
        case 'listCountWhere':
            return `${emitExpr(e.receiver)}.zaehleMit(${emitExpr(e.fn)})`;
        case 'listContains':
            return `${emitExpr(e.receiver)}.enthaelt(${emitExpr(e.value)})`;
        case 'listAt':
            return `${emitExpr(e.receiver)}.bei(${emitExpr(e.index)})`;
        case 'listFold':
            return `${emitExpr(e.receiver)}.zusammenfassen(${emitExpr(e.start)}, ${emitExpr(e.fn)})`;
        case 'lambda2':
            return `(${e.param1}, ${e.param2}) -> ${emitExpr(e.body)}`;
        case 'lambda1':
            return `(${e.param}) -> ${emitExpr(e.body)}`;
        case 'strInterp': {
            const terms: string[] = [];
            for (let k = 0; k < e.slots.length; k++) {
                terms.push(javaString(e.parts[k]));
                // (#44 Lücke 11) Text-Slots → direkt anhängen
                // (primitiver Java-`String` hat kein `.asText()`).
                // Numerische Slots (Default): `.asText()` für die
                // bit-genaue Zahl→Text-Konversion über die Runtime.
                const isText = e.slotIsText?.[k] ?? false;
                terms.push(isText
                    ? emitExpr(e.slots[k])
                    : `${emitExpr(e.slots[k])}.asText()`);
            }
            terms.push(javaString(e.parts[e.parts.length - 1]));
            return terms.join(' + ');
        }
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
function emitLet(l: { javaType: string; name: string; expr: IrExpr }, indent: string): string {
    const e = l.expr;
    if (e.kind === 'waehle') {
        return `${indent}final ${l.javaType} ${l.name};\n`
            + emitResult(e, indent, { kind: 'assign', name: l.name });
    }
    return `${indent}final ${l.javaType} ${l.name} = ${emitExpr(e)};`;
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
    const doc = javadoc(d.info, IND);
    const head = doc.length ? doc.join('\n') + '\n' : '';
    switch (d.kind) {
        case 'enum':
            return head + `${IND}public enum ${d.name} {\n`
                + d.values.map((v) => `${IND}${IND}${v}`).join(',\n')
                + `\n${IND}}`;
        case 'record': {
            const params = d.fields
                .map((f) => `${IND}${IND}${f.javaType} ${f.name}`)
                .join(',\n');
            return head + `${IND}public record ${d.name}(\n${params}\n${IND}) {}`;
        }
        case 'konst': {
            // API-Konstante: numerisch → Wrapper-getypt, Kern-Ausdruck
            // geboxt (`W.von(expr)`); nicht-numerisch (Text/Bool/Liste)
            // → echter API-Typ aus `d.javaType` (#44 Lücke 10 — vorher
            // wurde fälschlich auf `FinDslNumber` zurückgefallen).
            const w = d.wrapper;
            const init = w !== undefined ? `${w}.von(${emitExpr(d.expr)})` : emitExpr(d.expr);
            return head + `${IND}public static final ${d.javaType} ${d.name} = ${init};`;
        }
        case 'fn': {
            if (d.internal) return undefined;        // `_` nur in der Impl
            // Fassaden-Signatur: sprechende API-Typen (Wrapper).
            const params = d.params.map((p) => `${p.apiType} ${p.name}`).join(', ');
            return head + `${IND}${d.returnApiType} ${javaMethodName(d.name)}(${params});`;
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
        const doc = javadoc(d.info, IND);
        const head = doc.length ? doc.join('\n') + '\n' : '';
        const kernParams = d.params.map((p) => `${p.javaType} ${p.name}`).join(', ');
        const sig = `${d.returnJavaType} ${javaMethodName(d.name)}(${kernParams})`;
        return head + `${IND}protected ${sig} {\n` + emitFnBody(d) + `\n${IND}}`;
    }
    const apiParams = d.params.map((p) => `${p.apiType} ${p.name}`).join(', ');
    return `${IND}@Override\n`
        + `${IND}public ${d.returnApiType} ${javaMethodName(d.name)}(${apiParams}) {\n`
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
        'FinDslNumber', 'FinDslListe', 'Tarifart', 'Steuerklasse',
        'FinDslAbort', 'FinDslRuntimeError',
        'Euro', 'EuroCent', 'Cent', 'Prozent', 'Ganzzahl', 'Dezimal',
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
 * öffentliche `interface <Name>` (Datei-Doc, `newInstance()`, öffentliche
 * Methodensignaturen, nested `enum`/`record`, `public static final`
 * Konstanten) und die paket-private `class <Name>Impl implements <Name>`
 * (nur Methodenrümpfe; Cross-Modul-SUTs via `<Iface>.newInstance()`).
 */
export function emitJavaModuleFiles(m: IrModule): JavaModuleFiles {
    const interfaceName = m.className;
    const implName = `${m.className}Impl`;
    const classDoc = moduleClassDoc(m.info);
    const pkgHeader = packageHeader(m.javaPackage);
    const generated = '@Generated(value = "findsl.Generator")';

    // --- Interface: newInstance ▸ öffentliche fn-Signaturen ▸ enum ▸
    //     record ▸ konst (Quellreihenfolge je Gruppe, deterministisch). ---
    const ifaceOrder = { fn: 0, enum: 1, record: 2, konst: 3 } as const;
    const ifaceMembers = [...m.decls]
        .map((d, i) => ({ d, i }))
        .sort((a, b) => ifaceOrder[a.d.kind] - ifaceOrder[b.d.kind] || a.i - b.i)
        .map(({ d }) => emitInterfaceMember(d))
        .filter((s): s is string => s !== undefined);
    const newInstance =
        `${IND}static ${interfaceName} newInstance() {\n`
        + `${IND}${IND}return new ${implName}();\n${IND}}`;
    const interfaceBody = [newInstance, ...ifaceMembers].join('\n\n');

    // --- Impl: nur `fn` in QUELLREIHENFOLGE (interne `_` an Ort und
    //     Stelle); Cross-Modul-Komposition via Interface-Factory. ---
    const implFns = m.decls
        .map(emitImplFn)
        .filter((s): s is string => s !== undefined);
    const implBody = implFns.join('\n\n');

    // Cross-Modul: `import` NUR bei abweichendem Package; Komposition
    // hält das IMPLEMENTIERTE Interface, instanziiert via `newInstance()`
    // (die Impl-Klasse des Zielmoduls ist paket-privat).
    const crossImports = m.composedModules
        .filter((c) => c.javaPackage !== undefined && c.javaPackage !== m.javaPackage)
        .map((c) => `import ${c.javaPackage}.${c.className};`);
    const composedFields = m.composedModules.length > 0
        ? [
            ...m.composedModules.map(
                (c) => `${IND}private final ${c.className} ${c.fieldName} `
                    + `= ${c.className}.newInstance();`),
            '',
        ]
        : [];

    const interfaceCode = [
        ...pkgHeader,
        ...runtimeImportsFor(interfaceBody),
        ...crossImports,
        'import javax.annotation.processing.Generated;',
        '',
        ...classDoc,
        generated,
        `public interface ${interfaceName} {`,
        '',
        interfaceBody,
        '}',
        '',
    ].join('\n');

    const implCode = [
        ...pkgHeader,
        ...runtimeImportsFor(implBody),
        ...crossImports,
        'import javax.annotation.processing.Generated;',
        '',
        ...classDoc,
        generated,
        `class ${implName} implements ${interfaceName} {`,
        '',
        ...composedFields,
        implBody,
        '}',
        '',
    ].join('\n');

    return { interfaceName, interfaceCode, implName, implCode };
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
        'FinDslNumber', 'FinDslListe', 'Tarifart', 'Steuerklasse',
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
    const crossImports = m.composedModules
        .filter((c) => c.javaPackage !== undefined && c.javaPackage !== m.javaPackage)
        .map((c) => `import ${c.javaPackage}.${c.className};`);
    const composedFields = m.composedModules.length > 0
        ? [
            ...m.composedModules.map(
                (c) => `${IND}private final ${c.className} ${c.fieldName} `
                    + `= ${c.className}.newInstance();`),
            '',
        ]
        : [];

    const pkgHeader = (m.javaPackage !== undefined && m.javaPackage !== '')
        ? [`package ${m.javaPackage};`, '']
        : [];

    return [
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
    ].join('\n');
}
