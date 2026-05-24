// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * @findsl/web — Paket-Einstieg (`.`-Export): die öffentlichen API-Typen, die
 * die Website (findsl/website) konsumiert. Die Laufzeit lebt im Worker
 * (`@findsl/web/worker`); dieser Entry trägt nur Typen (Deklarationen).
 */

export type {
    Target,
    PruefeCase,
    CheckResult,
    Artifact,
    GenerateResult,
    GenerateOptions,
    Diagnostic,
} from './types.js';
