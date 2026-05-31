// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Hält den LSP-Client-Namen (aus `initialize` → `clientInfo.name`) und leitet
 * daraus ab, ob Hover-Formeln als reiner Unicode-Text statt als MathJax-SVG
 * gerendert werden.
 *
 * Hintergrund (Issue #250): Die Hover-Karten betten Formeln als
 * `data:image/svg+xml`-Markdown-Bild ein. VS Code rendert das im Hover; andere
 * Clients — insbesondere IntelliJ/JetBrains via LSP4IJ — können kein Bild im
 * Hover-Markdown anzeigen, dort bliebe die Formel leer. Für solche Clients
 * liefert der Server stattdessen den bereits vorhandenen `texToPlain`-Pfad
 * (Unicode-Math: `x²`, `≤`, `Σ` …).
 *
 * Prozessweiter State: ein LSP-Server-Prozess bedient genau einen Client —
 * analog zum MathJax-Init-Cache in `doc-hover-renderer.ts`.
 */

let clientName: string | undefined;

/** Wird vom {@link import('./findsl-language-server.js')} beim `initialize`
 *  gesetzt (`params.clientInfo?.name`). */
export function setClientName(name: string | undefined): void {
    clientName = name;
}

/** Client-Familien, die SVG-Bilder im Hover-Markdown rendern (VS Code & Verwandte). */
function rendersSvgInHover(name: string): boolean {
    return name.startsWith('Visual Studio Code')
        || name.startsWith('VSCodium')
        || name.startsWith('Code - OSS');
}

/**
 * `true`, wenn der aktuelle Client KEINE SVG-Bilder im Hover rendert (z. B.
 * IntelliJ/JetBrains) → Formeln als Unicode-Klartext statt SVG. Bei unbekanntem
 * Client (kein `clientInfo` gesendet) konservativ `false` (SVG-Default wie bisher,
 * kein Regress für VS Code und für Unit-Tests ohne gesetzten Client).
 */
export function clientPrefersPlainMath(): boolean {
    return clientName !== undefined && !rendersSvgInHover(clientName);
}

/** Test-Helper: Client-State zurücksetzen (prozessweiter Cache, s. o.). */
export function resetClientMathModeForTest(): void {
    clientName = undefined;
}
