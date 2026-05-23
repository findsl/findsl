// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * `findsl/generate` — erzeugt aus dem offenen Dokument je Target ein Artefakt.
 * Nutzt die REINEN `Program`-Bausteine von @findsl/core (kein Datei-Loader):
 *   java → lowerProgram + emitJavaModuleFiles
 *   ts   → lowerProgram + emitTsModule
 *   pap  → buildModuleGraphs + renderModuleMarkdown/renderMermaid
 * js/markdown/html/pdf folgen in der nächsten Phase (typescript-Strip,
 * reiner DocModel-Builder, pdfmake-Browser + MathJax lazy).
 */

import { URI } from 'langium';
import { lowerProgram } from '@findsl/core/codegen/lower/lower.js';
import { emitJavaModuleFiles } from '@findsl/core/codegen/emit-java/emitter.js';
import { emitTsModule } from '@findsl/core/codegen/emit-ts/emitter.js';
import { buildModuleGraphs } from '@findsl/core/papgen/model.js';
import { renderMermaid, renderModuleMarkdown } from '@findsl/core/papgen/mermaid.js';
import { buildDocModelFromProgram } from '@findsl/core/docgen/model.js';
import { renderMarkdown } from '@findsl/core/docgen/markdown.js';
import { renderHtml as renderDocHtml } from '@findsl/core/docgen/html.js';
import type { Program } from '@findsl/core/language/generated/ast.js';
import type { Artifact, GenerateResult, Target } from './types.js';

interface SharedLike {
    workspace: {
        LangiumDocuments: {
            getDocument(uri: URI): {
                parseResult: { value: unknown };
                textDocument: { getText(): string };
            } | undefined;
        };
        DocumentBuilder: {
            build(docs: unknown[], opts?: { validation?: boolean }): Promise<void>;
        };
    };
}

/** Klassen-/Modulname aus der Dokument-URI (Single-File-Playground). */
function classNameFromUri(uri: string): string {
    const base = (uri.split('/').pop() ?? 'Main').replace(/\.findsl$/i, '');
    const cleaned = base.replace(/[^A-Za-z0-9_]/g, '');
    const stem = cleaned.length > 0 ? cleaned : 'Main';
    return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function ok(artifact: Artifact): GenerateResult {
    return { ok: true, artifact };
}

export async function runGenerate(
    shared: SharedLike,
    uri: string,
    target: Target,
): Promise<GenerateResult> {
    const document = shared.workspace.LangiumDocuments.getDocument(URI.parse(uri));
    if (!document) return { ok: false, error: `Dokument nicht offen: ${uri}` };
    await shared.workspace.DocumentBuilder.build([document], { validation: false });
    const program = document.parseResult.value as Program;
    const className = classNameFromUri(uri);
    const ctx = { javaPackage: undefined, className, imports: [] };

    try {
        switch (target) {
            case 'java': {
                const f = emitJavaModuleFiles(lowerProgram(program, ctx));
                const text = `// ${f.interfaceName}.java\n${f.interfaceCode}\n\n`
                    + `// ${f.implName}.java\n${f.implCode}`;
                return ok({ target, filename: `${f.implName}.java`, mime: 'text/x-java-source', text });
            }
            case 'ts': {
                const f = emitTsModule(lowerProgram(program, ctx));
                return ok({ target, filename: f.fileName, mime: 'text/typescript', text: f.code });
            }
            case 'pap': {
                const modul = buildModuleGraphs(program, className, { detail: 'struktur' });
                const text = renderModuleMarkdown(modul);
                const mermaid = modul.graphs.length === 1
                    ? renderMermaid(modul.graphs[0]) : undefined;
                return ok({
                    target, filename: `${className}.pap.md`, mime: 'text/markdown', text, mermaid,
                });
            }
            case 'markdown': {
                const model = buildDocModelFromProgram(program, document.textDocument.getText(), className);
                return ok({
                    target, filename: `${className}.doku.md`, mime: 'text/markdown',
                    text: renderMarkdown(model),
                });
            }
            case 'html': {
                const model = buildDocModelFromProgram(program, document.textDocument.getText(), className);
                return ok({
                    target, filename: `${className}.doku.html`, mime: 'text/html',
                    text: renderDocHtml(model),
                });
            }
            case 'js':
            case 'pdf':
                return { ok: false, error: `Target "${target}" folgt in der nächsten Phase (#130).` };
            default:
                return { ok: false, error: `Unbekanntes Target: ${String(target)}` };
        }
    } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}
