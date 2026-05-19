// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * AST + aufgelöste Typen → target-neutrale IR (ADR1 `lower/`).
 *
 * Phase 1: `examples/kst`-Konstruktsatz. Phase 2: erweitert um den
 * `examples/est`-Satz — `Liste<T>`/`[]<T>`, `.zuordnen`/`.summe`/`.länge`,
 * parametrisches Lambda+Closure, `als`-Cast, Division, String-
 * Interpolation+`abbruch`, Block-als-`wähle`-Arm. `Bereich`/`für jeden`/
 * Index/Text-Methoden/`oder`/`T?` bleiben bewusste Phase-3-Guards.
 *
 * Die wert-/tag-tragende Semantik (parseNumberLiteral, castNumeric/
 * applyMoneyAnnotation, combine*, §11.2-Methoden) liegt in der Runtime
 * (ADR2); das Lowering trifft nur die *statischen* Entscheidungen, die
 * der Interpreter zur Laufzeit per AST-Kontext fällt (governingMoney-
 * Target; constructRecord-Positionsauflösung; Interpolations-Slots).
 */

import { Decimal } from 'decimal.js';
import {
    type Program, type TopDecl, type Expr, type Type,
    type FunktionDecl, type DatensatzDecl, type WaehleExpr,
    isKonstDecl, isFunktionDecl, isDatensatzDecl, isAufzaehlungDecl,
    isNumberLiteral, isStringLiteral, isCallChain, isParenChain,
    isCall, isFieldAccess, isBinaryOp, isWaehleExpr, isFallArm,
    isSonstArm, isCast, isAbbruchExpr, isLetStmt, isFunktionBody,
    isNamedType, isListLiteral, isLambda, isIndex, isPruefeDecl,
    isBoolLiteral, isUnaryOp,
} from '../../language/generated/ast.js';
import type {
    IrModule, IrDecl, IrExpr, IrArm, IrBlockResult, IrFnBody, IrField,
    IrParam, IrLet, IrDoc, ZahlFactory, ZielTyp, IrComposedModule,
    IrTestModule, IrTestSuite, IrTestCase,
} from '../ir/nodes.js';

interface DeclPrefixLike {
    doc?: string;
    annotations?: ReadonlyArray<{ name: string; args: ReadonlyArray<Expr> }>;
}
/** Roher `--…--`-Doc-Text + `@Quelle`-Argumente eines DeclPrefix übertragen. */
function extractDoc(prefix: DeclPrefixLike | undefined): IrDoc {
    const quelle: string[] = [];
    for (const a of prefix?.annotations ?? []) {
        if (a.name !== 'Quelle') continue;
        const arg = a.args[0];
        if (arg && isStringLiteral(arg)) quelle.push(arg.value);
    }
    return { doc: prefix?.doc, quelle };
}

/** Eine `verwende`-Bindung (lokaler Name ⇐ Quellname im Zielmodul). */
export interface LowerBinding {
    readonly localName: string;
    readonly sourceName: string;
}

/** Ein direkt importiertes Modul (eine `verwende … aus "…"`-Quelle). */
export interface LowerImport {
    /** Geparstes Ziel-Programm (für Symbol-Klassifikation/Registry-Merge). */
    readonly program: Program;
    /** Java-Klassenname des Zielmoduls (aus dessen Dateipfad, ADR8). */
    readonly className: string;
    /** Java-Package des Zielmoduls (`undefined` = unbenannt). */
    readonly javaPackage: string | undefined;
    readonly bindings: ReadonlyArray<LowerBinding>;
}

export interface LowerContext {
    /** `undefined` = unbenanntes (Default-)Package — kein `package …;`. */
    readonly javaPackage: string | undefined;
    readonly className: string;
    /** Direkte `verwende`-Importe (Phase 3); leer/undefined = keine. */
    readonly imports?: ReadonlyArray<LowerImport>;
}

/** Java-Feld-/Methodenname aus Java-Klassenname: erster Buchstabe klein. */
function lowerCamel(name: string): string {
    return name.length === 0 ? name : name.charAt(0).toLowerCase() + name.slice(1);
}

const NUMERIC_NAMES = new Set([
    'Ganzzahl', 'Dezimal', 'Prozent', 'Euro', 'EuroCent', 'Cent',
]);
const MONEY_NAMES = new Set(['Euro', 'Cent', 'EuroCent']);

interface NamedAtom { name: string; typeArgs?: { args: ReadonlyArray<Type> } }
function namedAtom(t: Type | undefined): NamedAtom | undefined {
    const atom = t?.atom;
    return atom && isNamedType(atom) ? (atom as NamedAtom) : undefined;
}

/** Name eines NamedType-Atoms, sonst undefined (Teil-Parse-robust). */
function atomName(t: Type | undefined): string | undefined {
    return namedAtom(t)?.name;
}

/**
 * FinDSL-Typ → Java-Typ. `Liste<T>`→`FinDslListe<E>`; numerisch→
 * FinDslNumber. Cross-modul Datensatz/Aufzählung wird zur nested-static
 * Klasse des Owner-Moduls qualifiziert (`OwnerClass.Typ`); lokal/builtin
 * unqualifiziert.
 */
function javaType(t: Type | undefined, reg: Registry): string {
    const a = namedAtom(t);
    if (a === undefined) return 'FinDslNumber';            // Teil-Parse: konservativ
    if (a.name === 'Liste') {
        const elem = a.typeArgs?.args?.[0];
        return `FinDslListe<${javaType(elem, reg)}>`;
    }
    if (NUMERIC_NAMES.has(a.name)) return 'FinDslNumber';
    if (a.name === 'Wahrheitswert') return 'boolean';
    if (a.name === 'Text') return 'String';
    const owner = reg.typeOwner.get(a.name);               // Datensatz/Aufzählung
    return owner !== undefined ? `${owner}.${a.name}` : a.name;
}

/** `true` ⇔ skalarer numerischer FinDSL-Typ (kein `Liste<…>`). */
function isNumericType(t: Type | undefined): boolean {
    const a = namedAtom(t);
    return a !== undefined && a.name !== 'Liste' && NUMERIC_NAMES.has(a.name);
}

/**
 * API-/Fassaden-Typ (deklarierte Grenzen: fn-Param/-Rückgabe, `record`-
 * Feld, `konst`): numerisch-skalar → **sprechender Wrapper** (= der
 * FinDSL-Typname `Euro`/`EuroCent`/`Cent`/`Prozent`/`Ganzzahl`/`Dezimal`).
 * `Liste<T>` bleibt `FinDslListe<Kern>` (Listen sind generische Rechen-
 * Container; `.summe()` einer leeren Liste ist orakel-gemäß `Ganzzahl 0`,
 * Boxing erst an der nächsten deklarierten Bindung). Alles übrige =
 * {@link javaType}.
 */
