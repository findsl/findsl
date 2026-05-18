// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Pfad → Java-Package/Klassenname (ADR8, Phase 3).
 *
 * Der Codegen erwartet **ein Basisverzeichnis** und ermittelt rekursiv
 * alle `*.findsl`. Das Java-Package ist der relative Verzeichnispfad
 * einer Datei zum Basisverzeichnis (Verzeichnisse = Package-Segmente).
 * Eine Datei **direkt** im Basisverzeichnis → das unbenannte (Default-)
 * Package (kein `package …;`). Kein Default-/Fallback-Package
 * `org.findsl`, kein `-p/--package`.
 *
 * Ungültige Verzeichnis-/Dateinamen werden **deterministisch**
 * saniert (Nicht-Java-Identifier-Zeichen → `_`, Ziffern-Start → `_`-
 * Präfix). Rein & seiteneffektfrei (Risiko R9) — `path` wird vom Aufrufer
 * (CLI) injiziert, damit dieses Modul plattform-/FS-agnostisch bleibt.
 */

/** Java-Schlüsselwörter (JLS §3.9) — als Identifier unzulässig. */
const JAVA_KEYWORDS: ReadonlySet<string> = new Set([
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch',
    'char', 'class', 'const', 'continue', 'default', 'do', 'double',
    'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto',
    'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long',
    'native', 'new', 'package', 'private', 'protected', 'public', 'return',
    'short', 'static', 'strictfp', 'super', 'switch', 'synchronized',
    'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile',
    'while', 'true', 'false', 'null', '_',
]);

/**
 * Saniert **ein** Verzeichnis-Segment zu einem gültigen Java-
 * Identifier (= Package-Segment): jedes Zeichen außerhalb
 * `[\p{L}\p{N}_]` → `_`; Ziffern-Start → `_`-Präfix; Java-Keyword →
 * `_`-Suffix. Groß-/Kleinschreibung bleibt unverändert (deterministisch).
 *
 * @param seg roher Verzeichnisname.
 * @returns gültiges, kollisionsarmes Package-Segment.
 */
export function sanitizePackageSegment(seg: string): string {
    let s = seg.replace(/[^\p{L}\p{N}_]/gu, '_');
    if (s === '' ) return '_';
    if (/^\p{Nd}/u.test(s)) s = '_' + s;
    if (JAVA_KEYWORDS.has(s)) s = s + '_';
    return s;
}

/**
 * Java-Package aus dem relativen Verzeichnis einer Datei zum
 * Basisverzeichnis. Datei direkt im Basisverzeichnis → `undefined`
 * (unbenanntes Package, kein `package …;`).
 *
 * @param relDir Verzeichnispfad der Datei **relativ** zum Basis-
 *               verzeichnis (vom Aufrufer via `path.relative` +
 *               `path.dirname` berechnet); `''`/`'.'` = Wurzel.
 * @param sep    Pfad-Trenner der Plattform (`path.sep`).
 * @returns punkt-getrenntes Package oder `undefined` (Wurzel).
 */
export function derivePackage(relDir: string, sep: string): string | undefined {
    const segs = relDir
        .split(sep)
        .filter((s) => s !== '' && s !== '.');
    if (segs.length === 0) return undefined;
    return segs.map(sanitizePackageSegment).join('.');
}

/**
 * Java-Klassenname aus dem Datei-Basenamen (ohne `.findsl`): Wörter
 * werden an jeder Nicht-`[\p{L}\p{N}]`-Sequenz getrennt (`-`/`.`/`_`/
 * Leerzeichen = Trenner), jedes Wort initial großgeschrieben, dann
 * konkateniert (PascalCase). Ziffern-Start → `_`-Präfix.
 *
 * Beispiele: `kst` → `Kst`, `kraftst.test` → `KraftstTest`,
 * `kraftstg-tarif-leicht` → `KraftstgTarifLeicht`.
 *
 * @param baseName Datei-Basename **ohne** `.findsl`-Endung.
 * @returns gültiger Java-Klassenname (PascalCase, deterministisch).
 */
export function deriveClassName(baseName: string): string {
    const words = baseName
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w !== '');
    let name = words
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join('');
    if (name === '') name = '_';
    if (/^\p{Nd}/u.test(name)) name = '_' + name;
    return name;
}

/** `true`, wenn der Datei-Basename eine `prüfe`-Testdatei ist. */
export function isTestFile(fileName: string): boolean {
    return fileName.endsWith('.test.findsl');
}
