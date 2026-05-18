// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Target-neutrale Codegen-IR (ADR1 `ir/`).
 *
 * **Phase 0: bewusst ein Skelett.** Die echte Ausdrucks-/Deklarations-IR
 * (konst/fn/datensatz/aufzählung/prüfe; `combine*`-Tag-Verlauf;
 * `governingMoneyTarget`-Auflösung EINMALIG beim Lowering eingefroren)
 * entsteht in Phase 1. Hier stehen nur die stabilen Hüllen-Typen und die
 * ADR1-Slots (`finType`/`tagTrace`), damit Emitter-Schnittstelle,
 * Determinismus-Kern und CLI-Pipe schon end-to-end testbar sind.
 *
 * Sprach-unabhängig (ADR11): dieselbe IR speist Java- und später
 * TS/JS-Emitter.
 */

/** Ein FinDSL-Modul (eine `.findsl`-Datei) als Ziel-Klasse. */
export interface IrModule {
    /** Deterministisch aus dem Dateipfad abgeleitet (Phase 3 final). */
    readonly javaPackage: string;
    /** Klassenname = gemappter Datei-Basename (ADR8, Phase 1 final). */
    readonly className: string;
    readonly decls: ReadonlyArray<IrDecl>;
}

/**
 * Phase 0: einzige Variante ist der Platzhalter. Phase 1 erweitert diese
 * Union um `IrKonst | IrFn | IrDatensatz | IrAufzaehlung | IrPruefe`.
 */
export type IrDecl = IrTodoDecl;

export interface IrTodoDecl {
    readonly kind: 'todo';
    /** Ursprünglicher FinDSL-Deklarationsname (für nachvollziehbare Stubs). */
    readonly source: string;
    /** ADR1: aufgelöster FinDSL-Typ (wird in Phase 1 gesetzt). */
    readonly finType?: string;
    /** ADR1: Numeric-Tag-Verlauf aus `combine*` (Phase 1). */
    readonly tagTrace?: string;
}
