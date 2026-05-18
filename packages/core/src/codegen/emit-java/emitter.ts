// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * IR → Java-Quelltext (ADR1 `emit-java/`).
 *
 * **Phase 0:** emittiert pro Modul eine deterministische, **kompilierbare**
 * leere `final class` (privater Konstruktor — ADR6). Member-Bodies
 * (konst/fn/datensatz/aufzählung/prüfe) folgen in Phase 1. Der Emitter ist
 * ein reiner, deterministischer Pretty-Printer über dem `Doc`-Kern
 * (Risiko R9: byte-identische Wiederholung).
 */

import { type Doc, concat, text, line, indent, render } from '../emit/doc.js';
import type { IrModule } from '../ir/nodes.js';

/** Rendert ein `IrModule` zu Java-21-Quelltext (deterministisch). */
export function emitJavaModule(m: IrModule): string {
    const memberLines: Doc = m.decls.length === 0
        ? text('// Phase 0: noch keine Member emittiert — Lowering folgt in Phase 1.')
        : concat(
            ...m.decls.flatMap((d) => [
                text(`// TODO Phase 1: ${d.kind === 'todo' ? d.source : ''}`),
                line,
            ]),
        );

    const doc = concat(
        text(`package ${m.javaPackage};`), line,
        line,
        text('/**'), line,
        text(' * Generiert aus FinDSL — NICHT manuell editieren.'), line,
        text(' * Semantik-Orakel: der FinDSL-Interpreter (bit-genau).'), line,
        text(' */'), line,
        text(`public final class ${m.className} {`),
        indent(concat(
            line,
            text(`private ${m.className}() {}`),
            line,
            memberLines,
        )),
        line,
        text('}'), line,
    );
    return render(doc);
}
