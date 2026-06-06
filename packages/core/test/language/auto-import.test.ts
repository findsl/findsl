/**
 * Tests für den Auto-Import (Issue #20): geteilte Kern-Helfer
 * (`findsl-auto-import.ts`) und der CodeAction-Quick-Fix an der Diagnose
 * `findsl.unbekannter-identifier`.
 *
 * Workspace-Konvention wie in codeaction.test.ts: URIs sind
 * `file:///<name>.findsl`; ein Import `aus "./lib"` aus `app.findsl` löst
 * auf `/lib.findsl` auf. Beweis je Quick-Fix-Fall: nach Anwenden des
 * TextEdits ist die Ziel-Diagnose verschwunden (Schritt 4).
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import {
    toImportSource,
    findExportingModules,
    buildAddImportEdit,
} from '../../src/language/findsl-auto-import.js';
import type { Program } from '../../src/language/generated/ast.js';
import type { CodeAction, Diagnostic, TextEdit } from 'vscode-languageserver';

interface Ctx {
    services: ReturnType<typeof createFindslServices>['Findsl'];
}

function newCtx(): Ctx {
    return { services: createFindslServices(NodeFileSystem).Findsl };
}

async function build(
    ctx: Ctx, sources: Record<string, string>,
): Promise<void> {
    const docs = Object.entries(sources).map(([n, s]) =>
        ctx.services.shared.workspace.LangiumDocumentFactory.fromString(
            s, URI.parse(`file:///${n}.findsl`),
        ),
    );
    for (const d of docs) ctx.services.shared.workspace.LangiumDocuments.addDocument(d);
    await ctx.services.shared.workspace.DocumentBuilder.build(docs, { validation: true });
}

function doc(ctx: Ctx, name: string) {
    return [...ctx.services.shared.workspace.LangiumDocuments.all]
        .find((d) => d.uri.path.endsWith(`/${name}.findsl`))!;
}

function diagsOf(ctx: Ctx, name: string): Diagnostic[] {
    return (doc(ctx, name).diagnostics ?? []) as Diagnostic[];
}

async function actionsFor(
    ctx: Ctx, name: string, diags: Diagnostic[],
): Promise<CodeAction[]> {
    const d = doc(ctx, name);
    const res = await ctx.services.lsp.CodeActionProvider!.getCodeActions(d, {
        textDocument: { uri: d.uri.toString() },
        range: diags[0]?.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: { diagnostics: diags },
    });
    return (res ?? []) as CodeAction[];
}

/** Wendet die TextEdits eines WorkspaceEdits (Single-File) auf `src` an. */
function applyEdits(src: string, edits: TextEdit[]): string {
    const lines = src.split('\n');
    const toOffset = (l: number, c: number) =>
        lines.slice(0, l).reduce((n, ln) => n + ln.length + 1, 0) + c;
    // Von hinten nach vorne anwenden, damit frühere Offsets stabil bleiben.
    const sorted = [...edits].sort((a, b) =>
        toOffset(b.range.start.line, b.range.start.character)
        - toOffset(a.range.start.line, a.range.start.character));
    let out = src;
    for (const e of sorted) {
        const start = toOffset(e.range.start.line, e.range.start.character);
        const end = toOffset(e.range.end.line, e.range.end.character);
        out = out.slice(0, start) + e.newText + out.slice(end);
    }
    return out;
}

const UNKNOWN = 'findsl.unbekannter-identifier';

// ---------------------------------------------------------------------------
// Reine Helfer
// ---------------------------------------------------------------------------

describe('auto-import: toImportSource', () => {
    it('bildet einen relativen Quellstring mit ./-Präfix, ohne .findsl', () => {
        expect(toImportSource('/proj/app.findsl', '/proj/lib.findsl')).toBe('./lib');
    });
    it('nutzt ../ für Geschwister-Verzeichnisse', () => {
        expect(toImportSource('/proj/a/app.findsl', '/proj/b/lib.findsl')).toBe('../b/lib');
    });
});

describe('auto-import: findExportingModules', () => {
    it('findet das Modul, das ein Symbol exportiert', async () => {
        const ctx = newCtx();
        await build(ctx, {
            lib: 'fn verdoppele(x: Ganzzahl): Ganzzahl = x * 2\n',
            app: '@Quelle("§ 1 Test")\nkonst R: Ganzzahl = 21\n',
        });
        const appProg = doc(ctx, 'app').parseResult.value as Program;
        const found = findExportingModules(
            'verdoppele', ctx.services.shared.workspace.LangiumDocuments,
            appProg.$document?.uri.fsPath,
        );
        expect(found.map((m) => m.importSource)).toEqual(['./lib']);
    });

    it('liefert nichts für `_`-interne Namen', async () => {
        const ctx = newCtx();
        await build(ctx, {
            lib: 'fn _intern(x: Ganzzahl): Ganzzahl = x\n',
            app: '@Quelle("§ 1 Test")\nkonst R: Ganzzahl = 21\n',
        });
        const appProg = doc(ctx, 'app').parseResult.value as Program;
        expect(findExportingModules(
            '_intern', ctx.services.shared.workspace.LangiumDocuments,
            appProg.$document?.uri.fsPath,
        )).toEqual([]);
    });
});

