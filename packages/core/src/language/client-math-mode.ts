// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Hält LSP-Client-Kontext (Name aus `initialize` → `clientInfo.name`, IDE-Theme
 * aus `initializationOptions`) und leitet daraus ab, WIE Hover-Formeln gerendert
 * werden.
 *
 * Hintergrund (Issue #250): Die Hover-Karten betten gerenderte MathJax-Formeln
 * als Bild ein. **VS Code** kann ein `data:image/svg+xml`-Bild im Hover-Markdown
 * darstellen (Webview). **IntelliJ/JetBrains** (via LSP4IJ) lädt jedes `<img>`
 * über IntelliJs Bildlader und kann `data:`-URLs NICHT — es interpretiert sie als
 * Dateipfad (`… : File name too long`). IntelliJ rendert aber ein Bild aus einer
 * echten `file://`-URL (inkl. SVG). Deshalb:
 *
 *   - VS-Code-Familie + unbekannte Clients → `svg-data` (data-URL, wie bisher).
 *   - sonst (IntelliJ u.a.)                → `svg-file` (SVG in Datei, file://-URL).
 *
 * Das Theme (`dark`/`light`) wird für `svg-file` gebraucht: IntelliJs SVG-Loader
 * (JSVG) wertet `@media (prefers-color-scheme)` NICHT aus, also muss die
 * Formelfarbe fest gesetzt werden — das Plugin meldet das aktuelle IDE-Theme über
 * `initializationOptions.findsl.theme`.
 *
 * Prozessweiter State: ein LSP-Server-Prozess bedient genau einen Client —
 * analog zum MathJax-Init-Cache in `doc-hover-renderer.ts`.
 */

/** Render-Strategie für Hover-Formeln. */
export type HoverMathMode = 'svg-data' | 'svg-file';

let clientName: string | undefined;
let clientTheme: 'dark' | 'light' | undefined;

/** Vom {@link import('./findsl-language-server.js')} beim `initialize` gesetzt
 *  (`params.clientInfo?.name`). */
export function setClientName(name: string | undefined): void {
    clientName = name;
}

/** Vom `initialize` gesetzt (`params.initializationOptions?.findsl?.theme`).
 *  Alles außer `'dark'`/`'light'` → `undefined` (→ Light-Default). */
export function setClientTheme(theme: unknown): void {
    clientTheme = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : undefined;
}

/** Client-Familien, die `data:`-URL-SVG im Hover-Markdown rendern (VS Code & Verwandte). */
function rendersDataUrlSvg(name: string): boolean {
    return name.startsWith('Visual Studio Code')
        || name.startsWith('VSCodium')
        || name.startsWith('Code - OSS');
}

/**
 * Render-Strategie für den aktuellen Client. `svg-data` für VS-Code-Familie und
 * für unbekannte Clients (kein `clientInfo` → konservativ, kein Regress für
 * VS Code und für Unit-Tests ohne gesetzten Client). `svg-file` sonst (IntelliJ
 * u.a., die `data:`-URLs im Hover nicht laden).
 */
export function hoverMathMode(): HoverMathMode {
    if (clientName === undefined || rendersDataUrlSvg(clientName)) return 'svg-data';
    return 'svg-file';
}

/** `true`, wenn der Client ein dunkles IDE-Theme gemeldet hat (für die feste
 *  Formelfarbe im `svg-file`-Pfad). Default `false` (Light). */
export function hoverSvgIsDark(): boolean {
    return clientTheme === 'dark';
}

/** Test-Helper: Client-State zurücksetzen (prozessweiter Cache, s. o.). */
export function resetClientMathModeForTest(): void {
    clientName = undefined;
    clientTheme = undefined;
}
