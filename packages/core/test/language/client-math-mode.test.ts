// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Tests für die Client-Erkennung (#250): Welche LSP-Clients bekommen
 * Hover-Formeln als Unicode-Klartext statt als SVG-Bild?
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
    setClientName,
    clientPrefersPlainMath,
    resetClientMathModeForTest,
} from '../../src/language/client-math-mode.js';

describe('clientPrefersPlainMath (#250)', () => {
    afterEach(() => resetClientMathModeForTest());

    it('IntelliJ/JetBrains-Clients bevorzugen Unicode-Klartext (kein SVG-Hover)', () => {
        setClientName('IntelliJ IDEA Community Edition 2024.2');
        expect(clientPrefersPlainMath()).toBe(true);
    });

    it('weitere JetBrains-IDEs ebenso', () => {
        for (const name of ['PyCharm 2024.2', 'WebStorm 2024.2', 'GoLand 2024.2']) {
            setClientName(name);
            expect(clientPrefersPlainMath()).toBe(true);
        }
    });

    it('VS Code (und Verwandte) rendern SVG → kein plainMath', () => {
        for (const name of ['Visual Studio Code', 'VSCodium', 'Code - OSS']) {
            setClientName(name);
            expect(clientPrefersPlainMath()).toBe(false);
        }
    });

    it('unbekannter/fehlender Client → konservativ SVG (kein Regress)', () => {
        setClientName(undefined);
        expect(clientPrefersPlainMath()).toBe(false);
    });
});
