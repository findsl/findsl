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
    evalTestfall,
    interpretProgram,
    type InterpretedModule,
    type ModuleRegistry,
} from './interpreter.js';
import type { AstNode } from 'langium';
import type { Environment } from './environment.js';
import type { Program, PruefeDecl } from '../language/generated/ast.js';
import type { LoadedModule } from './module-loader.js';
import { programFilePath } from '../language/import-path.js';

export type TestfallStatus = 'pass' | 'fail' | 'error';

export interface TestfallReport {
    readonly pruefeName: string;
    readonly testfallLabel: string;
    readonly status: TestfallStatus;
    /** Ausgewerteter Wert bei pass/fail, Fehlermeldung bei error. */
    readonly detail: string;
    /** 1-basierte Quellposition des `testfall` (für die Editor-Navigation aus
     *  dem Test-Runner-Fenster, #256). Fehlt, wenn kein CST-Knoten vorliegt. */
    readonly line?: number;
    readonly column?: number;
}

export interface PruefeReport {
    readonly total: number;
    readonly passed: number;
    readonly failed: number;
    readonly errored: number;
    readonly results: ReadonlyArray<TestfallReport>;
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
    const results: TestfallReport[] = [];
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
                testfallLabel: '<modul-graph-initialisierung>',
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
            testfallLabel:  '<modul-initialisierung>',
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
/**
 * Führt die `testfall`-Items eines `prüfe`-Blocks aus. Optionaler
 * `testfallIndex` selektiert einen einzelnen Testfall — wird vom
 * Test-Controller-Pfad genutzt, wenn der Nutzer NICHT den Block-Run
 * sondern den Gutter-Play-Pfeil eines einzelnen `testfall` klickt
 * (Issue #79-Folge).
 */
export function runPruefeDecl(
    decl: PruefeDecl, env: Environment, testfallIndex?: number,
): TestfallReport[] {
    const testfaelle = testfallIndex === undefined
        ? decl.testfaelle
        : decl.testfaelle[testfallIndex] !== undefined
            ? [decl.testfaelle[testfallIndex]]
            : [];
    const results: TestfallReport[] = [];
    for (const testfall of testfaelle) {
        // Quellposition des testfall (1-basiert) — für die Sprung-Navigation aus
        // dem Test-Runner-Fenster. Einmal pro testfall, in jedes Ergebnis gesetzt.
        const pos = cstStartOf(testfall);
        const mk = (status: TestfallStatus, detail: string): TestfallReport => ({
            pruefeName:    decl.name,
            testfallLabel: testfall.label,
            status,
            detail,
            line:          pos?.line,
            column:        pos?.column,
        });
        const erwartetAbbruch = testfall.erwartetAbbruch === true;
        try {
            const value: Value = evalTestfall(testfall, env);
            if (erwartetAbbruch) {
                results.push(mk('fail', `erwartete abbruch, ergab ${valueToString(value)}`));
            } else if (value.kind === 'bool' && value.value) {
                results.push(mk('pass', 'wahr'));
            } else {
                results.push(mk('fail', `ergab ${valueToString(value)}`));
            }
        } catch (err) {
            if (err instanceof AbbruchSignal) {
                // Abbruch ist nicht abfangbar — hier an der Lauf-Grenze
                // wird er ausgewertet: erwartet → pass, sonst → fail
                // (mit Anzeige der Begründung, SPEC § 10.2).
                results.push(mk(
                    erwartetAbbruch ? 'pass' : 'fail',
                    erwartetAbbruch ? `Abbruch wie erwartet: "${err.grund}"` : `abbruch: "${err.grund}"`,
                ));
            } else {
                results.push(mk('error', formatError(err)));
            }
        }
    }
    return results;
}

/** 1-basierte Startposition eines AST-Knotens aus seinem CST-Knoten (oder
 *  `undefined`, wenn keiner vorliegt — z. B. bei programmatisch erzeugten Knoten). */
function cstStartOf(node: AstNode): { line: number; column: number } | undefined {
    const start = node.$cstNode?.range.start;
    return start ? { line: start.line + 1, column: start.character + 1 } : undefined;
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
    workspace: ReadonlyArray<Program>,
    entry: Program,
    pruefeIndex: number,
    testfallIndex?: number,
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
            pruefeName: '', testfallLabel: '<modul-initialisierung>',
            status: 'error', detail: formatError(err),
        }], ausgaben);
    }

    const decl = mod.pruefen[pruefeIndex];
    if (!decl) return summarize([], ausgaben);
    return summarize(runPruefeDecl(decl, mod.env, testfallIndex), ausgaben);
}

function summarize(
    results: ReadonlyArray<TestfallReport>,
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
