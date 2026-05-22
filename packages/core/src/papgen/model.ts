// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * PAP-Generator — strukturiertes Zwischenmodell (`FlowGraph`).
 *
 * Wandelt geparste FinDSL-Funktionen in einen sprach-/format-neutralen
 * Ablaufgraphen (Knoten + Kanten), aus dem die Format-Emitter
 * (`mermaid.ts`, später `dot.ts`/`svg.ts`) DIN-66001-nahe
 * Programmablaufpläne rendern. Eine `fn` = ein `FlowGraph`.
 *
 * Architektur analog `docgen/`: reines Datenmodell, Renderer hängen daran.
 * Der `detail`-Parameter steuert die Granularität bereits HIER (nicht im
 * Emitter) — die Emitter konsumieren einen bereits gefilterten Graphen.
 *
 * FinDSL ist ausdrucksorientiert und strukturiert (kein goto, keine
 * Mutation), daher ist die AST→Ablaufgraph-Abbildung eine direkte
 * rekursive Strukturierung ohne CFG-Rückbau:
 *   - `wenn`            → Verzweigung (Raute, 2 Wege)
 *   - `wähle` ohne subj → Verzweigungs-Kaskade (boolesche `falls`)
 *   - `wähle (subject)` → Mehrfach-Fallunterscheidung (Enum-Werte)
 *   - `für jeden`       → Schleife
 *   - `abbruch`         → Grenzstelle (anormales Ende)
 *   - Block + `var`     → lineare Operations-/Unterprogramm-Sequenz
 *   - Aufruf            → Unterprogramm (vordefinierter Prozess)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { NodeFileSystem } from 'langium/node';
import { AstUtils, URI, type AstNode } from 'langium';
import { createFindslServices } from '../language/findsl-module.js';
import {
    isAbbruchExpr,
    isBinaryOp,
    isCall,
    isCallChain,
    isFallArm,
    isFuerExpr,
    isFunktionDecl,
    isLambda,
    isLetStmt,
    isWaehleExpr,
    isWennExpr,
    type BlockStmt,
    type Expr,
    type FuerExpr,
    type FunktionDecl,
    type Program,
    type WaehleExpr,
    type WennExpr,
} from '../language/generated/ast.js';
import { commonBase, displayId, isInternalName } from '../language/import-path.js';
import { parseQuelleRefs } from '../docgen/quelle.js';
import { parseDocTags, stripDocMarkers } from '../language/doc-tags.js';
import { texToPlain } from '../language/tex-to-plain.js';

// ---------------------------------------------------------------------------
// Modell
// ---------------------------------------------------------------------------

/** DIN-66001-nahe Knotenarten. `merge` ist implizit (mehrere Kanten auf
 *  einen Folgeknoten) und wird daher nicht als eigener Knoten erzeugt. */
export type NodeKind =
    | 'start'        // Grenzstelle: Funktions-Eintritt (mit Signatur)
    | 'ende'         // Grenzstelle: reguläre Rückgabe
    | 'abbruch'      // Grenzstelle: anormales Ende (`abbruch`) — eigene Farbe
    | 'operation'    // Rechteck: Berechnung/Zuweisung
    | 'decision'     // Raute: 2-Wege-Verzweigung (`wenn` / boolesches `falls`)
    | 'case'         // n-Wege-Fallunterscheidung (`wähle (subject)` über Enum)
    | 'subprogram'   // vordefinierter Prozess: `fn`-Aufruf
    | 'ausgabe'      // Parallelogramm: `ausgabe(text)`
    | 'eingabe';     // Parallelogramm: Funktions-Parameter (DIN Ein-/Ausgabe)

