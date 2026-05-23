/**
 * Tests für den Quick-Fix-Provider. Vorgehen je Fall:
 *   1. Quelle validieren (voller DocumentBuilder-Pfad) → Diagnosen
 *   2. getCodeActions mit den Diagnosen aufrufen
 *   3. resultierenden TextEdit auf den Quelltext anwenden
 *   4. erneut validieren → die Ziel-Diagnose ist weg
 * Schritt 4 ist der eigentliche Beweis: der Fix repariert wirklich.
 *
 * Migriert nach der Sprachänderung "kein `modul`-Header; `verwende { … }
 * aus "<relpfad>"`": Workspace-URIs sind `file:///<name>.findsl`, ein Import
 * `aus "./lib"` aus `app.findsl` löst auf `/lib.findsl` (= lib.findsl) auf. Der
 * rekonstruierte verwende-Text ist jetzt `verwende { … } aus "<pfad>"`
 * (Quelle MIT Anführungszeichen).
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { CodeAction, Diagnostic, TextEdit } from 'vscode-languageserver';

interface Ctx {
    services: ReturnType<typeof createFindslServices>['Findsl'];
}

function newCtx(): Ctx {
    return { services: createFindslServices(NodeFileSystem).Findsl };
}

async function validate(
    ctx: Ctx, sources: Record<string, string>, main: string,
): Promise<{ uri: string; diags: Diagnostic[]; src: string }> {
    const docs = Object.entries(sources).map(([n, s]) =>
        ctx.services.shared.workspace.LangiumDocumentFactory.fromString(
            s, URI.parse(`file:///${n}.findsl`),
        ),
    );
    for (const d of docs) ctx.services.shared.workspace.LangiumDocuments.addDocument(d);
    await ctx.services.shared.workspace.DocumentBuilder.build(docs, { validation: true });
    const doc = docs.find((d) => d.uri.path.endsWith(`/${main}.findsl`))!;
    return {
        uri: doc.uri.toString(),
        diags: (doc.diagnostics ?? []) as Diagnostic[],
        src: sources[main],
    };
}

async function actionsFor(
    ctx: Ctx, uri: string, diags: Diagnostic[],
): Promise<CodeAction[]> {
    const docs = ctx.services.shared.workspace.LangiumDocuments;
    const doc = [...docs.all].find((d) => d.uri.toString() === uri)!;
    const res = await ctx.services.lsp.CodeActionProvider!.getCodeActions(doc, {
        textDocument: { uri },
        range: diags[0]?.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: { diagnostics: diags },
    });
    return (res ?? []) as CodeAction[];
}

/** Wendet einen einzelnen TextEdit (Single-File) auf den Quelltext an. */
function applyEdit(src: string, edit: TextEdit): string {
    const lines = src.split('\n');
    const toOffset = (l: number, c: number) =>
        lines.slice(0, l).reduce((n, ln) => n + ln.length + 1, 0) + c;
    const start = toOffset(edit.range.start.line, edit.range.start.character);
    const end = toOffset(edit.range.end.line, edit.range.end.character);
    return src.slice(0, start) + edit.newText + src.slice(end);
}

function firstEdit(action: CodeAction, uri: string): TextEdit {
    return action.edit!.changes![uri][0];
}

