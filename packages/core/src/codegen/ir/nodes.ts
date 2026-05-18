// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Target-neutrale Codegen-IR (ADR1 `ir/`).
 *
 * Phase 1: deckt genau den `examples/kst`-Konstruktsatz ab (KISS/YAGNI):
 * `konst`/`aufzählung`/`datensatz`/`fn` (Ausdrucks- & Block-Body),
 * `wähle` (subjektlos/Enum, Mehrfach-Pattern, `sonst`), Vergleiche,
 * `+ - *`, `.abrunden()/.aufrunden()` mit beim Lowering aufgelöstem Ziel,
 * Zahl-Literale, Feldzugriff, Aufruf/Konstruktor, `abbruch`. Listen/
 * Bereich/Lambda folgen in Phase 2.
 *
 * Sprach-unabhängig (ADR11): dieselbe IR speist Java- und später
 * TS/JS-Emitter. Die `combine*`-Tag-Logik lebt in der Runtime — die IR
 * trägt nur die *aufgelösten* Geld-Rundungsziele (governingMoneyTarget
 * EINMALIG beim Lowering, interpreter.ts:1008).
 */

/** Faktor-Methode der Runtime `FinDslNumber` (= Ergebnis von parseNumberLiteral). */
export type ZahlFactory =
    | 'ganzzahl' | 'dezimal' | 'prozent'
    | 'euro' | 'euroCent' | 'cent';

/** Aufgelöstes Rundungs-/Geldziel (= `FinDslNumber.Type`-Konstante). */
export type ZielTyp = 'Ganzzahl' | 'Dezimal' | 'Prozent' | 'Euro' | 'EuroCent' | 'Cent';

export type IrExpr =
    /** `FinDslNumber.<factory>("<arg>")` — arg ist der normalisierte Dezimalstring. */
    | { readonly kind: 'numLit'; readonly factory: ZahlFactory; readonly arg: string }
    /** Lokale/Parameter-/konst-Referenz (Bezeichner verbatim). */
    | { readonly kind: 'ref'; readonly name: string }
    /** Aufzählungs-Wert `EnumName.Value`. */
    | { readonly kind: 'enumVal'; readonly enumName: string; readonly value: string }
    /** Record-Feldzugriff → Java-Accessor `receiver.name()`. */
    | { readonly kind: 'field'; readonly receiver: IrExpr; readonly name: string }
    /** Statischer Funktionsaufruf `name(args…)`. */
    | { readonly kind: 'call'; readonly name: string; readonly args: ReadonlyArray<IrExpr> }
    /** Record-Konstruktion `new TypeName(args…)` — Args positionsaufgelöst. */
    | { readonly kind: 'ctor'; readonly typeName: string; readonly args: ReadonlyArray<IrExpr> }
    /** Arithmetik → `left.add/sub/mul(right)`. */
    | { readonly kind: 'arith'; readonly op: '+' | '-' | '*'; readonly left: IrExpr; readonly right: IrExpr }
    /** Vergleich → boolean (`equalsValue`/`compareValue`). */
    | { readonly kind: 'cmp'; readonly op: '==' | '!=' | '<' | '<=' | '>' | '>='; readonly left: IrExpr; readonly right: IrExpr }
    /** Logisches `und` → `&&`. */
    | { readonly kind: 'and'; readonly left: IrExpr; readonly right: IrExpr }
    /** `(receiver).abrunden()/.aufrunden()` — Ziel beim Lowering fixiert. */
    | { readonly kind: 'round'; readonly receiver: IrExpr; readonly mode: 'abrunden' | 'aufrunden'; readonly target: ZielTyp }
    /** `abbruch(grund)` → `throw new FinDslAbort(grund)`. */
    | { readonly kind: 'abort'; readonly reason: IrExpr }
    /** `konst`/`var`-Geld-Annotation → `expr.withMoneyAnnotation(Type.X, "what")`. */
    | { readonly kind: 'moneyAnno'; readonly expr: IrExpr; readonly target: 'Euro' | 'Cent' | 'EuroCent'; readonly what: string }
    /** `wähle` als Ausdruck — wird vom Emitter zu if/return gelowert. */
    | { readonly kind: 'waehle'; readonly subject?: IrExpr; readonly arms: ReadonlyArray<IrArm> };

export interface IrArm {
    /** Leer ⇔ `sonst`-Arm. Bei Subjekt: Enum-Werte; sonst: boolesche Prädikate. */
    readonly patterns: ReadonlyArray<IrExpr>;
    readonly result: IrExpr;
    readonly isSonst: boolean;
}

export type IrFnBody =
    | { readonly kind: 'expr'; readonly expr: IrExpr }
    | { readonly kind: 'block'; readonly lets: ReadonlyArray<IrLet>; readonly result: IrExpr };

export interface IrLet {
    readonly name: string;
    readonly javaType: string;
    readonly expr: IrExpr;
}

export interface IrParam {
    readonly name: string;
    readonly javaType: string;
}

export interface IrField {
    readonly name: string;
    readonly javaType: string;
    // Java `record` hat keine Feld-Defaults; Defaults werden callsite-
    // seitig in `resolveCtorArgs` (constructRecord-Spiegel) aufgelöst.
}

/** Übertragene FinDSL-Doku: Markdown-Prosa + `@Quelle`-Annotationen. */
export interface IrDoc {
    /** Roher `--…--`-Doc-Text (Markdown), undefined wenn keiner. */
    readonly doc?: string;
    /** `@Quelle("…")`-Argumente (eine Zeile je Annotation). */
    readonly quelle: ReadonlyArray<string>;
}

export type IrDecl =
    | { readonly kind: 'konst'; readonly name: string; readonly expr: IrExpr; readonly info: IrDoc }
    | { readonly kind: 'enum'; readonly name: string; readonly values: ReadonlyArray<string>; readonly info: IrDoc }
    | { readonly kind: 'record'; readonly name: string; readonly fields: ReadonlyArray<IrField>; readonly info: IrDoc }
    | {
        readonly kind: 'fn';
        readonly name: string;
        /** Führendes `_` ⇒ `protected` statt `public` (Nutzer-Entscheidung). */
        readonly internal: boolean;
        readonly params: ReadonlyArray<IrParam>;
        readonly returnJavaType: string;
        readonly body: IrFnBody;
        readonly info: IrDoc;
      };

export interface IrModule {
    readonly javaPackage: string;
    readonly className: string;
    readonly decls: ReadonlyArray<IrDecl>;
    /** Datei-Doc (`Program.fileDoc`) → Klassen-Javadoc. */
    readonly info: IrDoc;
}
