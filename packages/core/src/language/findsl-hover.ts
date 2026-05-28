/**
 * Hover-Provider für FinDSL.
 *
 * Liefert beim Hover über einen Identifier oder eine Deklaration eine
 * Markdown-Karte mit:
 *   - Signatur (`konst X: T`, `fn f(p: T): R`, `datensatz D(...)`)
 *   - Doc-Kommentar (`-- ... --`), entkleidet von den Markern und mit
 *     erhaltener Markdown-Formatierung
 *   - `@Quelle("...")`-Zitation als zusätzliche Zeile, damit der Nutzer
 *     direkt sieht, an welchem Paragraphen die Decl hängt
 *
 * Da die FinDSL-Grammatik keine `cross-references` deklariert (alle
 * Identifier sind einfache `ID`-Tokens), kann der Standard-
 * `AstNodeHoverProvider` keine Auflösung finden. Wir implementieren die
 * Symbol-Auflösung daher direkt: Top-Level-Namen werden gegen die
 * Modul-Decls + Builtin-Aufzählungen + Builtin-Funktionen gematcht.
 *
 * Skelett-Grenzen:
 *   - Cross-Modul-Auflösung ist NICHT eingebaut. Ein `verwende {x} aus
 *     a.b`-Identifier liefert (noch) keinen Hover-Inhalt aus a.b.
 *   - Field-Access-Hover (`person.adresse.straße`) braucht Typ-Inferenz am
 *     Cursor und ist hier ausgeklammert. Field-Decls bekommen Hover
 *     trotzdem, wenn der Cursor direkt auf der Deklaration steht.
 */

import {
    type AstNode,
    type CstNode,
    type LangiumDocument,
    type LangiumDocuments,
    CstUtils,
} from 'langium';
import { AstNodeHoverProvider } from 'langium/lsp';
import type { Hover, HoverParams } from 'vscode-languageserver';
import {
    isAbbruchExpr,
    isAusgabeStmt,
    isAufzaehlungDecl,
    isBlockExpr,
    isCall,
    isCallChain,
    isParenChain,
    isDatensatzDecl,
    isFieldAccess,
    isField,
    isForceUnwrap,
    isFuerExpr,
    isFunktionDecl,
    isKonstDecl,
    isLambda,
    isLetStmt,
    isParam,
    isSafeFieldAccess,
    isStringLiteral,
    type AufzaehlungDecl,
    type CallChain,
    type ChainOp,
    type DatensatzDecl,
    type DeclPrefix,
    type Expr,
    type Field,
    type FunktionDecl,
    type KonstDecl,
    type Param,
    type Program,
    type Type as TypeAnnotation,
    type TypeAtom,
} from './generated/ast.js';
import { analyzeImports, buildModuleHeader } from './findsl-scope.js';
import { parseDocTags, stripDocMarkers as stripMarkersShared } from './doc-tags.js';
import {
    buildLocalScope,
    elementOfListLike,
    inferExprQuiet,
    inferHOFElementType,
    inferReceiverElementType,
    resolveAnnotationWithImports,
    stepChainOp,
} from './findsl-local-scope.js';
import { renderDocForHover, type QuelleAnnotation } from './doc-hover-renderer.js';
import * as path from 'node:path';
import {
    BUILTIN_ENUM_DEFS,
    BUILTIN_FUNCTION_DEFS,
    BUILTIN_PRIMITIVE_DOCS,
} from './findsl-stdlib.js';
import { findMethodDef } from './findsl-method-defs.js';
import type { BuiltinMethodDef } from './findsl-stdlib.js';
import {
    infer,
    resolveTypeAnnotation,
    TNull,
    TUnknown,
    TypeEnv,
    type Type,
    type TypeContext,
} from './findsl-types.js';
import type { FindslServices } from './findsl-module.js';