function apiJavaType(t: Type | undefined, reg: Registry): string {
    const a = namedAtom(t);
    if (a === undefined) return 'FinDslNumber';
    if (a.name === 'Liste') {
        const elem = a.typeArgs?.args?.[0];
        return `FinDslListe<${javaType(elem, reg)}>`;
    }
    if (NUMERIC_NAMES.has(a.name)) return a.name;          // sprechender Wrapper
    if (a.name === 'Wahrheitswert') return 'boolean';
    if (a.name === 'Text') return 'String';
    const owner = reg.typeOwner.get(a.name);
    return owner !== undefined ? `${owner}.${a.name}` : a.name;
}

/** Geld-Annotationsname (`Euro|Cent|EuroCent`) einer Typ-Annotation. */
function moneyAnnotation(t: Type | undefined): 'Euro' | 'Cent' | 'EuroCent' | undefined {
    const n = atomName(t);
    return n && MONEY_NAMES.has(n) ? (n as 'Euro' | 'Cent' | 'EuroCent') : undefined;
}

/** `als <Ziel>`-Ziel; nur numerische Casts (est nutzt nur diese). */
function castTarget(t: Type | undefined): ZielTyp {
    const n = atomName(t);
    if (n && NUMERIC_NAMES.has(n)) return n as ZielTyp;
    throw new Error(`nicht-numerischer \`als\`-Cast (${n}) ist Phase-3-Scope.`);
}

/**
 * Spiegel `values.ts parseNumberLiteral` (277-290): deutsche Notation
 * `.`=Tausender, `,`=Dezimal, `%`→Bruch (÷100 exakt via decimal.js).
 */
function parseNumberLiteral(raw: string): { factory: ZahlFactory; arg: string } {
    const hasPercent = raw.endsWith('%');
    const body = hasPercent ? raw.slice(0, -1) : raw;
    const normalized = body.replace(/\./g, '').replace(',', '.');
    if (hasPercent) {
        return { factory: 'prozent', arg: new Decimal(normalized).div(100).toString() };
    }
    if (body.includes(',')) return { factory: 'dezimal', arg: normalized };
    return { factory: 'ganzzahl', arg: normalized };
}

/**
 * Slot-Pfad-Regex — 1:1-Spiegel von `values.ts:244` (Identifier-Kette,
 * Unicode): JEDES Segment (auch nach `.`) muss mit Buchstabe/Underscore
 * beginnen (kein Ziffern-Start), exakt wie das Orakel.
 */
const SLOT_PATH = /^\s*([A-Za-zäöüÄÖÜß_][A-Za-z0-9äöüÄÖÜß_]*)(\s*\.\s*[A-Za-zäöüÄÖÜß_][A-Za-z0-9äöüÄÖÜß_]*)*\s*$/u;

/**
 * Spiegel `values.ts parseStringLiteral` (212-235): `${…}`-Slots aus dem
 * (Langium-entquoteten) String-Wert; mehrzeilig `""…""` → 2 Quotes weg.
 * Slot-Pfad gegen dieselbe Regex; sonst harter Fehler (wie Interpreter).
 */
function lowerStringLiteral(raw: string, reg: Registry): IrExpr {
    const body = (raw.startsWith('""') && raw.endsWith('""'))
        ? raw.slice(2, -2) : raw;
    const parts: string[] = [];
    const slots: IrExpr[] = [];
    let i = 0;
    for (;;) {
        const start = body.indexOf('${', i);
        // Nicht geschlossenes `${` → Rest inkl. `${` als Literal-Text
        // (exakt wie das Orakel, values.ts:227-229; Lint diagnostiziert).
        if (start < 0) { parts.push(body.slice(i)); break; }
        const end = body.indexOf('}', start + 2);
        if (end < 0) { parts.push(body.slice(i)); break; }
        parts.push(body.slice(i, start));
        const slotText = body.slice(start + 2, end);
        if (!SLOT_PATH.test(slotText)) {
            throw new Error(
                `Interpolations-Slot "${slotText}": nur Identifier-Ketten `
                + `(name / name.feld) — komplexere Slots sind Phase-3-Scope.`);
        }
        const segs = slotText.split('.').map((s) => s.trim());
        let slot: IrExpr = resolveBareName(segs[0], reg);
        for (let k = 1; k < segs.length; k++) {
            slot = { kind: 'field', receiver: slot, name: segs[k] };
        }
        slots.push(slot);
        i = end + 1;
    }
    return { kind: 'strInterp', parts, slots };
}

/**
 * Lokaler AST-Eltern-Walk, 1:1 zu `interpreter.ts governingMoneyTarget`
 * (1008-1029): nächste maßgebliche Geld-Annotation über `$container`.
 */
function governingMoneyTarget(node: object): 'Euro' | 'Cent' | undefined {
    let cur = node as { $container?: object };
    for (;;) {
        const c = cur.$container as
            | (object & { value?: unknown; type?: Type; targetType?: Type; $container?: unknown })
            | undefined;
        if (!c) return undefined;
        if (isCast(c) && c.value === cur) {
            const m = moneyAnnotation(c.targetType);
            if (m === 'Euro' || m === 'Cent') return m;
        } else if (isKonstDecl(c) && c.value === cur) {
            const m = moneyAnnotation(c.type);
            if (m === 'Euro' || m === 'Cent') return m;
        } else if (isLetStmt(c) && c.value === cur) {
            const m = c.type ? moneyAnnotation(c.type) : undefined;
            if (m === 'Euro' || m === 'Cent') return m;
        } else if (isFunktionBody(c)) {
            const fd = (c as { $container?: unknown }).$container;
            const m = isFunktionDecl(fd as object) ? moneyAnnotation((fd as FunktionDecl).returnType) : undefined;
            if (m === 'Euro' || m === 'Cent') return m;
        }
        cur = c as { $container?: object };
    }
}