describe('Quick-Fix: @Quelle hinzufügen', () => {
    it('bietet Fix an und behebt die Warnung', async () => {
        const ctx = newCtx();
        // Ohne `modul`-Header bindet ein Annotations-Block am Dateianfang
        // an `fileDoc` (Datei-Doku), nicht an die erste Decl. Damit der
        // eingefügte @Quelle als `docPrefix` der Ziel-Konstante landet,
        // steht GFB als ZWEITE Decl (BASIS davor; dessen eigene
        // fehlende-quelle-Warnung wird hier bewusst ignoriert).
        const src = 'konst BASIS: Euro = 1 als Euro\nkonst GFB: Euro = 12.096 als Euro\n';
        const v = await validate(ctx, { m: src }, 'm');
        const quelleDiag = v.diags.find(
            (d) => d.code === 'findsl.fehlende-quelle' && d.message.includes('GFB'),
        );
        expect(quelleDiag).toBeDefined();

        const actions = await actionsFor(ctx, v.uri, [quelleDiag!]);
        const fix = actions.find((a) => a.title.includes('@Quelle'));
        expect(fix).toBeDefined();

        const fixed = applyEdit(src, firstEdit(fix!, v.uri));
        expect(fixed).toContain('@Quelle("Quelle angeben")');

        // Re-Validierung: keine fehlende-quelle-Warnung für GFB mehr.
        const v2 = await validate(newCtx(), { m: fixed }, 'm');
        expect(v2.diags.some(
            (d) => d.code === 'findsl.fehlende-quelle' && d.message.includes('GFB'),
        )).toBe(false);
    });
});

// entfernt: describe('Quick-Fix: Modul-Pfad korrigieren') — die
// `modul`-Deklaration ist abgeschafft, der Quick-Fix `findsl.modul-pfad`
// existiert nicht mehr (es gibt keinen Modulnamen↔Datei-Konsistenzcheck
// mehr). Beide Tests ("ersetzt die Endkomponente …" / "korrigiert nur die
// letzte Komponente …") wurden ersatzlos gelöscht.

describe('Quick-Fix: Builtin-Import entfernen', () => {
    it('entfernt das Builtin-Symbol, behält die anderen', async () => {
        const ctx = newCtx();
        const lib = 'fn estX(z: Euro): Euro = z\n';
        const app = 'verwende {estX, Tarifart} aus "./lib"\nkonst R: Euro = estX(1 als Euro)\n';
        const v = await validate(ctx, { lib, app }, 'app');
        const diag = v.diags.find((d) => d.code === 'findsl.builtin-import');
        expect(diag).toBeDefined();

        const actions = await actionsFor(ctx, v.uri, [diag!]);
        const fix = actions.find((a) => a.title.includes('Eingebautes'));
        expect(fix).toBeDefined();

        const fixed = applyEdit(app, firstEdit(fix!, v.uri));
        expect(fixed).toContain('verwende { estX } aus "./lib"');
        expect(fixed).not.toContain('Tarifart');
    });

    it('löscht die ganze verwende-Zeile, wenn das Builtin das einzige Symbol war', async () => {
        const ctx = newCtx();
        const lib = 'konst DUMMY: Euro = 1 als Euro\n';
        const app = 'verwende {Tarifart} aus "./lib"\nkonst R: Euro = 1 als Euro\n';
        const v = await validate(ctx, { lib, app }, 'app');
        const diag = v.diags.find((d) => d.code === 'findsl.builtin-import')!;
        const actions = await actionsFor(ctx, v.uri, [diag]);
        const fix = actions.find((a) => a.title.includes('Eingebautes'))!;
        const fixed = applyEdit(app, firstEdit(fix, v.uri));
        expect(fixed).not.toContain('verwende');
        expect(fixed.startsWith('konst R')).toBe(true);
    });
});

describe('Quick-Fix: nicht-exportiertes Symbol entfernen', () => {
    it('entfernt das unbekannte Symbol aus dem Import', async () => {
        const ctx = newCtx();
        const lib = 'fn echt(z: Euro): Euro = z\n';
        const app = 'verwende {echt, Foobar} aus "./lib"\nkonst R: Euro = echt(1 als Euro)\n';
        const v = await validate(ctx, { lib, app }, 'app');
        const diag = v.diags.find((d) => d.code === 'findsl.symbol-nicht-exportiert');
        expect(diag).toBeDefined();

        const actions = await actionsFor(ctx, v.uri, [diag!]);
        const fix = actions.find((a) => a.title.includes('Nicht-exportiertes'));
        expect(fix).toBeDefined();

        const fixed = applyEdit(app, firstEdit(fix!, v.uri));
        expect(fixed).toContain('verwende { echt } aus "./lib"');

        // Re-Validierung im Workspace: Diagnose weg.
        const c2 = newCtx();
        const v2 = await validate(c2, { lib, app: fixed }, 'app');
        expect(v2.diags.some((d) => d.code === 'findsl.symbol-nicht-exportiert')).toBe(false);
    });
});