// ---------------------------------------------------------------------------
// Builtins ohne Source-Doc-Kommentar — synthetische Hover-Beschreibungen
// ---------------------------------------------------------------------------

interface BuiltinDoc {
    readonly signature: string;
    readonly doc:       string;
    readonly quelle?:   string;
}

const BUILTIN_FUNCTIONS: ReadonlyMap<string, BuiltinDoc> = new Map(
    BUILTIN_FUNCTION_DEFS.map((f) => [f.name, {
        signature: f.signature,
        doc:       f.doc,
        quelle:    f.quelle,
    }] as const),
);

interface BuiltinEnum {
    readonly signature: string;
    readonly doc:       string;
    readonly quelle:    string;
    readonly values:    ReadonlyArray<string>;
}

const BUILTIN_ENUMS: ReadonlyMap<string, BuiltinEnum> = new Map(
    BUILTIN_ENUM_DEFS.map((e) => [e.name, {
        signature: `aufzählung ${e.name} { ${e.values.join(', ')} }`,
        doc:       e.doc,
        quelle:    e.quelle,
        values:    e.values,
    }] as const),
);

// Aufzählungs-Wert → enthaltender Aufzählungs-Typ (für Hover auf `Grundtarif`)
const BUILTIN_ENUM_VALUES: ReadonlyMap<string, string> = (() => {
    const m = new Map<string, string>();
    for (const [enumName, e] of BUILTIN_ENUMS) {
        for (const v of e.values) m.set(v, enumName);
    }
    return m;
})();

// ---------------------------------------------------------------------------
// Resolved-Hover: schmale Datenstruktur, die der Provider als Zwischenform
// herumreicht. Trennt die "Was hovere ich?"-Logik (Lookup) von der
// "Wie formatiere ich das?"-Logik (Markdown).
// ---------------------------------------------------------------------------

type Resolved =
    | { kind: 'decl';              node: AstNode }
    | { kind: 'cross-decl';        node: AstNode; sourceModule: string }
    | { kind: 'builtin-fn';        name: string }
    | { kind: 'builtin-enum';      name: string }
    | { kind: 'builtin-value';     value: string; enumName: string }
    | { kind: 'builtin-method';    def: BuiltinMethodDef }
    | { kind: 'builtin-primitive'; name: string };

// ---------------------------------------------------------------------------
// HoverProvider
// ---------------------------------------------------------------------------

export class FindslHoverProvider extends AstNodeHoverProvider {

    protected readonly documents: LangiumDocuments;

    constructor(services: FindslServices) {
        super(services);
        this.documents = services.shared.workspace.LangiumDocuments;
    }

    override async getHoverContent(document: LangiumDocument, params: HoverParams): Promise<Hover | undefined> {
        const program = document.parseResult?.value as Program | undefined;
        const rootCst = program?.$cstNode;
        if (!program || !rootCst) return undefined;
        const offset = document.textDocument.offsetAt(params.position);

        // 1. Cursor auf einem ID-Token → identifier-getriebene Auflösung.
        const idNode = CstUtils.findDeclarationNodeAtOffset(
            rootCst, offset, this.grammarConfig.nameRegexp,
        );
        if (idNode) {
            const resolved = this.resolveIdToken(idNode, program);
            if (resolved) return formatResolved(resolved);
        }

        // 2. Fallback: AST-Knoten am Offset, falls der Cursor auf einer
        //    Keyword-Stelle einer Decl steht.
        const leaf = CstUtils.findLeafNodeAtOffset(rootCst, offset);
        if (leaf) {
            const ast = leaf.astNode;
            return formatResolved({ kind: 'decl', node: ast });
        }
        return undefined;
    }

    // Langium 4: liefert den Markdown-Inhalt als String; die Basisklasse
    // wickelt ihn selbst in ein `Hover`. Wird hier nur als abstrakter
    // Vertrag erfüllt — der eigentliche Pfad läuft über `getHoverContent`.
    protected override async getAstNodeHoverContent(node: AstNode): Promise<string | undefined> {
        const h = await formatResolved({ kind: 'decl', node });
        if (!h) return undefined;
        const c = h.contents;
        if (typeof c === 'string') return c;
        return 'value' in c ? c.value : undefined;
    }

