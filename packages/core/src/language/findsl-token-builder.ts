/**
 * Custom Token-Builder für FinDSL.
 *
 * Hintergrund: Seit das `ID`-Terminal auf Unicode-Buchstaben umgestellt
 * wurde (Unicode-Property-Escape `\p{L}` mit `u`-Flag), zerschnitt Langium
 * Identifier wie `nichtselbständigeArbeit` fälschlich in das Keyword
 * `nicht` plus den Rest.
 *
 * Ursache: Langiums `DefaultTokenBuilder.findLongerAlt` testet jedes
 * Keyword gegen `new RegExp('^' + pattern.source + '$')` — OHNE die Flags
 * des Terminal-Patterns zu übernehmen. Ohne `u`-Flag ist `\p{L}` kein
 * Unicode-Property-Escape mehr, der Test schlägt fehl, und das Keyword
 * bekommt kein `LONGER_ALT`. Chevrotain bevorzugt dann das kürzere
 * Keyword vor dem längeren Identifier.
 *
 * Fix: `findLongerAlt` so überschreiben, dass der Keyword-Test die Flags
 * (insbesondere `u`) des jeweiligen Terminal-Patterns mit übernimmt.
 */

import { DefaultTokenBuilder, type GrammarAST } from 'langium';
import type { TokenType } from 'chevrotain';

export class FindslTokenBuilder extends DefaultTokenBuilder {

    /** Gültiger FinDSL-Identifier (muss mit der ID-Terminal-Regex übereinstimmen). */
    private static readonly ID_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u;

    protected override findLongerAlt(
        keyword: GrammarAST.Keyword, terminalTokens: TokenType[],
    ): TokenType[] {
        // Default-Verhalten unverändert lassen — chevrotains `partialMatches`
        // berechnet LONGER_ALT für DOC_COMMENT, STRING etc. korrekt.
        const alts = super.findLongerAlt(keyword, terminalTokens);

        // Einzige Ergänzung: das `ID`-Terminal manuell als LONGER_ALT für
        // Keywords nachtragen, die ein gültiger Unicode-Identifier wären.
        // Genau hier scheitert Langiums Default-Heuristik, weil sie das
        // `u`-Flag des ID-Patterns verwirft und `\p{L}` nicht auflöst.
        if (FindslTokenBuilder.ID_RE.test(keyword.value)) {
            const idToken = terminalTokens.find((t) => t.name === 'ID');
            if (idToken && !alts.includes(idToken)) {
                alts.push(idToken);
            }
        }
        return alts;
    }
}
