/**
 * Inlay-Hint-Provider für FinDSL (LSP `textDocument/inlayHint`).
 *
 * Zwei Hint-Sorten, beide auf Audit-Lesbarkeit ausgerichtet:
 *
 *  1. **Parameter-Namen** an positionalen Aufruf-Argumenten —
 *     `estEinkommensteuer(60_000, Splitting)` zeigt inline
 *     `zve: 60_000, art: Splitting`. Für Sachbearbeiter:innen, die eine
 *     Berechnung lesen, ohne die Signatur nachzuschlagen.
 *
 *  2. **Inferierte Einheit** hinter blanken Zahl-Literalen, wenn der
 *     Parameter-Typ ein Geld-/Prozent-Typ ist — Geldtypen als
 *     Währungssymbol (`50.000` → `€` für Euro/EuroCent, `250` → `¢`
 *     für Cent), `Prozent` als Typname. Greift an Aufruf-/Konstruktor-
 *     Argumenten UND an `konst`/`var`-Deklarationen sowie `datensatz`-
 *     Feld- und `fn`-Parameter-Defaults mit Geldtyp — macht
 *     Designprinzip P3 (Einheiten im Typsystem) durchgängig sichtbar.
 *
 * Aufgelöst werden `fn`-Aufrufe und `datensatz`-Konstruktoren, lokal und
 * über `verwende`-Importe, plus Builtin-Funktionen. Bewusst eng gehalten
 * (positionale Argumente bis zum ersten benannten Argument) — lieber
 * keinen Hint als einen falsch zugeordneten.
 */

import {
    type AstNode,
    type LangiumDocument,
    type LangiumDocuments,
    AstUtils,
    interruptAndCheck,
} from 'langium';
import { AbstractInlayHintProvider, type InlayHintAcceptor } from 'langium/lsp';
import {
    InlayHintKind,
    type InlayHint,
    type InlayHintParams,
    CancellationToken,
} from 'vscode-languageserver';
import {
    type Expr,
    isBeispiel,
    isBinaryOp,
    isCall,
    isCallChain,
    isCast,
    isDatensatzDecl,
    isField,
    type FunktionBody,
    isFuerExpr,
    isFunktionDecl,
    isKonstDecl,
    isLambda,
    isLetStmt,
    isNumberLiteral,
    isParenChain,
    isParam,
    isUnaryOp,
    isWaehleExpr,
    isWennExpr,
    type Program,
} from './generated/ast.js';
import {
    analyzeImports, buildModuleHeader, asImportResolver,
    type ModuleHeaderRegistry,
} from './findsl-scope.js';
import { findModuleInWorkspace } from './findsl-definition.js';
import { BUILTIN_FUNCTION_DEFS } from './findsl-stdlib.js';
import { collectExpressionTypes, type Type, type ImportResolver } from './findsl-types.js';
import type { FindslServices } from './findsl-module.js';

/** Signatur eines aufrufbaren Symbols: Parameter-/Feld-Namen (für die
 *  Namens-Hints an positionalen Argumenten). Einheiten kommen aus dem
 *  Type-Checker (`collectExpressionTypes`), nicht mehr aus der Signatur. */
interface Callable {
    readonly names: ReadonlyArray<string>;
}

const BUILTIN_CALLABLES: ReadonlyMap<string, Callable> = new Map(
    BUILTIN_FUNCTION_DEFS.map((f) => {
        // signature: "fn name(p: Typ, ...): R" → Parameter-Namen.
        const inner = f.signature.slice(
            f.signature.indexOf('(') + 1, f.signature.lastIndexOf(')'),
        );
        const names = inner.split(',').map((s) => s.trim()).filter(Boolean)
            .map((part) => part.split(':')[0].trim());
        return [f.name, { names }] as const;
    }),
);

export class FindslInlayHintProvider extends AbstractInlayHintProvider {

    private readonly documents: LangiumDocuments;
    /** Pro Request gefüllt: Ausdruck-Knoten → effektiver Typ
     *  (vom Type-Checker, kontextuell). */
    private typeMap: Map<AstNode, Type> = new Map();

    constructor(services: FindslServices) {
        super();
        this.documents = services.shared.workspace.LangiumDocuments;
    }