    private resolveIdToken(idNode: CstNode, program: Program): Resolved | undefined {
        const ast = idNode.astNode;
        const text = idNode.text;

        // Direkter Decl-Hover: der Identifier IST der Name einer Decl.
        if (isKonstDecl(ast)       && ast.name === text) return { kind: 'decl', node: ast };
        if (isFunktionDecl(ast)    && ast.name === text) return { kind: 'decl', node: ast };
        if (isDatensatzDecl(ast)   && ast.name === text) return { kind: 'decl', node: ast };
        if (isAufzaehlungDecl(ast) && ast.name === text) return { kind: 'decl', node: ast };
        if (isField(ast)           && ast.name === text) return { kind: 'decl', node: ast };
        if (isParam(ast)           && ast.name === text) return { kind: 'decl', node: ast };

        // Cursor auf einem Field-Access-Identifier (z. B. `fall.tarifart`
        // oder `betrag.höchstens`). Erst auf Builtin-Methode prüfen (Geld/
        // Liste/Text/…), dann auf Datensatz-Feld — beide nutzen denselben
        // Typ-Stepper, scheitern aber an unterschiedlichen Empfänger-Arten.
        if ((isFieldAccess(ast) || isSafeFieldAccess(ast)) && ast.name === text) {
            const method = this.resolveBuiltinMethod(ast, program);
            if (method) return method;
            const field = this.resolveFieldAccess(ast, program);
            if (field) return { kind: 'decl', node: field };
        }

        // CallChain-Wurzel: resolve gegen lokale Decls + Imports + Builtins.
        if (isCallChain(ast) && ast.name === text) {
            return this.resolveName(program, text);
        }

        // Fallback für sonstige Identifier-Stellen.
        return this.resolveName(program, text);
    }

    /**
     * Findet eine Builtin-Methode (SPEC § 11), auf der der Cursor steht.
     * Spiegelbild zu `resolveFieldAccess`: gleicher Typ-Stepper für den
     * Empfänger-Typ, aber statt im Datensatz-Decl wird der zentrale
     * `findMethodDef`-Dispatch befragt. Liefert `undefined`, wenn der
     * Empfänger kein Builtin-Methoden-Träger ist (Record, unknown, …) —
     * dann fällt der Aufrufer auf `resolveFieldAccess` zurück.
     *
     * Behandelt sowohl `CallChain` (`a.höchstens(…)`) als auch `ParenChain`
     * (`(a + b).abrunden()`). Für ParenChain wird `infer` direkt auf den
     * geklammerten Receiver-Ausdruck gerufen — `inferBaseTypeAt` braucht
     * eine benannte Wurzel und passt dort nicht.
     */
    private resolveBuiltinMethod(field: ChainOp, program: Program): Resolved | undefined {
        const container = field.$container;
        const name = (field as { name?: string }).name;
        if (!name) return undefined;

        let baseType: Type | undefined;
        if (isCallChain(container)) {
            const idx = container.chain.indexOf(field);
            if (idx < 0) return undefined;
            baseType = inferBaseTypeAt(container, idx, program, this);
        } else if (isParenChain(container) && container.receiver) {
            const idx = container.chain.indexOf(field);
            if (idx < 0) return undefined;
            const header = buildModuleHeader(program);
            const ctx = header.context;
            const localEnv = buildLocalScope(
                container, ctx, program,
                (p, n) => this.resolveCrossModuleType(p, n),
            );
            let current: Type | undefined =
                infer(container.receiver, localEnv, ctx, () => {});
            for (let i = 0; i < idx; i++) {
                if (!current || current.kind === 'unknown') return undefined;
                current = stepChainOp(current, container.chain[i], true);
            }
            baseType = current;
        } else {
            return undefined;
        }
        if (!baseType) return undefined;

        const def = findMethodDef(baseType, name);
        if (!def) return undefined;
        return { kind: 'builtin-method', def };
    }

