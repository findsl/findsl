/**
 * Sicherheitsorientierte Tests für `renderDocForHover` (Issue #73 LOW 5/6).
 *
 * Härtungen:
 *  - `@Quelle`-Wert wird Markdown-escaped, damit Sonderzeichen den Hover
 *    nicht zu unbeabsichtigten Bildern/Links/Formatierungen umbauen.
 *  - `altText()` (intern) escapt `]`, damit ein TeX-`\text{foo]…}` die
 *    `![<alt>](data:…)`-Bildklammer nicht aus dem `data:`-URL bricht.
 *
 * Wir testen den Markdown-Output direkt (reines String-In/Out). Math-
 * Inhalte umgehen wir bewusst — das vermeidet die MathJax-Init-Latenz
 * und hält den Test fokussiert auf den Escape-Pfad.
 */

import { describe, it, expect } from 'vitest';
import { renderDocForHover } from '../../src/language/doc-hover-renderer.js';

describe('renderDocForHover — @Quelle-Escape (Issue #73)', () => {
    it('Markdown-Sonderzeichen im @Quelle-Wert werden escaped', async () => {
        const out = await renderDocForHover({
            docRaw: '-- Test --',
            quellen: [{ value: '§ 7 EStG [Tarif]' }],
        });
        // Eckige Klammern dürfen den Markdown-Renderer nicht als Link
        // interpretieren — sie müssen escaped sein.
        expect(out).toContain('\\[Tarif\\]');
        // `§` und Leerzeichen bleiben unverändert lesbar.
        expect(out).toContain('§ 7 EStG');
    });

    it('Markdown-Image-Injection im Quelle-Wert wird neutralisiert', async () => {
        const evil = '![pwn](http://attacker.example/track.png)';
        const out = await renderDocForHover({
            quellen: [{ value: evil }],
        });
        // Ein `!` direkt vor `[` würde sonst ein Image-Tag bilden.
        expect(out).not.toContain('![pwn](');
        expect(out).toContain('\\!');
        expect(out).toContain('\\[pwn\\]');
    });

    it('Mehrere Quellen werden je einzeln escaped', async () => {
        const out = await renderDocForHover({
            quellen: [
                { value: '*kursiv*' },
                { value: '_unterstrichen_' },
            ],
        });
        expect(out).toContain('\\*kursiv\\*');
        expect(out).toContain('\\_unterstrichen\\_');
    });

    it('Leere Quellen-Liste erzeugt keinen Quelle-Block', async () => {
        const out = await renderDocForHover({ quellen: [] });
        expect(out).toBe('');
    });
});
