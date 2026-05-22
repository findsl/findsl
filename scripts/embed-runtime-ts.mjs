#!/usr/bin/env node
// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Bettet die FinDSL-TypeScript-Runtime aus `runtimes/ts/src/` als
 * TypeScript-Modul ein, das vom CLI-Codegen ausgeliefert wird (Issue
 * #41/#99 — TS/JS-Target, Schwester zu `embed-runtime-java.mjs`).
 *
 * Ergebnis: `packages/core/src/codegen/emit-ts/runtime-files-ts.generated.ts`.
 * Wird von esbuild beim CLI-Bundle aufgenommen → das Native-Binary trägt die
 * Runtime intern und schreibt sie bei jedem `findsl codegen --lang ts` ins
 * Ausgabeverzeichnis (Lockstep zwischen CLI-Version und mit-geliefertem Code).
 *
 * Wird vor `tsc` ausgeführt (siehe `npm run build`). Datei steht in
 * `.gitignore` — die Quelle ist immer `runtimes/ts/src/`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const runtimeSrc = path.join(repoRoot, 'runtimes', 'ts', 'src');
const outFile = path.join(
    repoRoot, 'packages', 'core', 'src', 'codegen', 'emit-ts',
    'runtime-files-ts.generated.ts',
);

if (!fs.existsSync(runtimeSrc)) {
    console.error(`✗ Runtime-Quellen fehlen: ${runtimeSrc}`);
    process.exit(1);
}

// Deterministische Reihenfolge (sortiert) — wichtig für reproduzierbare Builds.
const files = fs.readdirSync(runtimeSrc)
    .filter((n) => n.endsWith('.ts'))
    .sort();

if (files.length === 0) {
    console.error(`✗ Keine .ts-Dateien in ${runtimeSrc}`);
    process.exit(1);
}

// relPath = `runtime/<name>.ts` — der Generat-Output legt die Runtime unter
// `<out>/runtime/` ab; generierte Module importieren `./runtime/index.js`.
const entries = files.map((name) => {
    const content = fs.readFileSync(path.join(runtimeSrc, name), 'utf8');
    return {
        relPath: `runtime/${name}`,
        content,
    };
});

const totalBytes = entries.reduce((n, e) => n + e.content.length, 0);

const ts = `// AUTO-GENERATED — NICHT VON HAND EDITIEREN.
// Quelle: runtimes/ts/src/
// Regenerieren: \`node scripts/embed-runtime-ts.mjs\` (Teil von \`npm run build\`).
//
// Das CLI emittiert diese Dateien bei jedem \`findsl codegen --lang ts\`
// ins Ausgabeverzeichnis (unter \`runtime/\`) — der Generat-Output ist damit
// ein vollständig autonomes TS-Projekt; einzige externe Abhängigkeit ist
// \`decimal.js\` (gleicher Stack wie der Interpreter → bit-genau, kein Drift).
//
// ${files.length} Datei(en), ${totalBytes} Zeichen.

export interface EmbeddedRuntimeFile {
    readonly relPath: string;
    readonly content: string;
}

export const TS_RUNTIME_FILES: ReadonlyArray<EmbeddedRuntimeFile> = ${
    JSON.stringify(entries, null, 4)
};
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, ts);
console.log(`[embed-runtime-ts] ${files.length} Datei(en) → ${path.relative(repoRoot, outFile)}`);
