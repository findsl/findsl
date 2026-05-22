// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * IR → TypeScript-Quelltext (ADR1/ADR11 `emit-ts/`, Issue #41/#99).
 *
 * Schwester-Emitter zu {@link ../emit-java/emitter.ts} — dieselbe
 * target-neutrale IR, andere Zielsyntax. Reiner, deterministischer
 * Pretty-Printer (Risiko R9). Ein FinDSL-Modul → EINE `.ts`-Datei mit
 * Top-Level-Deklarationen (`export function`/`const`/`enum`/`class`); ein
 * `*.test.findsl` → eine Vitest-Spec (`describe`/`it`/`expect`).
 *
 * Modulform (statt Java-Interface+Impl): Funktionen/Konstanten/Enums/
 * Records liegen top-level im Modul-File. Lokale Referenzen sind bloße
 * Bezeichner; Cross-Modul-Referenzen laufen über einen Namespace-Import
 * (`import * as <Klasse>`) — passt 1:1 auf die IR-Owner-Qualifikation
 * (`enumVal.ownerClass`/`ctor.ownerClass`/`crossRef.ownerClass` und
 * `crossCall.fieldName`→Klasse via {@link IrModule.composedModules}).
 *
 * Sicht-Wrapper (Euro/…) sind decimal.js-FinDslNumber-Subtypen (IS-A,
 * Runtime `runtimes/ts/`): Box = `Wrapper.von(kern)`, Unbox = No-op.
 * Walking-Skeleton-Umfang (#99): genau der `examples/kst`-Konstruktsatz
 * (konst/aufzählung/datensatz/fn, wähle, +−*, Vergleich, Rundung, Cast,
 * Geld-Annotation, Cross-Modul). Listen/Lambda/Interpolation/Nullable
 * folgen mit Issue #100 — bis dahin wirft der Emitter dafür eine klare
 * Out-of-Scope-Meldung (Modul wird vom CLI übersprungen, nicht der Batch).
 */

import type {
    IrModule, IrDecl, IrExpr, IrArm, IrBlockResult, IrDoc,
    IrTestModule, IrTestCase, IrType, IrComposedModule, IrLet,
} from '../ir/nodes.js';

const IND = '    ';

/** Alle vom Runtime-`index.ts` exportierten Wert-Symbole (für bedarfs-
 *  gesteuerte Imports). Reihenfolge = deterministische Import-Reihenfolge. */
const RUNTIME_SYMBOLS = [
    'FinDslNumber', 'FinDslRuntimeError', 'FinDslAbort',
    'Euro', 'EuroCent', 'Cent', 'Prozent', 'Ganzzahl', 'Dezimal',
    'Steuerklasse', 'Tarifart',
] as const;

/**
 * Cross-Modul-Auflösung für `crossCall`: `fieldName` → Klassenname (=
 * Namespace-Import-Alias). Single-threaded, synchron emittiert — wird zu
 * Beginn jeder öffentlichen Emit-Funktion gesetzt (analog zum Java-
 * Emitter, der ausschließlich aus Top-Level-Funktionen besteht).
 */
let crossClassByField: ReadonlyMap<string, string> = new Map();

function buildFieldToClass(
    composed: ReadonlyArray<IrComposedModule>,
): ReadonlyMap<string, string> {
    const m = new Map<string, string>();
    for (const c of composed) m.set(c.fieldName, c.className);
    return m;
}

// --- Typ-Mapping --------------------------------------------------------

/**
 * Out-of-Scope-Marker (#100): Listen/Lambda/Interpolation/Nullable sind im
 * TS-Walking-Skeleton (#99) noch nicht abgedeckt. Klar benennen statt still
 * Falsches zu erzeugen — der CLI-Batch überspringt nur dieses Modul.
 */
function outOfScope(was: string): never {
    throw new Error(
        `${was} ist im TS-Target-Skelett (#99) noch nicht unterstützt `
        + '— folgt mit dem vollen Korpus (Issue #100).');
}

/** {@link IrType} → TS-Kern-Typ (Rechen-Schicht): numerisch → `FinDslNumber`. */
function irTypeToTsCore(t: IrType): string {
    switch (t.kind) {
        case 'number': return 'FinDslNumber';
        case 'bool': return 'boolean';
        case 'text': return 'string';
        case 'list': return outOfScope('Listen-Typ');
        case 'lambda': return outOfScope('Funktions-Typ');
        case 'named': return t.owner !== undefined ? `${t.owner}.${t.name}` : t.name;
    }
}

/**
 * {@link IrType} → TS-API-Typ (Deklarationsgrenze): numerisch-skalar →
 * sprechender Wrapper (`Euro` …; Teil-Parse ohne Wrapper → `FinDslNumber`).
 */
function irTypeToTsApi(t: IrType): string {
    switch (t.kind) {
        case 'number': return t.wrapper ?? 'FinDslNumber';
        case 'list': return outOfScope('Listen-Typ');
        default: return irTypeToTsCore(t);
    }
}

/** Öffentliches Typ-Mapping (vom Index re-exportiert, Symmetrie zu Java). */
export function irTypeToTs(t: IrType): string {
    return irTypeToTsApi(t);
}

// --- String-/Namens-Helfer ----------------------------------------------

/** FinDSL-String → TS-Double-Quote-Literal (vollständig escaped). */
function tsString(s: string): string {
    return JSON.stringify(s);
}

/**
 * FinDSL-`fn`-Name → TS-Funktionsname: erster Buchstabe (nach optionalem
 * führendem `_`) klein. Deterministisch, konsistent an Decl UND Aufruf —
 * identische Transformation wie der Java-Emitter (`javaMethodName`).
 */
function tsFnName(name: string): string {
    return name.replace(/^(_*)(\p{L})/u, (_m, us: string, c: string) => us + c.toLowerCase());
}

/** FinDSL-Doc + `@Quelle` → JSDoc-Zeilen (oder leer). Port von `javadoc()`. */
function tsdoc(info: IrDoc, indent: string): string[] {
    const body: string[] = [];
    if (info.doc && info.doc.trim() !== '') {
        const stripped = info.doc.replace(/\r/g, '').trim()
            .replace(/^--/, '').replace(/--$/, '');
        for (const raw of stripped.split('\n')) {
            if (raw.trim() === '--') continue;
            const ln = raw.replace(/@rückgabe\b/g, '@returns').replace(/\*\//g, '* /');
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

// --- Ausdrucks-Emission --------------------------------------------------

/** (#44 Text-`+`) Arithmetik: Text → TS-String-Konkat; numerisch → Runtime-Method. */
function emitArith(e: Extract<IrExpr, { kind: 'arith' }>): string {
    if (e.isText) {
        return `(${emitExpr(e.left)}) + (${emitExpr(e.right)})`;
    }
    const m = e.op === '+' ? 'add' : e.op === '-' ? 'sub' : 'mul';
    return `${emitExpr(e.left)}.${m}(${emitExpr(e.right)})`;
}

/**
 * Vergleich: Text → `===`/`!==` (JS-Strings sind wertverglichen, primitiv);
 * numerisch → `.equalsValue`/`.compareValue` (decimal.js-Runtime, skalen-
 * unabhängig). Ordnungsvergleiche auf Text fängt das Lowering vorab ab.
 */
function emitCmp(e: Extract<IrExpr, { kind: 'cmp' }>): string {
    const l = emitExpr(e.left), r = emitExpr(e.right);
    const op: string = e.op;
    if (e.isText) {
        return op === '==' ? `${l} === ${r}` : `${l} !== ${r}`;
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

/** Ausdruck → TS-Ausdrucks-String (seiteneffektfrei, P2). Dispatch-Switch. */
function emitExpr(e: IrExpr): string {
    switch (e.kind) {
        case 'numLit':
            return `FinDslNumber.${e.factory}(${tsString(e.arg)})`;
        case 'ref':
            return e.name;
        case 'enumVal':
            // Cross-modul: Enum über Namespace-Import-Alias der Owner-Klasse.
            return e.ownerClass !== undefined
                ? `${e.ownerClass}.${e.enumName}.${e.value}`
                : `${e.enumName}.${e.value}`;
        case 'field':
            // Record = TS-Klasse mit `readonly`-Feldern → Property-Zugriff
            // (kein Java-Accessor `()`); Sicht-Subtyp IS-A FinDslNumber.
            return `${emitExpr(e.receiver)}.${e.name}`;
        case 'call':
            // Lokaler Top-Level-Funktionsaufruf (hoisted im Modul).
            return `${tsFnName(e.name)}(${e.args.map(emitExpr).join(', ')})`;
        case 'box':
            // Sicht-Adapter an Schreibgrenze (rein nominal, Wert/Tag bleiben).
            return `${e.wrapper}.von(${emitExpr(e.expr)})`;
        case 'unbox':
            // IS-A — Unboxing entfällt; defensiver Durchgriff.
            return emitExpr(e.expr);
        case 'ctor': {
            const qual = e.ownerClass !== undefined ? `${e.ownerClass}.` : '';
            return `new ${qual}${e.typeName}(${e.args.map(emitExpr).join(', ')})`;
        }
        case 'crossCall': {
            const owner = crossClassByField.get(e.fieldName);
            if (owner === undefined) {
                throw new Error(
                    `Emit: Cross-Modul-Feld "${e.fieldName}" ohne Klasse `
                    + '(composedModules unvollständig).');
            }
            return `${owner}.${tsFnName(e.methodName)}`
                + `(${e.args.map(emitExpr).join(', ')})`;
        }
        case 'crossRef':
            return `${e.ownerClass}.${e.memberName}`;
        case 'enumCmp': {
            const l = emitExpr(e.left), r = emitExpr(e.right);
            return e.op === '==' ? `${l} === ${r}` : `${l} !== ${r}`;
        }
        case 'arith':           return emitArith(e);
        case 'div':             return `${emitExpr(e.left)}.div(${emitExpr(e.right)})`;
        case 'cmp':             return emitCmp(e);
        case 'and':             return `(${emitExpr(e.left)}) && (${emitExpr(e.right)})`;
        case 'or':              return `(${emitExpr(e.left)}) || (${emitExpr(e.right)})`;
        case 'nullLit':         return 'null';
        case 'nullCheck':
            return `${emitExpr(e.value)} ${e.negated ? '!==' : '==='} null`;
        case 'bool':            return e.value ? 'true' : 'false';
        case 'neg':             return `${emitExpr(e.value)}.neg()`;
        case 'not':             return `!(${emitExpr(e.value)})`;
        case 'round':           return `${emitExpr(e.receiver)}.${e.mode}(${tsString(e.target)})`;
        case 'cast':            return `${emitExpr(e.value)}.cast(${tsString(e.target)})`;
        case 'moneyAnno':
            return `${emitExpr(e.expr)}.withMoneyAnnotation(`
                + `${tsString(e.target)}, ${tsString(e.what)})`;
        // --- Phase 2 (#100): noch nicht im TS-Target ---
        case 'elvis': case 'forceUnwrap': case 'safeFieldAccess':
            return outOfScope('Nullable-Operator');
        case 'listLit': case 'listRange': case 'listEnumRange':
        case 'listMethod': case 'listMap': case 'listFilter':
        case 'listCountWhere': case 'listContains': case 'listAt': case 'listFold':
            return outOfScope('Listen-Ausdruck');
        case 'lambda1': case 'lambda2': case 'lambdaCall':
            return outOfScope('Lambda');
        case 'strInterp':
            return outOfScope('String-Interpolation');
        case 'abort':
            throw new Error('abbruch nur in Ergebnis-Position (emitResult), nicht als Sub-Ausdruck.');
        case 'waehle':
            throw new Error('wähle nur in Ergebnis-Position (emitResult), nicht als Sub-Ausdruck.');
    }
    throw new Error(`Emit: unbekannter IR-Knoten ${(e as { kind: string }).kind}.`);
}

// --- Statement-Lowering (Ergebnis-Position) -----------------------------

/** Ziel eines Statement-gelowerten Ergebnisses: `return` oder `let`-Zuweisung. */
type Sink = { readonly kind: 'return' } | { readonly kind: 'assign'; readonly name: string };
const RETURN_SINK: Sink = { kind: 'return' };

/**
 * `const <name>: <T> = <expr>;`; ein `var x = wähle{…}` wird zu
 * `let <name>: <T>;` + Statement-gelowertem `wähle` als Zuweisungs-Sink
 * (TS-Definite-Assignment via erschöpfendem if/else + throw).
 */
function emitLet(l: IrLet, indent: string): string {
    const e = l.expr;
    const tt = irTypeToTsCore(l.type);
    if (e.kind === 'waehle') {
        return `${indent}let ${l.name}: ${tt};\n`
            + emitResult(e, indent, { kind: 'assign', name: l.name });
    }
    return `${indent}const ${l.name}: ${tt} = ${emitExpr(e)};`;
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
        return `${emitExpr(subject)} === ${emitExpr(p)}`;
    });
    return terms.length === 1 ? terms[0] : terms.map((t) => `(${t})`).join(' || ');
}

function emitWaehle(
    w: Extract<IrExpr, { kind: 'waehle' }>,
    indent: string,
    sink: Sink = RETURN_SINK,
): string {
    const noMatch = `${indent}throw new FinDslRuntimeError(`
        + `${tsString('Kein falls-Arm passte (wähle, Codegen).')});`;

    // Return-Sink: sequenzielle `if (cond) { return … }` (return bricht ab,
    // kein Durchfall); fehlt `sonst`, terminiert ein `throw`.
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

    // Assign-Sink (`var x = wähle{…}`): echte if / else if / else-Kette —
    // jeder Pfad weist genau einmal zu oder wirft (TS-Definite-Assignment).
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
        return emitResult(b.expr, IND);
    }
    const out = b.lets.map((l) => emitLet(l, IND));
    out.push(emitResult(b.result, IND));
    return out.join('\n');
}

// --- Deklarations-Emission ----------------------------------------------

/** `aufzählung` → `export enum`. */
function emitEnumDecl(d: Extract<IrDecl, { kind: 'enum' }>): string {
    const doc = tsdoc(d.info, '');
    const head = doc.length ? doc.join('\n') + '\n' : '';
    return head + `export enum ${d.name} {\n`
        + d.values.map((v) => `${IND}${v},`).join('\n')
        + '\n}';
}

/** `datensatz` → `export class` mit `readonly`-Konstruktor-Parametern. */
function emitRecordDecl(d: Extract<IrDecl, { kind: 'record' }>): string {
    const doc = tsdoc(d.info, '');
    const head = doc.length ? doc.join('\n') + '\n' : '';
    const params = d.fields
        .map((f) => `${IND}${IND}readonly ${f.name}: ${irTypeToTsApi(f.type)},`)
        .join('\n');
    return head + `export class ${d.name} {\n`
        + `${IND}constructor(\n${params}\n${IND}) {}\n}`;
}

/** `konst` → `export const`; numerisch → Wrapper-getypt, Kern-Ausdruck geboxt. */
function emitKonstDecl(d: Extract<IrDecl, { kind: 'konst' }>): string {
    const doc = tsdoc(d.info, '');
    const head = doc.length ? doc.join('\n') + '\n' : '';
    const w = d.type.kind === 'number' ? d.type.wrapper : undefined;
    const init = w !== undefined ? `${w}.von(${emitExpr(d.expr)})` : emitExpr(d.expr);
    return head + `export const ${d.name}: ${irTypeToTsApi(d.type)} = ${init};`;
}

/**
 * `fn` → Top-Level-Funktion. Öffentlich: `export function`, Wrapper-getypte
 * Signatur (Rückgabe wird vom Lowering an der Ergebnisposition geboxt).
 * Intern (`_`): nicht exportiert, Kern-Signatur (`FinDslNumber`).
 */
function emitFnDecl(d: Extract<IrDecl, { kind: 'fn' }>): string {
    const doc = tsdoc(d.info, '');
    const head = doc.length ? doc.join('\n') + '\n' : '';
    if (d.internal) {
        const params = d.params
            .map((p) => `${p.name}: ${irTypeToTsCore(p.type)}`).join(', ');
        return head + `function ${tsFnName(d.name)}(${params}): `
            + `${irTypeToTsCore(d.returnType)} {\n` + emitFnBody(d) + '\n}';
    }
    const params = d.params
        .map((p) => `${p.name}: ${irTypeToTsApi(p.type)}`).join(', ');
    return head + `export function ${tsFnName(d.name)}(${params}): `
        + `${irTypeToTsApi(d.returnType)} {\n` + emitFnBody(d) + '\n}';
}

/**
 * Bedarfsgesteuerte Runtime-Importe + Cross-Modul-Namespace-Importe für
 * einen emittierten Code-Block. Reihenfolge deterministisch.
 */
function importHeader(
    code: string,
    pkg: string | undefined,
    composed: ReadonlyArray<IrComposedModule>,
    extraImports: ReadonlyArray<string> = [],
): string[] {
    const used = RUNTIME_SYMBOLS.filter((s) => new RegExp(`\\b${s}\\b`).test(code));
    const lines: string[] = [...extraImports];
    if (used.length > 0) {
        lines.push(`import { ${used.join(', ')} } from '${relRuntimeImport(pkg)}';`);
    }
    for (const c of composed) {
        lines.push(`import * as ${c.className} from `
            + `'${relModuleImport(pkg, c.javaPackage, c.className)}';`);
    }
    return lines;
}

/** Relativer ESM-Import vom Paket-Verzeichnis zur Runtime (`<root>/runtime/`). */
function relRuntimeImport(pkg: string | undefined): string {
    const depth = pkg ? pkg.split('.').length : 0;
    const up = depth === 0 ? './' : '../'.repeat(depth);
    return `${up}runtime/index.js`;
}

/**
 * Relativer ESM-Import vom aktuellen Paket zum Ziel-Modul-File —
 * kanonisch über den gemeinsamen Paket-Präfix (zwei Module im selben
 * Package → `./Foo.js`, nicht `../../pkg/Foo.js`).
 */
function relModuleImport(
    fromPkg: string | undefined, toPkg: string | undefined, className: string,
): string {
    const from = fromPkg ? fromPkg.split('.') : [];
    const to = toPkg ? toPkg.split('.') : [];
    let i = 0;
    while (i < from.length && i < to.length && from[i] === to[i]) i++;
    const ups = from.length - i;                 // hoch bis zum gemeinsamen Vorfahren
    const downs = to.slice(i);                    // dann runter ins Ziel-Package
    const prefix = ups > 0 ? '../'.repeat(ups) : './';
    return `${prefix}${downs.length ? downs.join('/') + '/' : ''}${className}.js`;
}

/** Datei-Doc (`Program.fileDoc`) → Modul-Kopf-Block (JSDoc). */
function moduleDoc(info: IrDoc): string[] {
    const doc: string[] = [
        '/**',
        ' * Generiert aus FinDSL — NICHT manuell editieren.',
        ' * Semantik-Orakel: der FinDSL-Interpreter (bit-genau).',
    ];
    const fileDoc = tsdoc(info, '');
    if (fileDoc.length) doc.push(' *', ...fileDoc.slice(1, -1));
    doc.push(' */');
    return doc;
}

export interface TsModuleFile {
    readonly fileName: string;
    readonly code: string;
}

/**
 * Rendert ein `IrModule` zu EINER `.ts`-Datei (deterministisch). Decl-
 * Reihenfolge: `enum` → `class` (Record) → `const` → `function`, je Gruppe
 * Quellreihenfolge. Diese Ordnung respektiert TS-TDZ (Klassen/Enums vor
 * Konstanten-Initialisierern); Funktionen sind hoisted und stehen zuletzt.
 */
export function emitTsModule(m: IrModule): TsModuleFile {
    crossClassByField = buildFieldToClass(m.composedModules);

    const order = { enum: 0, record: 1, konst: 2, fn: 3 } as const;
    const members = [...m.decls]
        .map((d, i) => ({ d, i }))
        .sort((a, b) => order[a.d.kind] - order[b.d.kind] || a.i - b.i)
        .map(({ d }) => emitDecl(d))
        .join('\n\n');

    const header = importHeader(members, m.javaPackage, m.composedModules);
    const code = [
        ...header,
        '',
        ...moduleDoc(m.info),
        '',
        members,
        '',
    ].join('\n');

    return { fileName: `${m.className}.ts`, code };
}

function emitDecl(d: IrDecl): string {
    switch (d.kind) {
        case 'enum':   return emitEnumDecl(d);
        case 'record': return emitRecordDecl(d);
        case 'konst':  return emitKonstDecl(d);
        case 'fn':     return emitFnDecl(d);
    }
    // Exhaustiveness-Guard (wie emitExpr): eine künftige IrDecl-Variante
    // wird mit Codegen-Diagnose abgewiesen statt still `undefined` zu
    // emittieren (das `tsc`-Gate fängt das sonst erst spät).
    const _exhaustive: never = d;
    throw new Error(`Emit: unbekannte IrDecl-Variante "${(_exhaustive as { kind: string }).kind}".`);
}

// --- `prüfe`-Blöcke → Vitest --------------------------------------------

/** Plattet eine Top-Level-`und`-Kette in ihre Konjunkte (Quellreihenfolge). */
function flattenAnd(e: IrExpr): IrExpr[] {
    return e.kind === 'and'
        ? [...flattenAnd(e.left), ...flattenAnd(e.right)]
        : [e];
}

/** Ein `testfall` → ein `it(...)` (Spiegel runPruefeDecl). */
function emitTestCase(c: IrTestCase, indent: string): string {
    const I1 = indent + IND;            // it-Rumpf
    let bodyLines: string[];
    if (c.erwartetAbbruch) {
        // Abbruch erwartet → gesamte Auswertung im toThrow-Callback (lets
        // tiefer eingerückt, daher hier separat gerendert).
        const I2 = I1 + IND;
        bodyLines = [
            `${I1}expect(() => {`,
            ...c.lets.map((l) => emitLet(l, I2)),
            `${I2}${emitExpr(c.assertion)};`,
            `${I1}}).toThrow(FinDslAbort);`,
        ];
    } else {
        // Top-Level-`und` → je Konjunkt ein `expect(...).toBe(true)`.
        bodyLines = [
            ...c.lets.map((l) => emitLet(l, I1)),
            ...flattenAnd(c.assertion).map(
                (t) => `${I1}expect(${emitExpr(t)}).toBe(true);`),
        ];
    }
    return [
        `${indent}it(${tsString(c.label)}, () => {`,
        ...bodyLines,
        `${indent}});`,
    ].join('\n');
}

/**
 * Rendert ein `IrTestModule` zu einer Vitest-Spec (`*.test.ts`,
 * deterministisch). `prüfe` → `describe`, `testfall` → `it`; das SUT wird
 * per Namespace-Import (`import * as <SUT>`) eingebunden.
 */
export function emitTsTestModule(m: IrTestModule): TsModuleFile {
    crossClassByField = buildFieldToClass(m.composedModules);

    const suites = m.suites.map((s) => {
        const cases = s.cases.map((c) => emitTestCase(c, IND)).join('\n\n');
        return `describe(${tsString(s.suiteName)}, () => {\n${cases}\n});`;
    });
    const body = suites.join('\n\n');

    const header = importHeader(
        body, m.javaPackage, m.composedModules,
        ["import { describe, it, expect } from 'vitest';"],
    );
    const code = [
        ...header,
        '',
        ...moduleDoc(m.info),
        '',
        body,
        '',
    ].join('\n');

    // `*.test.ts` — von Vitests Standard-Glob erfasst.
    return { fileName: `${m.className}.test.ts`, code };
}
