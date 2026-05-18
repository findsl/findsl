// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * IR → Java-21-Quelltext (ADR1 `emit-java/`), Phase 1.
 *
 * Reiner, deterministischer Pretty-Printer (Risiko R9). Ein FinDSL-Modul
 * → eine **instanziierbare** Klasse (Objekt; `fn` = Instanzmethoden, kein
 * privater Konstruktor) mit verschachtelten `enum`/`record` + statischen
 * `konst`. `_`-interne `fn` → `protected`. Methoden-Namen in Java-
 * Konvention (erster Buchstabe klein). `wähle`/`abbruch` →
 * Statement-Lowering (ADR4). FinDSL-`--…--`-Doc + `@Quelle` werden als
 * Javadoc übertragen. Wert-/Tag-Semantik liegt in der Runtime.
 */

import type { IrModule, IrDecl, IrExpr, IrArm, IrDoc } from '../ir/nodes.js';

const IND = '    ';

function javaString(s: string): string {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

/**
 * FinDSL-`fn`-Name → Java-Methodenname: erster Buchst(nach optionalem
 * führendem `_`) klein (Java-Konvention). `KstSatz`→`kstSatz`,
 * `_BegrenzterFreibetrag24`→`_begrenzterFreibetrag24`. Deterministisch,
 * konsistent an Deklaration UND Aufrufstelle anzuwenden.
 */
function javaMethodName(name: string): string {
    return name.replace(/^(_*)(\p{L})/u, (_m, us: string, c: string) => us + c.toLowerCase());
}

/** FinDSL-Doc + `@Quelle` → Javadoc-Zeilen (oder leer). */
function javadoc(info: IrDoc, indent: string): string[] {
    const body: string[] = [];
    if (info.doc && info.doc.trim() !== '') {
        // Inhalt maximal übertragen, aber die `--`-Fence-Marker selbst
        // sind kein Doku-Inhalt. Beide FinDSL-Formen abdecken: Block
        // (`--`\n…\n`--`) UND Einzeiler (`-- Text --`) — führendes/
        // schließendes `--` am getrimmten Gesamttext entfernen.
        const stripped = info.doc.replace(/\r/g, '').trim()
            .replace(/^--/, '').replace(/--$/, '');
        for (const raw of stripped.split('\n')) {
            if (raw.trim() === '--') continue;             // interne Fence-Zeile
            // `@rückgabe` → Javadoc `@return`; Prosa/Markdown unverändert.
            const ln = raw.replace(/@rückgabe\b/g, '@return').replace(/\*\//g, '* /');
            body.push(ln.length ? ` * ${ln}` : ' *');
        }
        // Führende/abschließende Leerzeile (durch Fence-Strip) trimmen.
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
        case 'moneyAnno':
            return `${emitExpr(e.expr)}.withMoneyAnnotation(`
                + `FinDslNumber.Type.${e.target}, ${javaString(e.what)})`;
        case 'abort':
            throw new Error('abbruch-Emission ist Phase-2-Scope (kst nutzt es nicht).');
        case 'waehle':
            throw new Error('wähle in Ausdrucksposition: nur als Body/Arm-Ergebnis (Phase 1).');
    }
    throw new Error(`Emit: unbekannter IR-Knoten ${(e as { kind: string }).kind}.`);
}

function emitResultStmt(e: IrExpr, indent: string): string {
    if (e.kind === 'abort') {
        return `${indent}throw new FinDslAbort(${emitExpr(e.reason)});`;
    }
    return `${indent}return ${emitExpr(e)};`;
}

function emitArmCondition(arm: IrArm, subject: IrExpr | undefined): string {
    if (arm.patterns.length === 0) {
        // Nicht-sonst-Arm ohne Pattern (nur via Teil-Parse) — niemals
        // `if () {` emittieren.
        throw new Error('falls-Arm ohne Pattern (Teil-Parse, Codegen).');
    }
    const terms = arm.patterns.map((p) => {
        if (subject === undefined) return emitExpr(p);
        if (p.kind !== 'enumVal') {
            throw new Error('Subjekt-wähle erwartet Enum-Pattern (Phase 1/kst).');
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
            lines.push(emitResultStmt(arm.result, indent));
            break;
        }
        lines.push(`${indent}if (${emitArmCondition(arm, w.subject)}) {`);
        lines.push(emitResultStmt(arm.result, indent + IND));
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
    const out: string[] = [];
    const resultPos = (e: IrExpr): string =>
        e.kind === 'waehle' ? emitWaehle(e, IND + IND) : emitResultStmt(e, IND + IND);

    if (b.kind === 'expr') {
        out.push(resultPos(b.expr));
    } else {
        for (const l of b.lets) {
            out.push(`${IND}${IND}final ${l.javaType} ${l.name} = ${emitExpr(l.expr)};`);
        }
        out.push(resultPos(b.result));
    }
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

    // Klassen-Javadoc: fixe Erzeugt-Notiz + übertragener FinDSL-Datei-Doc.
    const classDoc: string[] = [
        '/**',
        ' * Generiert aus FinDSL — NICHT manuell editieren.',
        ' * Semantik-Orakel: der FinDSL-Interpreter (bit-genau).',
    ];
    const fileDoc = javadoc(m.info, '');
    if (fileDoc.length) {
        classDoc.push(' *', ...fileDoc.slice(1, -1));          // ohne /** und */
    }
    classDoc.push(' */');

    return [
        `package ${m.javaPackage};`,
        '',
        'import javax.annotation.processing.Generated;',
        'import org.findsl.runtime.FinDslNumber;',
        'import org.findsl.runtime.FinDslAbort;',
        'import org.findsl.runtime.FinDslRuntimeError;',
        '',
        ...classDoc,
        '@Generated(value = "findsl.Generator")',
        `public final class ${m.className} {`,
        '',
        decls.join('\n\n'),
        '}',
        '',
    ].join('\n');
}
