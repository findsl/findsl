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
    type MaybePromise,
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
    isDatensatzDecl,
    isFieldAccess,
    isField,
    isForceUnwrap,
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
import * as path from 'node:path';
import { BUILTIN_ENUM_DEFS, BUILTIN_FUNCTION_DEFS } from './findsl-stdlib.js';
import {
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
    | { kind: 'decl';          node: AstNode }
    | { kind: 'cross-decl';    node: AstNode; sourceModule: string }
    | { kind: 'builtin-fn';    name: string }
    | { kind: 'builtin-enum';  name: string }
    | { kind: 'builtin-value'; value: string; enumName: string };

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
        const rootCst = document.parseResult?.value?.$cstNode;
        if (!rootCst) return undefined;
        const offset = document.textDocument.offsetAt(params.position);

        // 1. Cursor auf einem ID-Token → identifier-getriebene Auflösung.
        const idNode = CstUtils.findDeclarationNodeAtOffset(
            rootCst, offset, this.grammarConfig.nameRegexp,
        );
        const program = document.parseResult.value as Program;
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
    protected override getAstNodeHoverContent(node: AstNode): MaybePromise<string | undefined> {
        const h = formatResolved({ kind: 'decl', node });
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

        // Cursor auf einem Field-Access-Identifier (z. B. `fall.tarifart`):
        // Typ der Base inferieren und das Feld im Datensatz nachschlagen.
        if ((isFieldAccess(ast) || isSafeFieldAccess(ast)) && ast.name === text) {
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
        if (BUILTIN_FUNCTIONS.has(name)) return { kind: 'builtin-fn',   name };
        if (BUILTIN_ENUMS.has(name))     return { kind: 'builtin-enum', name };
        const enumName = BUILTIN_ENUM_VALUES.get(name);
        if (enumName)                     return { kind: 'builtin-value', value: name, enumName };
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
    const localEnv = buildLocalScope(chain, ctx, program, provider);

    // Wurzel-Typ: lokal → Top-Level → Cross-Modul.
    let current: Type | undefined =
        localEnv.lookup(chain.name) ?? provider.resolveCrossModuleType(program, chain.name);
    if (!current) return undefined;
    // Cross-Modul-Datensatz-Symbol ist als Konstruktor-Funktionstyp
    // gespeichert; für die Field-Zugriffs-Inferenz brauchen wir aber den
    // Record-Typ. Hier passiert das nicht — die Cross-Modul-Wurzel ist
    // typischerweise ein Wert oder Funktionsaufruf, kein Datensatz selbst.

    for (let i = 0; i < untilIndex; i++) {
        current = stepChainOp(current, chain.chain[i]);
        if (!current || current.kind === 'unknown') return undefined;
    }
    return current;
}

function stepChainOp(t: Type, op: ChainOp): Type | undefined {
    if (isCall(op)) {
        if (t.kind === 'function') return t.result;
        return TUnknown;
    }
    if (isFieldAccess(op)) {
        const unwrapped = t.kind === 'nullable' ? t.inner : t;
        if (unwrapped.kind !== 'record') return TUnknown;
        const field = unwrapped.decl.fields.find((f) => f.name === op.name);
        if (!field) return TUnknown;
        // Wir brauchen einen TypeContext, um Field-Typen aufzulösen — der
        // hier rumgereichte Datensatz hat noch keinen direkten Zugriff
        // darauf. Workaround: wir bauen ihn aus dem Container des Records
        // (Program) bei Bedarf nochmal auf. Für den Hover-Pfad (selten,
        // einmal pro Cursor-Bewegung) ist das vertretbar.
        const program = (unwrapped.decl as { $container?: Program }).$container;
        if (!program) return TUnknown;
        const localCtx = buildModuleHeader(program).context;
        return resolveTypeAnnotation(field.type, localCtx);
    }
    if (isSafeFieldAccess(op)) {
        if (t.kind === 'nullable') {
            const inner = t.inner;
            if (inner.kind !== 'record') return TUnknown;
            const field = inner.decl.fields.find((f) => f.name === op.name);
            if (!field) return TUnknown;
            const program = (inner.decl as { $container?: Program }).$container;
            if (!program) return TUnknown;
            const localCtx = buildModuleHeader(program).context;
            return TNull(resolveTypeAnnotation(field.type, localCtx));
        }
        if (t.kind === 'record') {
            // ?. auf nicht-Nullable — formal ein Typ-Fehler, fürs Hover
            // tolerant durchreichen.
            const field = t.decl.fields.find((f) => f.name === op.name);
            if (!field) return TUnknown;
            const program = (t.decl as { $container?: Program }).$container;
            if (!program) return TUnknown;
            const localCtx = buildModuleHeader(program).context;
            return resolveTypeAnnotation(field.type, localCtx);
        }
        return TUnknown;
    }
    if (isForceUnwrap(op)) {
        return t.kind === 'nullable' ? t.inner : t;
    }
    // Index in Listen — Hover-Skelett unterstützt das nicht
    return TUnknown;
}

/**
 * Sammelt Param- und Let-Bindings entlang der $container-Kette ausgehend
 * von einem inneren AST-Knoten. Äußere Bindings landen zuerst, innere
 * überschreiben sie — die TypeEnv-Semantik (Map-set) regelt Shadowing
 * automatisch.
 *
 * Param-Typen werden über `resolveAnnotationWithImports` aufgelöst, damit
 * Cross-Modul-importierte Datensatz-Typen (`f: Fall` mit `Fall` aus `lib`)
 * korrekt zum Record-Typ werden.
 */
function buildLocalScope(
    from: { $container?: object },
    ctx: TypeContext,
    program: Program,
    provider: FindslHoverProvider,
): TypeEnv {
    const env = ctx.globals.child();
    const stack: object[] = [];
    let n: object | undefined = from;
    while (n) {
        stack.push(n);
        n = (n as { $container?: object }).$container;
    }
    const resolve = (t: TypeAnnotation) => resolveAnnotationWithImports(t, ctx, program, provider);
    for (const node of stack.reverse()) {
        if (isFunktionDecl(node)) {
            for (const p of node.params) {
                env.define(p.name, resolve(p.type));
            }
        } else if (isBlockExpr(node) || isLambda(node)) {
            for (const s of node.stmts) {
                if (isLetStmt(s)) env.define(s.name, resolve(s.type));
            }
            if (isLambda(node)) {
                for (const p of node.params) {
                    if (p.type) env.define(p.name, resolve(p.type));
                }
            }
        }
    }
    return env;
}

/**
 * Wie `resolveTypeAnnotation`, aber mit Cross-Modul-Fallback: wenn der
 * Type-Name lokal nicht aufgelöst werden kann, wird er in den `verwende`-
 * Imports gesucht und über den Workspace geladen. Importierte Datensätze
 * sind im Header-Kontext als Konstruktor-Funktionstypen registriert; wir
 * "unwrappen" sie hier zum eigentlichen Record-Typ.
 */
function resolveAnnotationWithImports(
    t: TypeAnnotation,
    ctx: TypeContext,
    program: Program,
    provider: FindslHoverProvider,
): Type {
    const local = resolveTypeAnnotation(t, ctx);
    if (local.kind !== 'unknown') return local;
    if (!t?.atom || t.atom.$type !== 'NamedType') return local;

    const sym = provider.resolveCrossModuleType(program, t.atom.name);
    if (!sym) return local;

    // Datensatz-Konstruktor → Record
    if (sym.kind === 'function' && sym.result.kind === 'record') {
        return t.optional ? TNull(sym.result) : sym.result;
    }
    // Aufzählung
    if (sym.kind === 'enum') {
        return t.optional ? TNull(sym) : sym;
    }
    return local;
}

// ---------------------------------------------------------------------------
// Markdown-Formatierung
// ---------------------------------------------------------------------------

function formatResolved(r: Resolved): Hover | undefined {
    switch (r.kind) {
        case 'decl':          return formatDeclNode(r.node);
        case 'cross-decl':    return formatCrossDeclNode(r.node, r.sourceModule);
        case 'builtin-fn':    return formatBuiltinFn(r.name);
        case 'builtin-enum':  return formatBuiltinEnum(r.name);
        case 'builtin-value': return formatBuiltinEnumValue(r.value, r.enumName);
    }
}

/**
 * Erzeugt die Hover-Karte für eine importierte Decl. Inhaltlich identisch
 * mit dem lokalen Hover, aber mit einer zusätzlichen Hinweis-Zeile auf das
 * Quell-Modul — so weiß der Nutzer, wohin die Definition gehört.
 */
function formatCrossDeclNode(node: AstNode, sourceFile: string): Hover | undefined {
    const local = formatDeclNode(node);
    if (!local) return undefined;
    const original = typeof local.contents === 'string'
        ? local.contents
        : ('value' in local.contents ? local.contents.value : '');
    const prefix = `*Importiert aus Datei:* \`${sourceFile}\``;
    return markdown(`${prefix}\n\n${original}`);
}

function formatDeclNode(node: AstNode): Hover | undefined {
    if (isAbbruchExpr(node))     return markdown(formatAbbruch());
    if (isAusgabeStmt(node))     return markdown(formatAusgabe());
    if (isKonstDecl(node))       return markdown(formatKonst(node));
    if (isFunktionDecl(node))    return markdown(formatFunktion(node));
    if (isDatensatzDecl(node))   return markdown(formatDatensatz(node));
    if (isAufzaehlungDecl(node)) return markdown(formatAufzaehlung(node));
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

function formatKonst(decl: KonstDecl): string {
    // Wert in die Code-Signatur einweben (Issue #65 B1) — Konstanten-
    // Werte sind in einem Steuer-DSL primäres Interesse beim Hover
    // (Tarifeckwert, Hebesatz, Grundfreibetrag …). Lange/mehrzeilige
    // Werte (z. B. Datensatz-Konstruktoren) bekommen `…` als Ellipse.
    const valueText = compactValueText(decl.value?.$cstNode?.text);
    const head = `konst ${decl.name}: ${typeToString(decl.type)}`;
    const sig = fence(valueText ? `${head} = ${valueText}` : head);
    return joinSections(sig, formatDocPrefix(decl.docPrefix));
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

function formatFunktion(decl: FunktionDecl): string {
    const params = decl.params.map((p) => {
        const def = p.default ? ' = …' : '';
        return `${p.name}: ${typeToString(p.type)}${def}`;
    }).join(', ');
    const sig = fence(`fn ${decl.name}(${params}): ${typeToString(decl.returnType)}`);
    return joinSections(sig, formatDocPrefix(decl.docPrefix));
}

function formatDatensatz(decl: DatensatzDecl): string {
    const sig = fence(`datensatz ${decl.name}(…${decl.fields.length} Felder…)`);
    const fields = decl.fields.length
        ? '**Felder:**\n' + decl.fields.map((f) => {
            const def = f.default ? ' = …' : '';
            return `- \`${f.name}: ${typeToString(f.type)}${def}\``;
        }).join('\n')
        : '';
    return joinSections(sig, formatDocPrefix(decl.docPrefix), fields);
}

function formatAufzaehlung(decl: AufzaehlungDecl): string {
    const sig = fence(`aufzählung ${decl.name} { ${decl.values.join(', ')} }`);
    return joinSections(sig, formatDocPrefix(decl.docPrefix));
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

function formatBuiltinFn(name: string): Hover {
    const b = BUILTIN_FUNCTIONS.get(name)!;
    return markdown(joinSections(fence(b.signature), b.doc, quelleLine(b.quelle)));
}

function formatBuiltinEnum(name: string): Hover {
    const b = BUILTIN_ENUMS.get(name)!;
    return markdown(joinSections(fence(b.signature), b.doc, quelleLine(b.quelle)));
}

function formatBuiltinEnumValue(value: string, enumName: string): Hover {
    const e = BUILTIN_ENUMS.get(enumName)!;
    const sig = fence(`${value}: ${enumName}`);
    const body = `Wert der eingebauten Aufzählung **${enumName}**.\n\n${e.doc}`;
    return markdown(joinSections(sig, body, quelleLine(e.quelle)));
}

// ---------------------------------------------------------------------------
// Doc-Prefix und Helfer
// ---------------------------------------------------------------------------

function formatDocPrefix(prefix?: DeclPrefix): string {
    if (!prefix) return '';
    const body = prefix.doc ? stripDocMarkers(prefix.doc).trim() : '';
    const quellen = (prefix.annotations ?? [])
        .filter((a) => a.name === 'Quelle')
        .map((a) => a.args[0])
        .filter(isStringLiteral)
        .map((s) => `*Quelle:* ${s.value}`)
        .join('\n\n');
    return [body, quellen].filter(Boolean).join('\n\n---\n\n');
}

function stripDocMarkers(raw: string): string {
    let s = raw;
    if (s.startsWith('--')) s = s.slice(2);
    if (s.endsWith('--'))   s = s.slice(0, -2);
    return s.replace(/^\s*\n/, '').replace(/\n\s*$/, '');
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