describe('Quick-Fix: Grenzfälle', () => {
    it('Diagnose ohne bekannten Code → keine Action', async () => {
        const ctx = newCtx();
        const src = 'konst A: Euro = "text"\nkonst A: Euro = 1 als Euro\n';
        const v = await validate(ctx, { m: src }, 'm');
        // Type-Mismatch + Duplikat haben (noch) keinen Quick-Fix-Code.
        // `findsl.modul-pfad` ist nicht mehr in der Liste — der Fix
        // existiert nach der Abschaffung der `modul`-Deklaration nicht mehr.
        const noCode = v.diags.filter((d) => typeof d.code !== 'string'
            || !['findsl.fehlende-quelle', 'findsl.ungenutzt',
                 'findsl.builtin-import', 'findsl.symbol-nicht-exportiert']
                .includes(d.code as string));
        const actions = await actionsFor(ctx, v.uri, noCode);
        expect(actions).toEqual([]);
    });
});

// --- #90: Refactor-CodeActions -----------------------------------------

/** Formatiert über die echte Formatter-Instanz (für Idempotenz-Checks). */
async function format(src: string): Promise<string> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        src, URI.parse(`file:///fmt-${Math.random().toString(36).slice(2)}.findsl`),
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    const edits = await services.lsp.Formatter!.formatDocument(doc, {
        textDocument: { uri: doc.uri.toString() },
        options: { tabSize: 4, insertSpaces: true },
    });
    return TextDocument.applyEdits(doc.textDocument, edits);
}

/** getCodeActions mit `only: source.organizeImports` über das Dokument. */
async function organizeActions(ctx: Ctx, uri: string): Promise<CodeAction[]> {
    const docs = ctx.services.shared.workspace.LangiumDocuments;
    const doc = [...docs.all].find((d) => d.uri.toString() === uri)!;
    const res = await ctx.services.lsp.CodeActionProvider!.getCodeActions(doc, {
        textDocument: { uri },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: { diagnostics: [], only: ['source.organizeImports'] },
    });
    return (res ?? []) as CodeAction[];
}

