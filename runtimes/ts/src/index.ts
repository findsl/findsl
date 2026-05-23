// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * FinDSL-TypeScript-Runtime — Sammel-Re-Export. Der generierte Code
 * importiert die benötigten Symbole aus `./runtime/index.js` (Issue
 * #41/#99). Bit-genauer decimal.js-Port der Java-Runtime
 * (`runtimes/java/src/main/java/org/findsl/runtime/`).
 *
 * Voller Korpus (Issue #100): Geldmodell + Sicht-Wrapper + Abbruch +
 * Builtin-Enums + Listen (`FinDslListe`, § 11.2). Lambdas sind native
 * TS-Funktionstypen (keine eigene Klasse). `ausgabe`/`Output` bleibt
 * codegen-seitig Phase-4-Scope.
 */
export { FinDslNumber, FinDslRuntimeError, germanFormat, type FinDslNumberType } from './findsl-number.js';
export { Euro, EuroCent, Cent, Prozent, Ganzzahl, Dezimal } from './wrappers.js';
export { FinDslAbort } from './findsl-abort.js';
export { FinDslListe } from './findsl-liste.js';
export { nichtNull } from './findsl-nullable.js';
export { Steuerklasse } from './steuerklasse.js';
export { Tarifart } from './tarifart.js';
