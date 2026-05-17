/**
 * Runner für `prüfe`-Blöcke.
 *
 * Wertet jeden `testfall`-Ausdruck aus, erwartet einen Wahrheitswert `wahr`
 * und sammelt Pass/Fail-/Fehler-Diagnosen. Der Runner ist asynchron-freundlich
 * (Promise<Report>), bleibt im Skelett aber rein synchron — er hängt nur an
 * der Lang-IO-Schicht der CLI.
 */

import {
    AbbruchSignal,
    InterpretError,
    valueToString,
    type Value,
} from './values.js';
import {
    evalBeispiel,
    interpretProgram,
    type InterpretedModule,
    type ModuleRegistry,
} from './interpreter.js';
import type { Environment } from './environment.js';
import type { Program, PruefeDecl } from '../language/generated/ast.js';
import type { LoadedModule } from './module-loader.js';
import { programFilePath } from '../language/import-path.js';

export type BeispielStatus = 'pass' | 'fail' | 'error';

export interface BeispielReport {
    readonly pruefeName: string;
    readonly beispielLabel: string;
    readonly status: BeispielStatus;
    /** Ausgewerteter Wert bei pass/fail, Fehlermeldung bei error. */
    readonly detail: string;
}

export interface PruefeReport {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly errored: number;
    readonly results: ReadonlyArray<BeispielReport>;
    /** Gesammelte `ausgabe`-Zeilen des gesamten Laufs (SPEC § 5.4). */
    readonly ausgaben: ReadonlyArray<string>;
}

/**
 * Initialisiert die Modul-Umgebung und wertet jeden `testfall` aus.
 * Tritt während der Modul-Initialisierung selbst ein Fehler auf (z. B.
 * Lookup einer importierten Konstante), wird er als einzelner error-Report
 * mit leerem prüfe-Namen geliefert.
 *
 * Bei mehreren übergebenen Modulen wird das letzte als Hauptmodul behandelt
 * (dessen `prüfe`-Blöcke laufen); die früheren werden in topologischer
 * Reihenfolge interpretiert und stehen als Registry für `verwende`-Direktiven
 * zur Verfügung.
 */
export function runPruefe(program: Program): PruefeReport;
export function runPruefe(modules: ReadonlyArray<LoadedModule>): PruefeReport;
export function runPruefe(arg: Program | ReadonlyArray<LoadedModule>): PruefeReport {
    const results: BeispielReport[] = [];
    const ausgaben: string[] = [];
    const sink = (t: string): void => { ausgaben.push(t); };

    let entryProgram: Program;
    let entryFilePath: string | undefined;
    let registry: ModuleRegistry | undefined;

    const isModuleArray = (x: Program | ReadonlyArray<LoadedModule>): x is ReadonlyArray<LoadedModule> =>
        Array.isArray(x);

    if (isModuleArray(arg)) {
        if (arg.length === 0) return summarize(results, ausgaben);
        const interpreted = new Map<string, InterpretedModule>();
        registry = { lookup: (key) => (key ? interpreted.get(key) : undefined) };
        try {
            for (let i = 0; i < arg.length - 1; i++) {
                const m = arg[i];
                interpreted.set(
                    m.filePath,
                    interpretProgram(m.program, registry, sink, m.filePath),
                );
            }
        } catch (err) {
            results.push({
                pruefeName:    '',
                beispielLabel: '<modul-graph-initialisierung>',
                status:        'error',
                detail:        formatError(err),
            });
            return summarize(results, ausgaben);
        }
        entryProgram = arg[arg.length - 1].program;
        entryFilePath = arg[arg.length - 1].filePath;
    } else {
        entryProgram = arg;
        entryFilePath = programFilePath(arg);
    }

    let env;
    let pruefen: ReadonlyArray<PruefeDecl>;
    try {
        const mod = interpretProgram(entryProgram, registry, sink, entryFilePath);
        env = mod.env;
        pruefen = mod.pruefen;
    } catch (err) {
        results.push({
            pruefeName:     '',
            beispielLabel:  '<modul-initialisierung>',
            status:         'error',
            detail:         formatError(err),
        });
        return summarize(results, ausgaben);
    }

    for (const decl of pruefen) {
        results.push(...runPruefeDecl(decl, env));
    }
    return summarize(results, ausgaben);
}

/**
 * Wertet die `testfall`-Einträge EINES `prüfe`-Blocks aus. Enthält die
 * vollständige Pass/Fail-/Abbruch-Logik (SPEC § 10.2, D2) — die einzige
 * Quelle dieser Semantik; sowohl `runPruefe` als auch `runSinglePruefe`
 * (CodeLens) rufen sie auf.
 */