export interface FlowNode {
    readonly id: string;
    readonly kind: NodeKind;
    readonly label: string;
    /** `@Quelle`-Annotation der Funktion (nur am `start`-Knoten gesetzt). */
    readonly quelle?: string;
    /** Aufgelöster gesetze-im-internet-Tiefenlink (erstes §) — Start-Knoten
     *  aus `@Quelle`, `abbruch`-Knoten aus dem § im Grund. Emitter machen
     *  daraus z. B. Mermaid `click … href`. */
    readonly link?: string;
    /** Hover-Text in Plain-Notation (Mathe via tex-to-plain) — für die
     *  nativen Mermaid-Tooltips (reiner Text). */
    readonly tooltip?: string;
    /** Hover-Text mit roher `$$…$$`-Mathe — der HTML-Emitter rendert daraus
     *  echtes KaTeX (Mermaids native Tooltips können das nicht). */
    readonly tooltipRaw?: string;
}

export interface FlowEdge {
    readonly from: string;
    readonly to: string;
    /** Kanten-Beschriftung: `ja`/`nein` (Verzweigung), Enum-Wert/`sonst` (case). */
    readonly label?: string;
}

export interface FlowGraph {
    readonly fnName: string;
    /** Signatur für die Eintritts-Grenzstelle (`name(p: T, …): R`). */
    readonly signatur: string;
    readonly nodes: ReadonlyArray<FlowNode>;
    readonly edges: ReadonlyArray<FlowEdge>;
}

export interface PapModul {
    readonly modul: string;
    /** Ein Graph je `fn` (inkl. interner `_`-Funktionen — Audit-relevant). */
    readonly graphs: ReadonlyArray<FlowGraph>;
}

export type Detail = 'struktur' | 'voll';

/** Wie die Funktions-Parameter dargestellt werden:
 *   - `inline`  — in der Start-Grenzstelle (`name(p: T, …): R`).
 *   - `symbole` — als DIN-Ein-/Ausgabe-Parallelogramme, die in den
 *                 Start-Knoten fließen (DIN-konformer, entlastet die
 *                 Grenzstelle). */
export type ParamMode = 'inline' | 'symbole';

// ---------------------------------------------------------------------------
// Walker-Hilfstypen
// ---------------------------------------------------------------------------

/** Offener Ausgang eines Teilgraphen, der an den Folgeknoten gebunden wird. */
interface ExitPort {
    readonly from: string;
    readonly label?: string;
}

/** Ergebnis eines Walk-Schritts: ein Eintrittsknoten + offene Ausgänge. */
interface Fragment {
    readonly entry: string;
    readonly exits: ReadonlyArray<ExitPort>;
}

/** Quelltext eines AST-Knotens, Whitespace zu Einzelblanks kollabiert. */
function nodeText(node: AstNode | undefined): string {
    return (node?.$cstNode?.text ?? '').replace(/\s+/g, ' ').trim();
}

/** `true`, wenn der Ausdruck ein Funktionsaufruf `Name(…)` ist (→ Unterprogramm). */
function istAufruf(expr: Expr | undefined): boolean {
    return !!expr && isCallChain(expr) && expr.chain.some(isCall);
}

/** `true`, wenn der Ausdruck eine Kontrollfluss-Struktur ist, die als
 *  eigener Teilgraph (Rauten/Schleife/Grenzstelle) zerlegt werden muss —
 *  statt als ein Knoten dargestellt zu werden. Block-Lambdas (`= { … }`)
 *  zählen dazu, HOF-Lambdas mit Parametern nicht. */
function istKontrollfluss(expr: Expr | undefined): boolean {
    if (!expr) return false;
    return isWennExpr(expr) || isWaehleExpr(expr) || isFuerExpr(expr)
        || isAbbruchExpr(expr) || (isLambda(expr) && expr.params.length === 0);
}

/** `true`, wenn `node` (echt innerhalb `top`) in den Argumenten eines
 *  anderen Aufrufs steckt — solche verschachtelten Calls subsumiert das
 *  äußere `(…)` ohnehin, also nicht separat behandeln. */
function nestedInCall(node: AstNode, top: AstNode): boolean {
    if (node === top) return false;
    let p: AstNode | undefined = node.$container;
    while (p && p !== top) {
        if (isCall(p)) return true;
        p = p.$container;
    }
    return false;
}

