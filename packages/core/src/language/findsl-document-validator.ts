/**
 * Custom Document-Validator fuer FinDSL.
 *
 * Einziger Zweck: die kryptische Chevrotain-Lexer-Meldung
 *   `unexpected character ...`
 * durch eine klare, handlungsleitende deutsche Diagnose ersetzen. Fuer
 * Sachbearbeiter:innen ist "skipped 1 characters" nicht verstaendlich.
 *
 * Nach der Unicode-Identifier-Erweiterung sind Buchstaben (jeder \p{L})
 * gueltig — uebrig bleiben echte Fremdzeichen: Paragraf, Pipe,
 * Gedankenstriche, Emoji, mathematische Symbole. Die neue Meldung sagt,
 * wohin solche Zeichen gehoeren (Text-Literale oder Kommentare).
 */

import { DefaultDocumentValidator } from 'langium';
import type { ParseResult } from 'langium';
import type { Diagnostic } from 'vscode-languageserver';

type LexOptions = Parameters<DefaultDocumentValidator['processLexingErrors']>[2];

export class FindslDocumentValidator extends DefaultDocumentValidator {

    protected override processLexingErrors(
        parseResult: ParseResult,
        diagnostics: Diagnostic[],
        options: LexOptions,
    ): void {
        const before = diagnostics.length;
        super.processLexingErrors(parseResult, diagnostics, options);

        // Nur die NEU hinzugefuegten Lexer-Diagnosen umschreiben.
        for (let i = before; i < diagnostics.length; i++) {
            const d = diagnostics[i];
            const m = /unexpected character:\s*->([\s\S]?)<-/.exec(d.message);
            if (!m) continue;
            const ch = m[1];
            diagnostics[i] = {
                ...d,
                message:
                    `Ungueltiges Zeichen "${ch}" in FinDSL-Code. Bezeichner duerfen `
                    + `nur Buchstaben (inkl. Umlaute/Unicode), Ziffern und _ enthalten. `
                    + `Sonderzeichen, Emoji oder Anfuehrungszeichen gehoeren in ein `
                    + `Text-Literal oder einen Kommentar.`,
                code: 'findsl.ungueltiges-zeichen',
            };
        }
    }
}
