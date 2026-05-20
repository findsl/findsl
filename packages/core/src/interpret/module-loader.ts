/**
 * Minimaler Datei-Auflöser für den Interpreter.
 *
 * Verantwortlich für:
 *   1. Auflösen der relativen `verwende … aus "…"`-Pfade gegen das
 *      Verzeichnis der importierenden Datei.
 *   2. Rekursive DFS-Lade-Schleife mit Zyklus-Erkennung und topologischer
 *      Sortierung (Blätter zuerst).
 *
 * Es gibt keinen `modul`-Header und keine Projekt-Wurzel-Heuristik mehr —
 * die Datei-Identität ist ihr absoluter, normalisierter Pfad.
 *
 * Parsen passiert injiziert (`parse: (filePath) => Promise<Program>`), damit
 * dieser Layer Langium-frei bleibt — Test- und Build-Tooling können hier
 * eigene Parser einklinken.
 */

import * as path from 'node:path';

import { type Program } from '../language/generated/ast.js';
import { isWithinRoot, resolveImportPath } from '../language/import-path.js';
import { InterpretError } from './values.js';

export interface LoadedModule {
    /** Absoluter, normalisierter Dateipfad — die Datei-Identität. */
    readonly filePath: string;
    readonly program: Program;
}

export type ParseFile = (filePath: string) => Promise<Program>;

/**
 * Optionen für `loadModuleGraph`. Aktuell rein sicherheitsrelevant
 * (Issue #73 — Path-Traversal-Schutz).
 */
export interface LoadOptions {
    /**
     * Absolutes Projekt-Basis-Verzeichnis. Ist es gesetzt, lehnt der
     * Loader jeden `verwende … aus "…"`-Pfad ab, dessen aufgelöstes
     * Ziel außerhalb dieses Verzeichnisses liegt — verhindert
     * bösartige `../../../etc/passwd.findsl`-Eskapaden. Der Entry-Pfad
     * selbst wird ebenfalls geprüft.
     *
     * Default: kein Check (rückwärtskompatibel; Tests/In-Memory-
     * Setups können ohne Boundary arbeiten). Produktion (CLI) MUSS
     * `process.cwd()` oder ein anderes konkretes Verzeichnis setzen.
     */
    readonly allowedRoot?: string;
}

/**
 * Liefert die relativen Import-Pfad-Strings eines Programms (ohne
 * Duplikate, Reihenfolge wie im Quelltext, wie geschrieben — ohne `.findsl`).
 */
export function listImportSources(program: Program): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const imp of program.imports ?? []) {
        const src = imp?.source;
        if (src && !seen.has(src)) {
            seen.add(src);
            out.push(src);
        }
    }
    return out;
}

/**
 * Lädt die Einstiegsdatei und alle transitiv referenzierten Dateien.
 * Liefert sie in topologischer Reihenfolge (Blätter zuerst, Entry zuletzt)
 * — der Interpreter kann sie so von links nach rechts auswerten und beim
 * Init der späteren Dateien auf die Env der früheren zugreifen.
 *
 * Zyklen werden mit einer `InterpretError` gemeldet (harter Stopp).
 */
export async function loadModuleGraph(
    entryFilePath: string,
    parse: ParseFile,
    options: LoadOptions = {},
): Promise<LoadedModule[]> {
    const absEntry = path.normalize(path.resolve(entryFilePath));
    const allowedRoot = options.allowedRoot
        ? path.normalize(path.resolve(options.allowedRoot))
        : undefined;

    if (allowedRoot && !isWithinRoot(absEntry, allowedRoot)) {
        throw new InterpretError(
            `Einstiegsdatei "${absEntry}" liegt außerhalb des erlaubten `
            + `Projektverzeichnisses "${allowedRoot}".`,
        );
    }

    const entryProgram = await parse(absEntry);

    const order: LoadedModule[] = [];
    const visited = new Map<string, 'in-progress' | 'done'>();
    const cache = new Map<string, LoadedModule>();
    cache.set(absEntry, { filePath: absEntry, program: entryProgram });

    async function visit(filePath: string, program: Program): Promise<void> {
        const state = visited.get(filePath);
        if (state === 'done')        return;
        if (state === 'in-progress') {
            throw new InterpretError(`Zyklischer Import erkannt: ${filePath}`);
        }
        visited.set(filePath, 'in-progress');

        for (const rawSource of listImportSources(program)) {
            const depPath = resolveImportPath(filePath, rawSource);
            if (allowedRoot && !isWithinRoot(depPath, allowedRoot)) {
                throw new InterpretError(
                    `Import "${rawSource}" liegt außerhalb des erlaubten `
                    + `Projektverzeichnisses "${allowedRoot}" `
                    + `(aufgelöst zu "${depPath}").`,
                );
            }
            let depEntry = cache.get(depPath);
            if (!depEntry) {
                let depProgram: Program;
                try {
                    depProgram = await parse(depPath);
                } catch (err) {
                    throw new InterpretError(
                        `Import "${rawSource}" kann nicht geladen werden `
                        + `(erwartet: ${depPath}): ${(err as Error).message}`,
                    );
                }
                depEntry = { filePath: depPath, program: depProgram };
                cache.set(depPath, depEntry);
            }
            await visit(depEntry.filePath, depEntry.program);
        }

        visited.set(filePath, 'done');
        order.push({ filePath, program });
    }

    await visit(absEntry, entryProgram);
    return order;
}
