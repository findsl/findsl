/**
 * Tests für CodeLens „Testfälle ausführen" + das Server-Kommando
 * `findsl.pruefe.run`. Ohne LSP-Connection (Tests) ist die Notification
 * ein No-op; der ExecuteCommandHandler liefert den PruefeReport zurück,
 * den wir auswerten.
 */

import { describe, it, expect } from 'vitest';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import { DiagnosticSeverity, type CodeLens } from 'vscode-languageserver';
import type { PruefeReport } from '../../src/interpret/pruefe.js';
import { buildPruefeDiagnostics } from '../../src/language/findsl-commands.js';
import { LENS_RUN_COMMAND } from '../../src/language/findsl-codelens.js';
import { isPruefeDecl, type Program, type PruefeDecl } from '../../src/language/generated/ast.js';

async function setup(sources: Record<string, string>) {
    const services = createFindslServices(NodeFileSystem);
    const docs = Object.entries(sources).map(([n, s]) =>
        services.Findsl.shared.workspace.LangiumDocumentFactory.fromString(
            s, URI.parse(`file:///${n}.findsl`),
        ),
    );
    for (const d of docs) services.Findsl.shared.workspace.LangiumDocuments.addDocument(d);
    await services.Findsl.shared.workspace.DocumentBuilder.build(docs, { validation: false });

    const lensesOf = async (mod: string): Promise<CodeLens[]> => {
        const doc = docs.find((d) => d.uri.path.endsWith(`/${mod}.findsl`))!;
        const r = await services.Findsl.lsp.CodeLensProvider!.provideCodeLens(doc, {
            textDocument: { uri: doc.uri.toString() },
        });
        return r ?? [];
    };

    const run = async (mod: string, index: number): Promise<PruefeReport | undefined> => {
        const doc = docs.find((d) => d.uri.path.endsWith(`/${mod}.findsl`))!;
        const handler = services.shared.lsp.ExecuteCommandHandler!;
        return (await handler.executeCommand(
            'findsl.pruefe.run', [doc.uri.toString(), index],
        )) as PruefeReport | undefined;
    };

    const pruefeDecl = (mod: string, index: number): PruefeDecl | undefined => {
        const doc = docs.find((d) => d.uri.path.endsWith(`/${mod}.findsl`))!;
        const program = doc.parseResult?.value as Program;
        return program.decls.filter(isPruefeDecl)[index];
    };

    return { lensesOf, run, pruefeDecl };
}

describe('CodeLens-Provider', () => {
    it('eine Lens pro prüfe-Block mit Titel, Kommando und Args', async () => {
        const { lensesOf } = await setup({
            m: `fn f(): Ganzzahl = 1
prüfe "A" {
    testfall "x" { f() == 1 }
}
prüfe "B" {
    testfall "y" { f() == 1 }
    testfall "z" { f() == 1 }
}
`,
        });
        const lenses = await lensesOf('m');
        expect(lenses).toHaveLength(2);
        expect(lenses[0].command!.title).toBe('▶ 1 Testfall ausführen');
        expect(lenses[1].command!.title).toBe('▶ 2 Testfälle ausführen');
        expect(lenses[0].command!.command).toBe(LENS_RUN_COMMAND);
        expect(lenses[0].command!.arguments![1]).toBe(0);
        expect(lenses[1].command!.arguments![1]).toBe(1);
    });

    it('keine Lens ohne prüfe-Block', async () => {
        const { lensesOf } = await setup({ m: 'konst K: Euro = 1 als Euro\n' });
        expect(await lensesOf('m')).toHaveLength(0);
    });

    it('Initial-Race (#79): provideCodeLens VOR DocumentBuilder.build liefert vollständige Lenses', async () => {
        // Spiegelt das VS-Code-Verhalten beim Datei-Öffnen: der Client
        // schickt `textDocument/codeLens` praktisch sofort nach
        // `didOpen` — also bevor (oder parallel zu) der Build-Pipeline
        // den Parse abgeschlossen hat. Der Provider muss intern auf
        // `DocumentState.Validated` warten und darf nicht stumm `[]`
        // zurückgeben.
        const services = createFindslServices(NodeFileSystem);
        const src = `fn f(): Ganzzahl = 1
prüfe "A" {
    testfall "x" { f() == 1 }
}
prüfe "B" {
    testfall "y" { f() == 1 }
    testfall "z" { f() == 1 }
}
`;
        const doc = services.Findsl.shared.workspace.LangiumDocumentFactory.fromString(
            src, URI.parse('file:///race.findsl'),
        );
        services.Findsl.shared.workspace.LangiumDocuments.addDocument(doc);

        // KEIN explizites `await DocumentBuilder.build([doc], …)` —
        // wir stoßen den Build nur asynchron an und rufen sofort den
        // Provider auf. Der Build läuft im Hintergrund weiter.
        void services.Findsl.shared.workspace.DocumentBuilder.build([doc], { validation: false });

        const lenses = await services.Findsl.lsp.CodeLensProvider!.provideCodeLens(doc, {
            textDocument: { uri: doc.uri.toString() },
        });

        expect(lenses).toBeDefined();
        expect(lenses).toHaveLength(2);
        expect(lenses![0].command!.title).toBe('▶ 1 Testfall ausführen');
        expect(lenses![1].command!.title).toBe('▶ 2 Testfälle ausführen');
    });
});

