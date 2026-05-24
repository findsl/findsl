// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Öffentliche Codegen-API (vom CLI-Subkommando `codegen` konsumiert).
 *
 * Architektur (ADR1/ADR11): target-neutrales Lowering `lower/` → IR `ir/`
 * → deterministischer Pretty-Printer `emit/` → sprachspezifischer Emitter
 * `emit-java/`. Phase 0 verdrahtet die Pipe end-to-end mit Skelett-
 * Lowering/-Emitter; Phase 1+ füllt die Semantik.
 *
 * Zielsprache ist ein **Parameter** (`--lang`), nicht der Subkommando-
 * Name — TS/JS-Targets kommen später ohne neues Subkommando dazu.
 */

/** Zielsprachen: `java` (#7), `ts` (#99), `js` (#101, Typ-Strip des TS). */
export type ZielSprache = 'java' | 'ts' | 'js';

/** Keine weiteren Targets geplant (TS/JS-Initiative #41 abgeschlossen). */
export const GEPLANTE_SPRACHEN = [] as const;

export const UNTERSTUETZTE_SPRACHEN: ReadonlyArray<ZielSprache> = ['java', 'ts', 'js'];

export function istUnterstuetzteSprache(s: string): s is ZielSprache {
    return (UNTERSTUETZTE_SPRACHEN as ReadonlyArray<string>).includes(s);
}

export { lowerProgram, lowerTestProgram, type LowerContext } from './lower/lower.js';
export {
    emitJavaModuleFiles, emitJavaTestModule, emitJavaPackageFactory,
    findCompositionCycle,
    type JavaModuleFiles, type JavaFactoryFile,
} from './emit-java/emitter.js';
export {
    emitTsModule, emitTsTestModule, irTypeToTs, type TsModuleFile,
} from './emit-ts/emitter.js';
export {
    emitJsModule, emitJsTestModule, tsZuJs, stripRuntimeToJs,
} from './emit-js/strip.js';
export { render, type Doc } from './emit/doc.js';
export type { IrModule, IrDecl, IrTestModule } from './ir/nodes.js';
export {
    sanitizePackageSegment, derivePackage, deriveClassName, isTestFile,
} from './path-naming.js';

// Java-Runtime ist Teil des Generat-Outputs (kein externes Maven-Artefakt
// mehr): das CLI schreibt sie bei jedem `findsl codegen --lang java` ins
// Ausgabeverzeichnis. Lockstep gratis — CLI-Bundle und mit-geliefertes
// `org/findsl/runtime/*.java` stammen aus derselben Build-Phase.
export {
    JAVA_RUNTIME_FILES, type EmbeddedRuntimeFile,
} from './emit-java/runtime-files.generated.js';

// TS-Runtime (decimal.js-Port) — analog zur Java-Runtime Teil des Generat-
// Outputs: das CLI schreibt sie bei jedem `findsl codegen --lang ts` unter
// `<out>/runtime/`. Lockstep gratis (CLI-Bundle + Runtime aus einer Build-Phase).
export {
    TS_RUNTIME_FILES,
} from './emit-ts/runtime-files-ts.generated.js';