    /**
     * Findet die Field-Decl, auf der der Cursor steht. Inferiert dafür den
     * Typ der CallChain-Base **bis vor** dieser Chain-Op-Stelle und sucht
     * dann das Field mit passendem Namen im resultierenden Datensatz.
     *
     * Sicher-Zugriff (`?.`) ist transparent: wenn die Base `Pt?` ist, wird
     * für die Field-Suche temporär auf den Inner-Typ ausgepackt.
     */
    private resolveFieldAccess(field: ChainOp, program: Program): Field | undefined {
        const chain = field.$container;
        if (!isCallChain(chain)) return undefined;
        const idx = chain.chain.indexOf(field);
        if (idx < 0) return undefined;

        const fieldName = (field as { name?: string }).name;
        if (!fieldName) return undefined;

        const baseType = inferBaseTypeAt(chain, idx, program, this);
        if (!baseType) return undefined;
        const unwrapped = baseType.kind === 'nullable' ? baseType.inner : baseType;
        if (unwrapped.kind !== 'record') return undefined;

        return unwrapped.decl.fields.find((f) => f.name === fieldName);
    }

    /**
     * Resolved den Typ eines Cross-Modul-Identifiers (für die Field-Access-
     * Auflösung, wenn die Wurzel des CallChain importiert ist). Greift
     * dieselbe Logik wie `resolveCrossModule`, liefert aber den Type statt
     * der AST-Decl.
     */
    resolveCrossModuleType(program: Program, localName: string): Type | undefined {
        const { bindings } = analyzeImports(program);
        const binding = bindings.find((b) => b.localName === localName);
        if (!binding) return undefined;

        const sourceProgram = this.findModuleInWorkspace(binding.resolvedPath);
        if (!sourceProgram) return undefined;

        const header = buildModuleHeader(sourceProgram);
        return header.context.globals.lookup(binding.sourceName);
    }

    /**
     * Sucht in dieser Reihenfolge nach einem Identifier:
     *   1. lokale Top-Decls des aktuellen Moduls
     *   2. `verwende`-Importe: Lookup im Workspace nach dem Quell-Modul
     *      und Auflösung der dortigen Decl mit dem Original-Namen
     *   3. Builtin-Funktionen (`abrundenEuro`, ...)
     *   4. Builtin-Aufzählungen (`Tarifart`, ...) und ihre Werte
     */
    private resolveName(program: Program, name: string): Resolved | undefined {
        // 1. Lokal
        for (const decl of program.decls) {
            if (decl.name === name) return { kind: 'decl', node: decl };
        }

        // 2. Cross-Modul: schlage in den Imports nach.
        const crossResolved = this.resolveCrossModule(program, name);
        if (crossResolved) return crossResolved;

        // 3. + 4. Builtins
        if (BUILTIN_FUNCTIONS.has(name))      return { kind: 'builtin-fn',   name };
        if (BUILTIN_ENUMS.has(name))          return { kind: 'builtin-enum', name };
        if (BUILTIN_PRIMITIVE_DOCS.has(name)) return { kind: 'builtin-primitive', name };
        const enumName = BUILTIN_ENUM_VALUES.get(name);
        if (enumName)                          return { kind: 'builtin-value', value: name, enumName };
        return undefined;
    }

