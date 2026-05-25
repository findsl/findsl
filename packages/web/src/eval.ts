// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * `findsl/eval` — wertet einen freien FinDSL-Ausdruck im Scope des offenen
 * Dokuments aus und liefert Wert + Typ + deutsch formatierten Text (Issue
 * #164). Damit lässt sich „Engine im Browser" bauen (HTML-Formular →
 * Live-Berechnung, z. B. `Koerperschaftsteuer(50000)` → `7.500 €`), ohne den
 * `prüfe`-Test-Pfad zu missbrauchen oder das `generate('js')`-Generat samt
 * Runtime selbst zu bündeln.
 *
 * FinDSL hat keinen Ausdruck-Parser-Entry (nur `entry Program`), darum wird
 * der Ausdruck in ein synthetisches Dokument eingebettet — Original-Quelltext
 * plus ein angehängter `prüfe`-Block, der den Ausdruck in Ausdrucksposition
 * bringt. Der `Expr`-AST-Knoten wird herausgegriffen und direkt mit dem
 * vorhandenen `evalExpr` gegen die `interpretProgram`-Environment ausgewertet
 * (kein `konst`-Annotation-Pfad, kein Geld-Cast). Wie `docgen/model.ts` wird
 * das synthetische Dokument NICHT zum Workspace hinzugefügt (`fromString` +
 * `build` genügt) → kein Leak, kein `deleteDocument`.
 *
 * Sicherheit: rein lokale Auswertung (kein fs, kein Netz, kein JS-`eval`).
 * Ein `expr`, der die Block-Einbettung syntaktisch sprengt (z. B. unbalanciertes
 * `}` ausserhalb eines String-Literals oder ein `--`-Zeilenkommentar, der die
 * schliessenden Klammern auskommentiert), führt zu einem Parse-Fehler →
 * `ok:false`. Ein `}` INNERHALB eines String-Literals (`"a}b"`) ist unkritisch.
 */

import { URI } from 'langium';
import { interpretProgram, evalExpr } from '@findsl/core/interpret/interpreter.js';
import {
    AbbruchSignal,
    formatGerman,
    valueToString,
    type Value,
} from '@findsl/core/interpret/values.js';
import { isPruefeDecl, type Expr, type Program } from '@findsl/core/language/generated/ast.js';
import type { EvalResult } from './types.js';

interface SharedLike {
    workspace: {
        LangiumDocuments: {
            getDocument(uri: URI): { textDocument: { getText(): string } } | undefined;
        };
        LangiumDocumentFactory: {
            fromString(text: string, uri: URI): {
                parseResult: { value: unknown; parserErrors: ReadonlyArray<{ message: string }> };
            };
        };
        DocumentBuilder: {
            build(docs: unknown[], opts?: { validation?: boolean }): Promise<void>;
        };
    };
}

/** Eindeutiger URI-Namespace je Eval — kollidiert nie mit dem offenen Dokument. */
let evalCounter = 0;

export async function runEval(shared: SharedLike, uri: string, expr: string): Promise<EvalResult> {
    const original = shared.workspace.LangiumDocuments.getDocument(URI.parse(uri));
    if (!original) return { ok: false, error: `Dokument nicht offen: ${uri}` };

    // Ausdruck in Ausdrucksposition bringen: Original + angehängter prüfe-Block.
    const src = original.textDocument.getText();
    const synthetic = `${src}\n\nprüfe "__findsl_eval__" {\n`
        + `    testfall "__findsl_eval__" {\n        ${expr}\n    }\n}\n`;

    const evalUri = URI.parse(`inmemory://findsl-eval/${evalCounter++}.findsl`);
    const doc = shared.workspace.LangiumDocumentFactory.fromString(synthetic, evalUri);

    try {
        await shared.workspace.DocumentBuilder.build([doc], { validation: false });

        const parserErrors = doc.parseResult.parserErrors;
        if (parserErrors.length > 0) {
            return { ok: false, error: `Ausdruck nicht parsebar: ${parserErrors[0]?.message ?? 'Syntaxfehler'}` };
        }

        const program = doc.parseResult.value as Program;
        const exprNode: Expr | undefined =
            program.decls.filter(isPruefeDecl).at(-1)?.testfaelle[0]?.body?.result;
        if (!exprNode) return { ok: false, error: 'Ausdruck konnte nicht eingebettet werden.' };

        const { env } = interpretProgram(program);
        const value = evalExpr(exprNode, env);
        return { ok: true, ...mapValue(value) };
    } catch (err) {
        // abbruch ist kein Fehler i. e. S., sondern ein begründeter Lauf-Abbruch.
        if (err instanceof AbbruchSignal) return { ok: false, error: err.message };
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
}

/**
 * Wert → `{ value, type, text }`. `value` ist die reine deutsche Zahl OHNE
 * Einheit, `text` voll formatiert MIT Einheit. Issue #164 verlangt `text`
 * mit Einheit (`"7.500 €"`/`"15 %"`); `valueToString` liefert das NICHT
 * (Euro/EuroCent/Cent ohne Symbol, Strings mit JSON-Quotes) — daher hier
 * einheitenbewusst: Euro/EuroCent → `€`, Cent → `ct`, Prozent → `%`,
 * Ganzzahl/Dezimal ohne Einheit.
 */
function mapValue(v: Value): { value: string; type: string; text: string } {
    if (v.kind === 'numeric') {
        switch (v.tag) {
            case 'Euro':     { const s = formatGerman(v.value);          return { value: s, type: 'Euro', text: `${s} €` }; }
            case 'EuroCent': { const s = formatGerman(v.value, 2);       return { value: s, type: 'EuroCent', text: `${s} €` }; }
            case 'Cent':     { const s = formatGerman(v.value.mul(100)); return { value: s, type: 'Cent', text: `${s} ct` }; }
            case 'Prozent':  { const s = formatGerman(v.value.mul(100)); return { value: s, type: 'Prozent', text: `${s} %` }; }
            default:         { const s = formatGerman(v.value);          return { value: s, type: v.tag, text: s }; }
        }
    }
    switch (v.kind) {
        case 'bool':   { const s = v.value ? 'wahr' : 'falsch'; return { value: s, type: 'Wahrheitswert', text: s }; }
        case 'string': return { value: v.value, type: 'Text', text: v.value };
        case 'null':   return { value: 'nichts', type: 'nichts', text: 'nichts' };
        case 'symbol': return { value: v.name, type: 'Aufzählung', text: v.name };
        case 'record': { const s = valueToString(v); return { value: s, type: v.typeName, text: s }; }
        case 'list':   { const s = valueToString(v); return { value: s, type: 'Liste', text: s }; }
        default:       { const s = valueToString(v); return { value: s, type: v.kind, text: s }; }
    }
}
