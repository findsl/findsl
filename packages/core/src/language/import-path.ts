/**
 * Import-Pfad-Auflösung — EINE Quelle (genutzt vom Validator, Scope,
 * LSP-Providern UND vom Interpreter-Modul-Loader, damit alle synchron
 * bleiben).
 *
 * Ablösung des früheren Modulnamen↔Pfad-Mappings (`module-path.ts`):
 * Es gibt keinen `modul`-Header mehr. Eine `verwende { … } aus "…"`-
 * Direktive trägt einen **relativen Dateipfad-String** (ohne `.findsl`,
 * mit `./`/`../`-Präfix), aufgelöst relativ zum Verzeichnis der
 * importierenden Datei.
 *
 * Test-Konvention: `.test` ist reiner Dateinamensbestandteil
 * (`"./foo.test"` → `foo.test.findsl`); ein `*.test.findsl` ist eine
 * Akzeptanztest-Datei.
 */

import * as path from 'node:path';
import type { AstNode } from 'langium';
import type { Program } from './generated/ast.js';

/**
 * Löst einen relativen Import-Pfad-String (bereits entquotet, ohne
 * `.findsl`) gegen das Verzeichnis der importierenden Datei auf und liefert
 * einen absoluten, normalisierten Pfad.
 */
export function resolveImportPath(importingFileAbs: string, rawSource: string): string {
    const baseDir = path.dirname(importingFileAbs);
    return path.normalize(path.resolve(baseDir, `${rawSource}.findsl`));
}

/**
 * Sicherheitsprüfung (Issue #73): liegt `absPath` innerhalb von
 * `allowedRoot`? Verhindert, dass eine `verwende … aus "../../../etc/…"`-
 * Direktive Dateien außerhalb des erlaubten Projekt-Basis-Verzeichnisses
 * öffnet (Path-Traversal). `allowedRoot` zählt selbst als „innerhalb".
 *
 * Beide Pfade müssen absolut/normalisiert sein (kein Symlink-Resolving —
 * der Loader normalisiert ohnehin via `path.normalize`/`path.resolve`).
 */
export function isWithinRoot(absPath: string, allowedRoot: string): boolean {
    const root = path.normalize(allowedRoot);
    const target = path.normalize(absPath);
    if (target === root) return true;
    const prefix = root.endsWith(path.sep) ? root : root + path.sep;
    return target.startsWith(prefix);
}

/** True, wenn der Dateipfad eine Akzeptanztest-Datei ist (`*.test.findsl`). */
export function isTestFile(absPath: string): boolean {
    return /\.test\.findsl$/.test(absPath);
}

/**
 * Modul-intern (SPEC § 4.16, verschärft): eine Top-Level-Deklaration mit
 * führendem `_` ist NICHT Teil der öffentlichen API — nicht cross-file
 * importierbar (Ausnahme s. `mayImportInternal`) und nicht in der
 * generierten Doku. Reine Namenskonvention, kein eigenes Token (`IDENT`
 * bleibt generisch; Enforcement im Validator/Doc-Generator).
 */
export function isInternalName(name: string): boolean {
    return name.startsWith('_');
}

/**
 * Die zu einer `<basis>.test.findsl` gehörende Quelldatei
 * `<basis>.findsl` (absolut, normalisiert). `undefined`, wenn `absPath`
 * keine Akzeptanztest-Datei ist.
 */
export function associatedSourcePath(absPath: string): string | undefined {
    if (!isTestFile(absPath)) return undefined;
    return path.normalize(absPath.replace(/\.test\.findsl$/, '.findsl'));
}

/**
 * Darf die importierende Datei `_`-Interne der Zieldatei importieren?
 * Einzige Ausnahme von der Intern-Sperre: eine `<basis>.test.findsl`
 * darf die Interna ihrer **zugehörigen** Quelldatei `<basis>.findsl`
 * importieren (direkte Unit-Tests interner Logik). Jede andere
 * Kombination (auch Test-Datei → fremde Datei) ist gesperrt.
 */
export function mayImportInternal(
    importingFileAbs: string | undefined,
    targetAbs: string | undefined,
): boolean {
    if (!importingFileAbs || !targetAbs) return false;
    const src = associatedSourcePath(importingFileAbs);
    return src !== undefined && src === path.normalize(targetAbs);
}