    /**
     * Überschreibt die Default-Traversierung: Langiums Basis prunet auf
     * `params.range` (Sichtbereich), wodurch Hints beim Scrollen
     * flackern (mehrzeilige `fn`/`datensatz` werden teilweise
     * abgeschnitten). FinDSL-Dateien sind klein → wir streamen den
     * GANZEN AST (range-unabhängig, stabil). Pro-Knoten-`try/catch`
     * hält Teil-Parse-Knoten davon ab, die ganze Antwort zu kippen.
     */
    override async getInlayHints(
        document: LangiumDocument,
        _params: InlayHintParams,
        cancelToken: CancellationToken = CancellationToken.None,
    ): Promise<InlayHint[] | undefined> {
        const root = document.parseResult?.value;
        if (!root) return undefined;
        // Effektive Ausdruckstypen einmal pro Request vom Type-Checker
        // sammeln (kontextuell; deckt Vergleiche/`testfall` etc. ab).
        try {
            // Mit Cross-Modul-Resolver: importierte Funktions-/
            // Datensatz-Typen (z. B. Geld-Rückgaben aus dem Quellmodul
            // eines `.test`-Moduls) werden echt aufgelöst statt
            // `unknown` → Geld-Inlay-Hints erscheinen auch im Test-Modul.
            this.typeMap = collectExpressionTypes(root as Program, {
                importResolver: this.buildImportResolver(root as Program),
            });
        } catch {
            this.typeMap = new Map();   // Teil-Parse: ohne Typen weiter
        }
        const hints: InlayHint[] = [];
        const acceptor: InlayHintAcceptor = (h) => hints.push(h);
        for (const node of AstUtils.streamAst(root)) {
            await interruptAndCheck(cancelToken);
            try {
                this.computeInlayHint(node, acceptor);
            } catch {
                // Teil-Parse: einzelnen Knoten überspringen, Rest liefern.
            }
        }
        return hints;
    }

    computeInlayHint(node: AstNode, acceptor: InlayHintAcceptor): void {
        // Wert-Träger mit Geldtyp: Währungssymbol hinter die Geld-Leaves
        // des Wert-Ausdrucks. Welcher Knoten Geld ist, sagt der
        // Type-Checker (this.typeMap) — kontextuell, deckt auch
        // Vergleiche/`testfall` ab.
        if (isKonstDecl(node) || isLetStmt(node)) {
            this.emitMoney(node.value, acceptor);
            return;
        }
        if (isField(node) || isParam(node)) {
            this.emitMoney(node.default, acceptor);
            return;
        }
        if (isFunktionDecl(node)) {
            this.emitMoney(bodyResultExpr(node.body), acceptor);
            return;
        }
        if (isBeispiel(node)) {                    // testfall-Block-Assertion
            this.emitMoney(node.body?.result, acceptor);
            return;
        }
        if (isFuerExpr(node)) {                    // für-jeden-Body-Ergebnis
            this.emitMoney(node.body?.result, acceptor);
            return;
        }
        if (isLambda(node) && node.params.length > 0) {  // Closure-Ergebnis
            this.emitMoney(node.result, acceptor);
            return;
        }

        if (!isCallChain(node) || !node.name) return;
        const call = node.chain[0];
        if (!call || !isCall(call)) return;        // nur direkter Aufruf/Ctor

        const program = AstUtils.getDocument(node).parseResult?.value as Program | undefined;
        if (!program) return;
        const callable = this.resolveCallable(program, node.name);
        if (!callable) return;

        call.args.forEach((arg, i) => {
            const value = arg.value;
            const startCst = value?.$cstNode;
            if (!startCst) return;

            // Geld-Symbol für den Argument-Wert (auch benannt) — Typ
            // kommt aus dem Type-Checker.
            this.emitMoney(value, acceptor);

            // Namens-Hint NUR vor positionalen Argumenten (bei `feld =`
            // ist der Name schon sichtbar).
            if (arg.name) return;
            if (i >= callable.names.length) return;
            acceptor({
                position: startCst.range.start,
                label: `${callable.names[i]}:`,
                kind: InlayHintKind.Parameter,
                paddingRight: true,
            });
        });
    }

