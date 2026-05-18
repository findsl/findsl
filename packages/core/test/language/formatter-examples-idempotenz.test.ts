/**
 * Pitfall-Gate (CLAUDE § 7 „Formatter: Idempotenz ist hart erkämpft"):
 * `format ∘ format == format` MUSS auf ALLEN Beispieldateien gelten —
 * inklusive der seit 2026-05-18 enthaltenen `ParenChain`-Syntax
 * (`(a * b).abrunden()`). Zusätzlich: das einmal formatierte Ergebnis
 * ist fehlerfrei (Formatter erzeugt keinen invaliden Code).
 */

import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createFindslServices } from '../../src/language/findsl-module.js';

const examplesDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)), '../../../../examples',
);

function findslFiles(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...findslFiles(p));
        else if (e.name.endsWith('.findsl')) out.push(p);
    }
    return out;
}

async function format(src: string, name: string): Promise<string> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const doc = services.shared.workspace.LangiumDocumentFactory.fromString(
        src, URI.parse(`file:///${name}`),
    );
    services.shared.workspace.LangiumDocuments.addDocument(doc);
    await services.shared.workspace.DocumentBuilder.build([doc], { validation: false });
    const edits = await services.lsp.Formatter!.formatDocument(doc, {
        textDocument: { uri: doc.uri.toString() },
        options: { tabSize: 4, insertSpaces: true },
    });
    return TextDocument.applyEdits(doc.textDocument, edits);
}

describe('Formatter — Idempotenz auf allen Beispieldateien (ParenChain)', () => {
    const files = findslFiles(examplesDir);

    it('findet Beispieldateien', () => {
        expect(files.length).toBeGreaterThan(0);
    });

    for (const file of files) {
        const rel = path.relative(examplesDir, file);
        it(`format∘format == format — ${rel}`, async () => {
            const src = fs.readFileSync(file, 'utf-8');
            const once = await format(src, path.basename(file));
            const twice = await format(once, path.basename(file));
            expect(twice).toBe(once);
        });
    }
});
