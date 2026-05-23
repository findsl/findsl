/**
 * Quick-Fix-Provider für FinDSL (LSP `textDocument/codeAction`).
 *
 * Macht die Diagnose-Schicht aktionierbar: jede der häufigsten
 * Diagnosen bekommt einen Ein-Klick-Fix. Zuordnung erfolgt über den
 * stabilen `diagnostic.code` (NICHT über fragile Message-Strings) —
 * die Codes werden im Validator gesetzt:
 *
 *   findsl.fehlende-quelle        → `@Quelle("…")` über der Konstante einfügen
 *   findsl.builtin-import         → Symbol aus `verwende {…}` entfernen
 *   findsl.symbol-nicht-exportiert→ Symbol aus `verwende {…}` entfernen
 *
 * Alle Fixes liefern ein `WorkspaceEdit`; nichts wird automatisch
 * angewandt — der Nutzer wählt im Lampen-Menü.
 */

import {
    type LangiumDocument,
    type MaybePromise,
    type AstNode,
    AstUtils,
    CstUtils,
} from 'langium';
import type { CodeActionProvider } from 'langium/lsp';
import {
    CodeActionKind,
    type CodeAction,
    type CodeActionParams,
    type Command,
    type Diagnostic,
    type Range,
    type TextEdit,
} from 'vscode-languageserver';
import {
    isImportDecl,
    isImportItem,
    isCallChain,
    isExpr,
    isStringLiteral,
    isAufzaehlungDecl,
    type ImportDecl,
    type ImportItem,
    type Program,
    type Expr,
} from './generated/ast.js';
import { collectRefs } from './findsl-validator.js';
import { collectExpressionTypes, typeToString, type Type } from './findsl-types.js';
import { analyzeImports } from './findsl-scope.js';
import { isBuiltinName } from './findsl-stdlib.js';

/** Symbol-Render eines `verwende`-Items: `Foo` bzw. `Foo als bar`. */
function renderItem(it: { name: string; alias?: string }): string {
    return it.alias ? `${it.name} als ${it.alias}` : it.name;
}

/**
 * `verwende { … } aus "…"` in der **Formatter-kanonischen** Form rendern:
 * IMMER mehrzeilig, jedes Item auf eigener, 4-fach eingerückter Zeile mit
 * Trailing-Komma, `}` auf eigener Zeile. Genau das, was der Formatter
 * idempotent erzeugt (empirisch verifiziert) → der Edit übersteht ein
 * nachgelagertes `format` unverändert (AK „Formatter-idempotent").
 */
function renderVerwende(
    source: string, items: ReadonlyArray<{ name: string; alias?: string }>,
): string {
    const body = items.map((it) => `    ${renderItem(it)},`).join('\n');
    return `verwende {\n${body}\n} aus "${source}"`;
}

/** Deterministischer Code-Unit-Vergleich (locale-unabhängig → stabil über
 *  Umgebungen, wichtig für die Determinismus-/Idempotenz-Garantie). */
function cmp(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
}

export class FindslCodeActionProvider implements CodeActionProvider {

    getCodeActions(
        document: LangiumDocument, params: CodeActionParams,
    ): MaybePromise<Array<Command | CodeAction> | undefined> {
        const actions: CodeAction[] = [];
        for (const diag of params.context.diagnostics) {
            const code = typeof diag.code === 'string' ? diag.code : undefined;
            if (!code) continue;
            switch (code) {
                case 'findsl.fehlende-quelle': {
                    const a = this.fixAddQuelle(document, diag);
                    if (a) actions.push(a);
                    break;
                }
                case 'findsl.builtin-import':
                case 'findsl.symbol-nicht-exportiert': {
                    const a = this.fixRemoveImportSymbol(document, diag, code);
                    if (a) actions.push(a);
                    break;
                }
                case 'findsl.ungenutzt': {
                    // (#90/1) Nur ungenutzte IMPORTE — dieselbe Diagnose gilt
                    // auch für Params/var/Decls (dort kein Import-Fix).
                    const a = this.fixRemoveUnusedImport(document, diag);
                    if (a) actions.push(a);
                    break;
                }
            }
        }
        // (#90/2) Nicht-diagnose-getrieben: „Importe organisieren" (Refactor
        // bzw. source.organizeImports), verfügbar wenn das angeforderte
        // `only`-Kind es zulässt.
        const organize = this.organizeImports(document, params);
        if (organize) actions.push(organize);
        // (#90/3) Refactor: markierten Ausdruck in eine neue Top-Level-konst
        // heben (RefactorExtract).
        const extract = this.extractConstant(document, params);
        if (extract) actions.push(extract);
        return actions;
    }

