// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Auto-Import-Kern (Issue #20) — geteilte, reine Helfer für den
 * CodeAction-Quick-Fix UND die proaktive Completion. EINE Quelle für:
 *   - Rendern eines `verwende { … } aus "…"`-Blocks in Formatter-kanonischer
 *     (idempotenter) Form,
 *   - Finden der Workspace-Module, die ein Symbol exportieren,
 *   - Erzeugen des `TextEdit`, der ein Symbol importiert (neuer Block oder
 *     Einsortieren in einen bestehenden).
 *
 * Bewusst ohne Provider-Bezug (nur Datentypen) gehalten → direkt testbar.
 */

import * as path from 'node:path';
import type { LangiumDocuments } from 'langium';
import type { TextEdit } from 'vscode-languageserver';
import type { Program } from './generated/ast.js';
import { buildModuleHeader } from './findsl-scope.js';
import {
    isInternalName,
    isTestFile,
    programFilePath,
    resolveImportPath,
} from './import-path.js';

/** Ein importierbares Symbol-Item (`Foo` bzw. `Foo als bar`). */
export interface ImportItemLike {
    readonly name: string;
    readonly alias?: string;
}

/** Symbol-Render eines `verwende`-Items. */
export function renderItem(it: ImportItemLike): string {
    return it.alias ? `${it.name} als ${it.alias}` : it.name;
}

/**
 * `verwende { … } aus "…"` Formatter-kanonisch rendern: IMMER mehrzeilig,
 * jedes Item 4-fach eingerückt mit Trailing-Komma, `}` auf eigener Zeile —
 * genau die idempotente Form, die der Formatter erzeugt → der Edit übersteht
 * ein nachgelagertes `format` unverändert.
 */
export function renderVerwende(
    source: string, items: ReadonlyArray<ImportItemLike>,
): string {
    const body = items.map((it) => `    ${renderItem(it)},`).join('\n');
    return `verwende {\n${body}\n} aus "${source}"`;
}

/** Deterministischer Code-Unit-Vergleich (locale-unabhängig → stabil). */
function cmp(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Relativen Import-Quellstring von `fromFileAbs` zur Zieldatei `targetFileAbs`
 * bilden: POSIX-separiert, ohne `.findsl`, IMMER mit `./`/`../`-Präfix — die
 * exakte Umkehrung von {@link resolveImportPath}.
 */
export function toImportSource(fromFileAbs: string, targetFileAbs: string): string {
    const fromDir = path.dirname(fromFileAbs);
    const targetNoExt = targetFileAbs.replace(/\.findsl$/, '');
    let rel = path.relative(fromDir, targetNoExt).split(path.sep).join('/');
    if (!rel.startsWith('./') && !rel.startsWith('../')) rel = `./${rel}`;
    return rel;
}

/** Ein Workspace-Modul, das ein gesuchtes Symbol exportiert. */
export interface ExportingModule {
    /** Quellstring für `aus "…"`, relativ zur importierenden Datei. */
    readonly importSource: string;
    /** Absoluter, normalisierter Zielpfad (Dedup-/Sort-Stabilität). */
    readonly targetPath: string;
}

/**
 * Workspace-Module (ausser der Datei selbst und `*.test.findsl`), die
 * `symbolName` ÖFFENTLICH exportieren. `_`-Interne werden nie geliefert
 * (SPEC § 4.16). Deterministisch nach `importSource` sortiert.
 */
export function findExportingModules(
    symbolName: string,
    documents: LangiumDocuments,
    currentDocFsPath: string | undefined,
): ExportingModule[] {
    if (!currentDocFsPath || isInternalName(symbolName)) return [];
    const self = path.normalize(currentDocFsPath);
    const out: ExportingModule[] = [];
    for (const doc of documents.all) {
        if (!doc.uri.fsPath) continue;   // Nicht-Datei-URI (untitled:/vfs) → kein Ziel
        const targetPath = path.normalize(doc.uri.fsPath);
        if (targetPath === self || isTestFile(targetPath)) continue;
        const program = doc.parseResult?.value as Program | undefined;
        if (!program) continue;
        if (!buildModuleHeader(program).exports.has(symbolName)) continue;
        out.push({ importSource: toImportSource(self, targetPath), targetPath });
    }
    return out.sort((a, b) => cmp(a.importSource, b.importSource));
}

/**
 * `TextEdit[]`, das `symbolName` aus `importSource` importiert. Erweitert
 * einen bestehenden `verwende … aus`-Block (per AUFGELÖSTEM Pfad gematcht,
 * robust gegen Schreibvarianten) Formatter-kanonisch, sonst neuer Block nach
 * dem letzten Import bzw. am Dateianfang. Leeres Array, wenn das Symbol
 * bereits importiert ist (No-op).
 */
export function buildAddImportEdit(
    program: Program, symbolName: string, importSource: string,
): TextEdit[] {
    const self = programFilePath(program);
    const targetResolved = self ? resolveImportPath(self, importSource) : undefined;
    const imports = (program.imports ?? []).filter(
        (i): i is typeof i & { source: string } => Boolean(i.$cstNode && i.source),
    );

    const existing = imports.find((imp) => {
        if (imp.source === importSource) return true;
        return self !== undefined && targetResolved !== undefined
            && resolveImportPath(self, imp.source) === targetResolved;
    });

    if (existing?.$cstNode) {
        if (existing.items.some((it) => it.name === symbolName)) return [];
        const items: ImportItemLike[] = [
            ...existing.items.map((it) => ({ name: it.name, alias: it.alias })),
            { name: symbolName },
        ].sort((a, b) => cmp(renderItem(a), renderItem(b)));
        return [{
            range: existing.$cstNode.range,
            newText: renderVerwende(existing.source, items),
        }];
    }

    const block = renderVerwende(importSource, [{ name: symbolName }]);
    if (imports.length > 0) {
        const last = imports[imports.length - 1].$cstNode!;
        const pos = { line: last.range.end.line + 1, character: 0 };
        return [{ range: { start: pos, end: pos }, newText: `${block}\n` }];
    }
    // Kein Import vorhanden → neuen Block VOR der ersten Top-Level-Deklaration
    // einfügen. Deren CST-Start liegt HINTER dem führenden `--…--`-fileDoc-
    // Block (Program.fileDoc ist ein eigener Knoten) → ein Datei-Kopf bleibt
    // erhalten. Ohne Deklarationen Fallback auf Zeile 0.
    const firstDecl = (program.decls ?? []).find((d) => d.$cstNode);
    const pos = { line: firstDecl?.$cstNode?.range.start.line ?? 0, character: 0 };
    return [{ range: { start: pos, end: pos }, newText: `${block}\n\n` }];
}