/** Längstes gemeinsames Verzeichnis der gegebenen absoluten Dateipfade. */
export function commonBase(absPaths: ReadonlyArray<string>): string {
    if (absPaths.length === 0) return '';
    const split = absPaths.map((p) => path.dirname(path.normalize(p)).split(path.sep));
    let common = split[0];
    for (const segs of split.slice(1)) {
        let i = 0;
        while (i < common.length && i < segs.length && common[i] === segs[i]) {
            i++;
        }
        common = common.slice(0, i);
    }
    return common.join(path.sep);
}

/**
 * Anzeige-Identität einer Datei: Pfad relativ zu `base`, ohne `.findsl`,
 * POSIX-separiert (z. B. `einkommensteuer/tarif/tarif2025`). Fehlt eine
 * gemeinsame Basis, wird der Dateiname (ohne `.findsl`) verwendet.
 */
export function displayId(absPath: string, base: string): string {
    const norm = path.normalize(absPath);
    const rel = base ? path.relative(base, norm) : path.basename(norm);
    return rel.replace(/\.findsl$/, '').split(path.sep).join('/');
}

/**
 * Absoluter Dateipfad der Datei, zu der `program` gehört (aus dem
 * Langium-Dokument-URI). `undefined`, wenn kein Dokument-URI vorliegt
 * (z. B. reiner In-Memory-Parse ohne `file://`-URI).
 */
export function programFilePath(program: Program): string | undefined {
    const doc = (program as { $document?: { uri?: { fsPath?: string } } }).$document;
    return doc?.uri?.fsPath;
}

/** Ein durch eine `verwende`-Direktive gebundenes Symbol. */
export interface RawImportBinding {
    /** Lokaler Name, unter dem das Symbol sichtbar wird (ggf. `als`-Alias). */
    readonly localName: string;
    /** Originalname in der Quelldatei. */
    readonly sourceName: string;
    /** Relativer Pfad-String wie geschrieben (für Anzeige/Links). */
    readonly rawSource: string;
    /** Absoluter, normalisierter Zielpfad — `undefined` ohne Dokument-URI. */
    readonly resolvedPath: string | undefined;
    /** AST-Knoten, an dem eine Diagnose hängen kann. */
    readonly node: AstNode;
}

/**
 * Extrahiert die flache Liste aller `verwende`-Bindungen eines Programms,
 * jeweils mit dem gegen das Dateiverzeichnis aufgelösten Zielpfad. EINE
 * Quelle, genutzt von `findsl-scope.analyzeImports` UND vom Type-Checker
 * (`bindImports`), damit Scope- und Typ-Auflösung denselben
 * Registry-Schlüssel (absoluter Pfad) verwenden. Teil-Parse-robust.
 */
export function collectImportBindings(program: Program): RawImportBinding[] {
    const filePath = programFilePath(program);
    const out: RawImportBinding[] = [];
    for (const imp of program.imports ?? []) {
        const raw = imp?.source;
        if (!raw) continue;
        const resolved = filePath ? resolveImportPath(filePath, raw) : undefined;
        for (const item of imp.items ?? []) {
            if (!item?.name) continue;
            out.push({
                localName: item.alias ?? item.name,
                sourceName: item.name,
                rawSource: raw,
                resolvedPath: resolved,
                node: item as unknown as AstNode,
            });
        }
    }
    return out;
}

/** Problemarten eines fehlerhaften Import-Pfad-Literals. */
export type ImportPathProblemCode = 'multiline' | 'interpolation' | 'empty' | 'prefix';

export interface ImportPathProblem {
    readonly code: ImportPathProblemCode;
    readonly message: string;
}

/**
 * Prüft das rohe Import-Pfad-Literal. `rawWithQuotes` ist der
 * CST-Quelltext inkl. Anführungszeichen, `converted` der von Langium
 * entquotete Wert (bei einfachen Strings der reine Pfad). Liefert das
 * erste Problem oder `undefined`, wenn der Pfad gültig ist.
 */
export function checkImportPathLiteral(
    rawWithQuotes: string,
    converted: string,
): ImportPathProblem | undefined {
    if (rawWithQuotes.startsWith('"""')) {
        return {
            code: 'multiline',
            message: 'Importpfad muss ein einfaches String-Literal sein (kein """…""").',
        };
    }
    if (rawWithQuotes.includes('${')) {
        return {
            code: 'interpolation',
            message: 'Importpfad darf keine ${…}-Interpolation enthalten.',
        };
    }
    const p = converted.trim();
    if (p.length === 0) {
        return { code: 'empty', message: 'Importpfad darf nicht leer sein.' };
    }
    if (!p.startsWith('./') && !p.startsWith('../')) {
        return {
            code: 'prefix',
            message: 'Importpfad muss relativ mit "./" oder "../" beginnen.',
        };
    }
    return undefined;
}
