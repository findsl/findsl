// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Browser-Stub für `node:fs/promises`. Nur die fs-basierten Datei-Loader
 * (papgen `buildPapModel`, docgen `buildDocModel`, `kopf`) importieren das —
 * im Browser werden sie NICHT aufgerufen (wir nutzen die reinen
 * `Program`-Bausteine). Der Stub existiert nur fürs Bündeln.
 */

function nichtImBrowser(): Promise<never> {
    return Promise.reject(new Error('node:fs/promises ist im Browser nicht verfügbar (@findsl/web).'));
}

export const readFile = nichtImBrowser;
export const writeFile = nichtImBrowser;
export const mkdir = nichtImBrowser;

export default { readFile, writeFile, mkdir };