    /**
     * Sucht den Identifier in den `verwende`-Direktiven des aktuellen Moduls.
     * Findet er ein Binding, wird das Quell-Modul im Workspace gesucht und
     * die exportierte Decl mit dem (ggf. nicht-aliasierten) Originalnamen
     * geliefert. Modul nicht im Workspace → kein Hover (kein eager load).
     */
    private resolveCrossModule(program: Program, localName: string): Resolved | undefined {
        const { bindings } = analyzeImports(program);
        const binding = bindings.find((b) => b.localName === localName);
        if (!binding) return undefined;

        const sourceProgram = this.findModuleInWorkspace(binding.resolvedPath);
        if (!sourceProgram) return undefined;

        const decl = sourceProgram.decls.find((d) => d.name === binding.sourceName);
        if (!decl) return undefined;
        return { kind: 'cross-decl', node: decl, sourceModule: binding.rawSource };
    }

    /**
     * Iteriert durch alle im Langium-Workspace bekannten Dokumente und
     * findet das Programm mit passendem Modul-Namen. Workspace wird beim
     * Initial-Indexing der Extension gefüllt; on-demand-Laden machen wir
     * im Hover-Pfad bewusst nicht (sonst wird Hover async und langsam).
     */
    private findModuleInWorkspace(filePath: string | undefined): Program | undefined {
        if (!filePath) return undefined;
        const target = path.normalize(filePath);
        for (const doc of this.documents.all) {
            if (path.normalize(doc.uri.fsPath) === target) {
                return doc.parseResult?.value as Program | undefined;
            }
        }
        return undefined;
    }
}

// ---------------------------------------------------------------------------
// Schmaler Type-Stepper für Field-Access-Hover
// ---------------------------------------------------------------------------
//
// Dieser Walker macht NICHT was der vollständige Type-Checker macht — er
// inferiert nur den Typ einer CallChain-Base bis zu einer bestimmten
// Chain-Op-Stelle, mit den Operationen Call, FieldAccess, SafeFieldAccess,
// ForceUnwrap. Reicht für Field-Access-Hover und vermeidet, dass wir die
// volle Inferenz-Engine pro Hover-Request anwerfen.

function inferBaseTypeAt(
    chain: CallChain,
    untilIndex: number,
    program: Program,
    provider: FindslHoverProvider,
): Type | undefined {
    if (!chain.name) return undefined;

    const header = buildModuleHeader(program);
    const ctx = header.context;
    const localEnv = buildLocalScope(
        chain, ctx, program,
        (p, n) => provider.resolveCrossModuleType(p, n),
    );

    // Wurzel-Typ: lokal → Top-Level → Cross-Modul.
    let current: Type | undefined =
        localEnv.lookup(chain.name) ?? provider.resolveCrossModuleType(program, chain.name);
    if (!current) return undefined;
    // Cross-Modul-Datensatz-Symbol ist als Konstruktor-Funktionstyp
    // gespeichert; für die Field-Zugriffs-Inferenz brauchen wir aber den
    // Record-Typ. Hier passiert das nicht — die Cross-Modul-Wurzel ist
    // typischerweise ein Wert oder Funktionsaufruf, kein Datensatz selbst.

    for (let i = 0; i < untilIndex; i++) {
        current = stepChainOp(current, chain.chain[i], true);
        if (!current || current.kind === 'unknown') return undefined;
    }
    return current;
}

// ---------------------------------------------------------------------------
// Markdown-Formatierung
// ---------------------------------------------------------------------------

async function formatResolved(r: Resolved): Promise<Hover | undefined> {
    switch (r.kind) {
        case 'decl':              return formatDeclNode(r.node);
        case 'cross-decl':        return formatCrossDeclNode(r.node, r.sourceModule);
        case 'builtin-fn':        return formatBuiltinFn(r.name);
        case 'builtin-enum':      return formatBuiltinEnum(r.name);
        case 'builtin-value':     return formatBuiltinEnumValue(r.value, r.enumName);
        case 'builtin-method':    return formatBuiltinMethod(r.def);
        case 'builtin-primitive': return formatBuiltinPrimitive(r.name);
    }
}

