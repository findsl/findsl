#!/usr/bin/env node
/**
 * Bettet die Java-Runtime-Quellen aus `runtimes/java/src/main/java/org/findsl/runtime/`
 * als TypeScript-Modul ein, das vom CLI-Codegen ausgeliefert wird.
 *
 * Ergebnis: `packages/core/src/codegen/emit-java/runtime-files.generated.ts`.
 * Wird von esbuild beim CLI-Bundle aufgenommen → das Native-Binary trägt die
 * Runtime intern und schreibt sie bei jedem `findsl codegen --lang java` ins
 * Ausgabeverzeichnis (Lockstep zwischen CLI-Version und mit-geliefertem Code).
 *
 * Wird vor `tsc` ausgeführt (siehe `npm run build`). Datei steht in
 * `.gitignore` — die Quelle ist immer `runtimes/java/src/main/java/`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const runtimeSrc = path.join(
    repoRoot, 'runtimes', 'java', 'src', 'main', 'java', 'org', 'findsl', 'runtime',
);
const outFile = path.join(
    repoRoot, 'packages', 'core', 'src', 'codegen', 'emit-java',
    'runtime-files.generated.ts',
);

if (!fs.existsSync(runtimeSrc)) {
    console.error(`✗ Runtime-Quellen fehlen: ${runtimeSrc}`);
    process.exit(1);
}

// Deterministische Reihenfolge (sortiert) — wichtig für reproduzierbare Builds.
const files = fs.readdirSync(runtimeSrc)
    .filter((n) => n.endsWith('.java'))
    .sort();

if (files.length === 0) {
    console.error(`✗ Keine .java-Dateien in ${runtimeSrc}`);
    process.exit(1);
}

const entries = files.map((name) => {
    const content = fs.readFileSync(path.join(runtimeSrc, name), 'utf8');
    return {
        relPath: `org/findsl/runtime/${name}`,
        content,
    };
});

const totalBytes = entries.reduce((n, e) => n + e.content.length, 0);

const ts = `// AUTO-GENERATED — NICHT VON HAND EDITIEREN.
// Quelle: runtimes/java/src/main/java/org/findsl/runtime/
// Regenerieren: \`node scripts/embed-runtime-java.mjs\` (Teil von \`npm run build\`).
//
// Das CLI emittiert diese Dateien bei jedem \`findsl codegen --lang java\`
// ins Ausgabeverzeichnis — der Generat-Output ist damit ein vollständig
// autonomes Java-Projekt ohne externe Maven-Dependency.
//
// ${files.length} Datei(en), ${totalBytes} Zeichen.

export interface EmbeddedRuntimeFile {
    readonly relPath: string;
    readonly content: string;
}

export const JAVA_RUNTIME_FILES: ReadonlyArray<EmbeddedRuntimeFile> = ${
    JSON.stringify(entries, null, 4)
};
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, ts);
console.log(`[embed-runtime-java] ${files.length} Datei(en) → ${path.relative(repoRoot, outFile)}`);
