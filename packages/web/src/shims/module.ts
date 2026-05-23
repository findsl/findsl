// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Browser-Stub für `node:module`. `stripTypeScriptTypes` (CLI-JS-Strip) ist
 * Node-only; der Browser-JS-Strip in @findsl/web nutzt stattdessen
 * `typescript`s `transpileModule` (siehe generate, Phase 4). Dieser Stub
 * verhindert nur, dass ein versehentlicher Import den Build bricht.
 */

export function stripTypeScriptTypes(): never {
    throw new Error(
        'node:module.stripTypeScriptTypes ist im Browser nicht verfügbar — '
        + '@findsl/web strippt via typescript transpileModule.',
    );
}

export default { stripTypeScriptTypes };
