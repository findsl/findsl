// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Öffentliche @findsl/web-Typen — von der Website (findsl/website) konsumiert.
 * Stabil halten; Änderungen sind API-Brüche für die Website.
 */

import type { Diagnostic } from 'vscode-languageserver-types';

export type Target = 'java' | 'ts' | 'js' | 'markdown' | 'html' | 'pdf' | 'pap';

export interface PruefeCase {
    name: string;
    status: 'pass' | 'fail' | 'error';
    /** Ausgewerteter Wert (pass/fail) bzw. Fehlermeldung (error). */
    message?: string;
    expected?: string;
    actual?: string;
    quelle?: string;
}

export interface CheckResult {
    cases: PruefeCase[];
    passed: number;
    total: number;
    durationMs: number;
    diagnostics?: Diagnostic[];
}

export interface Artifact {
    target: Target;
    filename: string;
    mime: string;
    /** java/ts/js/markdown/html */
    text?: string;
    /** pdf (pdfmake → Uint8Array → base64) */
    bytesBase64?: string;
    /** pap (Mermaid-Quelle; Website rendert mit mermaid.js) */
    mermaid?: string;
}

export interface GenerateResult {
    ok: boolean;
    artifact?: Artifact;
    diagnostics?: Diagnostic[];
    error?: string;
}

export type { Diagnostic };
