/**
 * Tests für die Modul-Scope-Auflösung: Import-Analyse, Konflikt-Detection,
 * Header-Registry und Cross-Module-Type-Resolution.
 *
 * Migriert nach der Sprachänderung "kein `modul`-Header; `verwende { … }
 * aus "<relpfad>"`": Es gibt keinen Modulnamen mehr — Import-Quellen sind
 * relative Dateipfad-Strings. `parseSource` nutzt die Default-URI
 * `file:///inline.findsl`, daher löst `aus "./m"` zum absoluten Pfad
 * `/m.findsl` auf (= Registry-Schlüssel `resolvedPath`/`filePath`).
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { parseSource } from '../helpers/parse.js';
import {
    analyzeImports,
    asImportResolver,
    buildHeaderRegistry,
    reportImportIssues,
} from '../../src/language/findsl-scope.js';
import { typeCheckProgram } from '../../src/language/findsl-types.js';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { LoadedModule } from '../../src/interpret/module-loader.js';

describe('analyzeImports', () => {
    it('MultiImport: localName ist Item-Name', async () => {
        const program = await parseSource(
            'verwende {a, b} aus "./mod.x"\n',
        );
        const { bindings, conflicts } = analyzeImports(program);
        expect(bindings.map((b) => [b.localName, b.rawSource, b.sourceName])).toEqual([
            ['a', './mod.x', 'a'],
            ['b', './mod.x', 'b'],
        ]);
        // Default-URI file:///inline.findsl → "./mod.x" löst zu /mod.x.findsl auf.
        expect(bindings.map((b) => b.resolvedPath)).toEqual([
            '/mod.x.findsl',
            '/mod.x.findsl',
        ]);
        expect(conflicts).toEqual([]);
    });

    it('MultiImport mit Alias: localName ist Alias, sourceName ist Original', async () => {
        const program = await parseSource(
            'verwende {original als umbenannt} aus "./mod.x"\n',
        );
        const { bindings } = analyzeImports(program);
        expect(bindings).toHaveLength(1);
        expect(bindings[0].localName).toBe('umbenannt');
        expect(bindings[0].sourceName).toBe('original');
        expect(bindings[0].rawSource).toBe('./mod.x');
    });

    // entfernt: klammerloser Einzelimport `verwende symbol aus m` abgeschafft
    // (einzige verwende-Form ist jetzt `verwende { … } aus "<relpfad>"`).

    // entfernt: Modulimport `verwende mod.x` (Modul-als-Wert) abgeschafft;
    // `ImportAnalysis` hat kein `unsupported`-Feld mehr, es gibt keine
    // "Modul-Wert-Import"/unsupported-Diagnose mehr.

    it('Konflikt: gleicher localName aus zwei Quellen', async () => {
        const program = await parseSource(
            'verwende {x} aus "./a"\nverwende {x} aus "./b"\n',
        );
        const { conflicts } = analyzeImports(program);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].localName).toBe('x');
        expect(conflicts[0].first.rawSource).toBe('./a');
        expect(conflicts[0].second.rawSource).toBe('./b');
    });

    it('Konflikt zwischen Alias und Originalname', async () => {
        const program = await parseSource(
            'verwende {x} aus "./a"\nverwende {y als x} aus "./b"\n',
        );
        const { conflicts } = analyzeImports(program);
        expect(conflicts).toHaveLength(1);
        expect(conflicts[0].localName).toBe('x');
    });

    it('Kein Konflikt, wenn Aliase auseinanderlaufen', async () => {
        const program = await parseSource(
            'verwende {x als x1} aus "./a"\nverwende {x als x2} aus "./b"\n',
        );
        const { conflicts } = analyzeImports(program);
        expect(conflicts).toEqual([]);
    });

    it('Keine Imports → leere Analyse', async () => {
        const program = await parseSource('konst K: Euro = 1 als Euro\n');
        const { bindings, conflicts } = analyzeImports(program);
        expect(bindings).toEqual([]);
        expect(conflicts).toEqual([]);
    });
});

describe('Validator: Duplikat-Decls', () => {
    async function validateAndDiagnose(source: string): Promise<string[]> {
        const services = createFindslServices(NodeFileSystem).Findsl;
        const document = services.shared.workspace.LangiumDocumentFactory.fromString(
            source,
            URI.parse('file:///dup.findsl'),
        );
        await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
        return (document.diagnostics ?? [])
            .filter((d) => d.severity === 1)
            .map((d) => d.message);
    }

    it('Zwei Funktionen mit gleichem Namen', async () => {
        const msgs = await validateAndDiagnose(`fn f(x: Euro): Euro = x
fn f(x: Euro): Euro = x + 1 als Euro
`);
        expect(msgs.some((m) => /Doppelte Deklaration "f".*fn/.test(m))).toBe(true);
    });

    it('Zwei Konstanten mit gleichem Namen', async () => {
        const msgs = await validateAndDiagnose(`konst A: Euro = 100 als Euro
konst A: Euro = 200 als Euro
`);
        expect(msgs.some((m) => /Doppelte Deklaration "A".*konst/.test(m))).toBe(true);
    });

    it('Konst kollidiert mit Funktion', async () => {
        const msgs = await validateAndDiagnose(`fn foo(): Euro = 1 als Euro
konst foo: Euro = 2 als Euro
`);
        expect(msgs.some((m) => /Doppelte Deklaration "foo".*fn/.test(m))).toBe(true);
    });

    it('Datensatz kollidiert mit Aufzählung', async () => {
        const msgs = await validateAndDiagnose(`aufzählung S { A, B }
datensatz S(x: Ganzzahl)
`);
        expect(msgs.some((m) => /Doppelte Deklaration "S".*aufzählung/.test(m))).toBe(true);
    });

    it('Import-Binding kollidiert mit lokaler Decl', async () => {
        const msgs = await validateAndDiagnose(`verwende {f} aus "./lib"
fn f(): Euro = 1 als Euro
`);
        expect(msgs.some((m) => /Import "f".*kollidiert.*fn/.test(m))).toBe(true);
    });

    it('Keine Diagnose bei eindeutigen Namen', async () => {
        const msgs = await validateAndDiagnose(`konst A: Euro = 1 als Euro
fn f(): Euro = A
datensatz D(x: Ganzzahl)
aufzählung E { X, Y }
`);
        const conflicts = msgs.filter((m) => /Doppelte Deklaration|kollidiert/.test(m));
        expect(conflicts).toEqual([]);
    });
});

describe('reportImportIssues', () => {
    it('meldet alle Konflikte als Diagnosen', async () => {
        const program = await parseSource(
            'verwende {x} aus "./a"\nverwende {x} aus "./b"\n'
            + 'verwende {y} aus "./c"\nverwende {y} aus "./d"\n',
        );
        const msgs: string[] = [];
        reportImportIssues(program, (_node, message) => msgs.push(message));
        expect(msgs).toHaveLength(2);
        expect(msgs[0]).toMatch(/"x".*bereits aus ".\/a".*".\/b"/);
        expect(msgs[1]).toMatch(/"y".*bereits aus ".\/c".*".\/d"/);
    });

    // entfernt: "meldet unsupported-Form als Diagnose" — die
    // Modul-als-Wert-Form (`verwende a.b`) und die unsupported-Diagnose
    // existieren nicht mehr (ImportAnalysis hat kein `unsupported` mehr).

    it('Import einer eingebauten Aufzählung ist ein Fehler', async () => {
        const program = await parseSource(
            'verwende {Tarifart} aus "./a.b"\n',
        );
        const msgs: string[] = [];
        reportImportIssues(program, (_node, message) => msgs.push(message));
        expect(msgs.some((m) => /"Tarifart" ist eine eingebaute Definition/.test(m))).toBe(true);
    });

    it('Import einer eingebauten Funktion ist ein Fehler', async () => {
        const program = await parseSource(
            'verwende {abrundenEuro} aus "./a.b"\n',
        );
        const msgs: string[] = [];
        reportImportIssues(program, (_node, message) => msgs.push(message));
        expect(msgs.some((m) => /"abrundenEuro" ist eine eingebaute Definition/.test(m))).toBe(true);
    });

    it('Import eines eingebauten Aufzählungs-Werts ist ein Fehler', async () => {
        const program = await parseSource(
            'verwende {Grundtarif} aus "./a.b"\n',
        );
        const msgs: string[] = [];
        reportImportIssues(program, (_node, message) => msgs.push(message));
        expect(msgs.some((m) => /"Grundtarif" ist eine eingebaute Definition/.test(m))).toBe(true);
    });

    it('Import eines normalen User-Symbols ist OK (kein Builtin-Fehler)', async () => {
        const program = await parseSource(
            'verwende {estGrundtarif} aus "./a.b"\n',
        );
        const msgs: string[] = [];
        reportImportIssues(program, (_node, message) => msgs.push(message));
        expect(msgs.some((m) => /eingebaute Definition/.test(m))).toBe(false);
    });
});

describe('Validator: Import nicht-existierender Symbole (voller Pfad mit Workspace)', () => {
    /**
     * Validiert über DocumentBuilder.build mit MEHREREN Dateien im
     * Workspace-Index — genau der LSP-Pfad. Spiegelt den Editor-Fall:
     * `verwende {Foobar} aus "./a"` wo Foobar in a.findsl nicht existiert.
     * Die Datei-URIs sind so gewählt, dass `aus "./<name>"` auf die
     * jeweilige zweite Datei auflöst (`file:///<name>.findsl`).
     */
    async function diagnoseWithWorkspace(
        sources: Record<string, string>, mainModule: string,
    ): Promise<string[]> {
        const services = createFindslServices(NodeFileSystem).Findsl;
        const docs = Object.entries(sources).map(([name, src]) =>
            services.shared.workspace.LangiumDocumentFactory.fromString(
                src, URI.parse(`file:///${name}.findsl`),
            ),
        );
        for (const d of docs) services.shared.workspace.LangiumDocuments.addDocument(d);
        await services.shared.workspace.DocumentBuilder.build(docs, { validation: true });
        const main = docs.find((d) => d.uri.path.endsWith(`/${mainModule}.findsl`))!;
        return (main.diagnostics ?? [])
            .filter((d) => d.severity === 1)
            .map((d) => d.message);
    }

    it('Nicht-existierendes importiertes Symbol → Fehler im Validator', async () => {
        const lib = 'konst K: Euro = 1 als Euro\n';
        const app = 'verwende {Foobar} aus "./lib"\nkonst R: Euro = K\n';
        const msgs = await diagnoseWithWorkspace({ lib, app }, 'app');
        expect(msgs.some((m) =>
            /Symbol "Foobar" wird von der Datei ".\/lib" nicht exportiert/.test(m),
        )).toBe(true);
    });

    it('Gemischter Import: existierendes + nicht-existierendes Symbol', async () => {
        const lib = 'konst echtDa: Euro = 1 als Euro\n';
        const app = 'verwende {echtDa, Foobar} aus "./lib"\nkonst R: Euro = echtDa\n';
        const msgs = await diagnoseWithWorkspace({ lib, app }, 'app');
        expect(msgs.some((m) => /"Foobar".*nicht exportiert/.test(m))).toBe(true);
        // Das echte Symbol darf KEINE Diagnose erzeugen
        expect(msgs.some((m) => /"echtDa".*nicht exportiert/.test(m))).toBe(false);
    });

    it('Existierendes Symbol → keine Diagnose', async () => {
        const lib = 'konst K: Euro = 1 als Euro\n';
        const app = 'verwende {K} aus "./lib"\nkonst R: Euro = K\n';
        const msgs = await diagnoseWithWorkspace({ lib, app }, 'app');
        expect(msgs.some((m) => /nicht exportiert/.test(m))).toBe(false);
    });

    it('Quell-Datei nicht im Workspace → tolerant (kein eager load)', async () => {
        const app = 'verwende {Foobar} aus "./nichtgeladen"\nkonst R: Euro = 1 als Euro\n';
        const msgs = await diagnoseWithWorkspace({ app }, 'app');
        expect(msgs.some((m) => /nicht exportiert/.test(m))).toBe(false);
    });

    it('Importierte Funktion existiert → keine Diagnose', async () => {
        const lib = 'fn doppel(x: Euro): Euro = x * 2\n';
        const app = 'verwende {doppel} aus "./lib"\nkonst R: Euro = doppel(2 als Euro)\n';
        const msgs = await diagnoseWithWorkspace({ lib, app }, 'app');
        expect(msgs.some((m) => /nicht exportiert/.test(m))).toBe(false);
    });
});

