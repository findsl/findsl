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

import type { IrModule, IrDecl, IrExpr, IrArm, IrBlockResult, IrDoc } from '../ir/nodes.js';

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
            return `${e.enumName}.${e.value}`;
        case 'field':
            return `${emitExpr(e.receiver)}.${e.name}()`;
        case 'call':
            return `${javaMethodName(e.name)}(${e.args.map(emitExpr).join(', ')})`;
        case 'ctor':
            return `new ${e.typeName}(${e.args.map(emitExpr).join(', ')})`;
        case 'arith': {
            const m = e.op === '+' ? 'add' : e.op === '-' ? 'sub' : 'mul';
            return `${emitExpr(e.left)}.${m}(${emitExpr(e.right)})`;
        }
        case 'div':
            return `${emitExpr(e.left)}.div(${emitExpr(e.right)})`;
        case 'cmp': {
            const l = emitExpr(e.left), r = emitExpr(e.right);
            switch (e.op) {
                case '==': return `${l}.equalsValue(${r})`;
                case '!=': return `!${l}.equalsValue(${r})`;
                case '<':  return `${l}.compareValue(${r}) < 0`;
                case '<=': return `${l}.compareValue(${r}) <= 0`;
                case '>':  return `${l}.compareValue(${r}) > 0`;
                case '>=': return `${l}.compareValue(${r}) >= 0`;
            }
            break;
        }
        case 'and':
            return `(${emitExpr(e.left)}) && (${emitExpr(e.right)})`;
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

    return [
        `package ${m.javaPackage};`,
        '',
        'import javax.annotation.processing.Generated;',
        ...runtimeImports,
        '',
        ...classDoc,
        '@Generated(value = "findsl.Generator")',
        `public final class ${m.className} {`,
        '',
        code,
        '}',
        '',
    ].join('\n');
}