interface EnumValueInfo {
    readonly enumName: string;
    /** Owner-Java-Klasse bei cross-modul Enum (sonst undefined = lokal/builtin). */
    readonly ownerClass?: string;
}
interface RecordInfo {
    readonly decl: DatensatzDecl;
    /** Owner-Java-Klasse bei cross-modul Datensatz (sonst undefined = lokal). */
    readonly ownerClass?: string;
}
interface CrossFnInfo {
    readonly fieldName: string;
    readonly methodName: string;
    /** Callee-Parameter-Typen (für Box numerischer Cross-Argumente). */
    readonly paramTypes: ReadonlyArray<Type | undefined>;
    /** Callee-Rückgabetyp (für Unbox numerischen Cross-Ergebnisses). */
    readonly returnType: Type | undefined;
}
interface Registry {
    readonly enumValues: ReadonlyMap<string, EnumValueInfo>;
    readonly records: ReadonlyMap<string, RecordInfo>;
    /** Cross-modul Typ-/Enum-NAME → Owner-Klasse (nur cross; lokal fehlt → unqualifiziert). */
    readonly typeOwner: ReadonlyMap<string, string>;
    /** Lokaler Name → Kompositions-Feld + Quell-`fn` + Callee-Signatur. */
    readonly crossFns: ReadonlyMap<string, CrossFnInfo>;
    /** Lokaler Name → Owner-Klasse + Quell-`konst` + numerisch? (`Owner.MEMBER`). */
    readonly crossKonst: ReadonlyMap<string, { ownerClass: string; memberName: string; numeric: boolean }>;
    /** Lokale `konst`: Name → numerisch? (Wrapper-getypt). */
    readonly localKonst: ReadonlyMap<string, boolean>;
    /**
     * Lokale `fn`: Name → intern? + Param-Typen. Öffentliche `fn` haben
     * Sicht-getypte Parameter → numerische Aufruf-Argumente boxen;
     * interne `_`-fn haben `FinDslNumber`-Parameter (kein Box, IS-A).
     */
    readonly localFns: ReadonlyMap<string,
        { internal: boolean; paramTypes: ReadonlyArray<Type | undefined> }>;
    /**
     * Per-`fn` veränderliche Sicht: lokaler Name (Param/`var`) → FinDSL-
     * Typ — für die Typauflösung von Record-Feldzugriffen (Lese-Unbox).
     * `lowerFn`/Block setzt sie vor dem Lowern des Rumpfs.
     */
    readonly scopeTypes: Map<string, Type | undefined>;
}

/** Eingebaute Sprach-Aufzählungen (SPEC § 8.5, kein Import) — Runtime-Enums. */
const BUILTIN_ENUMS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ['Tarifart', ['Grundtarif', 'Splitting']],
    ['Steuerklasse', ['I', 'II', 'III', 'IV', 'V', 'VI']],
];

function buildRegistry(
    program: Program,
    imports: ReadonlyArray<LowerImport>,
): Registry {
    const enumValues = new Map<string, EnumValueInfo>();
    for (const [enumName, values] of BUILTIN_ENUMS) {
        for (const v of values) enumValues.set(v, { enumName });
    }
    const records = new Map<string, RecordInfo>();
    const typeOwner = new Map<string, string>();
    const crossFns = new Map<string, CrossFnInfo>();
    const crossKonst = new Map<string, { ownerClass: string; memberName: string; numeric: boolean }>();
    const localKonst = new Map<string, boolean>();
    const localFns = new Map<string,
        { internal: boolean; paramTypes: ReadonlyArray<Type | undefined> }>();

    // Lokale Decls (ownerClass=undefined → in Java unqualifiziert/nested).
    for (const d of program.decls as ReadonlyArray<TopDecl>) {
        if (isAufzaehlungDecl(d)) {
            for (const v of d.values) enumValues.set(v, { enumName: d.name });
        } else if (isDatensatzDecl(d)) {
            records.set(d.name, { decl: d });
        } else if (isKonstDecl(d)) {
            localKonst.set(d.name, isNumericType(d.type));
        } else if (isFunktionDecl(d)) {
            localFns.set(d.name, {
                internal: d.name.startsWith('_'),
                paramTypes: d.params.map((p) => p.type),
            });
        }
    }

    // Importierte Module: Typen/Enum-Werte/Datensätze voll mergen (bei
    // validen Programmen graph-global eindeutig — gespiegelt am
    // Interpreter `applyImports`); `fn`/`konst` NUR für tatsächlich
    // gebundene Symbole (Komposition bzw. `Owner.MEMBER`).
    for (const imp of imports) {
        const owner = imp.className;
        const fieldName = lowerCamel(owner);
        const fnDecls = new Map<string, FunktionDecl>();
        const konstNumeric = new Map<string, boolean>();
        for (const d of imp.program.decls as ReadonlyArray<TopDecl>) {
            if (isAufzaehlungDecl(d)) {
                typeOwner.set(d.name, owner);
                for (const v of d.values) {
                    enumValues.set(v, { enumName: d.name, ownerClass: owner });
                }
            } else if (isDatensatzDecl(d)) {
                typeOwner.set(d.name, owner);
                records.set(d.name, { decl: d, ownerClass: owner });
            } else if (isFunktionDecl(d)) {
                fnDecls.set(d.name, d);
            } else if (isKonstDecl(d)) {
                konstNumeric.set(d.name, isNumericType(d.type));
            }
        }
        for (const b of imp.bindings) {
            const fd = fnDecls.get(b.sourceName);
            if (fd !== undefined) {
                // `fn`-Alias ist korrekt: emittiert `feld.<sourceName>()`.
                crossFns.set(b.localName, {
                    fieldName, methodName: b.sourceName,
                    paramTypes: fd.params.map((p) => p.type),
                    returnType: fd.returnType,
                });
            } else if (konstNumeric.has(b.sourceName)) {
                // `konst`-Alias ist korrekt: emittiert `Owner.<sourceName>`.
                crossKonst.set(b.localName, {
                    ownerClass: owner, memberName: b.sourceName,
                    numeric: konstNumeric.get(b.sourceName) === true,
                });
            } else if (b.localName !== b.sourceName) {
                // Typ-/Enum-Wert-Aliasse würden über `enumValues`/`typeOwner`
                // (per sourceName verschlüsselt) NICHT unter `localName`
                // aufgelöst → stilles Falsch. Aktiver Phase-4-Guard statt
                // stillem Fehler (kraftst nutzt keine solchen Aliasse).
                throw new Error(
                    `Alias "${b.sourceName} als ${b.localName}" auf einen Typ/`
                    + 'Aufzählungswert ist Phase-4-Scope (nur fn/konst-Aliasse '
                    + 'werden in Phase 3 unterstützt).');
            }
        }
    }
    return {
        enumValues, records, typeOwner, crossFns, crossKonst,
        localKonst, localFns, scopeTypes: new Map<string, Type | undefined>(),
    };
}

