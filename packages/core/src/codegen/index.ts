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

/** v1.0-Stand: nur `java` ist eine Zielsprache. */
export type ZielSprache = 'java';

/** Künftige Targets (Folge-Tickets): `ts`, `js` — noch nicht implementiert. */
export const GEPLANTE_SPRACHEN = ['ts', 'js'] as const;

export const UNTERSTUETZTE_SPRACHEN: ReadonlyArray<ZielSprache> = ['java'];

export function istUnterstuetzteSprache(s: string): s is ZielSprache {
    return (UNTERSTUETZTE_SPRACHEN as ReadonlyArray<string>).includes(s);
}

export { lowerProgram, lowerTestProgram, type LowerContext } from './lower/lower.js';
export {
    emitJavaModuleFiles, emitJavaTestModule, type JavaModuleFiles,
} from './emit-java/emitter.js';
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