/**
 * Baut LoadedModules aus Quelltexten. Schlüssel ist jetzt der absolute
 * Dateipfad (`/<name>.findsl`), passend zur Default-URI-Auflösung von
 * `parseSource` (`file:///inline.findsl` + `aus "./<name>"` → `/<name>.findsl`).
 * Jede Quelle wird unter ihrer eigenen `file:///<name>.findsl`-URI geparst,
 * damit relative Importe in den Quellen korrekt auflösen.
 */
async function buildModulesFromSources(srcs: Record<string, string>): Promise<LoadedModule[]> {
    const out: LoadedModule[] = [];
    for (const [name, source] of Object.entries(srcs)) {
        const program = await parseSource(source, { uri: `file:///${name}.findsl` });
        out.push({
            filePath: `/${name}.findsl`,
            program,
        });
    }
    return out;
}

describe('buildHeaderRegistry', () => {
    it('exportiert Konstanten, Funktionen, Datensätze, Aufzählungen', async () => {
        const modules = await buildModulesFromSources({
            'lib': `konst K: Euro = 100
fn f(x: Euro): Euro = x
datensatz D(a: Ganzzahl)
aufzählung Farbe { Rot, Grün, Blau }
`,
        });
        const registry = buildHeaderRegistry(modules);
        const header = registry.lookup('/lib.findsl');
        expect(header).toBeDefined();
        expect(header!.exports.has('K')).toBe(true);
        expect(header!.exports.has('f')).toBe(true);
        expect(header!.exports.has('D')).toBe(true);
        expect(header!.exports.has('Farbe')).toBe(true);
        expect(header!.exports.has('Rot')).toBe(true);
    });

    it('Unbekannte Datei → lookup liefert undefined', async () => {
        const registry = buildHeaderRegistry([]);
        expect(registry.lookup('/nicht/da.findsl')).toBeUndefined();
    });

    it('lookup(undefined) → undefined', async () => {
        const registry = buildHeaderRegistry([]);
        expect(registry.lookup(undefined)).toBeUndefined();
    });
});