/** Arithmetische Operatoren, nach denen ein Zeilenumbruch erzwungen wird. */
const ARITH_OPS: ReadonlySet<string> = new Set(['+', '-', '*', '/']);

/** Rendert ein Ausdrucks-Label aus dem Quelltext mit zwei Transformationen:
 *   - `abbreviate`: Argumentlisten äußerster Aufrufe → `(…)` (leere bleiben
 *     `()`); zeigt, DASS Parameter fließen, ohne sie auszuschreiben.
 *   - Formel-Umbruch: nach jedem arithmetischen Operator (`+ - * /`) ein
 *     erzwungener Zeilenumbruch, damit lange Summen/Produkte lesbar werden.
 *  Beide arbeiten offset-basiert auf demselben CST-Text. */
function renderLabel(expr: Expr, abbreviate: boolean): string {
    const root = expr.$cstNode;
    if (!root) return nodeText(expr);
    const base = root.offset;
    const repls: Array<{ s: number; e: number; t: string }> = [];
    for (const node of AstUtils.streamAst(expr)) {
        if (isCall(node) && node.args.length > 0) {
            if (abbreviate && !nestedInCall(node, expr) && node.$cstNode) {
                const c = node.$cstNode;
                repls.push({ s: c.offset - base, e: c.offset + c.length - base, t: '(…)' });
            }
            continue;
        }
        if (isBinaryOp(node) && ARITH_OPS.has(node.op)) {
            // In gekürzten Aufruf-Argumenten ist die Formel ohnehin weg.
            if (abbreviate && nestedInCall(node, expr)) continue;
            const lc = node.left.$cstNode;
            const rc = node.right.$cstNode;
            if (!lc || !rc) continue;
            repls.push({
                s: lc.offset + lc.length - base, // Lücke zwischen Operanden
                e: rc.offset - base,
                t: ` ${node.op}\n`,            // Operator ans Zeilenende, dann Umbruch
            });
        }
    }
    let text = root.text;
    for (const r of repls.sort((a, b) => b.s - a.s)) {
        text = text.slice(0, r.s) + r.t + text.slice(r.e);
    }
    return text.replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

/** Kürzt einen `abbruch`-Grund auf die erste nichtleere Zeile (ohne
 *  einfache/Tripel-Anführungszeichen), gekappt auf 60 Zeichen. Hängt „…"
 *  an, wenn gekürzt oder weitere Zeilen folgen. Hält die Grenzstelle
 *  kompakt — der volle Wortlaut steht im Quelltext / in der Doku. */
function shortAbbruchGrund(grund: Expr | undefined): string {
    if (!grund) return '';
    const raw = (grund.$cstNode?.text ?? '').trim();
    const inner = raw
        .replace(/^"""([\s\S]*)"""$/, '$1')
        .replace(/^"([\s\S]*)"$/, '$1');
    const lines = inner.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
    const first = lines[0] ?? '';
    const max = 60;
    const truncated = first.length > max;
    const base = truncated ? first.slice(0, max).trimEnd() : first;
    return truncated || lines.length > 1 ? `${base}…` : base;
}

/** Voller `abbruch`-Grund (Anführungszeichen entfernt, Whitespace zu
 *  Einzelblanks kollabiert) — für den Hover-Tooltip. */
function fullAbbruchGrund(grund: Expr | undefined): string {
    if (!grund) return '';
    const inner = (grund.$cstNode?.text ?? '').trim()
        .replace(/^"""([\s\S]*)"""$/, '$1')
        .replace(/^"([\s\S]*)"$/, '$1');
    return inner.replace(/\s+/g, ' ').trim();
}

/** Erster gesetze-im-internet-Tiefenlink in einem Text (oder undefined). */
function firstQuelleUrl(text: string | undefined): string | undefined {
    return text ? parseQuelleRefs(text)[0]?.url : undefined;
}

/** Wandelt `$$…$$`/`$…$`-Mathe im Doc-Text in Unicode-Plain-Notation
 *  (z. B. `a^2` → `a²`) — Mermaid-Tooltips sind reiner Text, KaTeX wie im
 *  docgen ist dort nicht möglich (vgl. LSP-Hover-Fallback). Echte KaTeX-
 *  Wiedergabe bleibt dem HTML-Emitter vorbehalten. */
function mathToPlain(text: string): string {
    return text
        .replace(/\$\$([\s\S]*?)\$\$/g, (_m, t: string) => texToPlain(t))
        .replace(/\$([^$\n]+?)\$/g, (_m, t: string) => texToPlain(t));
}

/** Doc-Kommentar als Hover-Text in zwei Formen: `plain` (Mathe→Unicode, für
 *  native Mermaid-Tooltips) und `raw` (rohe `$$…$$`-Mathe, für KaTeX im
 *  HTML-Emitter). Whitespace kollabiert. */
function docTooltips(text: string | undefined): { plain?: string; raw?: string } {
    if (!text) return {};
    const raw = text.replace(/\s+/g, ' ').trim();
    if (!raw) return {};
    return { raw, plain: mathToPlain(raw) };
}

/** `@Quelle`-Texte einer Deklaration (ohne Anführungszeichen), Spiegel
 *  der `docgen/model.ts`-Logik. */
function quellenOf(fn: FunktionDecl): string[] {
    const out: string[] = [];
    for (const a of fn.docPrefix?.annotations ?? []) {
        if (a.name !== 'Quelle') continue;
        const arg = a.args[0] as { $type?: string; value?: string } | undefined;
        if (arg?.$type !== 'StringLiteral' || typeof arg.value !== 'string') continue;
        out.push(arg.value.replace(/^"|"$/g, ''));
    }
    return out;
}

/** Signatur-Bestandteile: Name, einzelne Parameter (`p: T`) und Rückgabe-
 *  Typ getrennt — damit der Start-Knoten den Namen in Zeile 1 und jeden
 *  Parameter in eigener Zeile zeigen kann, das `signatur`-Feld aber
 *  einzeilig bleibt. */
function signaturParts(fn: FunktionDecl): { name: string; params: string[]; ret: string } {
    return {
        name: fn.name,
        params: fn.params.map((p) => `${p.name}: ${nodeText(p.type)}`),
        ret: nodeText(fn.returnType),
    };
}

// ---------------------------------------------------------------------------
// Graph-Builder (je Funktion)
// ---------------------------------------------------------------------------

class GraphBuilder {
    private readonly nodes: FlowNode[] = [];
    private readonly edges: FlowEdge[] = [];
    private counter = 0;

    constructor(
        private readonly fnName: string,
        private readonly detail: Detail,
        private readonly paramMode: ParamMode,
    ) {}

    /** Deterministische ID aus Dokumentreihenfolge → byte-stabile Ausgabe. */
    private addNode(
        kind: NodeKind,
        label: string,
        extra?: { quelle?: string; link?: string; tooltip?: string; tooltipRaw?: string },
    ): string {
        const id = `${this.fnName}_n${this.counter++}`;
        this.nodes.push({ id, kind, label, ...extra });
        return id;
    }

    private edge(from: string, to: string, label?: string): void {
        this.edges.push({ from, to, label });
    }

    private connect(exits: ReadonlyArray<ExitPort>, to: string): void {
        for (const e of exits) this.edge(e.from, to, e.label);
    }

    /** Label eines Ausdrucks: Formel-Umbruch nach arithmetischen Operatoren
     *  immer; Aufruf-Argumente werden bei `struktur` zu `(…)` gekürzt, bei
     *  `voll` ausgeschrieben. */
    private exprLabel(expr: Expr | undefined): string {
        if (!expr) return '';
        return renderLabel(expr, this.detail !== 'voll');
    }

    build(fn: FunktionDecl): FlowGraph {
        const { name, params, ret } = signaturParts(fn);
        const signatur = `${name}(${params.join(', ')}): ${ret}`;   // einzeilig (Feld)
        const quelle = quellenOf(fn).join('; ') || undefined;
        // Doc-Kommentar parsen: Prosa → Start-Hover, @param → Eingabe-Hover.
        const tags = parseDocTags(stripDocMarkers(fn.docPrefix?.doc));
        // `symbole`: Grenzstelle trägt nur den Namen, die Parameter werden
        // separate Eingabe-Parallelogramme (s. u.). `inline`: Name in Zeile
        // 1, dann jeder Parameter in eigener Zeile, zuletzt `): Rückgabe`
        // (verhindert, dass eine lange Parameterliste über den Rand läuft).
        const startLabel = this.paramMode === 'symbole'
            ? name
            : `${name}\n(${params.join(',\n')}): ${ret}`;
        const proseTip = docTooltips(tags.prose);
        const start = this.addNode('start', startLabel, {
            quelle,
            link: firstQuelleUrl(quelle),
            tooltip: proseTip.plain,
            tooltipRaw: proseTip.raw,
        });
        if (this.paramMode === 'symbole') {
            // Jeder Parameter = DIN-Ein-/Ausgabe-Parallelogramm → Start;
            // Hover zeigt die @param-Beschreibung aus dem Doc-Kommentar.
            fn.params.forEach((fp, i) => {
                const t = docTooltips(tags.params.find((pd) => pd.name === fp.name)?.desc);
                this.edge(
                    this.addNode('eingabe', params[i], { tooltip: t.plain, tooltipRaw: t.raw }),
                    start,
                );
            });
        }

        const body = fn.body;
        const frag = body.expr
            ? this.walkExpr(body.expr)
            : body.block
                ? this.walkBlock(body.block)
                : { entry: this.addNode('operation', '(leerer Rumpf)'), exits: [] as ExitPort[] };

        this.edge(start, frag.entry);
        // `ende`-Knoten nur, wenn der Rumpf einen regulären Ausgang hat.
        // Bricht er auf allen Pfaden ab (`abbruch` als Body oder in jedem
        // `wähle`-Zweig), bleibt `frag.exits` leer — ein `ende`-Knoten wäre
        // dann ein verwaister Terminator und würde fälschlich eine nie
        // erreichbare normale Rückgabe suggerieren.
        if (frag.exits.length > 0) {
            const ende = this.addNode('ende', `Ergebnis: ${nodeText(fn.returnType)}`);
            this.connect(frag.exits, ende);
        }

        return { fnName: fn.name, signatur, nodes: this.nodes, edges: this.edges };
    }

    private walkExpr(expr: Expr): Fragment {
        if (isAbbruchExpr(expr)) {
            const grund = shortAbbruchGrund(expr.grund);
            const voll = fullAbbruchGrund(expr.grund);
            const label = grund ? `abbruch\n${grund}` : 'abbruch';
            // Voller Wortlaut als Hover; § im Grund (falls vorhanden) als Link.
            return {
                entry: this.addNode('abbruch', label, {
                    tooltip: voll || undefined,
                    tooltipRaw: voll || undefined,
                    link: firstQuelleUrl(voll),
                }),
                exits: [],
            };
        }
        if (isWennExpr(expr)) return this.walkWenn(expr);
        if (isWaehleExpr(expr)) {
            return expr.subject ? this.walkCase(expr) : this.walkKaskade(expr);
        }
        if (isFuerExpr(expr)) return this.walkFuer(expr);
        // Parameterloses Lambda = Block-Funktionskörper (`fn … = { … }`,
        // vom Parser als Lambda geparst) → wie einen Block zerlegen, statt
        // den ganzen `{ … }`-Rumpf in einen unlesbaren Knoten zu packen.
        // Ein HOF-Lambda MIT Parametern (`{ k -> … }`) bleibt ein Blatt.
        if (isLambda(expr) && expr.params.length === 0) return this.walkBlock(expr);
        // Blatt (struktur-Ebene): ein Operations-/Unterprogramm-Knoten.
        const kind: NodeKind = istAufruf(expr) ? 'subprogram' : 'operation';
        const id = this.addNode(kind, this.exprLabel(expr));
        return { entry: id, exits: [{ from: id }] };
    }

    private walkWenn(expr: WennExpr): Fragment {
        const d = this.addNode('decision', this.exprLabel(expr.condition) || '(?)');
        const exits: ExitPort[] = [];
        if (expr.then) {
            const t = this.walkExpr(expr.then);
            this.edge(d, t.entry, 'ja');
            exits.push(...t.exits);
        } else {
            exits.push({ from: d, label: 'ja' });
        }
        if (expr.else) {
            const e = this.walkExpr(expr.else);
            this.edge(d, e.entry, 'nein');
            exits.push(...e.exits);
        } else {
            exits.push({ from: d, label: 'nein' });
        }
        return { entry: d, exits };
    }

    /** `wähle (subject)` über Enum → ein `case`-Knoten mit beschrifteten Ausgängen. */
    private walkCase(expr: WaehleExpr): Fragment {
        const head = this.addNode('case', `wähle ${this.exprLabel(expr.subject)}`);
        const exits: ExitPort[] = [];
        for (const arm of expr.arms) {
            const label = isFallArm(arm)
                ? arm.patterns.map((p) => this.exprLabel(p)).join(', ')
                : 'sonst';
            const result = arm.result;
            if (!result) { exits.push({ from: head, label }); continue; }
            const frag = this.walkExpr(result);
            this.edge(head, frag.entry, label);
            exits.push(...frag.exits);
        }
        return { entry: head, exits };
    }

    /** `wähle` ohne subject → boolesche `falls`-Kaskade aus Rauten. */
    private walkKaskade(expr: WaehleExpr): Fragment {
        let entry: string | undefined;
        let pendingNein: ExitPort[] = [];
        const exits: ExitPort[] = [];
        for (const arm of expr.arms) {
            if (isFallArm(arm)) {
                const d = this.addNode('decision', arm.patterns.map((p) => this.exprLabel(p)).join(' oder '));
                if (entry === undefined) entry = d;
                this.connect(pendingNein, d);
                if (arm.result) {
                    const frag = this.walkExpr(arm.result);
                    this.edge(d, frag.entry, 'ja');
                    exits.push(...frag.exits);
                } else {
                    exits.push({ from: d, label: 'ja' });
                }
                pendingNein = [{ from: d, label: 'nein' }];
            } else {
                // SonstArm: letzter `nein`-Zweig mündet hier.
                if (arm.result) {
                    const frag = this.walkExpr(arm.result);
                    // Reines `wähle { sonst -> … }` (kein `falls`): das
                    // sonst-Fragment ist der Einstieg, sonst zeigte `entry`
                    // unten auf einen Ausgangs- statt Eingangsknoten.
                    if (entry === undefined) entry = frag.entry;
                    this.connect(pendingNein, frag.entry);
                    exits.push(...frag.exits);
                }
                pendingNein = [];
            }
        }
        // Ohne `sonst` bleibt der letzte `nein`-Zweig ein offener Ausgang.
        exits.push(...pendingNein);
        return {
            entry: entry ?? exits[0]?.from ?? this.addNode('operation', 'wähle'),
            exits,
        };
    }

    private walkFuer(expr: FuerExpr): Fragment {
        const head = this.addNode(
            'operation',
            `für ${expr.jeden ?? 'jeden'} ${expr.iter ?? '?'} aus ${this.exprLabel(expr.source)}`,
        );
        if (expr.body) {
            const frag = this.walkBlock(expr.body);
            this.edge(head, frag.entry, 'je Element');
            this.connect(frag.exits, head); // Schleifen-Rückkante
        }
        return { entry: head, exits: [{ from: head, label: 'fertig' }] };
    }

    /** Block: `var`/`ausgabe`-Anweisungen als lineare Kette, dann `result`.
     *  Strukturell getypt, damit sowohl `BlockExpr` (Form `): T { … }`) als
     *  auch ein parameterloses `Lambda` (Form `): T = { … }`) passen. */
    private walkBlock(block: { stmts: ReadonlyArray<BlockStmt>; result?: Expr }): Fragment {
        let firstEntry: string | undefined;
        let open: ReadonlyArray<ExitPort> = [];
        const chain = (frag: Fragment): void => {
            if (firstEntry === undefined) firstEntry = frag.entry;
            else this.connect(open, frag.entry);
            open = frag.exits;
        };
        for (const stmt of block.stmts) {
            if (isLetStmt(stmt)) {
                if (istKontrollfluss(stmt.value)) {
                    // `var x = wähle/wenn/…` → Kontrollfluss als Teilgraph
                    // zerlegen, mit voranstehendem Zuordnungs-Knoten `x ←`,
                    // statt den ganzen Block-Text in einen Knoten zu packen.
                    const head = this.addNode('operation', `${stmt.name} ←`);
                    const inner = this.walkExpr(stmt.value);
                    this.edge(head, inner.entry);
                    chain({ entry: head, exits: inner.exits });
                } else {
                    const kind: NodeKind = istAufruf(stmt.value) ? 'subprogram' : 'operation';
                    const id = this.addNode(kind, `${stmt.name} ← ${this.exprLabel(stmt.value)}`);
                    chain({ entry: id, exits: [{ from: id }] });
                }
            } else {
                // AusgabeStmt
                const id = this.addNode('ausgabe', this.exprLabel(stmt.text));
                chain({ entry: id, exits: [{ from: id }] });
            }
        }
        if (block.result) chain(this.walkExpr(block.result));
        if (firstEntry === undefined) {
            // Leerer Block (Teil-Parse) → Platzhalter, damit ein Eintritt existiert.
            const id = this.addNode('operation', '(leer)');
            return { entry: id, exits: [{ from: id }] };
        }
        return { entry: firstEntry, exits: open };
    }
}

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

/** Baut die Ablaufgraphen aller Funktionen eines bereits geparsten
 *  Programms (rein, ohne Datei-I/O — für Tests + Wiederverwendung). */
export function buildModuleGraphs(
    program: Program,
    modul: string,
    opts: { detail: Detail; params?: ParamMode; publicOnly?: boolean },
): PapModul {
    const params = opts.params ?? 'symbole';
    const graphs = program.decls
        .filter(isFunktionDecl)
        // `publicOnly`: interne `_`-Funktionen (SPEC § 4.16) auslassen —
        // nur die öffentliche API bekommt ein eigenes Diagramm.
        .filter((fn) => !opts.publicOnly || !isInternalName(fn.name))
        .map((fn) => new GraphBuilder(fn.name, opts.detail, params).build(fn));
    return { modul, graphs };
}

/** Lädt FinDSL-Dateien und baut je Modul die Ablaufgraphen. */
export async function buildPapModel(
    files: ReadonlyArray<string>,
    opts: { detail: Detail; params?: ParamMode; publicOnly?: boolean },
): Promise<PapModul[]> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const absFiles = files.map((f) => path.resolve(f));
    const base = commonBase(absFiles);
    const out: PapModul[] = [];

    for (const file of files) {
        const abs = path.resolve(file);
        try {
            const content = await fs.readFile(file, 'utf-8');
            const document = services.shared.workspace.LangiumDocumentFactory.fromString(
                content, URI.file(abs),
            );
            await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
            const program = document.parseResult.value as Program;
            const modul = buildModuleGraphs(program, displayId(abs, base), opts);
            // Module ohne diagrammierbare Funktion (z. B. reine `prüfe`-Test-
            // dateien) überspringen — kein Titel ohne Inhalt.
            if (modul.graphs.length > 0) out.push(modul);
        } catch (err) {
            // Eine kaputte/unlesbare Datei überspringen, nicht die ganze Batch
            // abbrechen — bereits gebaute Module bleiben erhalten.
            console.warn(`⚠ PAP übersprungen (${file}): `
                + (err instanceof Error ? err.message : String(err)));
        }
    }

    out.sort((a, b) => a.modul.localeCompare(b.modul));
    return out;
}
