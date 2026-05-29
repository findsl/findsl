// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Zielsprachen-agnostische Namens-Helfer für die Emitter (Issue #212).
 *
 * Java- und TS-Emitter leiten `fn`-Namen identisch ab — die gemeinsame
 * Quelle hier verhindert, dass die beiden Kopien auseinanderdriften.
 */

/**
 * FinDSL-`fn`-Name → camelCase-Bezeichner: erster Buchstabe (nach
 * optionalem führendem `_`) klein. Deterministisch, konsistent an Decl
 * UND Aufruf — von Java- (`javaMethodName`) und TS-Emitter (`tsFnName`)
 * gemeinsam genutzt.
 */
export function fnName(name: string): string {
    return name.replace(/^(_*)(\p{L})/u, (_m, us: string, c: string) => us + c.toLowerCase());
}
