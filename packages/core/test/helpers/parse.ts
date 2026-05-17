/**
 * Test-Helfer: parst einen FinDSL-Quelltext über die Langium-Services und
 * liefert das Program-AST zurück. Validierung ist standardmäßig aus, damit
 * Tests gezielt nur das Interpreter-Verhalten prüfen können; bei Bedarf
 * `validate: true` setzen.
 */

import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../../src/language/findsl-module.js';
import type { Program } from '../../src/language/generated/ast.js';

let cachedServices: ReturnType<typeof createFindslServices> | undefined;

function services() {
    if (!cachedServices) cachedServices = createFindslServices(NodeFileSystem);
    return cachedServices.Findsl;
}

export interface ParseOptions {
    validate?: boolean;
    /** Pseudo-URI, sofern relative Import-Auflösung mitgetestet werden soll. */
    uri?: string;
}

export async function parseSource(
    source: string,
    options: ParseOptions = {},
): Promise<Program> {
    const svc = services();
    const uri = URI.parse(options.uri ?? 'file:///inline.findsl');
    const document = svc.shared.workspace.LangiumDocumentFactory.fromString(source, uri);
    await svc.shared.workspace.DocumentBuilder.build(
        [document],
        { validation: options.validate ?? false },
    );
    return document.parseResult.value as Program;
}

/**
 * Hüllt einen Ausdruck in eine minimale Datei und liefert das Program.
 * Ergebnis: Konstante `R` mit dem Wert des Ausdrucks; Tests greifen sie
 * dann über die Modul-Env ab. Kein `modul`-Header mehr.
 */
export async function parseExpr(expr: string): Promise<Program> {
    return parseSource(`konst R: Dezimal = ${expr}\n`);
}