describe('auto-import: buildAddImportEdit', () => {
    it('erweitert einen bestehenden verwende-Block kanonisch', async () => {
        const ctx = newCtx();
        await build(ctx, {
            lib: 'fn a(x: Ganzzahl): Ganzzahl = x\nfn b(x: Ganzzahl): Ganzzahl = x\n',
            app: 'verwende {\n    a,\n} aus "./lib"\n\n@Quelle("§ 1")\nkonst R: Ganzzahl = a(1)\n',
        });
        const appProg = doc(ctx, 'app').parseResult.value as Program;
        const edits = buildAddImportEdit(appProg, 'b', './lib');
        expect(edits).toHaveLength(1);
        expect(edits[0].newText).toBe('verwende {\n    a,\n    b,\n} aus "./lib"');
    });

    it('No-op, wenn das Symbol bereits importiert ist', async () => {
        const ctx = newCtx();
        await build(ctx, {
            lib: 'fn a(x: Ganzzahl): Ganzzahl = x\n',
            app: 'verwende {\n    a,\n} aus "./lib"\n\n@Quelle("§ 1")\nkonst R: Ganzzahl = a(1)\n',
        });
        const appProg = doc(ctx, 'app').parseResult.value as Program;
        expect(buildAddImportEdit(appProg, 'a', './lib')).toEqual([]);
    });

    it('legt einen neuen Block VOR der ersten Deklaration an — fileDoc-Kopf bleibt erhalten', async () => {
        const ctx = newCtx();
        const appSrc = '--\n# Modul A\n--\n\n@Quelle("§ 1")\nkonst R: Ganzzahl = a(1)\n';
        await build(ctx, {
            lib: 'fn a(x: Ganzzahl): Ganzzahl = x\n',
            app: appSrc,
        });
        const appProg = doc(ctx, 'app').parseResult.value as Program;
        const edits = buildAddImportEdit(appProg, 'a', './lib');
        const fixed = applyEdits(appSrc, edits);

        // fileDoc bleibt ganz oben, der verwende-Block steht zwischen Kopf
        // und Deklaration (nicht davor → keine Kopf-Verdrängung).
        expect(fixed.startsWith('--\n# Modul A\n--')).toBe(true);
        expect(fixed).toContain('verwende {\n    a,\n} aus "./lib"');
        expect(fixed.indexOf('# Modul A')).toBeLessThan(fixed.indexOf('verwende'));
        expect(fixed.indexOf('verwende')).toBeLessThan(fixed.indexOf('konst R'));
    });
});

// ---------------------------------------------------------------------------
// Quick-Fix-Integration
// ---------------------------------------------------------------------------

describe('auto-import: Quick-Fix an „Unbekannter Identifier"', () => {
    it('bietet einen Import an und der Fix beseitigt die Diagnose', async () => {
        const ctx = newCtx();
        await build(ctx, {
            lib: 'fn verdoppele(x: Ganzzahl): Ganzzahl = x * 2\n',
            app: '@Quelle("§ 1 Test")\nkonst R: Ganzzahl = verdoppele(21)\n',
        });
        const diags = diagsOf(ctx, 'app').filter((d) => d.code === UNKNOWN);
        expect(diags.length).toBeGreaterThan(0);

        const actions = await actionsFor(ctx, 'app', diags);
        const imp = actions.find((a) => a.title.includes('importieren'));
        expect(imp?.title).toBe('"verdoppele" aus "./lib" importieren');

        const uri = doc(ctx, 'app').uri.toString();
        const edits = imp!.edit!.changes![uri];
        const fixed = applyEdits(
            '@Quelle("§ 1 Test")\nkonst R: Ganzzahl = verdoppele(21)\n', edits,
        );
        expect(fixed).toContain('verwende {\n    verdoppele,\n} aus "./lib"');

        // Schritt 4: erneut bauen → die Ziel-Diagnose ist weg.
        const ctx2 = newCtx();
        await build(ctx2, {
            lib: 'fn verdoppele(x: Ganzzahl): Ganzzahl = x * 2\n',
            app: fixed,
        });
        expect(diagsOf(ctx2, 'app').filter((d) => d.code === UNKNOWN)).toEqual([]);
    });

    it('bietet keinen Import für unbekannte, nirgends exportierte Namen', async () => {
        const ctx = newCtx();
        await build(ctx, {
            lib: 'fn verdoppele(x: Ganzzahl): Ganzzahl = x * 2\n',
            app: '@Quelle("§ 1 Test")\nkonst R: Ganzzahl = gibtsNicht(21)\n',
        });
        const diags = diagsOf(ctx, 'app').filter((d) => d.code === UNKNOWN);
        const actions = await actionsFor(ctx, 'app', diags);
        expect(actions.find((a) => a.title.includes('importieren'))).toBeUndefined();
    });
});