/**
 * Erzeugt die Hover-Karte für eine importierte Decl. Inhaltlich identisch
 * mit dem lokalen Hover, aber mit einer zusätzlichen Hinweis-Zeile auf das
 * Quell-Modul — so weiß der Nutzer, wohin die Definition gehört.
 */
async function formatCrossDeclNode(node: AstNode, sourceFile: string): Promise<Hover | undefined> {
    const local = await formatDeclNode(node);
    if (!local) return undefined;
    const original = typeof local.contents === 'string'
        ? local.contents
        : ('value' in local.contents ? local.contents.value : '');
    const prefix = `*Importiert aus Datei:* \`${sourceFile}\``;
    return markdown(`${prefix}\n\n${original}`);
}

async function formatDeclNode(node: AstNode): Promise<Hover | undefined> {
    if (isAbbruchExpr(node))     return markdown(formatAbbruch());
    if (isAusgabeStmt(node))     return markdown(formatAusgabe());
    if (isKonstDecl(node))       return markdown(await formatKonst(node));
    if (isFunktionDecl(node))    return markdown(await formatFunktion(node));
    if (isDatensatzDecl(node))   return markdown(await formatDatensatz(node));
    if (isAufzaehlungDecl(node)) return markdown(await formatAufzaehlung(node));
    if (isField(node))           return markdown(formatField(node));
    if (isParam(node))           return markdown(formatParam(node));
    return undefined;
}

function markdown(value: string): Hover {
    return { contents: { kind: 'markdown', value } };
}

function formatAbbruch(): string {
    const sig = fence('abbruch(begründung: Text): never');
    const body =
        'Begründeter, **nicht abfangbarer** Programmabbruch (SPEC § 4.19).\n\n'
        + 'Terminiert den gesamten Lauf mit der Pflicht-Begründung. Kein '
        + 'Sprachkonstrukt fängt `abbruch` ab — es ist das prinzipientreue '
        + 'Gegenstück zu `throw`. Hat den Bottom-Typ `never` und darf daher '
        + 'als Funktionsbody oder als `wähle`/`wenn`-Zweig stehen, wo ein '
        + 'beliebiger Typ erwartet wird.\n\n'
        + 'Geschwister von `!!`: `!!` ist der *unbeabsichtigte* Bug-Abbruch, '
        + '`abbruch` der *beabsichtigte, begründete* Fachabbruch. Die '
        + 'Begründung erscheint im Audit-Anhang.';
    return joinSections(sig, body);
}

function formatAusgabe(): string {
    const sig = fence('ausgabe(text: Text)        // Anweisung, kein Wert');
    const body =
        'Gibt `text` auf die Konsole aus (SPEC § 5.4).\n\n'
        + '**Anweisung, kein Ausdruck** — liefert keinen Wert, nur als '
        + 'eigene Zeile in einem Block erlaubt (nicht `var x = ausgabe(…)`, '
        + 'nicht als Funktionsbody, nicht als `wähle`/`wenn`-Wert).\n\n'
        + '`ausgabe` ist ein **echter Seiteneffekt** — die bewusste, '
        + 'einzige zugelassene Ausnahme von P2 (§ 4.18). Block-Anweisungen '
        + 'laufen eager in Quelltext-Reihenfolge.';
    return joinSections(sig, body);
}

async function formatKonst(decl: KonstDecl): Promise<string> {
    // Wert in die Code-Signatur einweben (Issue #65 B1) — Konstanten-
    // Werte sind in einem Steuer-DSL primäres Interesse beim Hover
    // (Tarifeckwert, Hebesatz, Grundfreibetrag …). Lange/mehrzeilige
    // Werte (z. B. Datensatz-Konstruktoren) bekommen `…` als Ellipse.
    const valueText = compactValueText(decl.value?.$cstNode?.text);
    const head = `konst ${decl.name}: ${typeToString(decl.type)}`;
    const sig = fence(valueText ? `${head} = ${valueText}` : head);
    return joinSections(sig, await formatDocPrefix(decl.docPrefix));
}

