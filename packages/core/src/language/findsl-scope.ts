/**
 * Modul-Scope-Auflösung für FinDSL.
 *
 * Verantwortlich für die hochlevel-Frage: "Welche Symbole sind in einem
 * Modul sichtbar, woher kommen sie, und wo kollidieren sie?"
 *
 * Aufgaben:
 *   1. `analyzeImports(program)` extrahiert die flache Liste der durch
 *      `verwende`-Direktiven gebundenen Symbole und deckt Konflikte auf.
 *   2. `buildHeaderRegistry(modules)` typisiert die Top-Level-Signaturen
 *      (Konstanten, Funktionen, Datensätze, Aufzählungen) jedes Moduls in
 *      einer Map<moduleName, TypeContext>, damit der Type-Checker Cross-
 *      Module-Imports gegen echte Typen statt gegen `unknown` auflösen kann.
 *
 * Die Datei-IO (Lesen und topologische Sortierung) liegt in
 * `../interpret/module-loader.ts` und bleibt unverändert.
 *
 * Auf das pragmatische Skelett beschränkt — kommt mit der vollständigen
 * Roadmap nicht abgedeckt:
 *   - `verwende modul.pfad [als alias]`-Form (Modul-als-Wert) — keine der
 *     Beispieldateien nutzt sie; ein eigener `ModuleValue`-Typ wäre nötig.
 *   - Mehrjahres-Lookups mit Versions-Disambiguierung.
 */

import type { AstNode } from 'langium';
import { type Program } from './generated/ast.js';
import {
    buildContext,
    resolveTypeAnnotation,
    TUnknown,
    type ImportResolver,
    type Type,
    type TypeContext,
} from './findsl-types.js';
import { isDatensatzDecl, isFunktionDecl, isKonstDecl } from './generated/ast.js';
import { isBuiltinName } from './findsl-stdlib.js';
import { collectImportBindings } from './import-path.js';
import type { LoadedModule } from '../interpret/module-loader.js';

// ---------------------------------------------------------------------------
// Import-Analyse
// ---------------------------------------------------------------------------

export interface ImportBinding {
    /** Lokaler Name, unter dem das Symbol im aktuellen Modul sichtbar wird. */
    readonly localName: string;
    /** Relativer Pfad-String der Quelle wie geschrieben (Anzeige/Links). */
    readonly rawSource: string;
    /** Absoluter, normalisierter Zielpfad — `undefined` ohne Dokument-URI. */
    readonly resolvedPath: string | undefined;
    /** Originalname in der Quelldatei (kann via `als` umbenannt worden sein). */
    readonly sourceName: string;
    /** AST-Knoten, an dem eine Diagnose hängen kann. */
    readonly node: AstNode;
}

export interface ImportConflict {
    readonly localName: string;
    readonly first: ImportBinding;
    readonly second: ImportBinding;
}

export interface ImportAnalysis {
    readonly bindings: ReadonlyArray<ImportBinding>;
    readonly conflicts: ReadonlyArray<ImportConflict>;
}

export function analyzeImports(program: Program): ImportAnalysis {
    const bindings: ImportBinding[] = collectImportBindings(program).map((b) => ({
        localName:    b.localName,
        rawSource:    b.rawSource,
        resolvedPath: b.resolvedPath,
        sourceName:   b.sourceName,
        node:         b.node,
    }));
    const conflicts = findConflicts(bindings);
    return { bindings, conflicts };
}

function findConflicts(bindings: ReadonlyArray<ImportBinding>): ImportConflict[] {
    const seen = new Map<string, ImportBinding>();
    const conflicts: ImportConflict[] = [];
    for (const b of bindings) {
        const first = seen.get(b.localName);
        if (first) {
            conflicts.push({ localName: b.localName, first, second: b });
        } else {
            seen.set(b.localName, b);
        }
    }
    return conflicts;
}

/**
 * Erweiterter Reporter für Import-Diagnosen — reicht zusätzlich einen
 * stabilen `code` (für Quick-Fix-Zuordnung) und optionale `data` durch.
 */
export type ImportIssueReporter = (
    node: AstNode, message: string, code: string, data?: unknown,
) => void;

/**
 * Meldet alle Konflikte und unsupported-Importe als Validator-Diagnosen.
 * Konflikt-Diagnosen hängen am zweiten (kollidierenden) Vorkommen, damit
 * der erste Bind sichtbar bleibt und der Nutzer den Duplikat-Fehler an der
 * tatsächlichen Doppel-Stelle korrigieren kann.
 */
