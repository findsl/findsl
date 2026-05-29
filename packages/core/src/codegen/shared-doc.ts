// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Gemeinsame Doc-Aufbereitung für Java- (`javadoc`) und TS-Emitter
 * (`tsdoc`), Issue #212. Die Strip-Logik (`--…--`-Hülle entfernen, leere
 * Rand-Zeilen kappen, Kommentar-Ende-Sequenzen entschärfen) ist identisch;
 * einziger Unterschied ist das Rückgabe-Tag (`@return` vs. `@returns`). Die
 * `@Quelle`-Behandlung
 * bleibt BEWUSST beim jeweiligen Emitter (Java → echte `@Quelle`-Annotation
 * via `quelleAnnotations`, #156; TS → Inline-`@Quelle`-Zeile im JSDoc).
 */

/**
 * FinDSL-`--…--`-Doc → JSDoc/Javadoc-Body-Zeilen (` * …`), oder leer.
 * `@rückgabe` wird auf das zielsprachige Tag gemappt, leere Rand-Zeilen
 * werden gekappt. OHNE Wrapper und OHNE `@Quelle` — das ergänzt der Aufrufer.
 */
export function stripDocBody(doc: string | undefined, returnTag: string): string[] {
    const body: string[] = [];
    if (doc && doc.trim() !== '') {
        const stripped = doc.replace(/\r/g, '').trim()
            .replace(/^--/, '').replace(/--$/, '');
        for (const raw of stripped.split('\n')) {
            if (raw.trim() === '--') continue;
            const ln = raw.replace(/@rückgabe\b/g, returnTag).replace(/\*\//g, '* /');
            body.push(ln.length ? ` * ${ln}` : ' *');
        }
        while (body.length && body[0] === ' *') body.shift();
        while (body.length && body[body.length - 1] === ' *') body.pop();
    }
    return body;
}

/**
 * Body-Zeilen → vollständiger, eingerückter Doc-Block (Kommentar-Öffner,
 * Body, Kommentar-Schluss); leerer Body → keine Zeilen (kein leerer
 * Kommentar).
 */
export function wrapDoc(body: ReadonlyArray<string>, indent: string): string[] {
    if (body.length === 0) return [];
    return [`${indent}/**`, ...body.map((l) => indent + l), `${indent} */`];
}
