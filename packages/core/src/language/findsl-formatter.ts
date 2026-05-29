/**
 * Formatter für FinDSL (LSP `textDocument/formatting` + Range + OnType).
 *
 * Zwei Ebenen:
 *
 *  A) Block-Struktur — Einrückung + ein Element pro Zeile:
 *       `prüfe { … }`  ·  `wähle { … }`  ·  Block-Body `{ … }`
 *
 *  B) Inline-Deklarations-Spacing — kollabiert wilden Whitespace in
 *     Deklarationen auf die kanonische Form:
 *       `@Quelle("…")`            (keine Spaces in den Klammern)
 *       `konst NAME: Typ = wert`  (`:` ohne Space davor/eins danach,
 *                                  `=` mit je einem Space)
 *       analog `var`, `fn`-Signatur, Parameter, Felder.
 *     Top-Level-Deklarationen werden auf Spalte 0 gezogen, vorhandene
 *     Leerzeilen-Gruppierung (Abschnitts-Banner) bleibt via `fit` erhalten.
 *
 * `datensatz(…)`-Feldlisten werden in mehrzeiliger Form jetzt in ein
 * **Zwei-Spalten-Layout** gebracht: Feldname + `:` linksbündig, alle
 * Typen auf einer Spalte (Breite = längster Feldname im Datensatz + 1).
 * Damit ersetzt der Formatter die frühere Hand-Ausrichtung (vormals
 * § 4.15-geschützt) durch eine deterministische, idempotente Regel —
 * auch bei Trailing-`//`-Kommentaren (deren Abstand zum `,` bleibt
 * unangetastet, nur die Name/Typ-Spalte wird normalisiert).
 * `aufzählung{…}`-Werteliste bleibt unangetastet. Langium editiert nur,
 * wo eine Regel greift; alles ohne Regel bleibt byte-identisch.
 */

import type { AstNode, LangiumDocument } from 'langium';
import { CstUtils, GrammarUtils } from 'langium';
import { AbstractFormatter, Formatting } from 'langium/lsp';
import type { FormattingOptions, Range, TextEdit } from 'vscode-languageserver';
import {
    isAnnotation,
    isAufzaehlungDecl,
    isBinaryOp,
    isBlockExpr,
    isCall,
    isCallArg,
    isCast,
    isDatensatzDecl,
    isDeclPrefix,
    isFallArm,
    isField,
    isFunktionBody,
    isFunktionDecl,
    isImportDecl,
    isImportItem,
    isKonstDecl,
    isLambda,
    isLetStmt,
    isNullCheck,
    isParam,
    isProgram,
    isPruefeDecl,
    isRange,
    isSonstArm,
    isUnaryOp,
    isWaehleExpr,
    isWennExpr,
    type FunktionBody,
    type FunktionDecl,
    type Type as TypeAnnotation,
    type TypeAtom,
} from './generated/ast.js';

/** Projektweit erzwungene Einrückung: 4 Leerzeichen (keine Tabs). */
const INDENT_SIZE = 4;

/**
 * Richtet `@param`/`@rückgabe`-Zeilen eines Doc-Kommentars zweispaltig
 * aus — analog zum `datensatz`-Zwei-Spalten-Layout:
 *
 *   `@param zve`       linksbündige erste Spalte, Breite = längste
 *                      Marke (`@param <name>` bzw. `@rückgabe`) + 1;
 *   Beschreibung       fluchtet auf einer Spalte; Fortsetzungszeilen
 *                      (eingerückte Folgezeilen einer Beschreibung)
 *                      hängen unter der Beschreibungsspalte.
 *
 * Reine Funktion über den Roh-Text des `DOC_COMMENT`-Tokens (Langiums
 * `Formatting`-API kann Token-INHALT nicht umformen). Nur Tag- und
 * deren Fortsetzungszeilen werden angefasst; Prosa, Überschriften,
 * Leerzeilen, ```-Codeblöcke und die `--`-Marker bleiben byte-genau.
 * Spaltenbreite rein aus den Markennamen abgeleitet ⇒ idempotent.
 */