    // --- Fix: @Quelle("") einfügen ---------------------------------------

    private fixAddQuelle(
        document: LangiumDocument, diag: Diagnostic,
    ): CodeAction | undefined {
        // Diagnostic hängt am Konst-Namen → enclosing KonstDecl finden.
        const decl = this.astNodeAt(document, diag.range);
        const konst = decl && this.enclosingKonst(decl);
        if (!konst?.$cstNode) return undefined;

        // Einfügeposition: Anfang der `konst`-Keyword-Zeile, gleiche Einrückung.
        const konstLeaf = CstUtils.flattenCst(konst.$cstNode)
            .find((l) => l.text === 'konst');
        if (!konstLeaf) return undefined;
        const line = konstLeaf.range.start.line;
        const indent = ' '.repeat(konstLeaf.range.start.character);

        const insert: TextEdit = {
            range: { start: { line, character: 0 }, end: { line, character: 0 } },
            newText: `${indent}@Quelle("Quelle angeben")\n`,
        };
        return {
            title: '@Quelle-Annotation hinzufügen',
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            isPreferred: true,
            edit: { changes: { [document.uri.toString()]: [insert] } },
        };
    }

    private enclosingKonst(node: AstNode): (AstNode & { name?: string }) | undefined {
        let n: AstNode | undefined = node;
        while (n) {
            if (n.$type === 'KonstDecl') return n as AstNode & { name?: string };
            n = n.$container as AstNode | undefined;
        }
        return undefined;
    }

    // --- Fix: Symbol aus verwende-Import entfernen -----------------------

    private fixRemoveImportSymbol(
        document: LangiumDocument, diag: Diagnostic, code: string,
    ): CodeAction | undefined {
        const data = diag.data as { sourceName?: string } | undefined;
        const sourceName = data?.sourceName;
        if (!sourceName) return undefined;

        const node = this.astNodeAt(document, diag.range);
        const multi = node && this.enclosingImportDecl(node);
        if (!multi?.$cstNode) return undefined;

        const remaining = multi.items
            .filter((it) => it.name !== sourceName)
            .map((it) => (it.alias ? `${it.name} als ${it.alias}` : it.name));

        const declRange = multi.$cstNode.range;
        let edit: TextEdit;
        if (remaining.length === 0) {
            // Einziges Symbol → den GANZEN Decl (mehrzeilig!) inkl. Zeilen-
            // umbruch tilgen. `end.line + 1`, NICHT `start.line + 1` — sonst
            // bliebe bei der Mehrzeilen-Form ein unparsebarer Rumpf stehen
            // (PR #129-Review HIGH).
            edit = {
                range: {
                    start: { line: declRange.start.line, character: 0 },
                    end:   { line: declRange.end.line + 1, character: 0 },
                },
                newText: '',
            };
        } else {
            edit = {
                range: declRange,
                newText: `verwende { ${remaining.join(', ')} } aus "${multi.source}"`,
            };
        }

        const label = code === 'findsl.builtin-import'
            ? `Eingebautes "${sourceName}" aus Import entfernen`
            : `Nicht-exportiertes "${sourceName}" aus Import entfernen`;
        return {
            title: label,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            isPreferred: true,
            edit: { changes: { [document.uri.toString()]: [edit] } },
        };
    }

    private enclosingImportDecl(node: AstNode): ImportDecl | undefined {
        let n: AstNode | undefined = node;
        while (n) {
            if (isImportDecl(n)) return n;
            n = n.$container as AstNode | undefined;
        }
        return undefined;
    }