    /**
     * Emittiert das Währungssymbol an den Geld-Leaves eines Wert-
     * Ausdrucks. Ob ein Knoten Geld ist, sagt der Type-Checker
     * (`this.typeMap`, kontextuell). Die Struktur-Rekursion steuert nur
     * die PLATZIERUNG: `+`/`-`/unär-`-`/Vergleich → in die Operanden;
     * `wenn`/`wähle` → in Zweige/Arme; `als`-Cast → bewusst NICHT (Typ
     * explizit sichtbar); Elvis `(a oder b)` → EIN Symbol nach `)`
     * (CST-Range schließt die Klammern ein), keine Rekursion in die
     * Operanden; sonst Leaf (Literal, Referenz, Feldzugriff, Aufruf-
     * resultat) → ein Symbol am Knoten-Ende, falls Geldtyp.
     */
    private emitMoney(expr: Expr | undefined, acceptor: InlayHintAcceptor): void {
        if (!expr) return;
        const emitLeaf = (): void => {
            const sym = moneySymbol(this.typeMap.get(expr));
            const cst = expr.$cstNode;
            if (sym && cst) {
                acceptor({
                    position: cst.range.end,
                    label: sym,
                    kind: InlayHintKind.Type,
                    paddingLeft: true,
                });
            }
        };
        if (isBinaryOp(expr)) {
            const op = expr.op;
            if (op === '+' || op === '-'
                || op === '==' || op === '!=' || op === '<'
                || op === '<=' || op === '>' || op === '>=') {
                this.emitMoney(expr.left, acceptor);
                this.emitMoney(expr.right, acceptor);
                return;
            }
            if (op === 'oder') { emitLeaf(); return; }   // Elvis: ein Symbol
            return;                                       // `und` etc.: nichts
        }
        if (isUnaryOp(expr)) {
            if (expr.op === '-') this.emitMoney(expr.operand, acceptor);
            return;
        }
        if (isWennExpr(expr)) {
            this.emitMoney(expr.then, acceptor);
            this.emitMoney(expr.else, acceptor);
            return;
        }
        if (isWaehleExpr(expr)) {
            for (const arm of expr.arms) this.emitMoney(arm.result, acceptor);
            return;
        }
        if (isCast(expr)) return;                          // `als`: bewusst aus
        // `ParenChain` (`(a*b).abrunden()`) ist wie `CallChain` ein
        // Leaf: ein Geld-Symbol am Ergebnis (Typ aus dem Type-Checker).
        if (isNumberLiteral(expr) || isCallChain(expr) || isParenChain(expr)) {
            emitLeaf();
        }
    }

    /**
     * Löst einen Aufruf-Namen zu seiner Signatur auf: lokale/importierte
     * `fn` und `datensatz`-Konstruktoren sowie Builtin-Funktionen.
     */
    private resolveCallable(program: Program, name: string): Callable | undefined {
        const builtin = BUILTIN_CALLABLES.get(name);
        if (builtin) return builtin;

        const decl = this.lookupDecl(program, name);
        if (decl && isFunktionDecl(decl)) {
            return { names: decl.params.map((p) => p.name) };
        }
        if (decl && isDatensatzDecl(decl)) {
            return { names: decl.fields.map((f) => f.name) };
        }
        return undefined;
    }

    /**
     * Cross-Modul-Resolver aus den im Workspace vorhandenen Quell-
     * modulen der `verwende`-Importe. Ohne ihn binden Importe als
     * `unknown` → importierte Geld-Rückgabetypen blieben unsichtbar
     * (keine €/¢-Inlay-Hints in `.test`-Modulen). `undefined`, wenn
     * keine auflösbaren Importe → Single-Module-Verhalten unverändert.
     */
    private buildImportResolver(program: Program): ImportResolver | undefined {
        const headers = new Map<string, ReturnType<typeof buildModuleHeader>>();
        for (const b of analyzeImports(program).bindings) {
            if (!b.resolvedPath || headers.has(b.resolvedPath)) continue;
            const prog = findModuleInWorkspace(this.documents, b.resolvedPath);
            if (prog) headers.set(b.resolvedPath, buildModuleHeader(prog));
        }
        if (headers.size === 0) return undefined;
        const registry: ModuleHeaderRegistry = {
            lookup: (k) => (k ? headers.get(k) : undefined),
        };
        return asImportResolver(registry);
    }

    /** Top-Level-Decl lokal, dann über `verwende`-Importe im Workspace. */
    private lookupDecl(program: Program, name: string): AstNode | undefined {
        for (const d of program.decls) {
            if (d.name === name) return d;
        }
        const binding = analyzeImports(program).bindings.find((b) => b.localName === name);
        if (!binding) return undefined;
        const src = findModuleInWorkspace(this.documents, binding.resolvedPath);
        return src?.decls.find((d) => d.name === binding.sourceName);
    }
}

/**
 * Währungssymbol für einen (ggf. nullable) Geldtyp: `Euro`/`EuroCent`
 * → `€`, `Cent` → `¢`; sonst (Prozent, Zahl, Nicht-Geld) `undefined`
 * (kein Symbol). `Prozent` bleibt absichtlich ohne Inlay (das `%` ist
 * an Literalen ohnehin sichtbar; Symbol-Rauschen vermeiden).
 */
function moneySymbol(t: Type | undefined): string | undefined {
    let cur = t;
    while (cur && cur.kind === 'nullable') cur = cur.inner;
    if (!cur || cur.kind !== 'primitive') return undefined;
    if (cur.name === 'Euro' || cur.name === 'EuroCent') return '€';
    if (cur.name === 'Cent') return '¢';
    return undefined;
}

/**
 * Der für den Rückgabetyp relevante Ausdruck eines `fn`-Rumpfs:
 * `= expr` direkt, bei Block-/Lambda-Rumpf dessen `result`.
 */
function bodyResultExpr(body: FunktionBody | undefined): Expr | undefined {
    if (!body) return undefined;
    if (body.block) return body.block.result;
    const e = body.expr;
    if (e && isLambda(e)) return e.result;
    return e;
}