describe('asImportResolver — Cross-Module-Type-Resolution', () => {
    it('liefert echten Typ eines exportierten Symbols', async () => {
        const modules = await buildModulesFromSources({
            'lib': `konst K: Euro = 100
`,
        });
        const resolver = asImportResolver(buildHeaderRegistry(modules));
        const msgs: string[] = [];
        const type = resolver.resolve(
            '/lib.findsl', 'K', './lib', modules[0].program as any, (_n, m) => msgs.push(m),
        );
        expect(type).toMatchObject({ kind: 'primitive', name: 'Euro' });
        expect(msgs).toEqual([]);
    });

    it('"Nicht exportiert"-Fehler bei fehlendem Symbol', async () => {
        const modules = await buildModulesFromSources({
            'lib': `konst K: Euro = 100
`,
        });
        const resolver = asImportResolver(buildHeaderRegistry(modules));
        const msgs: string[] = [];
        const type = resolver.resolve(
            '/lib.findsl', 'fehlt', './lib', modules[0].program as any, (_n, m) => msgs.push(m),
        );
        expect(type).toMatchObject({ kind: 'unknown' });
        expect(msgs).toHaveLength(1);
        expect(msgs[0]).toMatch(/Symbol "fehlt" wird von der Datei ".\/lib" nicht exportiert/);
    });

    it('Fehlende Quell-Datei liefert tolerant unknown (keine Diagnose)', async () => {
        const resolver = asImportResolver(buildHeaderRegistry([]));
        const dummy = (await parseSource('konst K: Euro = 1 als Euro\n')) as any;
        const msgs: string[] = [];
        const type = resolver.resolve(
            '/nicht/da.findsl', 'x', './da', dummy, (_n, m) => msgs.push(m),
        );
        expect(type).toMatchObject({ kind: 'unknown' });
        expect(msgs).toEqual([]);
    });
});

