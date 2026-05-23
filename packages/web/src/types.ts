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
    /** Ausgewerteter Wert (pass/fail) bzw. Fehlermeldung (error). Der
     *  Interpreter-Report (`TestfallReport`) liefert keinen getrennten
     *  Erwartet/Ist-Diff — daher nur dieses Detail. */
    message?: string;
}

export interface CheckResult {
    cases: PruefeCase[];
    passed: number;
    total: number;
    durationMs: number;
    diagnostics?: Diagnostic[];
    /** Gesetzt, wenn check selbst scheiterte (Dokument nicht offen, Wurf in
     *  runPruefe) — unterscheidbar von „0 Tests, alle grün". */
    error?: string;
}

export interface Artifact {
    target: Target;
    filename: string;
    mime: string;
    /** java/ts/js/markdown/html — und pdf als pdfmake-Doc-Definition (JSON,
     *  Path B: die Website rendert daraus die Bytes). */
    text?: string;
    /** Reserviert für worker-seitige PDF-Bytes (Path A, noch nicht genutzt —
     *  Path B liefert die Doc-Definition in `text`). */
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