    // --- (#90/1) Refactor: ungenutzten Import entfernen ------------------

    private fixRemoveUnusedImport(
        document: LangiumDocument, diag: Diagnostic,
    ): CodeAction | undefined {
        // Die `findsl.ungenutzt`-Diagnose hängt am ungenutzten Knoten —
        // nur wenn das ein `verwende`-Item ist, gibt es einen Import-Fix
        // (Params/var/Decls bleiben unberührt).
        const node = this.astNodeAt(document, diag.range);
        const item = node && this.enclosingImportItem(node);
        if (!item) return undefined;
        const decl = this.enclosingImportDecl(item);
        if (!decl?.$cstNode || !decl.source) return undefined;

        const remaining = decl.items.filter((it) => it !== item);
        const range = decl.$cstNode.range;
        const edit: TextEdit = remaining.length === 0
            // Einziges Symbol → den GANZEN (mehrzeiligen) Decl inkl. Umbruch
            // tilgen — `end.line + 1`, sonst bleibt bei der Mehrzeilen-Form
            // ein unparsebarer Rumpf stehen (PR #129-Review HIGH).
            ? {
                range: {
                    start: { line: range.start.line, character: 0 },
                    end: { line: range.end.line + 1, character: 0 },
                },
                newText: '',
            }
            : { range, newText: renderVerwende(decl.source, remaining) };

        return {
            title: `Ungenutzten Import "${item.name}" entfernen`,
            kind: CodeActionKind.QuickFix,
            diagnostics: [diag],
            isPreferred: true,
            edit: { changes: { [document.uri.toString()]: [edit] } },
        };
    }

    private enclosingImportItem(node: AstNode): ImportItem | undefined {
        let n: AstNode | undefined = node;
        while (n) {
            if (isImportItem(n)) return n;
            n = n.$container as AstNode | undefined;
        }
        return undefined;
    }

    // --- (#90/2) Refactor: Importe organisieren --------------------------

    private organizeImports(
        document: LangiumDocument, params: CodeActionParams,
    ): CodeAction | undefined {
        if (!this.kindAllowed(params, CodeActionKind.SourceOrganizeImports)) return undefined;
        const program = document.parseResult?.value as Program | undefined;
        const imports = (program?.imports ?? []).filter((i) => i.$cstNode && i.source);
        if (imports.length === 0) return undefined;

        // Kommentar/Trivia zwischen Import-Blöcken? Dann NICHT anbieten — die
        // Region-Ersetzung würde solche Hidden-Trivia (Kommentare) tilgen
        // (Content-Loss). Lieber keine Aktion als stille Löschung
        // (PR #129-Review MEDIUM-1).
        for (let i = 0; i + 1 < imports.length; i++) {
            const gap = document.textDocument.getText({
                start: imports[i].$cstNode!.range.end,
                end: imports[i + 1].$cstNode!.range.start,
            });
            if (gap.trim() !== '') return undefined;
        }

        // Modul-lokale Referenzen (NUR Decl-Bodies, NICHT der Import-Block —
        // sonst zählte ein Import sich durch seine eigene Deklaration). Gleiche
        // Grundlage wie der „ungenutzt"-Hint des Validators (checkUnused), damit
        // Organize und Quick-Fix konsistent dasselbe als ungenutzt einstufen.
        const used = new Set<string>();
        for (const decl of program?.decls ?? []) collectRefs(decl, used);
        // Ein Item gilt als genutzt, wenn sein lokaler Name (Alias, sonst Name)
        // im Modul referenziert wird.
        const isUsed = (it: ImportItem): boolean => used.has(it.alias ?? it.name);

        // Nach Quelle mergen (identische Bindungen dedupliziert), ungenutzte
        // Items entfernen (TS-Parität zu „Organize Imports"), Quellen und
        // Symbole alphabetisch (code-unit, deterministisch) sortieren.
        const bySource = new Map<string, Map<string, ImportItem>>();
        for (const imp of imports) {
            let m = bySource.get(imp.source);
            if (!m) { m = new Map(); bySource.set(imp.source, m); }
            for (const it of imp.items) {
                if (it?.name && isUsed(it) && !m.has(renderItem(it))) m.set(renderItem(it), it);
            }
        }
        // Quellen, deren Items komplett ungenutzt waren, fallen ganz weg.
        const sources = [...bySource.keys()].filter((s) => bySource.get(s)!.size > 0).sort(cmp);
        const newText = sources
            .map((src) => {
                const items = [...bySource.get(src)!.values()]
                    .sort((a, b) => cmp(renderItem(a), renderItem(b)));
                return renderVerwende(src, items);
            })
            .join('\n');

        // Region = erster Import-Start … letzter Import-Ende. Bleibt KEIN
        // Import übrig, auch die nachfolgende Zeilenumbruch-Trivia schlucken,
        // damit keine Leerzeile zurückbleibt (analog zum Einzel-Quick-Fix).
        const lastEnd = imports[imports.length - 1].$cstNode!.range.end;
        const region: Range = {
            start: imports[0].$cstNode!.range.start,
            end: sources.length === 0 ? { line: lastEnd.line + 1, character: 0 } : lastEnd,
        };
        // Schon organisiert → keine No-op-Aktion anbieten.
        if (document.textDocument.getText(region) === newText) return undefined;

        return {
            title: 'Importe organisieren',
            kind: CodeActionKind.SourceOrganizeImports,
            edit: { changes: { [document.uri.toString()]: [{ range: region, newText }] } },
        };
    }