function lowerExpr(expr: Expr | undefined, reg: Registry): IrExpr {
    if (!expr) throw new Error('Teil-Parse: fehlender Ausdruck (Codegen).');

    if (isNumberLiteral(expr)) {
        const { factory, arg } = parseNumberLiteral(expr.value);
        return { kind: 'numLit', factory, arg };
    }
    if (isBoolLiteral(expr)) {
        return { kind: 'bool', value: expr.value === 'wahr' };   // undefined → falsch
    }
    if (isUnaryOp(expr)) {
        const value = lowerExpr(expr.operand, reg);
        // interpreter.ts:243-251 — `-` = numerische Negation (Art bleibt),
        // `nicht` = boolesche Negation.
        return expr.op === '-' ? { kind: 'neg', value } : { kind: 'not', value };
    }
    if (isStringLiteral(expr)) {
        return lowerStringLiteral(expr.value, reg);
    }
    if (isAbbruchExpr(expr)) {
        if (!expr.grund) throw new Error('abbruch ohne Begründung (Teil-Parse).');
        return { kind: 'abort', reason: lowerExpr(expr.grund, reg) };
    }
    if (isCast(expr)) {
        return { kind: 'cast', value: lowerExpr(expr.value, reg), target: castTarget(expr.targetType) };
    }
    if (isListLiteral(expr)) {
        const elemType = expr.typeArgs?.args?.[0];
        return {
            kind: 'listLit',
            elementJavaType: elemType ? javaType(elemType, reg) : 'FinDslNumber',
            items: expr.items.map((e) => lowerExpr(e, reg)),
        };
    }
    if (isBinaryOp(expr)) {
        const op = expr.op;
        if (op === 'und') {
            return { kind: 'and', left: lowerExpr(expr.left, reg), right: lowerExpr(expr.right, reg) };
        }
        if (op === '+' || op === '-' || op === '*') {
            return { kind: 'arith', op, left: lowerExpr(expr.left, reg), right: lowerExpr(expr.right, reg) };
        }
        if (op === '/') {
            return { kind: 'div', left: lowerExpr(expr.left, reg), right: lowerExpr(expr.right, reg) };
        }
        if (op === '==' || op === '!=' || op === '<' || op === '<=' || op === '>' || op === '>=') {
            const left = lowerExpr(expr.left, reg);
            const right = lowerExpr(expr.right, reg);
            // Enum-(Un)gleichheit → Java-Identitäts-`==`/`!=` (Phase 3,
            // kraftst `f.antrieb == Elektro`). Ordnungsvergleiche auf
            // Enums bleiben unzulässig (kein FinDSL-Konstrukt dafür).
            if (left.kind === 'enumVal' || right.kind === 'enumVal') {
                if (op !== '==' && op !== '!=') {
                    throw new Error(`Ordnungsvergleich "${op}" auf Aufzählung ist unzulässig.`);
                }
                return { kind: 'enumCmp', op, left, right };
            }
            return { kind: 'cmp', op, left, right };
        }
        if (op === 'oder') {
            throw new Error('`oder` ist Phase-3-Scope (est nutzt es nicht).');
        }
    }
    if (isWaehleExpr(expr)) {
        return lowerWaehle(expr, reg);
    }
    if (isParenChain(expr)) {
        return lowerChainOps(lowerExpr(expr.receiver, reg), expr.chain, reg);
    }
    if (isCallChain(expr)) {
        return lowerCallChain(expr, reg);
    }
    throw new Error(`Ausdruck ${(expr as { $type?: string }).$type} ist out-of-scope (Phase 3).`);
}

/**
 * Faltet eine Chevrotain-Kette (FieldAccess/Call/Index) über einen Basis-
 * Ausdruck: Skalar-Rundung (`.abrunden/.aufrunden` mit governingMoney-
 * Target), §-11.2-Listen-Methoden (`.zuordnen/.summe/.länge`), sonst
 * Record-Feldzugriff. Index = Phase-3-Guard.
 */
/**
 * Datensatz-Deklaration des Empfänger-Ausdrucks (für Feld-Unbox):
 * `ref`→Param/`var`-Typ (scopeTypes), verschachtelter `field`→Feldtyp,
 * `ctor`/Cross-Aufruf→Rückgabetyp. `undefined`, wenn nicht statisch
 * auflösbar (dann kein Unbox; ein etwaiger Wrapper-Fehlgriff fällt als
 * javac-Typfehler auf — nie als stiller Zahlenfehler).
 */
function exprFinDslType(e: IrExpr, reg: Registry): Type | undefined {
    if (e.kind === 'ref') return reg.scopeTypes.get(e.name);
    if (e.kind === 'field') {
        const rec = reg.records.get(
            atomName(exprFinDslType(e.receiver, reg)) ?? '')?.decl;
        return rec?.fields.find((x) => x.name === e.name)?.type;
    }
    if (e.kind === 'crossCall') {
        return [...reg.crossFns.values()]
            .find((c) => c.fieldName === e.fieldName && c.methodName === e.methodName)
            ?.returnType;
    }
    return undefined;            // ctor/list-ops etc.: nicht als Empfänger nötig
}


function lowerChainOps(
    base: IrExpr,
    chain: ReadonlyArray<object>,
    reg: Registry,
): IrExpr {
    let cur = base;
    let i = 0;
    while (i < chain.length) {
        const op = chain[i];
        if (isIndex(op)) {
            throw new Error('Listen-Index `[i]` ist Phase-3-Scope (est nutzt ihn nicht).');
        }
        if (!isFieldAccess(op) || !op.name) {
            throw new Error('Ketten-Glied außerhalb des Scopes (Phase 3).');
        }
        const fname = op.name;
        const next = chain[i + 1];
        const isMethodCall = next !== undefined && isCall(next);
        if (isMethodCall) {
            const call = next as { args: ReadonlyArray<{ name?: string; value: Expr }> };
            if (fname === 'abrunden' || fname === 'aufrunden') {
                const target = governingMoneyTarget(op) ?? 'Ganzzahl';
                cur = { kind: 'round', receiver: cur, mode: fname, target: target as ZielTyp };
            } else if (fname === 'zuordnen') {
                // Lambda-Param-Typ = Element-Typ des Empfängers
                // (`Liste<E>`) → in die Sicht eintragen, damit `e.feld`
                // im Lambda-Rumpf korrekt unboxt (z. B. `k.faktor()`).
                const recvAtom = namedAtom(exprFinDslType(cur, reg));
                const elemT = recvAtom?.name === 'Liste'
                    ? recvAtom.typeArgs?.args?.[0] : undefined;
                const lam = call.args[0]?.value;
                if (isLambda(lam) && lam.params.length === 1) {
                    reg.scopeTypes.set(lam.params[0].name, elemT);
                }
                cur = { kind: 'listMap', receiver: cur, fn: lowerLambdaArg(call.args, reg) };
            } else if (fname === 'summe') {
                if (call.args.length !== 0) throw new Error('`.summe()` erwartet keine Argumente.');
                cur = { kind: 'listMethod', receiver: cur, method: 'summe' };
            } else {
                throw new Error(`Listen-/Skalar-Methode "${fname}" ist Phase-3-Scope (est nutzt sie nicht).`);
            }
            i += 2;
        } else {
            if (fname === 'länge') {
                cur = { kind: 'listMethod', receiver: cur, method: 'laenge' };
            } else {
                // (C): Feld ist Sicht-Subtyp IS-A FinDslNumber → kein Unbox.
                cur = { kind: 'field', receiver: cur, name: fname };
            }
            i += 1;
        }
    }
    return cur;
}

