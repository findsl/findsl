/**
 * TDD-RED → GREEN: `linkifyQuelleProsa` — §-Referenzen in Prosa-Markdown
 * werden zu gesetze-im-internet-Links (gleiche Quelle wie `@Quelle`).
 */

import { describe, it, expect } from 'vitest';
import { linkifyQuelleProsa } from '../../src/docgen/quelle.js';

const KSTG23 = 'https://www.gesetze-im-internet.de/kstg_1977/__23.html';
const ESTG32A = 'https://www.gesetze-im-internet.de/estg/__32a.html';
const KRAFT9 = 'https://www.gesetze-im-internet.de/kraftstg/__9.html';

describe('linkifyQuelleProsa', () => {
    it('verlinkt eine §-Referenz mit Gesetz', () => {
        expect(linkifyQuelleProsa('siehe § 23 Abs. 1 KStG hier'))
            .toBe(`siehe [§ 23 Abs. 1 KStG](${KSTG23}) hier`);
    });

    it('korrektes KStG-Slug (kstg_1977, nicht kstg)', () => {
        expect(linkifyQuelleProsa('§ 23 KStG')).toContain('/kstg_1977/__23.html');
    });

    it('verlinkt EStG und KraftStG', () => {
        expect(linkifyQuelleProsa('nach § 32a EStG'))
            .toBe(`nach [§ 32a EStG](${ESTG32A})`);
        expect(linkifyQuelleProsa('§ 9 Abs. 1 Nr. 2 KraftStG'))
            .toBe(`[§ 9 Abs. 1 Nr. 2 KraftStG](${KRAFT9})`);
    });

    it('bewahrt Markdown-Hervorhebung um die Referenz', () => {
        expect(linkifyQuelleProsa('- **§ 23 KStG** — Steuersatz'))
            .toBe(`- **[§ 23 KStG](${KSTG23})** — Steuersatz`);
    });

    it('Inline-Code wird NICHT verlinkt', () => {
        expect(linkifyQuelleProsa('Code `§ 23 KStG` bleibt'))
            .toBe('Code `§ 23 KStG` bleibt');
    });

    it('gefencter Code wird NICHT verlinkt', () => {
        const md = '```\n§ 23 KStG\n```';
        expect(linkifyQuelleProsa(md)).toBe(md);
    });

    it('idempotent: zweiter Lauf ändert nichts', () => {
        const once = linkifyQuelleProsa('§ 23 KStG und § 32a EStG');
        expect(linkifyQuelleProsa(once)).toBe(once);
    });

    it('unbekanntes Gesetz → kein Link', () => {
        expect(linkifyQuelleProsa('§ 228 SGB IX')).toBe('§ 228 SGB IX');
    });

    it('mehrere Referenzen in einem Satz', () => {
        const r = linkifyQuelleProsa('§ 7 KStG und § 24 KStG');
        expect(r).toContain('[§ 7 KStG](https://www.gesetze-im-internet.de/kstg_1977/__7.html)');
        expect(r).toContain('[§ 24 KStG](https://www.gesetze-im-internet.de/kstg_1977/__24.html)');
    });

    it('Plural-Aufzählung §§ 7, 23, 24 KStG → drei getrennte Links', () => {
        const r = linkifyQuelleProsa('die Kerne §§ 7, 23, 24 KStG hier');
        expect(r).toContain('](https://www.gesetze-im-internet.de/kstg_1977/__7.html)');
        expect(r).toContain('](https://www.gesetze-im-internet.de/kstg_1977/__23.html)');
        expect(r).toContain('](https://www.gesetze-im-internet.de/kstg_1977/__24.html)');
        expect((r.match(/\]\(https:\/\//g) ?? []).length).toBe(3);
    });

    it('Plural mit „und": §§ 8 und 26 KStG → zwei Links', () => {
        const r = linkifyQuelleProsa('§§ 8 und 26 KStG');
        expect(r).toContain('/kstg_1977/__8.html)');
        expect(r).toContain('/kstg_1977/__26.html)');
        expect((r.match(/\]\(https:\/\//g) ?? []).length).toBe(2);
    });

    it('„Absatz 1, 2" bleibt KEIN Trenner (nur § 5 verlinkt)', () => {
        const r = linkifyQuelleProsa('§§ 5 Absatz 1, 2 EStG');
        expect((r.match(/\]\(https:\/\//g) ?? []).length).toBe(1);
        expect(r).toContain('/estg/__5.html)');
        expect(r).not.toContain('/estg/__1.html)');
        expect(r).not.toContain('/estg/__2.html)');
    });

    it('Slash-Aufzählung §§ 7/23/24 KStG → drei Links (EU-RL 97/24/EG unberührt)', () => {
        const r = linkifyQuelleProsa('Umfang §§ 7/23/24 KStG; Richtlinie 97/24/EG');
        expect(r).toContain('/kstg_1977/__7.html)');
        expect(r).toContain('/kstg_1977/__23.html)');
        expect(r).toContain('/kstg_1977/__24.html)');
        expect((r.match(/\]\(https:\/\//g) ?? []).length).toBe(3);
        expect(r).toContain('Richtlinie 97/24/EG');   // kein §§-Anker → unverlinkt
    });

    it('Referenz über weichen Zeilenumbruch wird verlinkt (Label geglättet)', () => {
        const r = linkifyQuelleProsa('kein Ausschluss des § 24\nSatz 2 KStG vorliegt');
        expect(r).toBe(`kein Ausschluss des [§ 24 Satz 2 KStG](${KSTG23.replace('__23', '__24')}) vorliegt`);
    });

    it('Absatzgrenze (Leerzeile) im Label → KEIN Link', () => {
        const r = linkifyQuelleProsa('§ 24\n\nSatz 2 KStG');
        expect(r).not.toContain('](http');
    });

    it('einfache Formen unverändert (Regression)', () => {
        expect(linkifyQuelleProsa('§ 32a EStG'))
            .toBe('[§ 32a EStG](https://www.gesetze-im-internet.de/estg/__32a.html)');
    });

    it('leerer/None-Text bleibt unverändert', () => {
        expect(linkifyQuelleProsa('')).toBe('');
        expect(linkifyQuelleProsa('ganz ohne Paragraf')).toBe('ganz ohne Paragraf');
    });
});