describe('typeCheckProgram mit Cross-Module-Resolver', () => {
    it('Importiertes Symbol mit passendem Typ — keine Diagnosen', async () => {
        const modules = await buildModulesFromSources({
            'lib': `konst K: Euro = 100
`,
            'app': `verwende {K} aus "./lib"
konst R: Euro = K + 1
`,
        });
        const resolver = asImportResolver(buildHeaderRegistry(modules));
        const msgs: string[] = [];
        typeCheckProgram(
            modules[1].program,
            (_node, message) => msgs.push(message),
            { importResolver: resolver },
        );
        expect(msgs).toEqual([]);
    });

    it('Importiertes Symbol mit falschem Typ → Mismatch-Diagnose', async () => {
        const modules = await buildModulesFromSources({
            'lib': `konst K: Text = "abc"
`,
            'app': `verwende {K} aus "./lib"
konst R: Euro = K + 1
`,
        });
        const resolver = asImportResolver(buildHeaderRegistry(modules));
        const msgs: string[] = [];
        typeCheckProgram(
            modules[1].program,
            (_node, message) => msgs.push(message),
            { importResolver: resolver },
        );
        expect(msgs.some((m) => /Text/.test(m))).toBe(true);
    });

    it('Nicht exportiertes Symbol löst Diagnose aus', async () => {
        const modules = await buildModulesFromSources({
            'lib': `konst K: Euro = 100
`,
            'app': `verwende {fehlt} aus "./lib"
konst R: Euro = fehlt
`,
        });
        const resolver = asImportResolver(buildHeaderRegistry(modules));
        const msgs: string[] = [];
        typeCheckProgram(
            modules[1].program,
            (_node, message) => msgs.push(message),
            { importResolver: resolver },
        );
        expect(msgs.some((m) => /"fehlt".*nicht exportiert/.test(m))).toBe(true);
    });

    it('Importierter Funktionstyp ermöglicht typed-Aufruf-Check', async () => {
        const modules = await buildModulesFromSources({
            'lib': `fn f(x: Euro): Euro = x
`,
            'app': `verwende {f} aus "./lib"
konst R: Euro = f(100)
`,
        });
        const resolver = asImportResolver(buildHeaderRegistry(modules));
        const msgs: string[] = [];
        typeCheckProgram(
            modules[1].program,
            (_node, message) => msgs.push(message),
            { importResolver: resolver },
        );
        expect(msgs).toEqual([]);
    });
});
