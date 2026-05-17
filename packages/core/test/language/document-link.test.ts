/**
 * Tests für den Document-Link-Provider: @Quelle → gesetze-im-internet.de
 * (stabiles URL-Schema) und verwende-Modulpfad → Ziel-.findsl-Datei.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { DocumentLink } from 'vscode-languageserver';

async function linksIn(
    sources: Record<string, string>, main: string,
): Promise<{ links: DocumentLink[]; text: (l: DocumentLink) => string }> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const docs = Object.entries(sources).map(([n, s]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(
            s, URI.parse(`file:///${n}.findsl`),
        ),
    );
    for (const d of docs) services.shared.workspace.LangiumDocuments.addDocument(d);
    await services.shared.workspace.DocumentBuilder.build(docs, { validation: false });
    const doc = docs.find((d) => d.uri.path.endsWith(`/${main}.findsl`))!;
    const links = await services.lsp.DocumentLinkProvider!.getDocumentLinks(doc, {
        textDocument: { uri: doc.uri.toString() },
    });
    return { links, text: (l) => doc.textDocument.getText(l.range) };
}

const links = (src: string) => linksIn({ m: src }, 'm');

describe('DocumentLink: @Quelle → gesetze-im-internet.de', () => {
    it('einfacher Paragraf § 32a EStG', async () => {
        const { links: ls, text } = await links(`@Quelle("§ 32a EStG")
konst GFB: Euro = 12.096 als Euro
`);
        const l = ls.find((x) => x.target?.includes('gesetze-im-internet'));
        expect(l).toBeDefined();
        expect(l!.target).toBe('https://www.gesetze-im-internet.de/estg/__32a.html');
        expect(text(l!)).toBe('§ 32a EStG');
    });

    it('mit Absatz/Nr — Link verweist auf die Paragraf-Seite', async () => {
        const { links: ls } = await links(`@Quelle("§ 32a Absatz 1 Nr. 1 EStG")
konst K: Euro = 1 als Euro
`);
        expect(ls[0].target).toBe('https://www.gesetze-im-internet.de/estg/__32a.html');
    });

    it('§ 10c Satz 1 EStG', async () => {
        const { links: ls } = await links(`@Quelle("§ 10c Satz 1 EStG")
konst K: Euro = 1 als Euro
`);
        expect(ls[0].target).toBe('https://www.gesetze-im-internet.de/estg/__10c.html');
    });

    it('andere Gesetze: AO und KStG', async () => {
        const ao = await links(`@Quelle("§ 233a AO")
konst A: Euro = 1 als Euro
`);
        expect(ao.links[0].target).toBe('https://www.gesetze-im-internet.de/ao/__233a.html');

        const kstg = await links(`@Quelle("§ 8 KStG")
konst B: Euro = 1 als Euro
`);
        // gesetze-im-internet-Slug ist `kstg_1977` (Jahr-Suffix, verifiziert)
        expect(kstg.links[0].target).toBe('https://www.gesetze-im-internet.de/kstg_1977/__8.html');

        const kraftstg = await links(`@Quelle("§ 9 KraftStG")
konst C: Euro = 1 als Euro
`);
        expect(kraftstg.links[0].target).toBe('https://www.gesetze-im-internet.de/kraftstg/__9.html');
    });

    it('unbekannte Quelle (kein § / kein gelistetes Gesetz) → kein Link', async () => {
        const { links: ls } = await links(`@Quelle("PAP 2025 Subroutine UPTAB25")
konst K: Euro = 1 als Euro
`);
        expect(ls).toEqual([]);
    });

    it('Komma in „Absatz 1, 2" bricht den Link NICHT (§ 2 … EStG)', async () => {
        const { links: ls, text } = await links(`@Quelle("§ 2 Absatz 1, 2 EStG")
fn f(): Euro = 0 als Euro
`);
        expect(ls).toHaveLength(1);
        expect(ls[0].target).toBe('https://www.gesetze-im-internet.de/estg/__2.html');
        expect(text(ls[0])).toBe('§ 2 Absatz 1, 2 EStG');
    });

    it('mehrere §, geteiltes Gesetz am Ende: § 9a, § 10c, § 20 … EStG', async () => {
        const { links: ls, text } = await links(`@Quelle("§ 9a, § 10c, § 20 Abs. 9 EStG (Pauschbetragsmuster)")
fn f(): Euro = 0 als Euro
`);
        const ziele = ls.map((l) => l.target);
        expect(ziele).toContain('https://www.gesetze-im-internet.de/estg/__9a.html');
        expect(ziele).toContain('https://www.gesetze-im-internet.de/estg/__10c.html');
        expect(ziele).toContain('https://www.gesetze-im-internet.de/estg/__20.html');
        const t = ls.map(text);
        expect(t).toContain('§ 9a');
        expect(t).toContain('§ 10c');
        expect(t.some((s) => s.startsWith('§ 20'))).toBe(true);
    });

    it('eigene Gesetze je § bleiben getrennt: § 8 KStG, § 20 EStG', async () => {
        const { links: ls } = await links(`@Quelle("§ 8 KStG, § 20 EStG")
fn f(): Euro = 0 als Euro
`);
        const ziele = ls.map((l) => l.target);
        expect(ziele).toContain('https://www.gesetze-im-internet.de/kstg_1977/__8.html');
        expect(ziele).toContain('https://www.gesetze-im-internet.de/estg/__20.html');
    });

    it('kombinierte Quelle: erster §-Treffer wird verlinkt', async () => {
        const { links: ls, text } = await links(`@Quelle("§ 32a Absatz 1 EStG, PAP 2025 Subroutine UPTAB25")
konst K: Euro = 1 als Euro
`);
        expect(ls).toHaveLength(1);
        expect(ls[0].target).toBe('https://www.gesetze-im-internet.de/estg/__32a.html');
        expect(text(ls[0])).toBe('§ 32a Absatz 1 EStG');
    });
});

describe('DocumentLink: verwende-Modulpfad → Datei', () => {
    it('importierter Modulpfad zeigt auf die Ziel-.findsl-Datei', async () => {
        const { links: ls, text } = await linksIn({
            lib: `fn kern(z: Euro): Euro = z
`,
            app: `verwende {kern} aus "./lib"
fn f(): Euro = kern(1 als Euro)
`,
        }, 'app');
        const modLink = ls.find((l) => l.target?.endsWith('lib.findsl'));
        expect(modLink).toBeDefined();
        // Linkbereich = das Pfad-String-Literal inkl. Anführungszeichen.
        expect(text(modLink!)).toBe('"./lib"');
        expect(modLink!.tooltip).toBe('Datei "./lib" öffnen');
    });

    it('Ziel-Datei nicht im Workspace → kein Datei-Link', async () => {
        const { links: ls } = await links(`verwende {fremd} aus "./nicht-vorhanden"
konst K: Euro = 1 als Euro
`);
        expect(ls.filter((l) => !l.target?.includes('gesetze-im-internet'))).toEqual([]);
    });

    it('keine Links wenn nichts passt', async () => {
        const { links: ls } = await links(`konst K: Euro = 1 als Euro
`);
        expect(ls).toEqual([]);
    });
});

describe('DocumentLink: §-Referenzen in --…--Doc-Prosa', () => {
    it('Datei-Doc-Prosa: § wird klickbar (korrektes kstg_1977-Slug)', async () => {
        const { links: ls, text } = await links(`--
# Körperschaftsteuer
Bemessung nach § 23 KStG.
--

@Quelle("§ 7 KStG")
konst X: Euro = 1 als Euro
`);
        const l = ls.find((x) => x.target?.endsWith('/kstg_1977/__23.html'));
        expect(l).toBeTruthy();
        expect(text(l!)).toBe('§ 23 KStG');
    });

    it('Decl-Doc-Prosa: § wird klickbar', async () => {
        const { links: ls } = await links(`--
Datei.
--

-- Regelung nach § 32a EStG. --
konst Y: Euro = 1 als Euro
`);
        expect(ls.some((x) => x.target === 'https://www.gesetze-im-internet.de/estg/__32a.html'))
            .toBe(true);
    });

    it('Plural §§ 7, 23, 24 KStG in Prosa → drei getrennte Links', async () => {
        const { links: ls } = await links(`--
# K
Die Kerne §§ 7, 23, 24 KStG.
--

konst X: Euro = 1 als Euro
`);
        const ziele = ls.map((l) => l.target).sort();
        expect(ziele).toEqual([
            'https://www.gesetze-im-internet.de/kstg_1977/__23.html',
            'https://www.gesetze-im-internet.de/kstg_1977/__24.html',
            'https://www.gesetze-im-internet.de/kstg_1977/__7.html',
        ]);
    });

    it('Prosa-§ und @Quelle erzeugen getrennte, nicht doppelte Links', async () => {
        const { links: ls } = await links(`--
Datei.
--

-- Siehe § 24 KStG. --
@Quelle("§ 7 KStG")
konst Z: Euro = 1 als Euro
`);
        const ziele = ls.map((l) => l.target).sort();
        expect(ziele).toEqual([
            'https://www.gesetze-im-internet.de/kstg_1977/__24.html', // Prosa
            'https://www.gesetze-im-internet.de/kstg_1977/__7.html',  // @Quelle
        ]);
    });
});
