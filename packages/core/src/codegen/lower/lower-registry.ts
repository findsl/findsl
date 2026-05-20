// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Symbol-Registry für FinDSL-Codegen (ADR1 `lower/`).
 *
 * Aus `lower.ts` ausgelagert (Issue #72, Teil 2/3 — File-Size-Split).
 * Enthält:
 *  - `Registry` + Hilfs-Interfaces (`EnumValueInfo`/`RecordInfo`/
 *    `CrossFnInfo`) — Lookup-Tabellen für lokale Decls und
 *    `verwende`-Importe (Cross-Modul-Auflösung).
 *  - `buildRegistry` — baut die Registry aus dem geparsten Programm
 *    plus den gelowerten `LowerImport`-Bindungen.
 *  - `BUILTIN_ENUMS` — eingebaute Sprach-Aufzählungen (SPEC § 8.5).
 *
 * Dep-Injection: `isNumericType` / `lowerCamel` leben in `lower.ts`
 * (gemeinsam mit den restlichen Typ-/Namens-Helpern) — werden als
 * Funktionsparameter durchgereicht, kein Modul-Zyklus.
 */

import {
    isAufzaehlungDecl,
    isDatensatzDecl,
    isFunktionDecl,
    isKonstDecl,
    type DatensatzDecl,
    type Expr,
    type FunktionDecl,
    type Program,
    type TopDecl,
    type Type,
} from '../../language/generated/ast.js';

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

export interface EnumValueInfo {
    readonly enumName: string;
    /** Owner-Java-Klasse bei cross-modul Enum (sonst undefined = lokal/builtin). */
    readonly ownerClass?: string;
}

export interface RecordInfo {
    readonly decl: DatensatzDecl;
    /** Owner-Java-Klasse bei cross-modul Datensatz (sonst undefined = lokal). */
    readonly ownerClass?: string;
}

export interface CrossFnInfo {
    readonly fieldName: string;
    readonly methodName: string;
    /** Callee-Parameter-Typen (für Box numerischer Cross-Argumente). */
    readonly paramTypes: ReadonlyArray<Type | undefined>;
    /** Callee-Rückgabetyp (für Unbox numerischen Cross-Ergebnisses). */
    readonly returnType: Type | undefined;
    /** Parameter-Namen — für benannte Argument-Resolution (#44). */
    readonly paramNames: ReadonlyArray<string>;
    /** Default-Expressions je Parameter (oder `undefined`) — #44. */
    readonly paramDefaults: ReadonlyArray<Expr | undefined>;
}

export interface Registry {
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
        {
            internal: boolean;
            paramTypes: ReadonlyArray<Type | undefined>;
            /**
             * Parameter-Namen — für die Auflösung benannter Argumente
             * (`f(x = 5)`) gegen Positionen + Default-Substitution.
             */
            paramNames: ReadonlyArray<string>;
            /**
             * Default-Expressions je Parameter (oder `undefined`, wenn
             * der Parameter pflicht ist). Spiegelt Interpreter
             * `evaluateCall` — fehlt ein Argument, wird der Default
             * eingesetzt. Vor #44 fehlte das, der Codegen rief
             * `_f(n)` statt `_f(n, default)` und der Java-Compile brach.
             */
            paramDefaults: ReadonlyArray<Expr | undefined>;
        }>;
    /**
     * Per-`fn` veränderliche Sicht: lokaler Name (Param/`var`) → FinDSL-
     * Typ — für die Typauflösung von Record-Feldzugriffen (Lese-Unbox).
     * `lowerFn`/Block setzt sie vor dem Lowern des Rumpfs.
     */
    readonly scopeTypes: Map<string, Type | undefined>;
}

/** Eingebaute Sprach-Aufzählungen (SPEC § 8.5, kein Import) — Runtime-Enums. */
export const BUILTIN_ENUMS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
    ['Tarifart', ['Grundtarif', 'Splitting']],
    ['Steuerklasse', ['I', 'II', 'III', 'IV', 'V', 'VI']],
];

/**
 * Dep-Injection: `isNumericType` + `lowerCamel` leben in `lower.ts` —
 * werden hier per Funktionsparameter erwartet (kein Modul-Zyklus,
 * keine zweite Implementierung).
 */
export interface RegistryBuilderDeps {
    isNumericType: (t: Type | undefined) => boolean;
    lowerCamel: (name: string) => string;
}

/**
 * Baut die Symbol-Registry aus dem geparsten Programm + `verwende`-
 * Importen (Cross-Modul-Auflösung). Lokale Decls überschreiben Importe
 * nicht (bei validen Programmen graph-global eindeutig; gespiegelt am
 * Interpreter `applyImports`). `fn`/`konst` von Importen werden NUR für
 * tatsächlich gebundene Symbole registriert (Komposition bzw.
 * `Owner.MEMBER`).
 */
export function buildRegistry(
    program: Program,
    imports: ReadonlyArray<LowerImport>,
    deps: RegistryBuilderDeps,
): Registry {
    const { isNumericType, lowerCamel } = deps;
    const enumValues = new Map<string, EnumValueInfo>();
    for (const [enumName, values] of BUILTIN_ENUMS) {
        for (const v of values) enumValues.set(v, { enumName });
    }
    const records = new Map<string, RecordInfo>();
    const typeOwner = new Map<string, string>();
    const crossFns = new Map<string, CrossFnInfo>();
    const crossKonst = new Map<string, { ownerClass: string; memberName: string; numeric: boolean }>();
    const localKonst = new Map<string, boolean>();
    const localFns = new Map<string, {
        internal: boolean;
        paramTypes: ReadonlyArray<Type | undefined>;
        paramNames: ReadonlyArray<string>;
        paramDefaults: ReadonlyArray<Expr | undefined>;
    }>();

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
                paramNames: d.params.map((p) => p.name),
                paramDefaults: d.params.map((p) => p.default),
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
                    paramNames: fd.params.map((p) => p.name),
                    paramDefaults: fd.params.map((p) => p.default),
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
