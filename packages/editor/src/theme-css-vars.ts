// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Optionaler Theme-Helfer (#151-Dogfooding Finding #2). `@findsl/editor` ist
 * bewusst DOM-agnostisch — `FindslEditorThemeSpec` erwartet aufgelöste
 * sRGB-Hex. Konsumenten mit einem CSS-Custom-Property-Designsystem mussten
 * das oklch→Hex-Auflösen und das Lesen der Theme-Basis selbst bauen; dieser
 * Helfer kapselt genau das (kein API-Zwang — `mountFindslEditor` bleibt
 * unverändert nutzbar). Browser-only.
 */

import type { FindslEditorThemeSpec } from './index.js';

export interface ThemeFromCssVarsOptions {
    /** DOM-Attribut, das die Theme-Basis trägt. Default: `'data-theme'`. */
    attr?: string;
    /** Attribut-Wert, der „dunkel" bedeutet. Default: `'dark'`. */
    darkValue?: string;
    /** Element, das das Attribut trägt. Default: `document.documentElement`. */
    root?: Element;
}

/**
 * Baut einen {@link FindslEditorThemeSpec} aus CSS-Custom-Properties: löst
 * jede Property im aktiven Theme zu **sRGB-Hex** auf (Canvas-Probe, deckt
 * `oklch`/`hsl`/… ab — VS-Code-`colorCustomizations` akzeptieren nur Hex) und
 * liest die Basis aus einem DOM-Attribut.
 *
 * @example
 * const spec = themeFromCssVars({ 'editor.background': '--paper' });
 * const handle = await mountFindslEditor(el, { theme: spec });
 * // bei eigenem Theme-Wechsel:
 * new MutationObserver(() => handle.setTheme(themeFromCssVars({ 'editor.background': '--paper' })))
 *   .observe(document.documentElement, { attributeFilter: ['data-theme'] });
 *
 * @param colorCustomizations VS-Code-Key → CSS-Custom-Property-Name
 *   (z. B. `{ 'editor.background': '--paper' }`). Nicht auflösbare Properties
 *   werden ausgelassen.
 */
export function themeFromCssVars(
    colorCustomizations: Record<string, string>,
    opts: ThemeFromCssVarsOptions = {},
): FindslEditorThemeSpec {
    const root = opts.root ?? document.documentElement;
    const base: 'light' | 'dark' =
        root.getAttribute(opts.attr ?? 'data-theme') === (opts.darkValue ?? 'dark')
            ? 'dark'
            : 'light';
    const resolved: Record<string, string> = {};
    for (const [key, cssVar] of Object.entries(colorCustomizations)) {
        const hex = cssVarToHex(cssVar);
        if (hex !== undefined) resolved[key] = hex;
    }
    return { base, colorCustomizations: resolved };
}

/** sRGB-Hex einer CSS-Custom-Property im aktiven Theme (oklch/… → Hex via Canvas). */
function cssVarToHex(name: string): string | undefined {
    const probe = document.createElement('div');
    probe.style.cssText = `color:var(${name});display:none`;
    document.body.appendChild(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    if (!color) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    if (r === undefined || g === undefined || b === undefined) return undefined;
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}