export function alignDocTags(text: string): string {
    if (!text.includes('@param') && !text.includes('@rückgabe')) return text;
    const lines = text.split('\n');
    const TAG = /^(?:@param\s+(\S+)|@rückgabe)(?:\s+(.*))?$/u;
    type Info =
        | { kind: 'tag'; label: string; desc: string }
        | { kind: 'cont'; desc: string }
        | { kind: 'other' };
    const info: Info[] = [];
    let fence = false;
    let active = false;
    for (const ln of lines) {
        if (/^\s*```/.test(ln)) { fence = !fence; active = false; info.push({ kind: 'other' }); continue; }
        if (fence) { active = false; info.push({ kind: 'other' }); continue; }
        const m = ln.match(TAG);
        if (m) {
            const label = m[1] ? `@param ${m[1]}` : '@rückgabe';
            info.push({ kind: 'tag', label, desc: (m[2] ?? '').trim() });
            active = true;
            continue;
        }
        if (active && /^\s+\S/.test(ln)) {
            info.push({ kind: 'cont', desc: ln.trim() });
            continue;
        }
        active = false;
        info.push({ kind: 'other' });
    }
    const labelLens = info.flatMap((i) => (i.kind === 'tag' ? [i.label.length] : []));
    if (labelLens.length === 0) return text;
    const maxLabel = Math.max(...labelLens);
    const descCol = maxLabel + 1;
    return lines.map((ln, i) => {
        const inf = info[i];
        if (inf.kind === 'tag') {
            if (!inf.desc) return inf.label;
            return `${inf.label}${' '.repeat(maxLabel - inf.label.length)} ${inf.desc}`;
        }
        if (inf.kind === 'cont') {
            return inf.desc ? `${' '.repeat(descCol)}${inf.desc}` : '';
        }
        return ln;
    }).join('\n');
}

/** Decl mit nicht-leerem Doc-/Annotations-Präfix? */
function hasDocPrefix(node: AstNode): boolean {
    const p = (node as { docPrefix?: { doc?: string; annotations?: unknown[] } }).docPrefix;
    return !!p && (!!p.doc || (p.annotations?.length ?? 0) > 0);
}

/** Positions-Vergleich (`a` < `b` ⇒ <0). */
function posCmp(
    a: { line: number; character: number },
    b: { line: number; character: number },
): number {
    return a.line - b.line || a.character - b.character;
}

/** Echte Bereichs-Überschneidung (Berührung an den Endpunkten zählt NICHT). */
function rangesOverlap(a: Range, b: Range): boolean {
    return posCmp(a.start, b.end) < 0 && posCmp(b.start, a.end) < 0;
}

/** Liegt `inner` vollständig in `outer`? */
function rangeContains(outer: Range, inner: Range): boolean {
    return posCmp(outer.start, inner.start) <= 0 && posCmp(inner.end, outer.end) <= 0;
}

/**
 * Formatter-Direktiven (SPEC § 2.3.1) — Match gegen den **ganzen**
 * LINE_COMMENT-Text inkl. `//`; case-sensitiv, Zusatztext hebt auf.
 */
const RE_FMT_OFF = /^\/\/[ \t]*@formatter:off[ \t]*$/;
const RE_FMT_ON = /^\/\/[ \t]*@formatter:on[ \t]*$/;

/**
 * Geschützte Bereiche aus `// @formatter:off` … `// @formatter:on`
 * (SPEC § 2.3.1). Erkennung **token-basiert** über echte hidden
 * LINE_COMMENT-Tokens ⇒ `//` in `"…"`/`"""…"""`/`${…}` ist nie eine
 * Direktive. Region = ganze Zeilen inkl. beider Direktiv-Zeilen;
 * `off` ohne `on` → bis Dateiende; Streu-`on` → ignoriert; ein
 * zweites `off` in offener Region → No-op (keine Schachtelung). Ohne
 * Direktive: leer ⇒ Filter ist Identität (byte-identisch zu vorher).
 */
function protectedRegions(document: LangiumDocument): Range[] {
    const root = document.parseResult?.value?.$cstNode;
    if (!root) return [];
    const td = document.textDocument;
    const comments = CstUtils.flattenCst(root)
        .filter((n) => n.hidden && n.tokenType?.name === 'LINE_COMMENT')
        .toArray()
        .sort((a, b) => a.offset - b.offset);
    const regions: Range[] = [];
    let openLine: number | undefined;
    for (const c of comments) {
        const line = c.range.start.line;
        if (RE_FMT_OFF.test(c.text)) {
            if (openLine === undefined) openLine = line;       // verschachteltes off = No-op
        } else if (RE_FMT_ON.test(c.text) && openLine !== undefined) {
            regions.push({
                start: { line: openLine, character: 0 },
                end: { line: line + 1, character: 0 },         // inkl. EOL der on-Zeile
            });
            openLine = undefined;
        }
        // Streu-`on` (kein offenes `off`) → ignoriert
    }
    if (openLine !== undefined) {                              // off ohne on → bis EOF
        regions.push({
            start: { line: openLine, character: 0 },
            end: td.positionAt(td.getText().length),
        });
    }
    return regions;
}

/**
 * Breite der „linken Spalte" eines `wähle`-Arms = Text von `falls`/
 * `sonst` bis unmittelbar vor das Separator-`->`, mit zu je einem
 * Leerzeichen kollabiertem Whitespace. Das entspricht exakt der
 * kanonisch formatierten Linken (Operatoren/`,` werden ohnehin auf ein
 * Space gebracht) ⇒ nach einem Format-Lauf stabil ⇒ idempotent.
 */
function armLinkeBreite(
    arm: { $cstNode?: { text: string } },
): number {
    const t = arm.$cstNode?.text ?? '';
    const i = t.indexOf('->');
    return (i >= 0 ? t.slice(0, i) : t).replace(/\s+/g, ' ').trim().length;
}

/**
 * Polsterung vor dem Separator-`->` eines Arms, damit alle `->` eines
 * `wähle` fluchten (Spaltenbreite = längste Arm-Linke + 1; der längste
 * Arm bekommt genau ein Space). `undefined`, wenn der Arm nicht in einem
 * `wähle` mit ≥1 Arm sitzt (kein Eingriff → ein Space wie bisher).
 */
function arrowPad(arm: AstNode): number | undefined {
    const c = (arm as { $container?: AstNode }).$container;
    if (!c || !isWaehleExpr(c)) return undefined;
    const arms = (c as { arms?: ReadonlyArray<AstNode> }).arms ?? [];
    if (arms.length === 0) return undefined;
    // Bricht die Linke DIESES Arms um, steht das `->` inline hinter
    // der letzten Fortsetzungszeile (ein Space) — NICHT in der Spalte.
    if (armLinkeUmbricht(arm)) return 1;
    const max = maxArmLinkeOhneUmbruch(arms);
    if (max === undefined) return undefined;
    return max - armLinkeBreite(arm) + 1;
}

/** Maximale Zeilenbreite, ab der Operator-Ketten umgebrochen werden. */
const MAX_LINE = 120;

/** Whitespace zu je einem Space kollabiert (Längen-/Breitenmaß). */
function flat(s: string | undefined): string {
    return (s ?? '').replace(/\s+/g, ' ').trim();
}

/** Kanonische Typ-Schreibweise (parallel zu findsl-symbols.typeToString). */
function typeStr(t: TypeAnnotation | undefined): string {
    if (!t || !t.atom) return '?';
    return typeAtomStr(t.atom) + (t.optional ? '?' : '');
}
function typeAtomStr(atom: TypeAtom): string {
    if (atom.$type === 'NamedType') {
        const args = atom.typeArgs?.args.map(typeStr).join(', ');
        return args ? `${atom.name}<${args}>` : atom.name;
    }
    const params = atom.paramTypes.map(typeStr).join(', ');
    return `(${params}) -> ${atom.returnType ? typeStr(atom.returnType) : '?'}`;
}

/**
 * Kanonische Prefix-Breite einer `fn`-Deklaration bis EINSCHLIESSLICH
 * ` = ` (Spalte, an der der Rumpf-Ausdruck beginnt): `fn N(params): T = `.
 * Strukturell aus Namen+Typen berechenbar (trägt nie variable
 * Ausrichtungs-Polsterung) ⇒ über Format-Läufe stabil ⇒ idempotente
 * Umbruch-Entscheidung.
 */
function funktionDeclPrefixWidth(fd: FunktionDecl): number {
    const params = fd.params
        .map((p) => `${p.name}: ${typeStr(p.type)}`
            + (p.default ? ` = ${flat(p.default.$cstNode?.text)}` : ''))
        .join(', ');
    return 3 + (fd.name?.length ?? 1) + 1 + params.length + 1
        + 2 + typeStr(fd.returnType).length + 3;
}

/**
 * Breite des Funktions-Rumpfs, WENN er einzeilig hinter `= ` stünde:
 * Prefix (`fn N(params): T = `) + flach gerechnete Ausdrucksbreite.
 * Maß für die 120-Zeichen-Entscheidung bei intern nicht umbrechbaren
 * Rumpf-Ausdrücken (Postfix-/Methodenketten, Calls …).
 */
function funktionBodyInlineWidth(body: FunktionBody): number {
    return funktionDeclPrefixWidth(body.$container)
        + flat(body.expr?.$cstNode?.text).length;
}

/**
 * Kanonische Prefix-Breite (Spalte, an der der Rumpf-Ausdruck beginnt)
 * NUR wenn die Operator-Kette der direkte Rumpf einer `fn`/`konst`/
 * `var`-Deklaration ist — diese Prefixe (`fn N(p: T): R = `,
 * `konst N: T = `, `var n: T = `) tragen NIE variable Ausrichtungs-
 * Polsterung (anders als `wähle`-Arm-/datensatz-/`@param`-Spalten) ⇒
 * strukturell aus Namen+Typen berechenbar ⇒ über Format-Läufe stabil
 * ⇒ idempotente Umbruch-Entscheidung. Andere Kontexte (Arm-RHS, Call-
 * Argument …) liefern `undefined` → KEIN Breiten-Auto-Umbruch (nur
 * `fit`, das Autor-Umbrüche bewahrt), da deren Startspalte vom selben
 * Lauf verschoben wird (sonst Oszillation).
 */
function declPrefixWidth(chainRoot: AstNode): number | undefined {
    const c = (chainRoot as { $container?: AstNode }).$container;
    if (!c) return undefined;
    if (isKonstDecl(c)) {
        return 6 + (c.name?.length ?? 1) + 2 + typeStr(c.type).length + 3;
    }
    if (isLetStmt(c)) {
        return 4 + (c.name?.length ?? 1) + 2 + typeStr(c.type).length + 3;
    }
    if (c.$type === 'FunktionBody') {
        const fd = (c as { $container?: AstNode }).$container;
        if (!fd || !isFunktionDecl(fd)) return undefined;
        return funktionDeclPrefixWidth(fd);
    }
    // `wähle`-Arm-RHS: Startspalte ist DETERMINISTISCH aus dem Layout
    // (nicht aus der — im selben Lauf verschobenen — Quell-Spalte!):
    //   Einrücktiefe·4 + längste Arm-Linke + 1 (Pad) + `-> `(3).
    // Alle Terme formatierungs-invariant (AST-Struktur + kollabierte
    // Arm-Texte = dieselbe Quelle wie die `->`-Ausrichtung) ⇒ pass1==
    // pass2 ⇒ idempotent (behebt die frühere Oszillation).
    if (isFallArm(c) || isSonstArm(c)) {
        const we = (c as { $container?: AstNode }).$container;
        if (!we || !isWaehleExpr(we)) return undefined;
        const arms = (we as { arms?: ReadonlyArray<{ $cstNode?: { text: string } }> }).arms ?? [];
        if (arms.length === 0) return undefined;
        const base = indentDepth(c) * INDENT_SIZE;
        // Bedingung (`patterns`, LINKS vom `->`) beginnt nach `falls ` an der
        // Arm-Einrückung — NICHT an der (variabel gepolsterten) `->`-Spalte.
        // Sonst übernähme eine kurze Bedingung die Breite der LÄNGSTEN Arm-
        // Linken und bräche grundlos um. Mehrere `patterns` sind komma-
        // getrennt: jede Vorgänger-Breite + `, ` (=2) aufaddieren.
        if (isFallArm(c)) {
            const idx = c.patterns.findIndex((p) => p === chainRoot);
            if (idx >= 0) {
                const before = c.patterns
                    .slice(0, idx)
                    .reduce((w, p) => w + flat(p.$cstNode?.text).length + 2, 0);
                return base + 'falls '.length + before;
            }
        }
        // RHS (Arm-Resultat): deterministische `->`-Spalte aus dem Layout
        // — nur Arme OHNE Bedingungs-Umbruch bestimmen die Spalte.
        const maxLeft = maxArmLinkeOhneUmbruch(arms as ReadonlyArray<AstNode>);
        if (maxLeft === undefined) return undefined;
        return base + maxLeft + 4;
    }
    return undefined;
}

/**
 * Struktur-abgeleitete Einrücktiefe (Anzahl umschließender Einrück-
 * Scopes): jeder `wähle` (Arme), `BlockExpr`/`Lambda` (Stmts/Result)
 * und `prüfe` (Beispiele) auf dem `$container`-Pfad steuert genau eine
 * Ebene bei — spiegelt die `indent()`-Regeln des Formatters. Quell-
 * unabhängig ⇒ stabil über Format-Läufe.
 */
function indentDepth(node: AstNode): number {
    let d = 0;
    let n = (node as { $container?: AstNode }).$container;
    while (n) {
        if (isWaehleExpr(n) || isBlockExpr(n) || isLambda(n) || isPruefeDecl(n)) d++;
        n = (n as { $container?: AstNode }).$container;
    }
    return d;
}

/**
 * Soll die Operator-Kette von `node` wegen Überlänge umgebrochen
 * werden? Wurzel der (links-assoziativen) Kette ermitteln, dann
 * Prefix-Breite + flach gerechnete Kettenbreite > MAX_LINE. Jeder
 * `BinaryOp` derselben Kette liefert dieselbe Wurzel ⇒ dieselbe
 * Entscheidung ⇒ alle Operatoren brechen oder keiner.
 */
function chainExceedsMax(node: AstNode): boolean {
    let root = node;
    while (isBinaryOp((root as { $container?: AstNode }).$container)) {
        root = (root as { $container: AstNode }).$container;
    }
    const pw = declPrefixWidth(root);
    if (pw === undefined) return false;
    return pw + flat(root.$cstNode?.text).length > MAX_LINE;
}

/**
 * Erstreckt sich die Arm-Linke (`falls …` bis vor das `->`) über mehrere
 * Zeilen in der AUSGABE? Zwei Quellen:
 *
 *  1. Auto-Umbruch: eine `patterns`-Kette ist zu lang (`chainExceedsMax`)
 *     ⇒ der `BinaryOp`-Regelzweig erzwingt `indent()` vor jedem Operator.
 *  2. Autor-Umbruch: die Quell-Linke enthält bereits einen Zeilenumbruch
 *     ⇒ der `fit(oneSpace, indent)`-Zweig BEWAHRT ihn.
 *
 * In beiden Fällen sitzt das `->` inline hinter der letzten Fortsetzungs-
 * zeile; ein solcher Arm darf die gemeinsame `->`-Spalte NICHT mit seiner
 * (flach gerechneten) Gesamtbreite aufblähen. `sonst` hat keine Bedingung
 * ⇒ nie. Beide Kriterien sind über Format-Läufe stabil (Quell-Newline
 * bleibt erhalten, `chainExceedsMax` ist `flat()`-basiert) ⇒ idempotent.
 */
function armLinkeUmbricht(arm: AstNode): boolean {
    const t = (arm as { $cstNode?: { text: string } }).$cstNode?.text ?? '';
    const i = t.indexOf('->');
    if ((i >= 0 ? t.slice(0, i) : t).includes('\n')) return true;   // Autor-Umbruch
    if (!isFallArm(arm)) return false;
    return arm.patterns.some((p) => isBinaryOp(p) && chainExceedsMax(p)); // Auto-Umbruch
}

/**
 * Spaltenbreite für die `->`-Ausrichtung = längste Arm-Linke unter den
 * Armen, deren Linke NICHT umbricht. Umbrechende Arme setzen ihr `->`
 * inline hinter die letzte Fortsetzungszeile und dürfen die gemeinsame
 * Spalte daher nicht aufblähen. `undefined`, wenn alle Arme umbrechen
 * (kein Spaltenlayout). `flat()`-basiert ⇒ idempotent.
 */
function maxArmLinkeOhneUmbruch(arms: ReadonlyArray<AstNode>): number | undefined {
    const widths = arms.filter((a) => !armLinkeUmbricht(a)).map((a) => armLinkeBreite(a));
    return widths.length > 0 ? Math.max(...widths) : undefined;
}

/** Erstreckt sich die Argumentliste eines Aufrufs über mehrere Zeilen? */
function callIstMehrzeilig(
    call: { args: ReadonlyArray<{ $cstNode?: { range: { start: { line: number }; end: { line: number } } } }> },
): boolean {
    const as = call.args;
    const a = as[0]?.$cstNode?.range.start.line;
    const b = as[as.length - 1]?.$cstNode?.range.end.line;
    return as.length > 0 && a !== undefined && b !== undefined && a !== b;
}

/** Erstreckt sich die Feldliste eines `datensatz` über mehrere Zeilen? */
function datensatzIstMehrzeilig(
    decl: { fields: ReadonlyArray<{ $cstNode?: { range: { start: { line: number }; end: { line: number } } } }> },
): boolean {
    const fs = decl.fields;
    const a = fs[0]?.$cstNode?.range.start.line;
    const b = fs[fs.length - 1]?.$cstNode?.range.end.line;
    return fs.length > 0 && a !== undefined && b !== undefined && a !== b;
}

/** Erstreckt sich die Parameterliste einer `fn` über mehrere Zeilen? */
function fnParamsIstMehrzeilig(
    decl: { params: ReadonlyArray<{ $cstNode?: { range: { start: { line: number }; end: { line: number } } } }> },
): boolean {
    const ps = decl.params;
    const a = ps[0]?.$cstNode?.range.start.line;
    const b = ps[ps.length - 1]?.$cstNode?.range.end.line;
    return ps.length > 0 && a !== undefined && b !== undefined && a !== b;
}

export class FindslFormatter extends AbstractFormatter {

    /**
     * Single-Chokepoint aller Entry-Points (Document/Range/OnType laufen
     * alle hier durch). Erzwingt projektweit **Leerzeichen-Einrückung
     * der Größe 4**, unabhängig von den Client-`FormattingOptions`:
     *
     *  1. `insertSpaces: true`  → der Formatter emittiert alle
     *     strukturellen Einrückungen mit Blanks; bestehende Tab-
     *     Einrückung in regel-abgedeckten Bereichen (faktisch jede
     *     Decl/jeder Block, da Spalte-0 bzw. `indent()`-neu-emittiert)
     *     wird damit zu Blanks konvertiert.
     *  2. `tabSize: 4`          → feste Einrückungsgröße.
     *
     * Bewusst nicht über die Client-Optionen steuerbar — FinDSL-Quellen
     * sollen kanonisch (4 Blanks) aussehen, einheitlich fürs Audit.
     */
    protected override doDocumentFormat(
        document: LangiumDocument, options: FormattingOptions, range?: Range,
    ): TextEdit[] {
        const edits = super.doDocumentFormat(
            document,
            { ...options, insertSpaces: true, tabSize: INDENT_SIZE },
            range,
        );
        // Doc-Kommentar-Inhalt (`@param`/`@rückgabe`) zweispaltig — als
        // separate Replace-Edits, da Langiums Token-Formatter Terminal-
        // INHALT nicht umformen kann. Überlappen die Gap-Edits von oben
        // nicht (eigenes Token-Range); Sicherheitscheck zusätzlich.
        // Analog: Inline-Kommentare (`//` nach `,` in mehrzeiligen
        // Datensatz-Feldern) werden auf eine gemeinsame Spalte
        // ausgerichtet (Issue #202).
        const all = [
            ...edits,
            ...this.docTagEdits(document, edits, range),
            ...this.inlineCommentEdits(document),
        ];
        // `// @formatter:off`…`// @formatter:on` (SPEC § 2.3.1): jeden
        // Edit verwerfen, dessen Range eine geschützte Region berührt
        // ⇒ Quelltext dort byte-für-byte erhalten. Deckt ALLE Quellen
        // ab (AST-Layout, erzwungene 4-Blank-Einrückung, docTagEdits),
        // da alle hier zusammenlaufen. Ohne Direktive: leer ⇒ Identität.
        const regions = protectedRegions(document);
        return regions.length === 0
            ? all
            : all.filter((e) => !regions.some((p) => rangesOverlap(e.range, p)));
    }

    /** Replace-Edits, die `@param`/`@rückgabe` in Doc-Kommentaren ausrichten. */
    private docTagEdits(
        document: LangiumDocument, base: TextEdit[], range?: Range,
    ): TextEdit[] {
        const program = document.parseResult?.value as {
            fileDoc?: AstNode & { doc?: string };
            decls?: ReadonlyArray<{ docPrefix?: AstNode & { doc?: string } }>;
        } | undefined;
        if (!program) return [];
        const prefixes = [
            program.fileDoc,
            ...(program.decls ?? []).map((d) => d.docPrefix),
        ];
        const out: TextEdit[] = [];
        for (const prefix of prefixes) {
            if (!prefix?.doc || !prefix.$cstNode) continue;
            const docCst = GrammarUtils.findNodeForProperty(prefix.$cstNode, 'doc');
            if (!docCst) continue;
            const aligned = alignDocTags(docCst.text);
            if (aligned === docCst.text) continue;                 // idempotent: kein No-op-Edit
            const r = docCst.range;
            if (range && !rangeContains(range, r)) continue;       // Range-Format: nur innerhalb
            if (base.some((e) => rangesOverlap(e.range, r))) continue;
            out.push({ range: r, newText: aligned });
        }
        return out;
    }

    /**
     * Inline-Kommentar-Ausrichtung in mehrzeiligen `datensatz`-Feldern
     * (Issue #202, Spalte 4): pro Datensatz alle trailing `//`-Kommentare
     * auf eine gemeinsame Spalte gepaddet — die Whitespace-Lücke zwischen
     * `,` und `//` wird per Replace-Edit gesetzt.
     *
     * Berechnung pro Feld (relativ zum Typ-Anfang, targeted Output):
     *   - mit Default:    `rowTail = maxTypeLen + 3 + |default| + 1`
     *   - ohne Default:   `rowTail = typeLen + 1`
     *   - `commentCol = max(rowTail über Felder mit `//`) + 1`
     *   - Whitespace zwischen `,` und `//` = `commentCol − rowTail`
     *
     * Felder ohne Inline-Kommentar erzeugen KEINEN Edit ⇒ keine
     * Trailing-Spaces. `@formatter:off`-Regionen schützt der finale
     * Overlap-Filter in `doDocumentFormat`.
     */
    private inlineCommentEdits(document: LangiumDocument): TextEdit[] {
        const program = document.parseResult?.value as {
            decls?: ReadonlyArray<AstNode>;
        } | undefined;
        if (!program?.decls) return [];
        const text = document.textDocument.getText();
        const out: TextEdit[] = [];

        for (const decl of program.decls) {
            if (isDatensatzDecl(decl) && datensatzIstMehrzeilig(decl)) {
                this.alignInlineComments(decl.fields, text, document, out);
            } else if (isFunktionDecl(decl) && fnParamsIstMehrzeilig(decl)) {
                this.alignInlineComments(decl.params, text, document, out);
            }
        }
        return out;
    }

    /**
     * Berechnet `commentCol` und emittiert pro Sibling mit trailing
     * Inline-`//` einen Replace-Edit für den Whitespace zwischen `,` und
     * `//`. Wird sowohl für datensatz-Felder als auch für fn-Parameter
     * verwendet (identische Spalten-Logik).
     */
    private alignInlineComments(
        siblings: ReadonlyArray<{
            type?: { $cstNode?: { text: string } };
            default?: { $cstNode?: { text: string } };
            $cstNode?: { range: Range; offset: number; end: number };
        }>,
        text: string,
        document: LangiumDocument,
        out: TextEdit[],
    ): void {
        if (siblings.length === 0) return;
        const maxTypeLen = Math.max(
            ...siblings.map((s) => s.type?.$cstNode?.text.length ?? 0),
        );
        const rows: Array<{
            rowTail: number;
            commaEnd: number;
            slashStart: number;
        } | undefined> = siblings.map((s) => {
            const cst = s.$cstNode;
            if (!cst) return undefined;
            let i = cst.end;
            while (i < text.length && text[i] !== ',' && text[i] !== '\n') i++;
            if (i >= text.length || text[i] !== ',') return undefined;
            const commaEnd = i + 1;
            let j = commaEnd;
            while (j < text.length && (text[j] === ' ' || text[j] === '\t')) j++;
            if (j + 1 >= text.length || text[j] !== '/' || text[j + 1] !== '/') return undefined;
            const typeLen = s.type?.$cstNode?.text.length ?? 0;
            const rowTail = s.default
                ? maxTypeLen + 3 + (s.default.$cstNode?.text.length ?? 0) + 1
                : typeLen + 1;
            return { rowTail, commaEnd, slashStart: j };
        });
        const present = rows.filter((r): r is NonNullable<typeof r> => r !== undefined);
        if (present.length === 0) return;
        const commentCol = Math.max(...present.map((r) => r.rowTail)) + 1;
        for (const r of present) {
            const padding = commentCol - r.rowTail;
            out.push({
                range: {
                    start: document.textDocument.positionAt(r.commaEnd),
                    end:   document.textDocument.positionAt(r.slashStart),
                },
                newText: ' '.repeat(Math.max(1, padding)),
            });
        }
    }

    protected format(node: AstNode): void {
        // ---- A) Block-Strukturen ------------------------------------------
        if (isPruefeDecl(node)) {
            const f = this.getNodeFormatter(node);
            const open = f.keyword('{');
            const close = f.keyword('}');
            open.prepend(Formatting.oneSpace());
            f.interior(open, close).prepend(Formatting.indent());
            f.properties('testfaelle').prepend(Formatting.indent());
            close.prepend(Formatting.newLine());
            return;
        }
        if (isWaehleExpr(node)) {
            const f = this.getNodeFormatter(node);
            const open = f.keyword('{');
            const close = f.keyword('}');
            open.prepend(Formatting.oneSpace());
            f.interior(open, close).prepend(Formatting.indent());
            f.properties('arms').prepend(Formatting.indent());
            close.prepend(Formatting.newLine());
            return;
        }
        if (isBlockExpr(node) || isLambda(node)) {
            const f = this.getNodeFormatter(node);
            const open = f.keyword('{');
            const close = f.keyword('}');
            open.prepend(Formatting.oneSpace());
            f.interior(open, close).prepend(Formatting.indent());
            f.properties('stmts').prepend(Formatting.indent());
            f.property('result').prepend(Formatting.indent());
            close.prepend(Formatting.newLine());
            if (isLambda(node)) f.keyword('->').surround(Formatting.oneSpace());
            return;
        }

        // ---- `verwende { … } aus "…"` -------------------------------------
        // Jeder Import IMMER auf eigener, um 4 eingerückter Zeile; `}` auf
        // eigener Zeile, dann ` aus "…"`. Idempotentes Rezept exakt wie
        // datensatz-Multiline (interior+properties indent, Komma klebt am
        // Item ohne Append → keine Trenn-/Trailing-Komma-Oszillation).
        if (isImportDecl(node)) {
            const f = this.getNodeFormatter(node);
            const open = f.keyword('{');
            const close = f.keyword('}');
            open.prepend(Formatting.oneSpace());                 // verwende {
            f.interior(open, close).prepend(Formatting.indent());
            f.properties('items').prepend(Formatting.indent());
            f.keywords(',').prepend(Formatting.noSpace());
            close.prepend(Formatting.newLine());
            f.keyword('aus').surround(Formatting.oneSpace());     // } aus "…"
            return;
        }
        if (isImportItem(node)) {
            // `Foo als bar` — einheitliches Spacing innerhalb des Items.
            this.getNodeFormatter(node).keyword('als').surround(Formatting.oneSpace());
            return;
        }

        // ---- Ausdrucks-/Operator-Spacing (kollabiert Mehrfach-Spaces) -----
        if (isBinaryOp(node)) {
            // Deckt + - * / == != <= >= < > und/oder (alle BinaryOp.op) ab.
            // Lücke VOR dem Operator: > MAX_LINE → Umbruch vor jedem
            // Operator mit hängender Einrückung (erzwingt ≤120, erzeugt
            // die mehrzeilige Kettenform); sonst `fit(oneSpace, indent)`
            // — bewahrt vom Autor gesetzte Umbrüche idempotent (gleiche
            // Mechanik wie der Program-Leerzeilen-Separator) und
            // kollabiert nichts. Nach dem Operator immer ein Space.
            const f = this.getNodeFormatter(node);
            const op = f.property('op');
            op.prepend(
                chainExceedsMax(node)
                    ? Formatting.indent()
                    : Formatting.fit(Formatting.oneSpace(), Formatting.indent()),
            );
            op.append(Formatting.oneSpace());
            return;
        }
        if (isUnaryOp(node)) {
            const f = this.getNodeFormatter(node);
            // `nicht x` mit Space, unäres `-x` ohne.
            f.property('op').append(
                node.op === 'nicht' ? Formatting.oneSpace() : Formatting.noSpace(),
            );
            return;
        }
        if (isCast(node)) {
            this.getNodeFormatter(node).keyword('als').surround(Formatting.oneSpace());
            return;
        }
        if (isNullCheck(node)) {
            const f = this.getNodeFormatter(node);
            f.keyword('ist').surround(Formatting.oneSpace());
            f.keyword('nicht').surround(Formatting.oneSpace());
            f.keyword('nichts').prepend(Formatting.oneSpace());
            return;
        }
        if (isRange(node)) {
            const f = this.getNodeFormatter(node);
            f.keyword('bis').surround(Formatting.oneSpace());
            f.keyword('unter').surround(Formatting.oneSpace());
            f.keyword('schritt').surround(Formatting.oneSpace());
            return;
        }
        if (isFallArm(node)) {
            const f = this.getNodeFormatter(node);
            f.keyword('falls').append(Formatting.oneSpace());
            // Zwei-Spalten-Layout: das Separator-`->` (erstes `->` im
            // Arm) auf eine gemeinsame Spalte rücken. `keyword('->', 0)`
            // trifft gezielt den Separator (ein evtl. `->` im Ergebnis-
            // Ausdruck — Lambda/Funktionstyp — bleibt unberührt).
            const pad = arrowPad(node);
            const arrow = f.keyword('->', 0);
            arrow.prepend(pad !== undefined ? Formatting.spaces(pad) : Formatting.oneSpace());
            arrow.append(Formatting.oneSpace());
            // Pattern-Trenn-Kommas: kein Trailing-Komma in der Grammatik
            // (`patterns (',' patterns)*`) → keine Oszillation.
            f.keywords(',').prepend(Formatting.noSpace()).append(Formatting.oneSpace());
            return;
        }
        if (isSonstArm(node)) {
            // `sonst` und `->` sind benachbart → NUR die `->`-Prepend-
            // Regel bedient diese Lücke (keine `sonst`.append-Regel,
            // sonst Konflikt um dieselbe Lücke).
            const f = this.getNodeFormatter(node);
            const pad = arrowPad(node);
            const arrow = f.keyword('->', 0);
            arrow.prepend(pad !== undefined ? Formatting.spaces(pad) : Formatting.oneSpace());
            arrow.append(Formatting.oneSpace());
            return;
        }
        if (isWennExpr(node)) {
            const f = this.getNodeFormatter(node);
            f.keyword('wenn').append(Formatting.oneSpace());
            f.keyword('sonst').surround(Formatting.oneSpace());
            return;
        }

        // ---- B) Inline-Deklarations-Spacing -------------------------------

        // Top-Level: jede Decl/jeder Import auf Spalte 0; vorhandene
        // Leerzeilen-Gruppierung (Abschnitte) bleibt via `fit` erhalten
        // (idempotent — `fit` mappt den Ist-Abstand stabil auf einen der
        // Kandidaten 0/1/2 Leerzeilen).
        if (isProgram(node)) {
            const f = this.getNodeFormatter(node);
            const sep = Formatting.fit(
                Formatting.newLine(),
                Formatting.newLines(2),
                Formatting.newLines(3),
            );
            f.properties('imports').prepend(sep);
            f.properties('decls').prepend(sep);
            return;
        }

        // Doc-Präfix: Annotationen ab der ZWEITEN je eigene Zeile; die
        // erste nur dann, wenn ein Doc-Kommentar direkt darüber steht.
        // Die Lücke VOR der ersten Annotation (Grenze zur vorherigen
        // Decl) gehört zur Program-Regel oben — NICHT hier kollabieren,
        // sonst verschwindet die Abschnitts-Leerzeile.
        if (isDeclPrefix(node)) {
            const f = this.getNodeFormatter(node);
            const ann = (node as { annotations?: unknown[]; doc?: string });
            const count = ann.annotations?.length ?? 0;
            for (let i = 0; i < count; i++) {
                if (i > 0 || ann.doc) {
                    f.property('annotations', i).prepend(Formatting.newLine());
                }
            }
            return;
        }
        if (isAnnotation(node)) {
            const f = this.getNodeFormatter(node);
            f.keyword('@').append(Formatting.noSpace());        // @Quelle
            f.keyword('(').prepend(Formatting.noSpace()).append(Formatting.noSpace());
            f.keyword(')').prepend(Formatting.noSpace());
            // Bewusst KEINE Komma-Regel: Trenn- vs. Trailing-Komma unter
            // einer `keywords(',')`-Regel oszilliert (nicht idempotent).
            return;
        }
        if (isKonstDecl(node)) {
            const f = this.getNodeFormatter(node);
            if (hasDocPrefix(node)) f.keyword('konst').prepend(Formatting.newLine());
            f.keyword('konst').append(Formatting.oneSpace());
            f.keyword(':').prepend(Formatting.noSpace()).append(Formatting.oneSpace());
            f.keyword('=').surround(Formatting.oneSpace());
            return;
        }
        if (isLetStmt(node)) {
            const f = this.getNodeFormatter(node);
            f.keyword('var').append(Formatting.oneSpace());
            f.keyword(':').prepend(Formatting.noSpace()).append(Formatting.oneSpace());
            f.keyword('=').surround(Formatting.oneSpace());
            return;
        }
        if (isFunktionDecl(node)) {
            const f = this.getNodeFormatter(node);
            if (hasDocPrefix(node)) f.keyword('fn').prepend(Formatting.newLine());
            f.keyword('fn').append(Formatting.oneSpace());
            const open = f.keyword('(');
            const close = f.keyword(')');
            open.prepend(Formatting.noSpace());                // Name( statt Name (
            // Mehrzeilige Param-Liste → analog `datensatz`-Block-Layout
            // (kanonischer Block, Spalten-Padding macht die isParam-Regel).
            // Einzeilige bleiben kompakt (kein interior/`)`-Format,
            // damit Trailing-Komma `,)` vs. Trenn-Komma nicht oszilliert).
            if (fnParamsIstMehrzeilig(node)) {
                f.interior(open, close).prepend(Formatting.indent());
                f.properties('params').prepend(Formatting.indent());
                f.keywords(',').prepend(Formatting.noSpace());
                close.prepend(Formatting.newLine());
            } else {
                open.append(Formatting.noSpace());
                f.keywords(',').prepend(Formatting.noSpace())
                    .append(Formatting.oneSpace());
            }
            f.keyword(':').prepend(Formatting.noSpace()).append(Formatting.oneSpace());
            // Das `=` des Expression-Bodys gehört zum `FunktionBody`-
            // Kindknoten (eigener AST-Knoten, von Langium aus dieser
            // Decl-Region weggeschnitten) → dort formatiert (isFunktionBody).
            return;
        }
        if (isFunktionBody(node) && node.expr) {
            // `: T = expr`. Das `=` umschließt regulär EIN Space. Ein
            // Rumpf-Ausdruck, der EINZEILIG die 120-Zeichen-Grenze
            // überschritte UND nicht selbst intern umbricht (also KEINE
            // `wähle`- und KEINE Operator-Kette), wird nach `=` auf eine
            // eigene, um eine Ebene eingerückte Zeile gesetzt — so bleibt
            // die Zeile ≤ 120. `wähle` (inline `= wähle {`) und BinaryOp-
            // Ketten (erstes Operand bleibt nach `=`, Hang an den
            // Operatoren via chainExceedsMax) brechen selbst → hier
            // ausgenommen. Entscheidung rein strukturell (Prefix-Breite +
            // flache Ausdrucksbreite) ⇒ deterministisch ⇒ idempotent.
            const f = this.getNodeFormatter(node);
            const eq = f.keyword('=');
            eq.prepend(Formatting.oneSpace());
            // Nur EINZEILIGE Rumpf-Ausdrücke umbrechen: ein vom Formatter
            // selbst mehrzeilig gesetzter Ausdruck (mehrzeiliger Konstruktor-
            // Aufruf mit benannten Argumenten, Block …) beginnt mit einer
            // kurzen ersten Zeile (`= Ctor(`) und darf NICHT nach `=`
            // verschoben werden. `wähle` (inline `= wähle {`) und BinaryOp-
            // Ketten (Operator-Hang) brechen ohnehin selbst → ausgenommen.
            const r = node.expr.$cstNode?.range;
            const exprEinzeilig = !!r && r.start.line === r.end.line;
            const breakBody = exprEinzeilig
                && !isWaehleExpr(node.expr)
                && !isBinaryOp(node.expr)
                && funktionBodyInlineWidth(node) > MAX_LINE;
            // Überlauf → erzwungener Umbruch (deterministisch). Sonst
            // `fit`: bewahrt einen vom Autor gesetzten Umbruch bzw. das
            // Inline-Layout idempotent (wie bei Operator-Ketten) — KEIN
            // Kollabieren mehrzeiliger BinaryOp-/wähle-Rümpfe.
            eq.append(breakBody
                ? Formatting.indent()
                : Formatting.fit(Formatting.oneSpace(), Formatting.indent()));
            return;
        }
        if (isDatensatzDecl(node)) {
            const f = this.getNodeFormatter(node);
            if (hasDocPrefix(node)) f.keyword('datensatz').prepend(Formatting.newLine());
            f.keyword('datensatz').append(Formatting.oneSpace());
            const open = f.keyword('(');
            const close = f.keyword(')');
            open.prepend(Formatting.noSpace());                // Name( statt Name (

            if (datensatzIstMehrzeilig(node)) {
                // Kanonischer Block — EINE konsistente Einrückungsebene
                // (idempotentes Rezept wie prüfe/wähle; kein Kaskadieren,
                // kein `)`↔Komma-Konflikt). Die Name/Typ-Spalten-
                // Ausrichtung macht die Field-Regel (kennt den längsten
                // Feldnamen über `$container`). Trailing-`//`-Kommentare
                // bleiben als Hidden-Tokens unberührt (kein Komma-Append).
                f.interior(open, close).prepend(Formatting.indent());
                f.properties('fields').prepend(Formatting.indent());
                f.keywords(',').prepend(Formatting.noSpace());
                close.prepend(Formatting.newLine());
            } else {
                // Einzeilig → kompakt. KEINE `)`-Regel (Trailing-Komma-
                // Oszillation vermeiden); `)`-Position bleibt erhalten.
                open.append(Formatting.noSpace());
                f.keywords(',').prepend(Formatting.noSpace())
                    .append(Formatting.oneSpace());
            }
            return;
        }
        if (isAufzaehlungDecl(node)) {
            const f = this.getNodeFormatter(node);
            if (hasDocPrefix(node)) f.keyword('aufzählung').prepend(Formatting.newLine());
            f.keyword('aufzählung').append(Formatting.oneSpace());
            // `{ … }`-Werteliste bewusst unangetastet (oft hand-gelegt).
            return;
        }
        // ---- Aufruf (Konstruktor/Funktion) -------------------------------
        // Mehrzeiliger Aufruf → kanonischer Block (gleiches idempotentes
        // Rezept wie datensatz-Multiline). Einzeilige Aufrufe bleiben
        // unangetastet (wie fn-Parameter — Trailing-Komma-Oszillation
        // vermeiden). Die `name = wert`-Spalten-Ausrichtung macht die
        // CallArg-Regel (kennt den längsten Argumentnamen via $container).
        if (isCall(node)) {
            if (!callIstMehrzeilig(node)) return;
            const f = this.getNodeFormatter(node);
            const open = f.keyword('(');
            const close = f.keyword(')');
            open.prepend(Formatting.noSpace());                // Name( statt Name (
            f.interior(open, close).prepend(Formatting.indent());
            f.properties('args').prepend(Formatting.indent());
            f.keywords(',').prepend(Formatting.noSpace());
            close.prepend(Formatting.newLine());
            return;
        }
        if (isCallArg(node)) {
            const f = this.getNodeFormatter(node);
            const call = node.$container;
            // Index 0 = das Argument-`=`; ein evtl. `=` im Wert (z. B.
            // verschachtelter benannter Aufruf) gehört zu dessen eigenem
            // CallArg-Knoten und bleibt unberührt.
            if (node.name && isCall(call) && callIstMehrzeilig(call)) {
                const maxNameLen = Math.max(
                    ...call.args.map((a) => a.name?.length ?? 0),
                );
                const pad = maxNameLen - node.name.length + 1;
                f.keyword('=', 0).prepend(Formatting.spaces(pad))
                    .append(Formatting.oneSpace());
            } else if (node.name) {
                f.keyword('=', 0).surround(Formatting.oneSpace());
            }
            return;
        }

        if (isParam(node) || isField(node)) {
            // `name: Typ = default`. `:` klebt am Namen (kein Space davor).
            const f = this.getNodeFormatter(node);
            f.keyword(':').prepend(Formatting.noSpace());

            // Vier-Spalten-Layout (Issue #202 + Folge für fn-Params):
            // Spalte 1 (Name), Spalte 2 (Typ), Spalte 3 (`= default`),
            // Spalte 4 (`//`-Kommentar — separater Post-Pass in
            // `inlineCommentEdits`). Hier emittieren wir die beiden
            // Token-Paddings:
            //  - nach `:` → `maxNameLen − nameLen + 1` (Spalte 1→2)
            //  - vor `=` → `maxTypeLen − typeLen + 1` (Spalte 2→3, nur
            //    wenn Default vorhanden; ohne Default klebt `,` direkt am
            //    Typ — sonst „schwebt" das Komma)
            // Greift für Felder eines MEHRZEILIGEN datensatz UND für
            // Parameter einer fn mit mehrzeiliger Param-Liste.
            // Rein AST-basiert (CST-Text der Typ-Annotation) ⇒ idempotent.
            const container = node.$container;
            const siblings = isField(node) && isDatensatzDecl(container)
                    && datensatzIstMehrzeilig(container) && !!node.name
                ? (container as { fields: ReadonlyArray<{ name?: string; type?: { $cstNode?: { text: string } }; default?: unknown }> }).fields
                : isParam(node) && isFunktionDecl(container)
                    && fnParamsIstMehrzeilig(container) && !!node.name
                ? (container as { params: ReadonlyArray<{ name?: string; type?: { $cstNode?: { text: string } }; default?: unknown }> }).params
                : undefined;
            if (siblings) {
                const maxNameLen = Math.max(
                    ...siblings.map((x) => x.name?.length ?? 0),
                );
                f.keyword(':').append(Formatting.spaces(maxNameLen - node.name.length + 1));
                if ((node as { default?: unknown }).default !== undefined) {
                    const maxTypeLen = Math.max(
                        ...siblings.map((x) => x.type?.$cstNode?.text.length ?? 0),
                    );
                    const typeLen = (node as { type?: { $cstNode?: { text: string } } })
                        .type?.$cstNode?.text.length ?? 0;
                    f.keyword('=').prepend(Formatting.spaces(maxTypeLen - typeLen + 1))
                                  .append(Formatting.oneSpace());
                }
            } else {
                f.keyword(':').append(Formatting.oneSpace());
                f.keyword('=').surround(Formatting.oneSpace());
            }
            return;
        }
    }
}