describe('Refactor: ungenutzten Import entfernen (#90/1)', () => {
    it('entfernt ungenutztes verwende-Symbol, behält genutzte', async () => {
        const ctx = newCtx();
        const lib = 'fn Eins(z: Euro): Euro = z\nfn Zwei(z: Euro): Euro = z\n';
        const app = 'verwende {Eins, Zwei} aus "./lib"\nkonst R: Euro = Eins(1 als Euro)\n';
        const v = await validate(ctx, { lib, app }, 'app');
        const diag = v.diags.find(
            (d) => d.code === 'findsl.ungenutzt' && d.message.includes('Zwei'),
        );
        expect(diag).toBeDefined();

        const fix = (await actionsFor(ctx, v.uri, [diag!]))
            .find((a) => a.title.includes('Ungenutzten Import'));
        expect(fix).toBeDefined();

        const fixed = applyEdit(app, firstEdit(fix!, v.uri));
        expect(fixed).toContain('Eins');
        expect(fixed).not.toContain('Zwei');
        const v2 = await validate(newCtx(), { lib, app: fixed }, 'app');
        expect(v2.diags.some(
            (d) => d.code === 'findsl.ungenutzt' && d.message.includes('Zwei'),
        )).toBe(false);
    });

    it('letztes Symbol → ganze verwende-Zeile entfernt', async () => {
        const ctx = newCtx();
        const lib = 'fn Eins(z: Euro): Euro = z\n';
        const app = 'verwende {Eins} aus "./lib"\nkonst R: Euro = 1 als Euro\n';
        const v = await validate(ctx, { lib, app }, 'app');
        const diag = v.diags.find((d) => d.code === 'findsl.ungenutzt' && d.message.includes('Eins'));
        const fix = (await actionsFor(ctx, v.uri, [diag!]))
            .find((a) => a.title.includes('Ungenutzten Import'));
        expect(fix).toBeDefined();
        const fixed = applyEdit(app, firstEdit(fix!, v.uri));
        expect(fixed).not.toContain('verwende');
    });

    it('ungenutzter Parameter bietet KEINEN Import-Fix', async () => {
        const ctx = newCtx();
        const src = 'fn F(ungenutzt: Euro): Euro = 0 als Euro\n';
        const v = await validate(ctx, { m: src }, 'm');
        const diag = v.diags.find(
            (d) => d.code === 'findsl.ungenutzt' && d.message.includes('ungenutzt'),
        );
        expect(diag).toBeDefined();
        const actions = await actionsFor(ctx, v.uri, [diag!]);
        expect(actions.some((a) => a.title.includes('Ungenutzten Import'))).toBe(false);
    });

    it('letztes Symbol bei MEHRZEILIGEM Import → ganzer Block weg + parsebar', async () => {
        const ctx = newCtx();
        const lib = 'fn Eins(z: Euro): Euro = z\n';
        // Mehrzeilige (Formatter-kanonische) Form — der HIGH-Bug aus PR #129
        // hätte hier nur die erste Zeile getilgt → unparsebarer Rumpf.
        const app = 'verwende {\n    Eins,\n} aus "./lib"\nkonst R: Euro = 1 als Euro\n';
        const v = await validate(ctx, { lib, app }, 'app');
        const diag = v.diags.find((d) => d.code === 'findsl.ungenutzt' && d.message.includes('Eins'));
        const fix = (await actionsFor(ctx, v.uri, [diag!]))
            .find((a) => a.title.includes('Ungenutzten Import'));
        expect(fix).toBeDefined();
        const fixed = applyEdit(app, firstEdit(fix!, v.uri));
        expect(fixed).not.toContain('verwende');
        expect(fixed).not.toContain('Eins');
        expect(fixed).not.toContain('}');
        // Entscheidend: das Ergebnis parst (keine Parse-/Validierungsfehler).
        const v2 = await validate(newCtx(), { lib, app: fixed }, 'app');
        expect(v2.diags.filter((d) => d.severity === 1)).toEqual([]);
    });
});

