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
    /** Boxing an API-Grenze: Rechenkern → sprechender Wrapper (`Wrapper.von(e)`). */
    | { readonly kind: 'box'; readonly wrapper: string; readonly expr: IrExpr }
    /** Unboxing an API-Grenze: sprechender Wrapper → Rechenkern (`e.zahl()`). */
    | { readonly kind: 'unbox'; readonly expr: IrExpr }
    /**
     * Aufzählungs-Wert. Lokal/Builtin → `EnumName.Value`; cross-modul →
     * `OwnerClass.EnumName.Value` (Enum ist nested-static der Owner-Klasse).
     */
    | { readonly kind: 'enumVal'; readonly enumName: string; readonly value: string; readonly ownerClass?: string }
    /**
     * Record-Feldzugriff → Java-Accessor `receiver.name()`. `unbox` ⇔
     * das Feld ist ein numerischer Wrapper → `.zahl()` für die Rechen-
     * Schicht anhängen.
     */
    | { readonly kind: 'field'; readonly receiver: IrExpr; readonly name: string; readonly unbox?: boolean }
    /**
     * Lokaler Funktionsaufruf. In Kern-Methoden wird die Kern-Variante
     * gerufen: `kernName` (gesetzt bei öffentlichen `fn` → `_kern<Name>`)
     * sonst `name` (interne `_`-fn behält ihren Namen).
     */
    | { readonly kind: 'call'; readonly name: string; readonly args: ReadonlyArray<IrExpr>; readonly kernName?: string }
    /**
     * Record-Konstruktion `new TypeName(args…)` — Args positionsaufgelöst.
     * Cross-modul → `new OwnerClass.TypeName(args…)` (nested-static Record).
     */
    | { readonly kind: 'ctor'; readonly typeName: string; readonly args: ReadonlyArray<IrExpr>; readonly ownerClass?: string }
    /** Cross-Modul-Funktionsaufruf → `feldName.methode(args…)` (Komposition). */
    | { readonly kind: 'crossCall'; readonly fieldName: string; readonly methodName: string; readonly args: ReadonlyArray<IrExpr> }
    /** Cross-Modul-Konstantenreferenz → `OwnerClass.MEMBER` (static final). */
    | { readonly kind: 'crossRef'; readonly ownerClass: string; readonly memberName: string }
    /** Aufzählungs-(Un)gleichheit → Java-`==`/`!=` (Enum-Identität). */
    | { readonly kind: 'enumCmp'; readonly op: '==' | '!='; readonly left: IrExpr; readonly right: IrExpr }
    /**
     * Arithmetik → `left.add/sub/mul(right)` für numerische Operanden.
     * Bei Text-Operanden (`isText=true`, #44) und Operator `+` →
     * Java-String-Konkatenation `(left) + (right)`; andere Operatoren
     * auf Text werden im Lowering mit klarer Meldung abgewiesen.
     */
    | {
        readonly kind: 'arith';
        readonly op: '+' | '-' | '*';
        readonly left: IrExpr;
        readonly right: IrExpr;
        readonly isText?: boolean;
      }
    /**
     * Vergleich → boolean. Für numerische Operanden:
     * `equalsValue`/`compareValue`. Für Text-Operanden (`isText=true`,
     * #44 Lücke 12): nur `==`/`!=` zulässig → `Objects.equals` /
     * `!Objects.equals` (primitiver Java-`String` hat kein `.equalsValue()`).
     */
    | {
        readonly kind: 'cmp';
        readonly op: '==' | '!=' | '<' | '<=' | '>' | '>=';
        readonly left: IrExpr;
        readonly right: IrExpr;
        readonly isText?: boolean;
      }
    /** Logisches `und` → `&&`. */
    | { readonly kind: 'and'; readonly left: IrExpr; readonly right: IrExpr }
    /**
     * Logisches `oder` auf Wahrheitswerten → `||`. (#44 L3a)
     * Elvis-`oder` auf Nullable-Operanden ist ein anderer Pfad
     * (`elvis`, kommt in Folge-PR).
     */
    | { readonly kind: 'or'; readonly left: IrExpr; readonly right: IrExpr }
    /** `nichts`-Literal → Java `null`. (#44 L2) */
    | { readonly kind: 'nullLit' }
    /**
     * Elvis-`oder` auf Nullable-Operand → ternär
     * `(left != null) ? left : right` (#44 L3b). Lowering entscheidet
     * Boolean-`or` vs. Elvis anhand des Typs des linken Operanden.
     */
    | { readonly kind: 'elvis'; readonly left: IrExpr; readonly right: IrExpr }
    /**
     * `!!` Force-Unwrap → `Objects.requireNonNull(value, "!! …")`
     * (#44 L8). Wirft `NullPointerException` mit Quell-Hint bei `null`.
     */
    | { readonly kind: 'forceUnwrap'; readonly value: IrExpr; readonly hint: string }
    /**
     * `?.` Sicher-Zugriff → ternär
     * `(recv != null) ? recv.feld() : null` (#44 ?.). Receiver wird
     * im Generat doppelt evaluiert — in FinDSL P2 (seiteneffektfrei)
     * unkritisch; Optimierung via lokaler Variable wäre möglich,
     * aber der Generat-Code bleibt für jetzt KISS.
     */
    | { readonly kind: 'safeFieldAccess'; readonly receiver: IrExpr; readonly name: string }
    /**
     * `x ist nichts` / `x ist nicht nichts` → `x == null` / `x != null`.
     * (#44 L2 — NullCheck-AST-Knoten, getrennt vom Force-Unwrap `!!`.)
     */
    | { readonly kind: 'nullCheck'; readonly value: IrExpr; readonly negated: boolean }
    /** Wahrheitswert-Literal `wahr`/`falsch` → Java `true`/`false`. */
    | { readonly kind: 'bool'; readonly value: boolean }
    /** Unäres `-` → `value.neg()` (Art bleibt erhalten, interpreter.ts:249). */
    | { readonly kind: 'neg'; readonly value: IrExpr }
    /** Unäres `nicht` → `!(value)` (interpreter.ts:251). */
    | { readonly kind: 'not'; readonly value: IrExpr }
    /** `(receiver).abrunden()/.aufrunden()` — Ziel beim Lowering fixiert. */
    | { readonly kind: 'round'; readonly receiver: IrExpr; readonly mode: 'abrunden' | 'aufrunden'; readonly target: ZielTyp }
    /** `abbruch(grund)` → `throw new FinDslAbort(grund)` (grund i. d. R. `strInterp`). */
    | { readonly kind: 'abort'; readonly reason: IrExpr }
    /** `konst`/`var`-Geld-Annotation → `expr.withMoneyAnnotation(Type.X, "what")`. */
    | { readonly kind: 'moneyAnno'; readonly expr: IrExpr; readonly target: 'Euro' | 'Cent' | 'EuroCent'; readonly what: string }
    /** Division `/` → `left.div(right)`. */
    | { readonly kind: 'div'; readonly left: IrExpr; readonly right: IrExpr }
    /** `als <Ziel>`-Cast → `value.cast(FinDslNumber.Type.X)`. */
    | { readonly kind: 'cast'; readonly value: IrExpr; readonly target: ZielTyp }
    /** Listen-Literal — `[]<T>` → `FinDslListe.<E>empty()`, sonst `FinDslListe.of(List.of(…))`. */
    | { readonly kind: 'listLit'; readonly elementJavaType: string; readonly items: ReadonlyArray<IrExpr> }
    /**
     * Bereich-Literal `a bis b` / `a bis unter b` / `a bis b schritt s`
     * (SPEC § 4.16 / § 11.3, #44 L1) → `FinDslListe.bereich(from, to,
     * exklusiv, schritt)`. Eager materialisiert (siehe Designnotiz
     * der Runtime-Methode); alle § 11.2-Methoden funktionieren ohne
     * Spiegel-Pflege.
     */
    | {
        readonly kind: 'listRange';
        readonly from: IrExpr;
        readonly to: IrExpr;
        readonly exclusive: boolean;
        readonly step?: IrExpr;
      }
    /**
     * Aufzählungs-Bereich `I bis VI` (SPEC § 11.3, #44 Aufzählungs-Bereich).
     * `enumClassName` ist der vollständig qualifizierte Java-Name der
     * Enum-Klasse (`Steuerklasse` oder `OwnerClass.EnumName`); Reihenfolge
     * im FinDSL-`aufzählung`-Block = Java-`ordinal()`. Lowert zu
     * `FinDslListe.enumBereich(enumClass.class, from, to, exklusiv, schritt)`.
     */
    | {
        readonly kind: 'listEnumRange';
        readonly enumClassName: string;
        readonly from: IrExpr;
        readonly to: IrExpr;
        readonly exclusive: boolean;
        readonly step?: IrExpr;
      }
    /**
     * §-11.2-Listen-Methode ohne Argument (`.länge`/`.summe()`/`.leer`/
     * `.größtes()`/`.kleinstes()`/`.kopf`/`.rest`/`.zähle()`).
     * Getter-like (FieldAccess ohne Call: `.leer`/`.kopf`/`.rest`) und
     * call-form (`.summe()`/`.größtes()`/`.kleinstes()`/`.zähle()`)
     * werden gleich behandelt — die Runtime hat konsistent eine Methode.
     */
    | {
        readonly kind: 'listMethod';
        readonly receiver: IrExpr;
        readonly method:
            | 'laenge' | 'summe' | 'leer' | 'groesstes' | 'kleinstes'
            | 'kopf' | 'rest' | 'zaehle';
      }
    /** `.zuordnen(lambda)` — Argument typsicher (kein optionales Feld). */
    | { readonly kind: 'listMap'; readonly receiver: IrExpr; readonly fn: IrExpr }
    /**
     * §-11.2 `.filtern(p)` mit Lambda-Prädikat — strukturell wie
     * `listMap`, aber semantisch Filter (Runtime-Methode `filtern`).
     */
    | { readonly kind: 'listFilter'; readonly receiver: IrExpr; readonly fn: IrExpr }
    /**
     * §-11.2 `.zähle(p)` mit Lambda-Prädikat → `Ganzzahl` (Anzahl
     * Treffer). Runtime-Methode `zaehleMit` — Name vermeidet Kollision
     * mit der parameterlosen `zaehle()`.
     */
    | { readonly kind: 'listCountWhere'; readonly receiver: IrExpr; readonly fn: IrExpr }
    /**
     * §-11.2 `.enthält(x)` mit Wert-Argument → boolean. Argument wird
     * im Lowering ggf. geboxt; Vergleich liegt in der Runtime.
     */
    | { readonly kind: 'listContains'; readonly receiver: IrExpr; readonly value: IrExpr }
    /**
     * §-11.2 `.bei(i)` bzw. `[i]` — Element bei 0-basiertem Index.
     * `[i]` wird im Lowering auf denselben Knoten gemappt; die beiden
     * Syntax-Formen sind semantisch identisch.
     */
    | { readonly kind: 'listAt'; readonly receiver: IrExpr; readonly index: IrExpr }
    /**
     * §-11.2 `.zusammenfassen(start, f)` — Fold/Reduce. `f` ist ein
     * 2-stelliges Lambda `(akku, element) -> akku`; lowert zu
     * {@link FinDslLambda2}. Bit-genauer Spiegel des Interpreters.
     */
    | {
        readonly kind: 'listFold';
        readonly receiver: IrExpr;
        readonly start: IrExpr;
        readonly fn: IrExpr;
      }
    /**
     * Zweistelliges Lambda `{ a, b -> body }` → `(a, b) -> body` für
     * FinDslLambda2. Pendant zu `lambda1` für 2-arg-Reduktionen.
     */
    | { readonly kind: 'lambda2'; readonly param1: string; readonly param2: string; readonly body: IrExpr }
    /**
     * Aufruf eines first-class Lambda-Werts (`FinDslLambda1` o.ä.) → `fn.apply(args)`.
     * Wird im Lowering erzeugt, wenn `f(...)` und `f` ein lokaler `var`
     * mit `FunctionType` ist (#44 L5). Unterscheidet sich von `call`
     * (Java-Method-Call auf der Impl-Klasse).
     */
    | { readonly kind: 'lambdaCall'; readonly fn: IrExpr; readonly args: ReadonlyArray<IrExpr> }
    /**
     * Einstelliges Lambda `{ p -> body }` → `(p) -> body` (FinDslLambda1).
     * `lets` (optional, #44 Block-Lambda): wenn der Body Block-form ist
     * (`{ p -> var …; ergebnis }`) — Emitter generiert dann `(p) -> { …;
     * return body; }`.
     */
    | {
        readonly kind: 'lambda1';
        readonly param: string;
        readonly body: IrExpr;
        readonly lets?: ReadonlyArray<IrLet>;
      }
    /**
     * String-Literal mit Interpolation → Java-String-Konkatenation.
     * `slotIsText[i] === true` (#44 Lücke 11) markiert Slots, deren
     * Java-Typ bereits `String` ist → direkt anhängen (kein `.asText()`,
     * `String` hat die Methode nicht). Numerische Slots bekommen
     * `.asText()` wie zuvor.
     */
    | {
        readonly kind: 'strInterp';
        readonly parts: ReadonlyArray<string>;
        readonly slots: ReadonlyArray<IrExpr>;
        readonly slotIsText?: ReadonlyArray<boolean>;
      }
    /** `wähle` als Ausdruck — wird vom Emitter zu if/return gelowert. */
    | { readonly kind: 'waehle'; readonly subject?: IrExpr; readonly arms: ReadonlyArray<IrArm> };