    // --- (#90/3) Refactor: Konstante extrahieren -------------------------

    private extractConstant(
        document: LangiumDocument, params: CodeActionParams,
    ): CodeAction | undefined {
        if (!this.kindAllowed(params, CodeActionKind.RefactorExtract)) return undefined;
        const program = document.parseResult?.value as Program | undefined;
        if (!program?.$cstNode) return undefined;

        // Innersten Ausdruck finden, der die Selektion vollständig enthält.
        const expr = this.smallestExprCovering(program, document, params.range);
        if (!expr?.$cstNode) return undefined;

        // Bereits eine benannte Top-Level-Referenz (`FOO`) → Extraktion sinnlos.
        const globals = this.globalNames(program);
        if (isCallChain(expr) && (expr.chain?.length ?? 0) === 0
            && expr.name && globals.has(expr.name)) return undefined;

        // Nur einzeilige Ausdrücke (mehrzeilige würde der Formatter umbrechen
        // → Idempotenz-Risiko; bewusst außerhalb von Phase B).
        const exprText = document.textDocument.getText(expr.$cstNode.range);
        if (exprText.includes('\n')) return undefined;

        // Freie Wurzel-Bezeichner müssen ALLE global sein — sonst referenziert
        // der Ausdruck einen Parameter / eine `let`-Bindung und eine
        // Top-Level-`konst` wäre nicht auflösbar. (Konservativ: in Lambda/
        // `für jeden` lokal gebundene Namen blocken ebenfalls — sicherer
        // False-Negative.)
        for (const root of this.freeRoots(expr)) {
            if (!globals.has(root) && !isBuiltinName(root)) return undefined;
        }

        // Typ inferieren → gültige FinDSL-Annotation. unknown/never/nichts →
        // nicht annotierbar, kein Angebot.
        const type = collectExpressionTypes(program).get(expr);
        if (!type || !this.isAnnotatable(type)) return undefined;

        // Umschließende Top-Level-Decl = Einfügepunkt (davor, damit die neue
        // konst in Quellreihenfolge VOR ihrer Verwendung steht).
        const topDecl = this.enclosingTopLevelDecl(program, expr);
        if (!topDecl?.$cstNode) return undefined;

        const name = this.freshConstName(globals);
        const insertPos = { line: topDecl.$cstNode.range.start.line, character: 0 };
        const konstLine = `konst ${name}: ${typeToString(type)} = ${exprText}\n`;
        const uri = document.uri.toString();
        return {
            title: 'Konstante extrahieren',
            kind: CodeActionKind.RefactorExtract,
            edit: { changes: { [uri]: [
                { range: { start: insertPos, end: insertPos }, newText: konstLine },
                { range: expr.$cstNode.range, newText: name },
            ] } },
        };
    }

