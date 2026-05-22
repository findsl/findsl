// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * IR → JavaScript-Quelltext (ADR1/ADR11 `emit-js/`, Issue #41/#101).
 *
 * KEIN zweiter handgeschriebener Emitter (Architekt-Empfehlung: eine
 * Quelle der Wahrheit): JS = das TS-Generat ({@link ../emit-ts/emitter.ts})
 * **deterministisch von Typannotationen befreit** über die offizielle
 * Node-Transform `node:module.stripTypeScriptTypes` (kein Regex). `mode:
 * 'transform'` behandelt auch nicht-„erasable" Syntax — `enum` (Builtin-
 * Aufzählungen + generierte) und `readonly`-Konstruktor-Parameter
 * (Record-Klassen) → lauffähiges ESM.
 *
 * ESM-Output für Node ≥ 22 (Repo-Standard Node 24): die `.js`-Importe
 * (`./Foo.js`, `./runtime/index.js`) zeigen nach dem Strip auf die
 * mit-erzeugten `.js`-Dateien; einzige externe Abhängigkeit bleibt
 * `decimal.js` (bit-genau, gleicher Stack wie der Interpreter).
 */

import { stripTypeScriptTypes } from 'node:module';
import { emitTsModule, emitTsTestModule, type TsModuleFile } from '../emit-ts/emitter.js';
import type { IrModule, IrTestModule } from '../ir/nodes.js';
import type { EmbeddedRuntimeFile } from '../emit-ts/runtime-files-ts.generated.js';

/**
 * Unterdrückt EINMALIG die `ExperimentalWarning` der (in Node 24 noch
 * experimentellen) `stripTypeScriptTypes`-API — sie wird bewusst genutzt.
 * Andere Warnungen bleiben unberührt: der Default-Printer (Listener #0)
 * wird für nicht-passende Warnungen weiter aufgerufen.
 */
let warningPatched = false;
function suppressExperimentalStripWarning(): void {
    if (warningPatched) return;
    warningPatched = true;
    const prior = process.listeners('warning').slice() as Array<(w: Error) => void>;
    process.removeAllListeners('warning');
    process.on('warning', (w: Error) => {
        if (w.name === 'ExperimentalWarning'
            && /Type Stripping|stripTypeScriptTypes/i.test(w.message)) {
            return;
        }
        for (const l of prior) l(w);
    });
}

/**
 * TS-Quelltext → ESM-JS via offizielle Node-Transform (deterministisch).
 * `mode: 'transform'` strippt Typannotationen UND transformiert
 * `enum`/`readonly`-ctor-Params/Namespaces zu lauffähigem JS.
 */
export function tsZuJs(tsSource: string): string {
    suppressExperimentalStripWarning();
    return stripTypeScriptTypes(tsSource, { mode: 'transform' });
}

/** `<Name>.ts` → `<Name>.js` (auch `<Name>.test.ts` → `<Name>.test.js`). */
function tsNameToJs(name: string): string {
    return name.replace(/\.ts$/, '.js');
}

/** Rendert ein `IrModule` zu einer `.js`-Datei (TS-Emitter + Typ-Strip). */
export function emitJsModule(m: IrModule): TsModuleFile {
    const ts = emitTsModule(m);
    return { fileName: tsNameToJs(ts.fileName), code: tsZuJs(ts.code) };
}

/** Rendert ein `IrTestModule` zu einer `*.test.js`-Vitest-Spec (Strip). */
export function emitJsTestModule(m: IrTestModule): TsModuleFile {
    const ts = emitTsTestModule(m);
    return { fileName: tsNameToJs(ts.fileName), code: tsZuJs(ts.code) };
}

/**
 * TS-Runtime-Dateien → JS: `relPath` `.ts`→`.js`, Inhalt gestrippt.
 * Aus derselben eingebetteten Quelle wie das TS-Target (Lockstep).
 */
export function stripRuntimeToJs(
    files: ReadonlyArray<EmbeddedRuntimeFile>,
): ReadonlyArray<EmbeddedRuntimeFile> {
    return files.map((f) => ({ relPath: tsNameToJs(f.relPath), content: tsZuJs(f.content) }));
}