/** Einziges `.zuordnen`-Argument = einstelliges Ausdrucks-Lambda. */
function lowerLambdaArg(
    args: ReadonlyArray<{ name?: string; value: Expr }>,
    reg: Registry,
): IrExpr {
    if (args.length !== 1) throw new Error('`.zuordnen` erwartet genau ein Lambda.');
    const lam = args[0].value;
    if (!isLambda(lam) || lam.params.length !== 1) {
        throw new Error('`.zuordnen`-Argument muss ein einstelliges Lambda sein (Phase 2).');
    }
    if (!lam.result) throw new Error('Lambda ohne Ergebnis (Teil-Parse).');
    if (lam.stmts.length > 0) {
        throw new Error('Block-Lambda als `.zuordnen`-Argument ist Phase-3-Scope.');
    }
    return { kind: 'lambda1', param: lam.params[0].name, body: lowerExpr(lam.result, reg) };
}

/**
 * Bezeichner ohne Aufruf-Klammern → IR: Enum-Wert (lokal/builtin oder
 * cross-modul qualifiziert) ▸ cross-modul `konst` (`Owner.MEMBER`) ▸
 * lokale/Parameter-/konst-Referenz.
 */
function resolveBareName(name: string, reg: Registry): IrExpr {
    const ev = reg.enumValues.get(name);
    if (ev !== undefined) {
        return { kind: 'enumVal', enumName: ev.enumName, value: name, ownerClass: ev.ownerClass };
    }
    const ck = reg.crossKonst.get(name);
    if (ck !== undefined) {
        // (C): Sicht-Subtyp IST-EIN FinDslNumber → kein Unbox beim Lesen.
        return { kind: 'crossRef', ownerClass: ck.ownerClass, memberName: ck.memberName };
    }
    // (C): lokale `konst`/Param/`var` sind alle als FinDslNumber lesbar
    // (Sicht-Subtyp IS-A) → schlichte Referenz, kein Unbox.
    return { kind: 'ref', name };
}

function lowerCallChain(
    cc: { name?: string; chain: ReadonlyArray<object> },
    reg: Registry,
): IrExpr {
    const name = cc.name;
    if (name === undefined) throw new Error('Teil-Parse: CallChain ohne Name.');
    if (cc.chain.length === 0) {
        return resolveBareName(name, reg);
    }
    const first = cc.chain[0];
    if (isCall(first)) {
        const call = first;
        const rec = reg.records.get(name);
        const cf = reg.crossFns.get(name);
        let head: IrExpr;
        if (rec !== undefined) {
            head = {
                kind: 'ctor', typeName: rec.decl.name, ownerClass: rec.ownerClass,
                args: resolveCtorArgs(rec.decl, call.args, reg),
            };
        } else if (cf !== undefined) {
            // Cross-Aufruf → Interface-Methode (Sicht-Signatur):
            // numerische Argumente auf den Sicht-Param boxen. Das
            // Ergebnis ist Sicht-Subtyp IS-A FinDslNumber → KEIN Unbox.
            const args = call.args.map((a, idx) => {
                const e = lowerExpr(a.value, reg);
                const pt = cf.paramTypes[idx];
                return isNumericType(pt)
                    ? { kind: 'box', wrapper: namedAtom(pt)!.name, expr: e } as IrExpr
                    : e;
            });
            head = {
                kind: 'crossCall', fieldName: cf.fieldName, methodName: cf.methodName, args,
            };
        } else {
            // Lokaler Aufruf: EINE Methode. Öffentliche `fn` haben
            // Sicht-getypte Parameter → numerische Argumente boxen;
            // interne `_`-fn haben FinDslNumber-Parameter (kein Box).
            const lf = reg.localFns.get(name);
            const args = call.args.map((a, idx) => {
                const e = lowerExpr(a.value, reg);
                const pt = lf?.paramTypes[idx];
                return (lf !== undefined && !lf.internal && isNumericType(pt))
                    ? { kind: 'box', wrapper: namedAtom(pt)!.name, expr: e } as IrExpr
                    : e;
            });
            head = { kind: 'call', name, args };
        }
        return cc.chain.length > 1
            ? lowerChainOps(head, cc.chain.slice(1), reg)
            : head;
    }
    return lowerChainOps(resolveBareName(name, reg), cc.chain, reg);
}

/**
 * constructRecord-Spiegel (interpreter.ts:1173-1219): pro Feld in
 * Deklarationsreihenfolge — benanntes Arg ▸ positionales Arg ▸ Default
 * ▸ Pflichtfehler. Defaults OHNE applyMoneyAnnotation (wie Orakel).
 */
function resolveCtorArgs(
    rec: DatensatzDecl,
    args: ReadonlyArray<{ name?: string; value: Expr }>,
    reg: Registry,
): ReadonlyArray<IrExpr> {
    const named = new Map<string, Expr>();
    const positional: Expr[] = [];
    for (const a of args) {
        if (a.name) named.set(a.name, a.value);
        else positional.push(a.value);
    }
    let posIdx = 0;
    return rec.fields.map((f) => {
        // Record-Felder sind Wrapper-getypt (API) → numerisches Argument
        // (Rechen-Schicht) boxen. Box ist rein strukturell (ändert Wert/
        // Tag nicht) — constructRecord-Spiegel: Defaults OHNE moneyAnno.
        const box = (e: IrExpr): IrExpr =>
            isNumericType(f.type) ? { kind: 'box', wrapper: namedAtom(f.type)!.name, expr: e } : e;
        const byName = named.get(f.name);
        if (byName) return box(lowerExpr(byName, reg));
        if (posIdx < positional.length) return box(lowerExpr(positional[posIdx++], reg));
        if (f.default) return box(lowerExpr(f.default, reg));
        throw new Error(`Pflichtfeld "${f.name}" fehlt bei ${rec.name}(…).`);
    });
}

