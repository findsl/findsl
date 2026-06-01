// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Tests für die Client-Erkennung (#250): Welcher Hover-Formel-Modus gilt je
 * Client (`svg-data` für VS Code, `svg-file` für IntelliJ), und welches Theme
 * steuert die feste Formelfarbe im file://-Pfad.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    setClientName,
    setClientTheme,
    hoverMathMode,
    hoverSvgIsDark,
    resetClientMathModeForTest,
} from '../../src/language/client-math-mode.js';

describe('hoverMathMode (#250)', () => {
    afterEach(() => resetClientMathModeForTest());

    it('IntelliJ/JetBrains-Clients → file://-SVG (data:-URL wird dort nicht geladen)', () => {
        for (const name of [
            'IntelliJ IDEA Community Edition 2024.2',
            'PyCharm 2024.2', 'WebStorm 2024.2', 'GoLand 2024.2',
        ]) {
            setClientName(name);
            expect(hoverMathMode()).toBe('svg-file');
        }
    });

    it('VS Code (und Verwandte) → data:-URL-SVG (Webview rendert das Bild)', () => {
        for (const name of ['Visual Studio Code', 'VSCodium', 'Code - OSS']) {
            setClientName(name);
            expect(hoverMathMode()).toBe('svg-data');
        }
    });

    it('unbekannter/fehlender Client → konservativ data:-URL (kein Regress)', () => {
        setClientName(undefined);
        expect(hoverMathMode()).toBe('svg-data');
    });
});

describe('hoverSvgIsDark (#250)', () => {
    afterEach(() => resetClientMathModeForTest());

    it('Theme "dark" → dunkles Theme erkannt', () => {
        setClientTheme('dark');
        expect(hoverSvgIsDark()).toBe(true);
    });

    it('Theme "light", undefined oder unbekannt → Light-Default', () => {
        expect(hoverSvgIsDark()).toBe(false);          // nach reset
        setClientTheme('light');
        expect(hoverSvgIsDark()).toBe(false);
        setClientTheme(undefined);
        expect(hoverSvgIsDark()).toBe(false);
        setClientTheme('nonsense');
        expect(hoverSvgIsDark()).toBe(false);
    });
});
