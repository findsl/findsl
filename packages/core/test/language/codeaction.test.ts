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
            || !['findsl.fehlende-quelle',
                 'findsl.builtin-import', 'findsl.symbol-nicht-exportiert']
                .includes(d.code as string));
        const actions = await actionsFor(ctx, v.uri, noCode);
        expect(actions).toEqual([]);
    });
});