/** Block-Lambda (`{ var …; ergebnis }`) als Arm-Ergebnis → IrBlockResult. */
function lowerBlockLambda(lam: { stmts: ReadonlyArray<object>; result?: Expr }, reg: Registry): IrBlockResult {
    if (!lam.result) throw new Error('Block-Arm ohne Ergebnis (Teil-Parse).');
    for (const s of lam.stmts.filter(isLetStmt)) {
        reg.scopeTypes.set(s.name, s.type);          // Sicht für Feld-Unbox
    }
    const lets: IrLet[] = lam.stmts
        .filter(isLetStmt)
        .map((s) => ({
            name: s.name,
            javaType: javaType(s.type, reg),
            expr: maybeMoneyAnno(lowerExpr(s.value, reg), s.type, `var "${s.name}"`),
        }));
    return { kind: 'blockResult', lets, result: lowerExpr(lam.result, reg) };
}

function lowerArmResult(result: Expr | undefined, reg: Registry): IrExpr | IrBlockResult {
    if (!result) throw new Error('wähle-Arm ohne Ergebnis (Teil-Parse).');
    if (isLambda(result) && result.params.length === 0) {
        return lowerBlockLambda(result, reg);
    }
    return lowerExpr(result, reg);
}

function lowerWaehle(w: WaehleExpr, reg: Registry): IrExpr {
    const arms: IrArm[] = w.arms.map((arm) => {
        if (isFallArm(arm)) {
            return {
                patterns: arm.patterns.map((p) => lowerExpr(p as Expr, reg)),
                result: lowerArmResult(arm.result, reg),
                isSonst: false,
            };
        }
        if (isSonstArm(arm)) {
            return { patterns: [], result: lowerArmResult(arm.result, reg), isSonst: true };
        }
        throw new Error('Unbekannter wähle-Arm.');
    });
    return {
        kind: 'waehle',
        subject: w.subject ? lowerExpr(w.subject, reg) : undefined,
        arms,
    };
}

function lowerFn(fd: FunktionDecl, reg: Registry): IrDecl {
    const params: IrParam[] = fd.params.map((p) => ({
        name: p.name,
        javaType: javaType(p.type, reg),          // Kern (FinDslNumber)
        apiType: apiJavaType(p.type, reg),        // Fassade (Wrapper)
        numeric: isNumericType(p.type),
    }));
    const returnJavaType = javaType(fd.returnType, reg);
    const returnApiType = apiJavaType(fd.returnType, reg);
    const returnNumeric = isNumericType(fd.returnType);

    // Per-`fn`-Sicht für Record-Feld-Unbox: Param- und `var`-Typen.
    // Param/`var` sind im Kern bereits FinDslNumber — die Sicht dient
    // nur dazu, Datensatz-Empfänger von Feldzugriffen aufzulösen.
    reg.scopeTypes.clear();
    for (const p of fd.params) reg.scopeTypes.set(p.name, p.type);
    if (fd.body.block) {
        for (const s of fd.body.block.stmts.filter(isLetStmt)) {
            reg.scopeTypes.set(s.name, s.type);
        }
    } else if (fd.body.expr && isLambda(fd.body.expr) && fd.body.expr.params.length === 0) {
        for (const s of fd.body.expr.stmts.filter(isLetStmt)) {
            reg.scopeTypes.set(s.name, s.type);
        }
    }

    let body: IrFnBody;
    if (fd.body.expr) {
        const ex = fd.body.expr;
        if (isLambda(ex) && ex.params.length === 0) {
            // `fn … = { var …; ergebnis }` — Block-Lambda als ganzer Body.
            const blk = lowerBlockLambda(ex, reg);
            body = { kind: 'block', lets: blk.lets, result: blk.result };
        } else {
            body = { kind: 'expr', expr: lowerExpr(ex, reg) };
        }
    } else if (fd.body.block) {
        const blk = fd.body.block;
        const lets = blk.stmts
            .filter(isLetStmt)
            .map((s) => ({
                name: s.name,
                javaType: javaType(s.type, reg),
                expr: maybeMoneyAnno(lowerExpr(s.value, reg), s.type, `var "${s.name}"`),
            }));
        body = { kind: 'block', lets, result: lowerExpr(blk.result, reg) };
    } else {
        throw new Error(`fn ${fd.name}: leerer Body (Teil-Parse).`);
    }
    // `wähle` aus reinem Teilausdruck-Kontext in Ergebnisposition heben
    // (P2; Emitter lowert `wähle` nur dort, ADR4).
    body = body.kind === 'expr'
        ? { kind: 'expr', expr: floatWaehle(body.expr) }
        : { kind: 'block', lets: floatLets(body.lets), result: floatWaehle(body.result) };

    // (C): öffentliche `fn` deklarieren einen Sicht-Rückgabetyp; das
    // Kern-Ergebnis (FinDslNumber) wird an JEDER Ergebnisposition auf
    // die Sicht geboxt (`Euro.von(…)`). Interne `_`-fn geben den Kern
    // (FinDslNumber) zurück → kein Box.
    if (!fd.name.startsWith('_') && returnNumeric) {
        body = body.kind === 'expr'
            ? { kind: 'expr', expr: boxReturnExpr(body.expr, returnApiType) }
            : { kind: 'block', lets: body.lets, result: boxReturnExpr(body.result, returnApiType) };
    }

    return {
        kind: 'fn',
        name: fd.name,
        internal: fd.name.startsWith('_'),
        params,
        returnJavaType,
        returnApiType,
        returnNumeric,
        body,
        info: extractDoc(fd.docPrefix),
    };
}

/**
 * Boxt die RÜCKGABE einer öffentlichen `fn` auf den Sicht-Subtyp:
 * jede Ergebnisposition (`wähle`-Arm, Block-Ergebnis, schlichter
 * Ausdruck) wird in `box{wrapper}` gehüllt; `abbruch` (wirft, kein
 * Wert) und bereits geboxte Ausdrücke bleiben unberührt. Rein
 * strukturell (Wert/Tag unverändert) → bit-genau.
 */
function boxReturn(r: IrExpr | IrBlockResult, wrapper: string): IrExpr | IrBlockResult {
    return r.kind === 'blockResult'
        ? { ...r, result: boxReturnExpr(r.result, wrapper) }
        : boxReturnExpr(r, wrapper);
}
function boxReturnExpr(e: IrExpr, wrapper: string): IrExpr {
    if (e.kind === 'waehle') {
        return { ...e, arms: e.arms.map((a) => ({ ...a, result: boxReturn(a.result, wrapper) })) };
    }
    if (e.kind === 'abort' || e.kind === 'box') return e;
    return { kind: 'box', wrapper, expr: e };
}

/**
 * `var`/`konst` mit Euro/Cent/EuroCent-Annotation → Runtime-
 * `withMoneyAnnotation` (= applyMoneyAnnotation). Prozent/Ganzzahl/
 * Dezimal/Liste → No-Op (moneyAnnotationName undefined).
 */