export function runPruefeDecl(decl: PruefeDecl, env: Environment): BeispielReport[] {
    const results: BeispielReport[] = [];
    for (const beispiel of decl.beispiele) {
        const erwartetAbbruch = beispiel.erwartetAbbruch === true;
        try {
            const value: Value = evalBeispiel(beispiel, env);
            if (erwartetAbbruch) {
                results.push({
                    pruefeName:    decl.name,
                    beispielLabel: beispiel.label,
                    status:        'fail',
                    detail:        `erwartete abbruch, ergab ${valueToString(value)}`,
                });
            } else if (value.kind === 'bool' && value.value) {
                results.push({
                    pruefeName:    decl.name,
                    beispielLabel: beispiel.label,
                    status:        'pass',
                    detail:        'wahr',
                });
            } else {
                results.push({
                    pruefeName:    decl.name,
                    beispielLabel: beispiel.label,
                    status:        'fail',
                    detail:        `ergab ${valueToString(value)}`,
                });
            }
        } catch (err) {
            if (err instanceof AbbruchSignal) {
                // Abbruch ist nicht abfangbar — hier an der Lauf-Grenze
                // wird er ausgewertet: erwartet → pass, sonst → fail
                // (mit Anzeige der Begründung, SPEC § 10.2).
                results.push({
                    pruefeName:    decl.name,
                    beispielLabel: beispiel.label,
                    status:        erwartetAbbruch ? 'pass' : 'fail',
                    detail:        erwartetAbbruch
                        ? `Abbruch wie erwartet: "${err.grund}"`
                        : `abbruch: "${err.grund}"`,
                });
            } else {
                results.push({
                    pruefeName:    decl.name,
                    beispielLabel: beispiel.label,
                    status:        'error',
                    detail:        formatError(err),
                });
            }
        }
    }
    return results;
}

/**
 * Führt GENAU einen `prüfe`-Block des Entry-Programms aus (CodeLens
 * „Testfälle ausführen"). Cross-Modul-`verwende` wird über eine
 * memoisierende, zyklensichere Registry aus allen geparsten Workspace-
 * Programmen aufgelöst — ohne Datei-IO, ohne topologische Vorsortierung.
 *
 * @param workspace   alle geparsten `.findsl`-Programme (inkl. Entry)
 * @param entry       Programm, dessen Block läuft
 * @param pruefeIndex Index unter den `PruefeDecl`s des Entry-Programms
 */
export function runSinglePruefe(
    workspace: ReadonlyArray<Program>, entry: Program, pruefeIndex: number,
): PruefeReport {
    const ausgaben: string[] = [];
    const sink = (t: string): void => { ausgaben.push(t); };
    const byPath = new Map<string, Program>();
    for (const p of workspace) {
        const fp = programFilePath(p);
        if (fp && !byPath.has(fp)) byPath.set(fp, p);
    }

    const cache = new Map<string, InterpretedModule>();
    const inProgress = new Set<string>();
    const registry: ModuleRegistry = {
        lookup(key) {
            if (!key) return undefined;
            const hit = cache.get(key);
            if (hit) return hit;
            const p = byPath.get(key);
            if (!p || inProgress.has(key)) return undefined;   // fehlt / Zyklus
            inProgress.add(key);
            try {
                const m = interpretProgram(p, registry, sink, key);
                cache.set(key, m);
                return m;
            } catch {
                return undefined;
            } finally {
                inProgress.delete(key);
            }
        },
    };

    let mod;
    try {
        mod = interpretProgram(entry, registry, sink, programFilePath(entry));
    } catch (err) {
        return summarize([{
            pruefeName: '', beispielLabel: '<modul-initialisierung>',
            status: 'error', detail: formatError(err),
        }], ausgaben);
    }

    const decl = mod.pruefen[pruefeIndex];
    if (!decl) return summarize([], ausgaben);
    return summarize(runPruefeDecl(decl, mod.env), ausgaben);
}

function summarize(
    results: ReadonlyArray<BeispielReport>,
    ausgaben: ReadonlyArray<string> = [],
): PruefeReport {
    let passed = 0;
    let failed = 0;
    let errored = 0;
    for (const r of results) {
        if (r.status === 'pass')       passed++;
        else if (r.status === 'fail')  failed++;
        else                           errored++;
    }
    return { total: results.length, passed, failed, errored, results, ausgaben };
}

function formatError(err: unknown): string {
    if (err instanceof AbbruchSignal)  return `abbruch: "${err.grund}"`;
    if (err instanceof InterpretError) return err.message;
    if (err instanceof Error)          return `${err.name}: ${err.message}`;
    return String(err);
}
