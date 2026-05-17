/**
 * Tests für die „ungenutzt"-Erkennung (Diagnostic-Tags, ausgegraut):
 *   - modul-lokal: ungenutzte verwende-Importe, Parameter, var-Bindungen
 *   - workspace-weit: Top-Level-Decls, die in KEINEM Modul referenziert
 *     werden — nur wenn ≥ 2 Module indiziert sind (P7: öffentliche Decls
 *     dürfen nicht falsch-positiv geflaggt werden)
 *
 * Diagnose-Erwartung: severity „hint" (4) + Tag `Unnecessary` (1).
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import { DiagnosticSeverity, DiagnosticTag, type Diagnostic } from 'vscode-languageserver';

async function diagnose(
    sources: Record<string, string>, main: string,
): Promise<Diagnostic[]> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const docs = Object.entries(sources).map(([n, s]) =>
        services.shared.workspace.LangiumDocumentFactory.fromString(
            s, URI.parse(`file:///${n}.findsl`),
        ),
    );
    for (const d of docs) services.shared.workspace.LangiumDocuments.addDocument(d);
    await services.shared.workspace.DocumentBuilder.build(docs, { validation: true });
    const doc = docs.find((d) => d.uri.path.endsWith(`/${main}.findsl`))!;
    return (doc.diagnostics ?? []) as Diagnostic[];
}

const unusedOf = (ds: Diagnostic[]): Diagnostic[] =>
    ds.filter((d) => d.code === 'findsl.ungenutzt');

const fadedFor = (ds: Diagnostic[], needle: string): Diagnostic | undefined =>
    unusedOf(ds).find((d) => d.message.includes(needle));

describe('Ungenutzt: modul-lokal', () => {
    it('ungenutzter verwende-Import → ausgegraut', async () => {
        const ds = await diagnose({
            m: `verwende {kern} aus "./a.b"
konst K: Euro = 1 als Euro
`,
        }, 'm');
        const f = fadedFor(ds, 'Import "kern"');
        expect(f).toBeDefined();
        expect(f!.severity).toBe(DiagnosticSeverity.Hint);
        expect(f!.tags).toContain(DiagnosticTag.Unnecessary);
    });

    it('genutzter Import wird NICHT markiert', async () => {
        const ds = await diagnose({
            m: `verwende {kern} aus "./a.b"
fn f(z: Euro): Euro = kern(z)
`,
        }, 'm');
        expect(fadedFor(ds, 'Import "kern"')).toBeUndefined();
    });

    it('ungenutzter Parameter und ungenutzte var-Bindung', async () => {
        const ds = await diagnose({
            m: `fn f(x: Euro): Euro = {
    var y: Euro = 1 als Euro
    0 als Euro
}
`,
        }, 'm');
        expect(fadedFor(ds, 'Parameter "x"')).toBeDefined();
        expect(fadedFor(ds, 'Bindung "y"')).toBeDefined();
    });

    it('genutzter Parameter wird NICHT markiert', async () => {
        const ds = await diagnose({
            m: `fn f(x: Euro): Euro = x
`,
        }, 'm');
        expect(fadedFor(ds, 'Parameter "x"')).toBeUndefined();
    });

    it('nur via String-Interpolation genutzte Parameter zählen als verwendet', async () => {
        const ds = await diagnose({
            m: `datensatz B(name: Text, zve: Euro)
fn t1(zve: Euro, name: Text): Text = """
Sehr geehrte:r \${name}, zvE: \${zve}.
"""
fn t2(b: B): Text = """Name: \${b.name}"""
`,
        }, 'm');
        expect(fadedFor(ds, 'Parameter "zve"')).toBeUndefined();
        expect(fadedFor(ds, 'Parameter "name"')).toBeUndefined();
        expect(fadedFor(ds, 'Parameter "b"')).toBeUndefined();
    });

    it('Einzel-Modul: Top-Level-konst wird NICHT geflaggt (kein Workspace)', async () => {
        const ds = await diagnose({
            m: `konst UNSUED: Euro = 2 als Euro
`,
        }, 'm');
        expect(fadedFor(ds, 'UNSUED')).toBeUndefined();
    });
});

describe('Ungenutzt: workspace-weit (≥ 2 Module)', () => {
    it('nirgends referenzierte konst wird ausgegraut', async () => {
        const ds = await diagnose({
            lib: `konst UNSUED: Euro = 2 als Euro
konst GENUTZT: Euro = 3 als Euro
`,
            app: `verwende {GENUTZT} aus "./lib"
konst R: Euro = GENUTZT
`,
        }, 'lib');
        const f = fadedFor(ds, '"UNSUED"');
        expect(f).toBeDefined();
        expect(f!.severity).toBe(DiagnosticSeverity.Hint);
        expect(f!.tags).toContain(DiagnosticTag.Unnecessary);
        // GENUTZT wird von app referenziert → nicht geflaggt.
        expect(fadedFor(ds, '"GENUTZT"')).toBeUndefined();
    });

    it('Aufzählung gilt als genutzt, wenn nur ihre Werte verwendet werden', async () => {
        const ds = await diagnose({
            lib: `aufzählung Ampel { Rot, Gelb }
`,
            app: `verwende {Rot} aus "./lib"
fn g(): Ganzzahl = wähle (Rot) { sonst -> 0 }
`,
        }, 'lib');
        expect(fadedFor(ds, '"Ampel"')).toBeUndefined();
    });

    it('nirgends gerufene fn wird ausgegraut', async () => {
        const ds = await diagnose({
            lib: `fn tot(x: Euro): Euro = x
fn lebt(x: Euro): Euro = x
`,
            app: `verwende {lebt} aus "./lib"
fn nutzt(x: Euro): Euro = lebt(x)
`,
        }, 'lib');
        expect(fadedFor(ds, 'fn "tot"')).toBeDefined();
        expect(fadedFor(ds, 'fn "lebt"')).toBeUndefined();
    });
});