describe('Kommando findsl.pruefe.run', () => {
    it('führt den gewählten Block aus — alle bestehen', async () => {
        const { run } = await setup({
            m: `fn f(): Ganzzahl = 1
prüfe "Set A" {
    testfall "a" { f() == 1 }
    testfall "b" { f() == 1 }
}
`,
        });
        const r = await run('m', 0);
        expect(r!.total).toBe(2);
        expect(r!.passed).toBe(2);
        expect(r!.failed + r!.errored).toBe(0);
        expect(r!.results[0].pruefeName).toBe('Set A');
    });

    it('meldet Fehlschläge und erwartet-abbruch korrekt', async () => {
        const { run } = await setup({
            m: `fn f(zve: Euro): Euro = wähle {
    falls zve < 0 als Euro -> abbruch("§ X: negativ")
    sonst                  -> 0 als Euro
}
prüfe "Set" {
    testfall "ok" { f(1 als Euro) == 0 als Euro }
    testfall "kaputt" { f(1 als Euro) == 99 als Euro }
    testfall "ablehnung" erwartet abbruch { f(-1 als Euro) }
}
`,
        });
        const r = await run('m', 0);
        expect(r!.total).toBe(3);
        expect(r!.passed).toBe(2);          // ok + ablehnung
        expect(r!.failed).toBe(1);          // kaputt
    });

    it('löst Cross-Modul-verwende auf', async () => {
        const { run } = await setup({
            lib: `fn kern(z: Euro): Euro = z
`,
            app: `verwende {kern} aus "./lib"
prüfe "App" {
    testfall "delegiert" { kern(5 als Euro) == 5 als Euro }
}
`,
        });
        const r = await run('app', 0);
        expect(r!.passed).toBe(1);
        expect(r!.errored).toBe(0);
    });

    it('zweiter Block wird per Index angesprochen', async () => {
        const { run } = await setup({
            m: `fn f(): Ganzzahl = 2
prüfe "Erst" { testfall "x" { f() == 1 } }
prüfe "Zweit" { testfall "y" { f() == 2 } }
`,
        });
        const r = await run('m', 1);
        expect(r!.results[0].pruefeName).toBe('Zweit');
        expect(r!.passed).toBe(1);
    });

    it('unbekannte URI → kein Report', async () => {
        const { run } = await setup({ m: 'konst K: Euro = 1 als Euro\n' });
        const services = createFindslServices(NodeFileSystem);
        const handler = services.shared.lsp.ExecuteCommandHandler!;
        const r = await handler.executeCommand('findsl.pruefe.run', ['file:///nope.findsl', 0]);
        expect(r).toBeUndefined();
    });
});

describe('Inline-Diagnosen pro fehlgeschlagenem testfall', () => {
    it('genau die nicht bestandenen Testfälle bekommen eine Diagnose am Ausdruck', async () => {
        const { run, pruefeDecl } = await setup({
            m: `fn f(zve: Euro): Euro = wähle {
    falls zve < 0 als Euro -> abbruch("§ X: negativ")
    sonst                  -> 0 als Euro
}
prüfe "Set" {
    testfall "ok" { f(1 als Euro) == 0 als Euro }
    testfall "kaputt" { f(1 als Euro) == 99 als Euro }
    testfall "rt-fehler" { f(1 als Euro) / (0 als Euro) == 0 als Euro }
    testfall "ablehnung" erwartet abbruch { f(-1 als Euro) }
}
`,
        });
        const report = (await run('m', 0))!;
        const decl = pruefeDecl('m', 0)!;
        const diags = buildPruefeDiagnostics(decl, report);

        // ok + ablehnung bestehen → 2 Diagnosen (kaputt, rt-fehler).
        expect(diags).toHaveLength(2);

        const kaputt = diags.find((d) => d.message.includes('kaputt'))!;
        expect(kaputt.severity).toBe(DiagnosticSeverity.Error);
        expect(kaputt.source).toBe('findsl prüfe');
        expect(kaputt.code).toBe('findsl.testfall-fehlgeschlagen');
        expect(kaputt.message).toMatch(/fehlgeschlagen/);

        const rt = diags.find((d) => d.message.includes('rt-fehler'))!;
        expect(rt.code).toBe('findsl.testfall-fehler');
        expect(rt.message).toMatch(/Laufzeitfehler|Division/);

        // Range zeigt auf den testfall-Ausdruck (innerhalb des prüfe-Blocks).
        const blockRange = decl.$cstNode!.range;
        expect(kaputt.range.start.line).toBeGreaterThanOrEqual(blockRange.start.line);
        expect(kaputt.range.end.line).toBeLessThanOrEqual(blockRange.end.line);
    });

    it('alle bestanden → keine Diagnose (löscht vorherige Lauf-Marker)', async () => {
        const { run, pruefeDecl } = await setup({
            m: `fn f(): Ganzzahl = 1
prüfe "Set" { testfall "a" { f() == 1 } }
`,
        });
        const report = (await run('m', 0))!;
        expect(buildPruefeDiagnostics(pruefeDecl('m', 0), report)).toEqual([]);
    });
});
