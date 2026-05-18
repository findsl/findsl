// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * AST + aufgelöste Typen → target-neutrale IR (ADR1 `lower/`).
 *
 * **Phase 0: Stub.** Liefert ein Modul mit leerer Deklarationsliste —
 * der Emitter erzeugt daraus eine kompilierbare, leere `final class`.
 * Phase 1 implementiert hier das echte Lowering: `evalExpr`-Spiegel,
 * `combineAddSub/Mul/Div`-Tag-Verlauf eingefroren, `governingMoneyTarget`
 * EINMALIG ausgeführt, Default-/Named-Arg-Auflösung, Statement-vs-
 * Expression-Lowering (`never`-Zweig → `throw`). Semantik-Orakel bleibt
 * stets `packages/core/src/interpret/`.
 */

import type { Program } from '../../language/generated/ast.js';
import type { IrModule } from '../ir/nodes.js';

export interface LowerContext {
    readonly javaPackage: string;
    readonly className: string;
}

/**
 * Phase-0-Lowering: erzeugt das Modul-Gerüst ohne Member. Der `program`-
 * Parameter ist bewusst noch ungenutzt — Phase 1 walkt ihn.
 */
export function lowerProgram(_program: Program, ctx: LowerContext): IrModule {
    return {
        javaPackage: ctx.javaPackage,
        className: ctx.className,
        decls: [],
    };
}