function maybeMoneyAnno(expr: IrExpr, t: Type | undefined, what: string): IrExpr {
    const m = moneyAnnotation(t);
    if (!m) return expr;
    return { kind: 'moneyAnno', expr, target: m, what };
}

// ---------------------------------------------------------------------------
// `wähle` aus reinem Ausdruckskontext herausziehen (Phase 3)
// ---------------------------------------------------------------------------
//
// Der Emitter lowert `wähle` ausschließlich in Ergebnisposition zu
// if/return (ADR4 — Java hat kein Ausdrucks-`if`). FinDSL erlaubt aber
// `wähle` als Teilausdruck (kraftst `_SteuerPkwB = sockel + wähle {…}`).
// Da FinDSL-Ausdrücke seiteneffektfrei sind (P2), ist das Verteilen des
// umgebenden reinen Kontexts in JEDEN Arm semantik-erhaltend:
//   `f(wähle { p->r ; sonst->s })` ≡ `wähle { p->f(r) ; sonst->f(s) }`.
// `floatWaehle` bubbelt jedes eingebettete `wähle` nach oben; das
// Resultat ist entweder `wähle`-frei oder ein `wähle`, dessen Arm-
// Ergebnisse rekursiv normalisiert sind (emitResult kann verschachtelte
// `wähle` in Ergebnisposition).
//
// Mehrere `wähle`-Kinder eines Knotens (z. B. `wähle{…} + wähle{…}`):
// es wird zuerst das LINKE gehoben; das rechte `wähle` bleibt in der
// Closure als fester Operand und wird durch das erneute `floatWaehle`
// in `pushCtxExpr` (auf dem rekonstruierten Knoten) anschließend
// herausgehoben. Terminiert: jeder Schritt operiert auf strikt
// kleineren Teilbäumen.

function isChoice(e: IrExpr): e is Extract<IrExpr, { kind: 'waehle' }> {
    return e.kind === 'waehle';
}

/** Reinen unären Kontext `k` in eine Ergebnisposition (Arm/Block/Leaf) drücken. */
function pushCtx(
    r: IrExpr | IrBlockResult,
    k: (leaf: IrExpr) => IrExpr,
): IrExpr | IrBlockResult {
    if (r.kind === 'blockResult') {
        return { ...r, lets: floatLets(r.lets), result: pushCtxExpr(r.result, k) };
    }
    if (r.kind === 'waehle') {
        return { ...r, arms: r.arms.map((a) => ({ ...a, result: pushCtx(a.result, k) })) };
    }
    return pushCtxExpr(r, k);
}
function floatLets(lets: ReadonlyArray<IrLet>): IrLet[] {
    // `var` darf einen `wähle`-Wert tragen (Phase 4) — der Emitter
    // statement-lowert ihn (blank `final` + Zuweisungs-Sink). Daher
    // floatWaehle (hebt eingebettete `wähle`), NICHT floatValue (wirft).
    return lets.map((l) => ({ ...l, expr: floatWaehle(l.expr) }));
}
function pushCtxExpr(e: IrExpr, k: (leaf: IrExpr) => IrExpr): IrExpr {
    const f = floatWaehle(e);
    if (isChoice(f)) {
        return { ...f, arms: f.arms.map((a) => ({ ...a, result: pushCtx(a.result, k) })) };
    }
    // `abbruch` wirft (kein Wert) → umgebenden Kontext (moneyAnno/box/
    // cast/…) NICHT anwenden (wäre semantisch leer & emit-invalide),
    // wie boxReturn.
    if (f.kind === 'abort') return f;
    return floatWaehle(k(f));
}

/** Arm-/Block-Ergebnis selbst normalisieren (verschachtelte `wähle`). */
function floatResult(r: IrExpr | IrBlockResult): IrExpr | IrBlockResult {
    if (r.kind === 'blockResult') {
        return { ...r, lets: floatLets(r.lets), result: floatWaehle(r.result) };
    }
    return floatWaehle(r);
}

/**
 * Hebt jedes eingebettete `wähle` durch reine Operator-/Aufruf-/Cast-/
 * Feld-/Interpolations-Knoten nach außen. Deterministisch, terminierend
 * (strukturelle Rekursion; jeder Knoten endlich tief).
 */
function floatWaehle(e: IrExpr): IrExpr {
    switch (e.kind) {
        case 'waehle':
            return { ...e, arms: e.arms.map((a) => ({ ...a, result: floatResult(a.result) })) };
        case 'arith': case 'div': case 'cmp': case 'enumCmp': case 'and': {
            const L = floatWaehle(e.left);
            const R = floatWaehle(e.right);
            if (isChoice(L)) return pushCtxExpr(L, (l) => ({ ...e, left: l, right: R }));
            if (isChoice(R)) return pushCtxExpr(R, (r) => ({ ...e, left: L, right: r }));
            return { ...e, left: L, right: R };
        }
        case 'cast': case 'neg': case 'not': {
            const v = floatWaehle(e.value);
            return isChoice(v) ? pushCtxExpr(v, (x) => ({ ...e, value: x })) : { ...e, value: v };
        }
        case 'round': case 'listMethod': {
            const rc = floatWaehle(e.receiver);
            return isChoice(rc) ? pushCtxExpr(rc, (x) => ({ ...e, receiver: x })) : { ...e, receiver: rc };
        }
        case 'listMap': {
            const rc = floatWaehle(e.receiver);
            return isChoice(rc) ? pushCtxExpr(rc, (x) => ({ ...e, receiver: x })) : { ...e, receiver: rc };
        }
        case 'moneyAnno': case 'box': case 'unbox': {
            const x = floatWaehle(e.expr);
            return isChoice(x) ? pushCtxExpr(x, (y) => ({ ...e, expr: y })) : { ...e, expr: x };
        }
        case 'field': {
            const rc = floatWaehle(e.receiver);
            return isChoice(rc) ? pushCtxExpr(rc, (x) => ({ ...e, receiver: x })) : { ...e, receiver: rc };
        }
        case 'abort': {
            const x = floatWaehle(e.reason);
            return isChoice(x) ? pushCtxExpr(x, (y) => ({ ...e, reason: y })) : { ...e, reason: x };
        }
        case 'call': case 'crossCall': case 'ctor': case 'listLit': {
            const key = e.kind === 'listLit' ? 'items' : 'args';
            const xs = (e as unknown as Record<string, IrExpr[]>)[key].map(floatWaehle);
            const idx = xs.findIndex(isChoice);
            if (idx < 0) {
                return { ...e, [key]: xs } as IrExpr;
            }
            const w = xs[idx] as Extract<IrExpr, { kind: 'waehle' }>;
            return pushCtxExpr(w, (leaf) => {
                const next = xs.slice();
                next[idx] = leaf;
                return { ...e, [key]: next } as IrExpr;
            });
        }
        case 'strInterp': {
            const xs = e.slots.map(floatWaehle);
            const idx = xs.findIndex(isChoice);
            if (idx < 0) return { ...e, slots: xs };
            const w = xs[idx] as Extract<IrExpr, { kind: 'waehle' }>;
            return pushCtxExpr(w, (leaf) => {
                const next = xs.slice();
                next[idx] = leaf;
                return { ...e, slots: next };
            });
        }
        // Blätter ohne `wähle`-Kinder: numLit/ref/enumVal/crossRef/lambda1.
        default:
            return e;
    }
}