    /** Kleinster Expr-Knoten, dessen CST-Bereich die Selektion umschließt. */
    private smallestExprCovering(
        program: Program, document: LangiumDocument, range: Range,
    ): Expr | undefined {
        const selStart = document.textDocument.offsetAt(range.start);
        const selEnd = document.textDocument.offsetAt(range.end);
        let best: { node: Expr; span: number } | undefined;
        for (const node of AstUtils.streamAllContents(program)) {
            if (!isExpr(node) || !node.$cstNode) continue;
            const { offset, end } = node.$cstNode;
            if (offset <= selStart && end >= selEnd) {
                const span = end - offset;
                if (!best || span < best.span) best = { node, span };
            }
        }
        return best?.node;
    }

    /** Erste Decl auf dem Weg nach oben, deren Container das Programm ist. */
    private enclosingTopLevelDecl(program: Program, node: AstNode): AstNode | undefined {
        let n: AstNode | undefined = node;
        while (n?.$container && n.$container !== program) n = n.$container;
        return n?.$container === program ? n : undefined;
    }

    /** Top-Level-sichtbare Namen: Decls, Aufzählungswerte, Importe. */
    private globalNames(program: Program): Set<string> {
        const names = new Set<string>();
        for (const d of program.decls) {
            const nm = (d as { name?: string }).name;
            if (nm) names.add(nm);
            if (isAufzaehlungDecl(d)) for (const v of d.values) names.add(v);
        }
        for (const b of analyzeImports(program).bindings) names.add(b.localName);
        return names;
    }

    /** Freie Wurzel-Bezeichner eines Ausdrucks: CallChain-Wurzeln +
     *  `${…}`-Interpolations-Wurzeln (NICHT Feld-/Methodennamen). */
    private freeRoots(expr: AstNode): Set<string> {
        const roots = new Set<string>();
        const slotRe = /\$\{\s*([\p{L}_][\p{L}\p{N}_]*)/gu;
        const visit = (n: AstNode): void => {
            if (isCallChain(n) && n.name) roots.add(n.name);
            if (isStringLiteral(n) && n.value) {
                for (const m of n.value.matchAll(slotRe)) roots.add(m[1]);
            }
        };
        visit(expr);
        for (const n of AstUtils.streamAllContents(expr)) visit(n);
        return roots;
    }

    /** `typeToString(t)` ist eine gültige FinDSL-Annotation? */
    private isAnnotatable(t: Type): boolean {
        switch (t.kind) {
            case 'unknown': case 'never': case 'nichts': return false;
            case 'nullable':  return this.isAnnotatable(t.inner);
            case 'list':      return this.isAnnotatable(t.element);
            case 'function':  return t.params.every((p) => this.isAnnotatable(p))
                && this.isAnnotatable(t.result);
            default:          return true; // primitive | record | enum
        }
    }

    /** Eindeutiger UPPER_SNAKE-Name (SPEC § 2.5), kollisionsfrei. */
    private freshConstName(taken: ReadonlySet<string>): string {
        const base = 'EXTRAHIERT';
        if (!taken.has(base)) return base;
        for (let i = 2; ; i++) {
            const c = `${base}_${i}`;
            if (!taken.has(c)) return c;
        }
    }

    /** `params.context.only` respektieren: ohne Filter alles erlaubt, sonst
     *  nur, wenn ein angefordertes Kind dieses (als Präfix) abdeckt. */
    private kindAllowed(params: CodeActionParams, kind: string): boolean {
        const only = params.context.only;
        if (!only || only.length === 0) return true;
        return only.some((k) => kind === k || kind.startsWith(`${k}.`));
    }

    // --- Helfer ----------------------------------------------------------

    private astNodeAt(document: LangiumDocument, range: Range): AstNode | undefined {
        const root = document.parseResult?.value?.$cstNode;
        if (!root) return undefined;
        const offset = document.textDocument.offsetAt(range.start);
        const leaf = CstUtils.findLeafNodeAtOffset(root, offset);
        return leaf?.astNode;
    }
}
