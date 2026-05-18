// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * IR → Java-21-Quelltext (ADR1 `emit-java/`).
 *
 * Reiner, deterministischer Pretty-Printer (Risiko R9). Ein FinDSL-Modul
 * → eine **instanziierbare** Klasse (Objekt; `fn` = Instanzmethoden, kein
 * privater Konstruktor) mit verschachtelten `enum`/`record` + statischen
 * `konst`. `_`-interne `fn` → `protected`. Methoden-Namen lowerCamel.
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
            return `${emitExpr(e.receiver)}.${e.name}()`;
        case 'call':
            return `${javaMethodName(e.name)}(${e.args.map(emitExpr).join(', ')})`;
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
        case 'lambda1':
            return `(${e.param}) -> ${emitExpr(e.body)}`;
        case 'strInterp': {
            const terms: string[] = [];
            for (let k = 0; k < e.slots.length; k++) {
                terms.push(javaString(e.parts[k]));
                terms.push(`${emitExpr(e.slots[k])}.asText()`);
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
function emitResult(r: IrExpr | IrBlockResult, indent: string): string {
    if (r.kind === 'blockResult') {
        const lines = r.lets.map(
            (l) => `${indent}final ${l.javaType} ${l.name} = ${emitExpr(l.expr)};`);
        lines.push(emitResult(r.result, indent));
        return lines.join('\n');
    }
    if (r.kind === 'waehle') {
        return emitWaehle(r, indent);
    }
    if (r.kind === 'abort') {
        return `${indent}throw new FinDslAbort(${emitExpr(r.reason)});`;
    }
    return `${indent}return ${emitExpr(r)};`;
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
): string {
    const lines: string[] = [];
    let hasSonst = false;
    for (const arm of w.arms) {
        if (arm.isSonst) {
            hasSonst = true;
            lines.push(emitResult(arm.result, indent));
            break;
        }
        lines.push(`${indent}if (${emitArmCondition(arm, w.subject)}) {`);
        lines.push(emitResult(arm.result, indent + IND));
        lines.push(`${indent}}`);
    }
    if (!hasSonst) {
        lines.push(`${indent}throw new FinDslRuntimeError(`
            + `"Kein falls-Arm passte (wähle, Codegen).");`);
    }
    return lines.join('\n');
}

function emitFnBody(decl: Extract<IrDecl, { kind: 'fn' }>): string {
    const b = decl.body;
    if (b.kind === 'expr') {
        return emitResult(b.expr, IND + IND);
    }
    const out = b.lets.map(
        (l) => `${IND}${IND}final ${l.javaType} ${l.name} = ${emitExpr(l.expr)};`);
    out.push(emitResult(b.result, IND + IND));
    return out.join('\n');
}

function emitDecl(d: IrDecl): string {
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
        case 'konst':
            return head + `${IND}public static final FinDslNumber ${d.name} = ${emitExpr(d.expr)};`;
        case 'fn': {
            const vis = d.internal ? 'protected ' : 'public ';     // `_` → protected
            const params = d.params.map((p) => `${p.javaType} ${p.name}`).join(', ');
            return head + `${IND}${vis}${d.returnJavaType} ${javaMethodName(d.name)}(${params}) {\n`
                + emitFnBody(d) + `\n${IND}}`;
        }
    }
}

/** Rendert ein `IrModule` zu Java-21-Quelltext (deterministisch). */
export function emitJavaModule(m: IrModule): string {
    const order = { enum: 0, record: 1, konst: 2, fn: 3 } as const;
    const decls = [...m.decls]
        .map((d, i) => ({ d, i }))
        .sort((a, b) => order[a.d.kind] - order[b.d.kind] || a.i - b.i)
        .map(({ d }) => emitDecl(d));

    const classDoc: string[] = [
        '/**',
        ' * Generiert aus FinDSL — NICHT manuell editieren.',
        ' * Semantik-Orakel: der FinDSL-Interpreter (bit-genau).',
    ];
    const fileDoc = javadoc(m.info, '');
    if (fileDoc.length) {
        classDoc.push(' *', ...fileDoc.slice(1, -1));
    }
    classDoc.push(' */');

    // Bedarfsgesteuerte Imports: nur Runtime-Typen, die im generierten
    // Member-Code (NICHT Javadoc) namentlich vorkommen — vermeidet
    // ungenutzte Imports (Checkstyle/IDE). `FinDslLambda1` taucht nie
    // namentlich auf (nur strukturell via FinDslListe.zuordnen-Signatur).
    const code = decls.join('\n\n');
    const runtimeImports = [
        'FinDslNumber', 'FinDslListe', 'Tarifart', 'Steuerklasse',
        'FinDslAbort', 'FinDslRuntimeError',
    ]
        .filter((t) => new RegExp(`\\b${t}\\b`).test(code))
        .map((t) => `import org.findsl.runtime.${t};`);

    // Cross-Modul-Komposition: `import` NUR bei abweichendem Java-
    // Package (gleiches Package — z. B. kraftst, alle Dateien im selben
    // Verzeichnis — braucht keinen Import; nested-Typen ebenso).
    const crossImports = m.composedModules
        .filter((c) => c.javaPackage !== undefined && c.javaPackage !== m.javaPackage)
        .map((c) => `import ${c.javaPackage}.${c.className};`);
    const composedFields = m.composedModules.length > 0
        ? [
            ...m.composedModules.map(
                (c) => `${IND}private final ${c.className} ${c.fieldName} `
                    + `= new ${c.className}();`),
            '',
        ]
        : [];

    // Unbenanntes (Default-)Package, wenn die Quelldatei direkt im
    // Basisverzeichnis liegt → KEIN `package …;` (ADR8). Sonst: Package
    // = sanierter relativer Verzeichnispfad.
    const pkgHeader = (m.javaPackage !== undefined && m.javaPackage !== '')
        ? [`package ${m.javaPackage};`, '']
        : [];

    return [
        ...pkgHeader,
        'import javax.annotation.processing.Generated;',
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

/** `var`-Bindungen eines testfall → `final <T> <n> = <expr>;`-Zeilen. */
function emitTestLets(c: IrTestCase, indent: string): string[] {
    return c.lets.map(
        (l) => `${indent}final ${l.javaType} ${l.name} = ${emitExpr(l.expr)};`);
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
                    + `= new ${c.className}();`),
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