/** Floatet einen Wert; `wähle` als var-/konst-Wert ist Phase-4-Scope. */
function floatValue(e: IrExpr, what: string): IrExpr {
    const f = floatWaehle(e);
    if (isChoice(f)) {
        throw new Error(`\`wähle\` als Wert von ${what} ist Phase-4-Scope `
            + '(Statement-Zuweisung nötig; kraftst nutzt es nicht).');
    }
    return f;
}

/**
 * Kompositions-Felder: ein Feld je importiertem Modul, aus dem mindestens
 * ein `fn` gebunden wird (Cross-Aufruf braucht eine Instanz). Reihenfolge
 * = `verwende`-Reihenfolge, dedupliziert (Determinismus).
 */
function computeComposedModules(
    imports: ReadonlyArray<LowerImport>,
): IrComposedModule[] {
    const out: IrComposedModule[] = [];
    const seen = new Set<string>();
    for (const imp of imports) {
        const fnNames = new Set<string>();
        for (const d of imp.program.decls as ReadonlyArray<TopDecl>) {
            if (isFunktionDecl(d)) fnNames.add(d.name);
        }
        const usesFn = imp.bindings.some((b) => fnNames.has(b.sourceName));
        if (usesFn && !seen.has(imp.className)) {
            seen.add(imp.className);
            out.push({
                className: imp.className,
                fieldName: lowerCamel(imp.className),
                javaPackage: imp.javaPackage,
            });
        }
    }
    return out;
}

export function lowerProgram(program: Program, ctx: LowerContext): IrModule {
    const imports = ctx.imports ?? [];
    const reg = buildRegistry(program, imports);
    const composedModules = computeComposedModules(imports);

    const decls: IrDecl[] = [];
    for (const d of program.decls as ReadonlyArray<TopDecl>) {
        if (isKonstDecl(d)) {
            // `konst` ist API → numerisch Wrapper-getypt; der Kern-
            // Ausdruck bleibt unverändert (Emitter boxt: `W.von(expr)`).
            decls.push({
                kind: 'konst',
                name: d.name,
                expr: floatValue(
                    maybeMoneyAnno(lowerExpr(d.value, reg), d.type, `Konstante "${d.name}"`),
                    `Konstante "${d.name}"`),
                wrapper: isNumericType(d.type) ? namedAtom(d.type)!.name : undefined,
                info: extractDoc(d.docPrefix),
            });
        } else if (isAufzaehlungDecl(d)) {
            decls.push({ kind: 'enum', name: d.name, values: d.values, info: extractDoc(d.docPrefix) });
        } else if (isDatensatzDecl(d)) {
            // Record-Felder sind API → numerisch Wrapper-getypt.
            const fields: IrField[] = d.fields.map((f) => ({
                name: f.name,
                javaType: apiJavaType(f.type, reg),
                numeric: isNumericType(f.type),
            }));
            decls.push({ kind: 'record', name: d.name, fields, info: extractDoc(d.docPrefix) });
        } else if (isFunktionDecl(d)) {
            decls.push(lowerFn(d, reg));
        }
        // PruefeDecl: Phase 3 (prüfe→JUnit).
    }
    return {
        javaPackage: ctx.javaPackage,
        className: ctx.className,
        decls,
        info: extractDoc(program.fileDoc),
        composedModules,
    };
}

/**
 * `*.test.findsl` → `IrTestModule` (JUnit5). Nutzt die Cross-Modul-
 * Maschinerie aus Inkrement 2: das SUT wird per `verwende` importiert,
 * `buildRegistry`/`composedModules` lösen Aufrufe als `sut.methode(…)`
 * auf. Spiegel `pruefe.ts runPruefeDecl`: `var` → `lets`, `BlockExpr.
 * result` → `assertion`; `erwartetAbbruch` durchgereicht.
 */
export function lowerTestProgram(program: Program, ctx: LowerContext): IrTestModule {
    const imports = ctx.imports ?? [];
    const reg = buildRegistry(program, imports);
    const composedModules = computeComposedModules(imports);

    const suites: IrTestSuite[] = [];
    for (const d of program.decls as ReadonlyArray<TopDecl>) {
        if (!isPruefeDecl(d)) continue;                  // Nur prüfe-Blöcke
        const cases: IrTestCase[] = d.beispiele.map((b) => {
            const stmts = b.body.stmts ?? [];
            // Per-testfall-Sicht: `var`-Typen für Record-Feld-Unbox in
            // den Assertions (z. B. `e.gesamtbetragDerEinkuenfte()`).
            reg.scopeTypes.clear();
            for (const s of stmts.filter(isLetStmt)) {
                reg.scopeTypes.set(s.name, s.type);
            }
            const lets: IrLet[] = [];
            for (const s of stmts) {
                if (!isLetStmt(s)) {
                    throw new Error('`ausgabe` in prüfe-Block ist Phase-4-Scope '
                        + `(prüfe "${d.name}").`);
                }
                lets.push({
                    name: s.name,
                    javaType: javaType(s.type, reg),
                    // `var` darf `wähle`-Wert tragen (Phase 4) → floatWaehle
                    // (Emitter statement-lowert), nicht floatValue (wirft).
                    expr: floatWaehle(
                        maybeMoneyAnno(lowerExpr(s.value, reg), s.type, `var "${s.name}"`)),
                });
            }
            const assertion = floatWaehle(lowerExpr(b.body.result, reg));
            if (isChoice(assertion)) {
                throw new Error('`wähle` als testfall-Ergebnis ist Phase-4-Scope '
                    + `(prüfe "${d.name}", testfall "${b.label}").`);
            }
            return {
                label: b.label,
                erwartetAbbruch: b.erwartetAbbruch === true,
                lets,
                assertion,
            };
        });
        suites.push({ suiteName: d.name, cases });
    }

    return {
        javaPackage: ctx.javaPackage,
        className: ctx.className,
        composedModules,
        suites,
        info: extractDoc(program.fileDoc),
    };
}
