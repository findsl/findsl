// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Browser-Stub für `langium/node` (`NodeFileSystem`). Nur die fs-basierten
 * Datei-Loader (papgen/docgen) importieren das; im Browser werden sie NICHT
 * aufgerufen (wir nutzen `EmptyFileSystem` + reine `Program`-Bausteine).
 * Der Stub existiert nur fürs Bündeln und wirft, falls doch jemand ihn nutzt.
 */

export const NodeFileSystem = {
    fileSystemProvider: () => {
        throw new Error('NodeFileSystem ist im Browser nicht verfügbar (@findsl/web).');
    },
};
