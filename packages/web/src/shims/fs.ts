// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Browser-Stub für `node:fs`. Im Single-File-Modus (EmptyFileSystem) gibt es
 * kein Dateisystem: die einzige erreichbare Nutzung ist `existsSync` in der
 * Cross-File-Import-Validierung — die wird hier zum No-op (`false`), d. h.
 * Import-Existenzprüfung entfällt (Cross-File kommt in einer späteren
 * In-Memory-FS-Phase). Die Datei-Loader (docgen/papgen) liegen NICHT im
 * Browser-Graph.
 */

export function existsSync(_p: unknown): boolean {
    return false;
}

function nichtImBrowser(): never {
    throw new Error('node:fs ist im Browser nicht verfügbar (@findsl/web, Single-File-Modus).');
}

export const readFileSync = nichtImBrowser;
export const writeFileSync = nichtImBrowser;

export default { existsSync, readFileSync, writeFileSync };