describe('Source: Importe organisieren (#90/2)', () => {
    it('mergt Quellen, sortiert Symbole, formatter-kanonisch', async () => {
        const ctx = newCtx();
        const lib = 'fn Aaa(z: Euro): Euro = z\nfn Bbb(z: Euro): Euro = z\n';
        const lib2 = 'fn Ccc(z: Euro): Euro = z\n';
        const app = 'verwende {Ccc} aus "./lib2"\n'
            + 'verwende {Bbb} aus "./lib"\n'
            + 'verwende {Aaa} aus "./lib"\n'
            + 'konst R: Euro = Aaa(1 als Euro) + Bbb(1 als Euro) + Ccc(1 als Euro)\n';
        const v = await validate(ctx, { lib, lib2, app }, 'app');

        const org = (await organizeActions(ctx, v.uri))
            .find((a) => a.title === 'Importe organisieren');
        expect(org).toBeDefined();

        const out = applyEdit(app, firstEdit(org!, v.uri));
        // Quellen alphabetisch (./lib vor ./lib2), Symbole sortiert + gemergt,
        // mehrzeilig (Formatter-Konvention).
        expect(out).toBe(
            'verwende {\n    Aaa,\n    Bbb,\n} aus "./lib"\n'
            + 'verwende {\n    Ccc,\n} aus "./lib2"\n'
            + 'konst R: Euro = Aaa(1 als Euro) + Bbb(1 als Euro) + Ccc(1 als Euro)\n',
        );
        // Formatter-idempotent (keine Oszillation) + weiterhin valide +
        // organize ist idempotent (erneut angewandt → keine Aktion mehr).
        expect(await format(out)).toBe(await format(await format(out)));
        const ctx2 = newCtx();
        const v2 = await validate(ctx2, { lib, lib2, app: out }, 'app');
        expect(v2.diags.filter((d) => d.severity === 1)).toEqual([]);
        expect((await organizeActions(ctx2, v2.uri)).length).toBe(0);
    });

    it('bereits organisiert → keine (No-op-)Aktion', async () => {
        const ctx = newCtx();
        const lib = 'fn Aaa(z: Euro): Euro = z\n';
        const app = 'verwende {\n    Aaa,\n} aus "./lib"\nkonst R: Euro = Aaa(1 als Euro)\n';
        const v = await validate(ctx, { lib, app }, 'app');
        const org = (await organizeActions(ctx, v.uri))
            .find((a) => a.title === 'Importe organisieren');
        expect(org).toBeUndefined();
    });

    it('erhält Alias (Foo als bar) und sortiert', async () => {
        const ctx = newCtx();
        const lib = 'fn Alpha(z: Euro): Euro = z\nfn Zeta(z: Euro): Euro = z\n';
        const app = 'verwende {Zeta als z, Alpha} aus "./lib"\n'
            + 'konst R: Euro = z(1 als Euro) + Alpha(1 als Euro)\n';
        const v = await validate(ctx, { lib, app }, 'app');
        const org = (await organizeActions(ctx, v.uri)).find((a) => a.title === 'Importe organisieren');
        expect(org).toBeDefined();
        const out = applyEdit(app, firstEdit(org!, v.uri));
        // Alias erhalten + alphabetisch (Alpha vor Zeta).
        expect(out).toContain('verwende {\n    Alpha,\n    Zeta als z,\n} aus "./lib"');
    });

    it('entfernt ungenutzte Symbole beim Organisieren (TS-Parität)', async () => {
        const ctx = newCtx();
        const lib = 'fn Aaa(z: Euro): Euro = z\nfn Bbb(z: Euro): Euro = z\n';
        const app = 'verwende {Aaa, Bbb} aus "./lib"\nkonst R: Euro = Aaa(1 als Euro)\n';
        const v = await validate(ctx, { lib, app }, 'app');
        const org = (await organizeActions(ctx, v.uri)).find((a) => a.title === 'Importe organisieren');
        expect(org).toBeDefined();
        const out = applyEdit(app, firstEdit(org!, v.uri));
        // Bbb ungenutzt → raus; nur Aaa bleibt (kanonisch mehrzeilig).
        expect(out).toBe('verwende {\n    Aaa,\n} aus "./lib"\nkonst R: Euro = Aaa(1 als Euro)\n');
    });

    it('lässt eine Quelle ganz weg, wenn alle ihre Symbole ungenutzt sind', async () => {
        const ctx = newCtx();
        const lib = 'fn Aaa(z: Euro): Euro = z\n';
        const lib2 = 'fn Bbb(z: Euro): Euro = z\n';
        const app = 'verwende {Bbb} aus "./lib2"\n'
            + 'verwende {Aaa} aus "./lib"\n'
            + 'konst R: Euro = Aaa(1 als Euro)\n';
        const v = await validate(ctx, { lib, lib2, app }, 'app');
        const org = (await organizeActions(ctx, v.uri)).find((a) => a.title === 'Importe organisieren');
        expect(org).toBeDefined();
        const out = applyEdit(app, firstEdit(org!, v.uri));
        // ./lib2 (nur Bbb, ungenutzt) fällt weg; nur ./lib bleibt.
        expect(out).toBe('verwende {\n    Aaa,\n} aus "./lib"\nkonst R: Euro = Aaa(1 als Euro)\n');
    });

    it('entfernt ungenutzten Alias (Zeta als z) beim Organisieren', async () => {
        const ctx = newCtx();
        const lib = 'fn Alpha(z: Euro): Euro = z\nfn Zeta(z: Euro): Euro = z\n';
        const app = 'verwende {Zeta als z, Alpha} aus "./lib"\n'
            + 'konst R: Euro = Alpha(1 als Euro)\n';
        const v = await validate(ctx, { lib, app }, 'app');
        const org = (await organizeActions(ctx, v.uri)).find((a) => a.title === 'Importe organisieren');
        expect(org).toBeDefined();
        const out = applyEdit(app, firstEdit(org!, v.uri));
        // z (Alias von Zeta) nicht referenziert → raus; Alpha bleibt.
        expect(out).toBe('verwende {\n    Alpha,\n} aus "./lib"\nkonst R: Euro = Alpha(1 als Euro)\n');
    });

    it('alle Importe ungenutzt → Block komplett entfernt (keine Leerzeile)', async () => {
        const ctx = newCtx();
        const lib = 'fn Aaa(z: Euro): Euro = z\n';
        const app = 'verwende {Aaa} aus "./lib"\nkonst R: Euro = 1 als Euro\n';
        const v = await validate(ctx, { lib, app }, 'app');
        const org = (await organizeActions(ctx, v.uri)).find((a) => a.title === 'Importe organisieren');
        expect(org).toBeDefined();
        const out = applyEdit(app, firstEdit(org!, v.uri));
        // Import-Zeile inkl. Umbruch weg → keine führende Leerzeile.
        expect(out).toBe('konst R: Euro = 1 als Euro\n');
    });

    it('only:[quickfix] → Organize NICHT angeboten', async () => {
        const ctx = newCtx();
        const lib = 'fn Aaa(z: Euro): Euro = z\n';
        const app = 'verwende {Aaa} aus "./lib"\nkonst R: Euro = Aaa(1 als Euro)\n';
        const v = await validate(ctx, { lib, app }, 'app');
        const docs = ctx.services.shared.workspace.LangiumDocuments;
        const doc = [...docs.all].find((d) => d.uri.toString() === v.uri)!;
        const res = await ctx.services.lsp.CodeActionProvider!.getCodeActions(doc, {
            textDocument: { uri: v.uri },
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            context: { diagnostics: [], only: ['quickfix'] },
        });
        expect((res ?? []).some((a) => (a as CodeAction).title === 'Importe organisieren')).toBe(false);
    });

    it('Kommentar zwischen Imports → Organize NICHT angeboten (kein Content-Loss)', async () => {
        const ctx = newCtx();
        const lib = 'fn Aaa(z: Euro): Euro = z\n';
        const lib2 = 'fn Bbb(z: Euro): Euro = z\n';
        const app = 'verwende {Bbb} aus "./lib2"\n// wichtig\nverwende {Aaa} aus "./lib"\n'
            + 'konst R: Euro = Aaa(1 als Euro) + Bbb(1 als Euro)\n';
        const v = await validate(ctx, { lib, lib2, app }, 'app');
        const org = (await organizeActions(ctx, v.uri)).find((a) => a.title === 'Importe organisieren');
        expect(org).toBeUndefined();
    });
});

/**
 * Server-Capability (Issue #90, Phase A): Der FinDSL-LanguageServer muss die
 * unterstützten `codeActionKinds` in den InitializeResult-Capabilities melden.
 * Langiums Default meldet nur `codeActionProvider: true` (Boolean ohne Kinds);
 * dann blendet VS Code „Organize Imports" (`source.organizeImports`) aus —
 * exakt der im Editor beobachtete Fehler. Regressionsschutz dagegen.
 */
describe('LanguageServer-Capabilities', () => {
    it('meldet codeActionKinds inkl. source.organizeImports', async () => {
        const { shared } = createFindslServices(NodeFileSystem);
        const res = await shared.lsp.LanguageServer.initialize({
            processId: null,
            rootUri: null,
            capabilities: {},
            workspaceFolders: null,
        });
        const cap = res.capabilities.codeActionProvider;
        // Muss ein Objekt mit Kinds sein, KEIN bloßes `true`.
        expect(typeof cap).toBe('object');
        const kinds = (cap as { codeActionKinds?: string[] }).codeActionKinds ?? [];
        expect(kinds).toContain('source.organizeImports');
        expect(kinds).toContain('quickfix');
    });
});