export function reportImportIssues(program: Program, report: ImportIssueReporter): void {
    const analysis = analyzeImports(program);
    for (const conflict of analysis.conflicts) {
        report(
            conflict.second.node,
            `Import-Konflikt: "${conflict.localName}" wird bereits aus `
            + `"${conflict.first.rawSource}" importiert und kann nicht erneut `
            + `aus "${conflict.second.rawSource}" gebunden werden.`,
            'findsl.import-konflikt',
            { sourceName: conflict.second.sourceName },
        );
    }
    // Eingebaute Definitionen (SPEC § 8.5) sind überall verfügbar — ein
    // expliziter Import ist sinnlos und irreführend.
    for (const b of analysis.bindings) {
        if (isBuiltinName(b.sourceName)) {
            report(
                b.node,
                `"${b.sourceName}" ist eine eingebaute Definition (SPEC § 8.5) `
                + `und kann nicht importiert werden — sie ist in jeder Datei `
                + `automatisch verfügbar. Entferne den Import.`,
                'findsl.builtin-import',
                { sourceName: b.sourceName },
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Cross-Module Header-Registry
// ---------------------------------------------------------------------------

/**
 * Modul-Header = Top-Level-Signaturen ohne Body-Check. Reicht aus, um
 * importierte Symbole von außen typisch aufzulösen.
 */
export interface ModuleHeader {
    readonly context: TypeContext;
    /** Alle exportierten Top-Level-Namen (Konstanten, Funktionen, Datensätze,
     *  Aufzählungen). Wird für „Symbol nicht exportiert"-Diagnosen genutzt. */
    readonly exports: ReadonlySet<string>;
}

export interface ModuleHeaderRegistry {
    /** Schlüssel ist der absolute, normalisierte Dateipfad der Quelldatei. */
    lookup(filePath: string | undefined): ModuleHeader | undefined;
}

/**
 * Baut für jedes Programm einen Header-Eintrag. Reihenfolge spielt keine
 * Rolle — wir verarbeiten nur Top-Level-Annotationen, nicht Bodies, daher
 * sind keine zyklischen Abhängigkeiten möglich.
 */
export function buildHeaderRegistry(modules: ReadonlyArray<LoadedModule>): ModuleHeaderRegistry {
    const map = new Map<string, ModuleHeader>();
    for (const m of modules) {
        map.set(m.filePath, buildModuleHeader(m.program));
    }
    return { lookup: (filePath) => (filePath ? map.get(filePath) : undefined) };
}

export function buildModuleHeader(program: Program): ModuleHeader {
    const ctx = buildContext(program);
    const exports = new Set<string>();

    for (const decl of program.decls) {
        if (isKonstDecl(decl)) {
            ctx.globals.define(decl.name, resolveTypeAnnotation(decl.type, ctx));
            exports.add(decl.name);
        } else if (isFunktionDecl(decl)) {
            const params = decl.params.map((p) => resolveTypeAnnotation(p.type, ctx));
            const paramNames = decl.params.map((p) => p.name);
            const paramHasDefault = decl.params.map((p) => !!p.default);
            const result = resolveTypeAnnotation(decl.returnType, ctx);
            ctx.globals.define(decl.name, {
                kind: 'function', params, paramNames, paramHasDefault, result,
            });
            exports.add(decl.name);
        } else if (isDatensatzDecl(decl)) {
            // Datensatz-Konstruktor wurde schon in buildContext registriert,
            // aber als Funktionstyp; wir markieren ihn als exportiert.
            exports.add(decl.name);
        }
    }
    // Aufzählungs-Typen und ihre Werte sind ebenfalls "exportiert".
    for (const [name] of ctx.enums) {
        exports.add(name);
    }
    for (const [name] of ctx.enumValues) {
        exports.add(name);
    }
    return { context: ctx, exports };
}

// ---------------------------------------------------------------------------
// Cross-Module-Symbol-Resolution (für den Type-Checker)
// ---------------------------------------------------------------------------

/**
 * Adapter: liefert den `ImportResolver`, den `typeCheckProgram` erwartet.
 * Modul fehlt in der Registry → tolerant `unknown` (Modul-Loader sollte
 * Auffindbarkeits-Fehler vor dem Type-Check gemeldet haben). Symbol fehlt
 * im fremden Modul → Diagnose.
 */
export function asImportResolver(registry: ModuleHeaderRegistry): ImportResolver {
    return {
        resolve(sourceKey, sourceName, rawSource, node, report): Type {
            const header = registry.lookup(sourceKey);
            if (!header) return TUnknown;
            if (!header.exports.has(sourceName)) {
                report(
                    node,
                    `Symbol "${sourceName}" wird von der Datei "${rawSource}" `
                    + `nicht exportiert.`,
                );
                return TUnknown;
            }
            return header.context.globals.lookup(sourceName) ?? TUnknown;
        },
    };
}