/** Macht aus dem CST-Text eines Wertes eine einzeilige, gekürzte Form
 *  für die Hover-Code-Zeile. Mehrzeilige Werte werden zur ersten Zeile
 *  gekürzt; lange Werte (>60 Zeichen) werden mit `…` abgeschnitten. */
function compactValueText(raw: string | undefined): string {
    if (!raw) return '';
    const trimmed = raw.replace(/\s+/g, ' ').trim();
    if (!trimmed) return '';
    const MAX = 60;
    return trimmed.length > MAX ? trimmed.slice(0, MAX - 1) + '…' : trimmed;
}

async function formatFunktion(decl: FunktionDecl): Promise<string> {
    const params = decl.params.map((p) => {
        const def = p.default ? ' = …' : '';
        return `${p.name}: ${typeToString(p.type)}${def}`;
    }).join(', ');
    const sig = fence(`fn ${decl.name}(${params}): ${typeToString(decl.returnType)}`);
    const paramOrder = decl.params.map((p) => p.name);
    return joinSections(sig, await formatDocPrefix(decl.docPrefix, paramOrder));
}

async function formatDatensatz(decl: DatensatzDecl): Promise<string> {
    const sig = fence(`datensatz ${decl.name}(…${decl.fields.length} Felder…)`);
    const fields = decl.fields.length
        ? '**Felder:**\n' + decl.fields.map((f) => {
            const def = f.default ? ' = …' : '';
            return `- \`${f.name}: ${typeToString(f.type)}${def}\``;
        }).join('\n')
        : '';
    const paramOrder = decl.fields.map((f) => f.name);
    return joinSections(sig, await formatDocPrefix(decl.docPrefix, paramOrder), fields);
}

async function formatAufzaehlung(decl: AufzaehlungDecl): Promise<string> {
    const sig = fence(`aufzählung ${decl.name} { ${decl.values.join(', ')} }`);
    return joinSections(sig, await formatDocPrefix(decl.docPrefix));
}

function formatField(field: Field): string {
    const def = field.default ? ' = …' : '';
    const sig = fence(`Feld ${field.name}: ${typeToString(field.type)}${def}`);
    // Issue #65 B2: Beschreibung aus dem `@param <fieldName>`-Eintrag
    // des umschließenden `datensatz`-Doc-Kommentars in die Hover-Karte
    // ziehen, falls vorhanden.
    const datensatz = field.$container as DatensatzDecl | undefined;
    const docRaw = datensatz?.docPrefix?.doc;
    if (!docRaw) return sig;
    const { params } = parseDocTags(stripMarkersShared(docRaw));
    const match = params.find((p) => p.name === field.name);
    if (!match?.desc) return sig;
    // Blockquote unter der Signatur — visuell klar getrennt, im Markdown
    // sauber lesbar.
    return joinSections(sig, `> ${match.desc}`);
}

function formatParam(param: Param): string {
    const def = param.default ? ' = …' : '';
    return fence(`Parameter ${param.name}: ${typeToString(param.type)}${def}`);
}

function formatBuiltinFn(name: string): Hover | undefined {
    const b = BUILTIN_FUNCTIONS.get(name);
    if (!b) return undefined;
    return markdown(joinSections(fence(b.signature), b.doc, quelleLine(b.quelle)));
}

function formatBuiltinEnum(name: string): Hover | undefined {
    const b = BUILTIN_ENUMS.get(name);
    if (!b) return undefined;
    return markdown(joinSections(fence(b.signature), b.doc, quelleLine(b.quelle)));
}

function formatBuiltinEnumValue(value: string, enumName: string): Hover | undefined {
    const e = BUILTIN_ENUMS.get(enumName);
    if (!e) return undefined;
    const sig = fence(`${value}: ${enumName}`);
    const body = `Wert der eingebauten Aufzählung **${enumName}**.\n\n${e.doc}`;
    return markdown(joinSections(sig, body, quelleLine(e.quelle)));
}