/** Block als `wähle`-Arm-Ergebnis (`{ var …; ergebnis }`) — Statement-Lowering. */
export interface IrBlockResult {
    readonly kind: 'blockResult';
    readonly lets: ReadonlyArray<IrLet>;
    readonly result: IrExpr;
}

export interface IrArm {
    /** Leer ⇔ `sonst`-Arm. Bei Subjekt: Enum-Werte; sonst: boolesche Prädikate. */
    readonly patterns: ReadonlyArray<IrExpr>;
    /** Ausdruck ODER Block (`{ var …; ergebnis }`, Phase 2). */
    readonly result: IrExpr | IrBlockResult;
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
    /** Kern-Typ (Rechen-Schicht): numerisch → `FinDslNumber`. */
    readonly javaType: string;
    /** API-Typ (Fassade): numerisch → sprechender Wrapper (`Euro` …). */
    readonly apiType: string;
    /** `true` ⇔ numerisch (apiType ≠ javaType → Box/Unbox in der Fassade). */
    readonly numeric: boolean;
}

export interface IrField {
    readonly name: string;
    /** API-Typ: numerisch → sprechender Wrapper (`record`-Felder sind API). */
    readonly javaType: string;
    /** `true` ⇔ numerischer Wrapper (ctor-Arg boxen, Feldzugriff unboxen). */
    readonly numeric: boolean;
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
    | {
        readonly kind: 'konst';
        readonly name: string;
        readonly expr: IrExpr;
        /**
         * Deklarierter Java-Typ (API-Schicht) — für numerische `konst`
         * ist das der Sicht-Wrapper (`Euro`/`Cent`/…), für nicht-
         * numerische der echte API-Typ (`String`/`boolean`/`FinDslListe<…>`).
         * Vor #44/L10 wurde im Emitter für nicht-numerische `konst`
         * fälschlich auf `FinDslNumber` zurückgefallen (Generat hat nicht
         * kompiliert: `String cannot be converted to FinDslNumber`).
         */
        readonly javaType: string;
        /** Numerisch → sprechender Wrapper-Typ (`Euro` …), sonst undefined. */
        readonly wrapper?: string;
        readonly info: IrDoc;
      }
    | { readonly kind: 'enum'; readonly name: string; readonly values: ReadonlyArray<string>; readonly info: IrDoc }
    | { readonly kind: 'record'; readonly name: string; readonly fields: ReadonlyArray<IrField>; readonly info: IrDoc }
    | {
        readonly kind: 'fn';
        readonly name: string;
        /** Führendes `_` ⇒ paket-private Kern-Methode (kein Interface-Eintrag). */
        readonly internal: boolean;
        readonly params: ReadonlyArray<IrParam>;
        /** Kern-Rückgabetyp (Rechen-Schicht): numerisch → `FinDslNumber`. */
        readonly returnJavaType: string;
        /** API-Rückgabetyp (Fassade): numerisch → Wrapper. */
        readonly returnApiType: string;
        /** `true` ⇔ numerischer Rückgabewert (Fassade boxt das Kern-Ergebnis). */
        readonly returnNumeric: boolean;
        readonly body: IrFnBody;
        readonly info: IrDoc;
      };

/**
 * Importiertes Modul, dessen `fn` cross-modul aufgerufen wird →
 * `private final ClassName fieldName = new ClassName();` (Komposition).
 */
export interface IrComposedModule {
    readonly className: string;
    readonly fieldName: string;
    /** Java-Package des Zielmoduls (`undefined` = unbenannt) — Import nur bei Abweichung. */
    readonly javaPackage: string | undefined;
}

export interface IrModule {
    /** `undefined` = unbenanntes (Default-)Package — kein `package …;`. */
    readonly javaPackage: string | undefined;
    readonly className: string;
    readonly decls: ReadonlyArray<IrDecl>;
    /** Datei-Doc (`Program.fileDoc`) → Klassen-Javadoc. */
    readonly info: IrDoc;
    /** Kompositions-Felder (cross-modul `fn`), in `verwende`-Reihenfolge dedupliziert. */
    readonly composedModules: ReadonlyArray<IrComposedModule>;
}

// ---------------------------------------------------------------------------
// `prüfe`-Blöcke → JUnit5 (Phase 3, Inkrement 3)
// ---------------------------------------------------------------------------

/**
 * Ein `testfall` → eine JUnit-`@Test`-Methode. Spiegel
 * `pruefe.ts runPruefeDecl` (128-180): `lets` (= `var`-Bindungen) werden
 * vor der Auswertung gebunden; `assertion` (= `BlockExpr.result`) ergibt
 * den Wahrheitswert (`!erwartetAbbruch` → `assertTrue`) bzw. löst den
 * erwarteten `abbruch` aus (`erwartetAbbruch` → `assertThrows`).
 */
export interface IrTestCase {
    /** `Beispiel.label` (roh) → `@DisplayName`. */
    readonly label: string;
    readonly erwartetAbbruch: boolean;
    readonly lets: ReadonlyArray<IrLet>;
    readonly assertion: IrExpr;
}

/** Ein `prüfe`-Block → `@Nested`-Klasse mit `@DisplayName(suiteName)`. */
export interface IrTestSuite {
    /** `PruefeDecl.name` (roh) → `@DisplayName`. */
    readonly suiteName: string;
    readonly cases: ReadonlyArray<IrTestCase>;
}

/** Eine `*.test.findsl` → eine JUnit5-Testklasse. */
export interface IrTestModule {
    /** `undefined` = unbenanntes (Default-)Package — kein `package …;`. */
    readonly javaPackage: string | undefined;
    readonly className: string;
    /** SUT-Kompositions-Felder (`private final SUT sut = new SUT();`). */
    readonly composedModules: ReadonlyArray<IrComposedModule>;
    readonly suites: ReadonlyArray<IrTestSuite>;
    /** Datei-Doc (`Program.fileDoc`) → Klassen-Javadoc. */
    readonly info: IrDoc;
}