/**
 * Hover-Karte für eine Builtin-Methode (SPEC § 11). Empfängertyp-spezifisch
 * via `findMethodDef` aufgelöst; gleiches dreiteiliges Layout (Signatur ·
 * Doc · Quelle) wie für freie Builtins. SPEC-§ kommt aus `def.quelle`,
 * das die DEF-Listen via `withQuelle` einheitlich tragen.
 *
 * Properties (`.länge` etc.) tragen ihren Rückgabetyp als Signatur (kein
 * `(...)` → `name: signature`); Aufruf-Methoden zeigen `.name(...) -> R`.
 */
function formatBuiltinMethod(def: BuiltinMethodDef): Hover {
    const callForm = def.property
        ? `${def.name}: ${def.signature}`
        : `.${def.name}${def.signature}`;
    return markdown(joinSections(fence(callForm), def.doc, quelleLine(def.quelle)));
}

/**
 * Hover-Karte für einen primitiven Typ in einer Annotation (`: Euro`,
 * `: EuroCent`, …). Doku-Inhalt aus `BUILTIN_PRIMITIVE_DOCS`.
 */
function formatBuiltinPrimitive(name: string): Hover | undefined {
    const d = BUILTIN_PRIMITIVE_DOCS.get(name);
    if (!d) return undefined;
    return markdown(joinSections(fence(name), d.doc, quelleLine(d.quelle)));
}

// ---------------------------------------------------------------------------
// Doc-Prefix und Helfer
// ---------------------------------------------------------------------------

/** Ersetzt durch `renderDocForHover` (Issue #65 Phase C) — strukturiertes
 *  Markdown mit Parameter-/Rückgabe-Sektionen + Formel-Rendering. Diese
 *  Funktion ist nur noch ein dünner Wrapper für Aufrufer, die keine
 *  Param-Reihenfolge mitgeben können (Aufzählungen, Konstanten).
 *  Async, weil der Math-Renderer (MathJax) eine einmalige Init braucht. */
async function formatDocPrefix(prefix?: DeclPrefix, paramOrder?: ReadonlyArray<string>): Promise<string> {
    if (!prefix) return '';
    return renderDocForHover({
        docRaw: prefix.doc,
        paramOrder,
        quellen: quellenFromPrefix(prefix),
    });
}

function quellenFromPrefix(prefix: DeclPrefix): ReadonlyArray<QuelleAnnotation> {
    return (prefix.annotations ?? [])
        .filter((a) => a.name === 'Quelle')
        .map((a) => a.args[0])
        .filter(isStringLiteral)
        .map((s) => ({ value: s.value }));
}

function quelleLine(quelle?: string): string {
    return quelle ? `*Quelle:* ${quelle}` : '';
}

function fence(content: string): string {
    return `\`\`\`findsl\n${content}\n\`\`\``;
}

function joinSections(...parts: ReadonlyArray<string>): string {
    return parts.filter(Boolean).join('\n\n');
}

// ---------------------------------------------------------------------------
// Type-Annotation pretty-print
// ---------------------------------------------------------------------------

function typeToString(t: TypeAnnotation | undefined): string {
    if (!t || !t.atom) return '?';        // Teil-Parse beim Tippen
    return typeAtomToString(t.atom) + (t.optional ? '?' : '');
}

function typeAtomToString(atom: TypeAtom): string {
    if (atom.$type === 'NamedType') {
        const args = atom.typeArgs?.args.map(typeToString).join(', ');
        return args ? `${atom.name}<${args}>` : atom.name;
    }
    const params = atom.paramTypes.map(typeToString).join(', ');
    const result = atom.returnType ? typeToString(atom.returnType) : '?';
    return `(${params}) -> ${result}`;
}
