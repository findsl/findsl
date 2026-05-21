// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Java-Quelltext-Reflow (Issue #86, Option B): bricht überlange Zeilen
 * deterministisch um, sodass die maximale Zeilenlänge eingehalten wird.
 *
 * Der Emitter (`emitter.ts`) baut Ausdrücke per String-Konkatenation
 * ohne Umbruch — komplexe Ausdrücke landen als eine sehr lange Zeile.
 * Dieser Post-Processor läuft über den fertigen Quelltext und bricht zu
 * lange Zeilen an syntaktisch sicheren Punkten:
 *
 *   1. **Lambda-Blöcke** (`(x) -> { …; … }`) → Statements je Zeile.
 *   2. **Strukturbruch** — der Kandidat auf der **flachsten Klammertiefe**
 *      gewinnt (größte balancierte Stücke):
 *        • Argument-Listen (`f(a, b, c)`) → ein Argument pro Zeile,
 *        • Single-Argument-Aufrufe (`f(g(…))`) → Argument auf eigene Zeile,
 *        • Operatoren (`a || b`, `s + t`) → vor jedem Operator,
 *        • Methoden-Ketten (`recv.a().b()`) → fluent je Folge-Glied.
 *   3. **String-Literal-Split** (`"abc"` → `"ab" + "c"`) als letzte
 *      Instanz für ein einzelnes überlanges Literal (z. B. Gesetzeszitat).
 *
 * String-Literale, Generics (`<A, B>`) und Klammer-Tiefe werden korrekt
 * getrackt, damit niemals innerhalb eines `"…"` oder an einer falschen
 * Ebene umgebrochen wird. Findet sich kein sicherer Umbruchpunkt, bleibt
 * die Zeile unverändert (lieber zu lang als syntaktisch kaputt).
 *
 * Rein + deterministisch ⇒ idempotent (`reflow(reflow(x)) == reflow(x)`).
 * Das Bit-Genauigkeits-Gate (`runtimes/java`, `./gradlew check`) ist
 * **verhaltensbasiert** (Kompilieren + Lauf gegen das Interpreter-Orakel,
 * JavaParser-Struktur) — kein Byte-Vergleich. Umbrüche und das Aufteilen
 * von String-Literalen erhalten das Verhalten und sind damit sicher.
 */

const MAX_LINE = 120;
/** Eine Ebene Continuation-Einrückung für umgebrochene Folgezeilen. */
const CONT = '    ';

export function reflowJava(source: string): string {
    return source
        .split('\n')
        .flatMap((line) => reflowLine(line, 0))
        .join('\n');
}

/**
 * UTF-8-Byte-Breite eines Strings (ohne `Buffer`, browser-/node-portabel).
 * Maßgeblich ist die Byte-Länge, weil das Akzeptanz-Gate (`awk 'length>120'`)
 * Bytes zählt und deutscher Gesetzestext viele Mehrbyte-Zeichen enthält
 * (`§`, `ä`, `ö`, `ü`, `ß`). Eine 120-Zeichen-Zeile mit einem `§` wäre
 * sonst 121 Bytes und überschritte das Limit.
 */
function width(s: string): number {
    let n = 0;
    for (const ch of s) {
        const cp = ch.codePointAt(0)!;
        n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    }
    return n;
}

/** Bricht eine einzelne Zeile um (rekursiv für lange Continuation-Lines). */
function reflowLine(line: string, recursion: number): string[] {
    if (width(line) <= MAX_LINE) return [line];
    // Schutz gegen pathologische Rekursion (sollte nie greifen).
    if (recursion > 32) return [line];

    const indent = leadingSpaces(line);
    const cont = indent + CONT;
    const recur = (ls: string[]): string[] =>
        ls.flatMap((l) => reflowLine(l, recursion + 1));

    const block = breakLambdaBlock(line, indent, cont);
    if (block) return recur(block);

    const structural = breakStructural(line, cont);
    if (structural) return recur(structural);

    const str = breakStringLiteral(line, cont);
    if (str) return recur(str);

    // Kein sicherer Umbruchpunkt (z. B. ein einzelnes überlanges Literal,
    // das schon allein > 120 ist) — Zeile unverändert lassen.
    return [line];
}

function leadingSpaces(line: string): string {
    const m = line.match(/^[ \t]*/);
    return m ? m[0] : '';
}

// ───────────────────────────────────────────────────────────────────────
// Strukturbruch: flachste Klammertiefe gewinnt
// ───────────────────────────────────────────────────────────────────────

/**
 * Wählt unter den Kandidaten (Argument-Gruppe, Operator, Methoden-Kette)
 * den auf der **flachsten Klammertiefe** und bricht dort. Ein flacherer
 * Bruch teilt die Zeile in die größten balancierten Stücke. Bei
 * Gleichstand gilt die Vorrang-Ordnung: Argument-Gruppe → Operator →
 * Kette (Argument-Brüche sind am saubersten; Ketten zuletzt, da sie ohne
 * Konkurrenz ohnehin auf der flachsten Tiefe liegen).
 */
function breakStructural(line: string, cont: string): string[] | undefined {
    const group = shallowestGroup(line);
    const op = shallowestOperator(line);
    const chain = shallowestChain(line);

    const dGroup = group?.depth ?? Infinity;
    const dOp = op?.depth ?? Infinity;
    const dChain = chain?.depth ?? Infinity;
    const min = Math.min(dGroup, dOp, dChain);
    if (!isFinite(min)) return undefined;

    if (dGroup === min) return splitGroup(line, cont, group!);
    if (dOp === min) return splitBefore(line, cont, op!.points);
    return splitBefore(line, cont, chain!.points);
}

/**
 * Bricht vor jedem gegebenen Offset um: das erste Segment behält die
 * Original-Einrückung, jedes Folge-Segment beginnt am Offset (Operator
 * bzw. `.method`) mit Continuation-Einrückung. Für Methoden-Ketten und
 * Operator-Ketten gleichermaßen.
 */
function splitBefore(line: string, cont: string, points: number[]): string[] {
    const out: string[] = [line.slice(0, points[0]).trimEnd()];
    for (let i = 0; i < points.length; i++) {
        const end = i + 1 < points.length ? points[i + 1] : line.length;
        out.push(cont + line.slice(points[i], end).trimStart());
    }
    return out;
}

interface ChainBreak {
    readonly depth: number;
    readonly points: number[];
}

/**
 * Methoden-Ketten-Punkte auf der flachsten Klammertiefe: ein `.` (außerhalb
 * von Strings), das direkt nach `)` steht und von `<ident>(` gefolgt wird
 * (`recv.a().b()`). Qualifizierte Konstanten (`FinDslNumber.Type.X`) sind
 * kein `).method(` und bleiben unberührt.
 */
function shallowestChain(line: string): ChainBreak | undefined {
    const byDepth = new Map<number, number[]>();
    forEachToken(line, (c, i, depth, inString) => {
        if (inString) return;
        if (c === '.' && i > 0 && line[i - 1] === ')') {
            if (/^\p{L}[\p{L}\p{N}_]*\(/u.test(line.slice(i + 1))) {
                (byDepth.get(depth) ?? byDepth.set(depth, []).get(depth)!).push(i);
            }
        }
    });
    return shallowest(byDepth);
}

/**
 * Binäre Operatoren (` || `, ` && `, ` + `) auf der flachsten Klammertiefe.
 * Der Emitter setzt diese stets leerzeichen-umrandet — daher eindeutig von
 * unären/Generic-Zeichen unterscheidbar. Bruch vor dem Operator.
 */
function shallowestOperator(line: string): ChainBreak | undefined {
    const byDepth = new Map<number, number[]>();
    forEachToken(line, (c, i, depth, inString) => {
        if (inString) return;
        if (c !== ' ') return;
        const w4 = line.slice(i, i + 4);     // ` || ` / ` && `
        const isLogic = w4 === ' || ' || w4 === ' && ';
        const isPlus = line.slice(i, i + 3) === ' + ';
        if (!isLogic && !isPlus) return;
        // Führende Continuation-Operatoren (`    + "…"`) ignorieren — vor
        // dem Operator steht nur Whitespace, ein Bruch erzeugte eine leere
        // erste Zeile (und Endlos-Vertiefung).
        if (line.slice(0, i).trim().length === 0) return;
        // Bruchpunkt = Operator-Start (Zeichen nach dem Leerzeichen).
        (byDepth.get(depth) ?? byDepth.set(depth, []).get(depth)!).push(i + 1);
    });
    return shallowest(byDepth);
}

function shallowest(byDepth: Map<number, number[]>): ChainBreak | undefined {
    const depths = [...byDepth.keys()];
    if (depths.length === 0) return undefined;
    const d = Math.min(...depths);
    return { depth: d, points: byDepth.get(d)! };
}

interface GroupSpan {
    readonly open: number;
    readonly close: number;
    readonly commas: ReadonlyArray<number>;
    /** Klammertiefe des Inhalts (= Verschachtelungstiefe der Gruppe). */
    readonly depth: number;
}

/**
 * Flachste **brechbare** Klammer-Gruppe. Brechbar = enthält Top-Level-
 * Kommas (`f(a, b, c)`) ODER einen verschachtelten Aufruf (`f(g(…))`,
 * Inhalt enthält `(`). Triviale Gruppen (`()`, `(x)`, Lambda-Parameter
 * `(x)`) werden übersprungen. Bei gleicher Tiefe gewinnen Komma-Gruppen,
 * dann die kleinste `open`-Position → stabil/deterministisch.
 */
function shallowestGroup(line: string): GroupSpan | undefined {
    const stack: Array<{ open: number; commas: number[]; hasCall: boolean; depth: number }> = [];
    let best: GroupSpan | undefined;
    const better = (cand: GroupSpan): boolean => {
        if (!best) return true;
        if (cand.depth !== best.depth) return cand.depth < best.depth;
        const candComma = cand.commas.length > 0;
        const bestComma = best.commas.length > 0;
        if (candComma !== bestComma) return candComma;     // Komma-Gruppe bevorzugt
        return cand.open < best.open;
    };
    forEachToken(line, (c, i, depth, inString) => {
        if (inString) return;
        if (c === '(') {
            // Verschachtelter Aufruf des Elternteils: dessen Inhalt hat `(`.
            const parent = stack[stack.length - 1];
            if (parent) parent.hasCall = true;
            stack.push({ open: i, commas: [], hasCall: false, depth: depth + 1 });
            return;
        }
        if (c === ')') {
            const f = stack.pop();
            if (!f) return;
            if (f.commas.length > 0 || f.hasCall) {
                const cand: GroupSpan = {
                    open: f.open, close: i, commas: f.commas, depth: f.depth,
                };
                if (better(cand)) best = cand;
            }
            return;
        }
        if (c === ',' && stack.length > 0) {
            stack[stack.length - 1].commas.push(i);
        }
    });
    return best;
}

/**
 * Zerlegt eine Klammer-Gruppe `head(…)tail`. Mit Top-Level-Kommas: ein
 * Argument pro Zeile. Ohne Kommas (Single-Argument): der eine Inhalt auf
 * eigener Zeile. Schließende `)` + tail hängen an der letzten Inhaltszeile.
 */
function splitGroup(line: string, cont: string, span: GroupSpan): string[] {
    const { open, close, commas } = span;
    const head = line.slice(0, open + 1);          // bis einschließlich `(`
    const tail = line.slice(close);                // ab `)`
    const segments: string[] = [];
    let prev = open + 1;
    for (const ci of commas) {
        segments.push(line.slice(prev, ci + 1));     // Argument inkl. `,`
        prev = ci + 1;
    }
    segments.push(line.slice(prev, close));          // letztes/einziges Argument

    const out: string[] = [head];
    for (const seg of segments) out.push(cont + seg.trimStart());
    out[out.length - 1] = out[out.length - 1] + tail;
    return out;
}

// ───────────────────────────────────────────────────────────────────────
// Lambda-Block: `(x) -> { stmt; stmt; }`
// ───────────────────────────────────────────────────────────────────────

/**
 * Bricht einen Inline-Lambda-Block `… -> { s1; s2; … }` in
 *   `… -> {` / `  s1;` / `  s2;` / `}tail`
 * auf. Statements werden an `;` auf Block-Top-Level getrennt (string-,
 * klammer- und block-aware). Greift nur, wenn `-> {` vorkommt.
 */
function breakLambdaBlock(
    line: string, indent: string, cont: string,
): string[] | undefined {
    const arrow = findArrowBrace(line);
    if (arrow === undefined) return undefined;
    const close = matchingBrace(line, arrow);
    if (close === undefined) return undefined;

    const inner = line.slice(arrow + 1, close);
    const stmts = splitStatements(inner);
    if (stmts.length === 0) return undefined;

    const out: string[] = [line.slice(0, arrow + 1)];     // `… -> {`
    for (const s of stmts) out.push(cont + s.trim());
    out.push(indent + '}' + line.slice(close + 1));        // `}tail`
    return out;
}

/** Offset des `{` in `-> {` (string-aware), oder undefined. */
function findArrowBrace(line: string): number | undefined {
    let found: number | undefined;
    forEachToken(line, (c, i, _depth, inString) => {
        if (inString || found !== undefined) return;
        if (c === '{' && /->\s*$/.test(line.slice(0, i))) found = i;
    });
    return found;
}

/** Offset der zu `open` ({) passenden `}` (string-aware), oder undefined. */
function matchingBrace(line: string, open: number): number | undefined {
    let depth = 0;
    let result: number | undefined;
    forEachToken(line, (c, i, _d, inString) => {
        if (inString || i < open || result !== undefined) return;
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) result = i;
        }
    });
    return result;
}

/**
 * Trennt `s1; s2; s3` an `;` auf Top-Level (Klammer-, Block- und
 * String-aware). Leere Segmente (etwa nach dem letzten `;`) entfallen.
 * Das trennende `;` bleibt am jeweiligen Statement.
 */
function splitStatements(inner: string): string[] {
    const out: string[] = [];
    let depth = 0;
    let prev = 0;
    forEachToken(inner, (c, i, parenDepth, inString) => {
        if (inString) return;
        if (c === '{') depth++;
        else if (c === '}') depth--;
        else if (c === ';' && parenDepth === 0 && depth === 0) {
            out.push(inner.slice(prev, i + 1));
            prev = i + 1;
        }
    });
    const restRaw = inner.slice(prev);
    if (restRaw.trim().length > 0) out.push(restRaw);
    return out.filter((s) => s.trim().length > 0);
}

// ───────────────────────────────────────────────────────────────────────
// String-Literal-Split (letzte Instanz)
// ───────────────────────────────────────────────────────────────────────

interface Literal { readonly open: number; readonly close: number; }

/**
 * Teilt ein überlanges String-Literal in `"teil1" + "teil2"` auf, sodass
 * die erste Zeile ≤ 120 wird. Sicher: Java faltet konstante String-
 * Konkatenation, das Laufzeit-Ergebnis ist identisch. Schneidet nie
 * mitten in einer Escape-Sequenz (`\n`, `\"`, `\\`). Liefert undefined,
 * wenn kein geeignetes Literal die Zeile sinnvoll kürzen kann.
 */
function breakStringLiteral(line: string, cont: string): string[] | undefined {
    const maxPrefix = MAX_LINE - 1;               // line1 = prefix + `"` ≤ 120 Bytes
    for (const lit of stringLiterals(line)) {
        // Endet das Literal samt schließender `"` schon ≤ Limit, liegt die
        // Überlänge dahinter — dieses Literal aufzuteilen hilft nicht.
        if (width(line.slice(0, lit.close + 1)) <= MAX_LINE) continue;
        const cut = safeCut(line, lit, maxPrefix);
        if (cut <= lit.open + 1) continue;          // mind. 1 Zeichen in Teil 1
        const line1 = line.slice(0, cut) + '"';
        const line2 = cont + '+ "' + line.slice(cut);
        return [line1, line2];
    }
    return undefined;
}

/** Alle String-Literale als {open, close} (Quote-Offsets), escape-aware. */
function stringLiterals(line: string): Literal[] {
    const out: Literal[] = [];
    let open = -1;
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inString) {
            if (c === '\\') { i++; continue; }
            if (c === '"') { out.push({ open, close: i }); inString = false; }
            continue;
        }
        if (c === '"') { inString = true; open = i; }
    }
    return out;
}

/**
 * Größte sichere Schnitt-Position innerhalb des Literals, sodass die
 * Byte-Breite des Präfixes `≤ maxPrefix` bleibt und keine Escape-Sequenz
 * (`\n`, `\"`, `\\`) zerteilt wird. Wir laufen die Zeichen-Einheiten
 * (`\x` zählt als eine) ab, akkumulieren die Byte-Breite und merken die
 * letzte zulässige Einheitsgrenze. Liefert -1, wenn keine passt.
 */
function safeCut(line: string, lit: Literal, maxPrefix: number): number {
    let pos = lit.open + 1;
    let w = width(line.slice(0, pos));        // Breite bis einschl. öffnender `"`
    let best = -1;
    while (pos < lit.close) {
        if (w <= maxPrefix) best = pos;
        else break;
        const len = line[pos] === '\\' ? 2 : 1;
        w += width(line.substr(pos, len));
        pos += len;
    }
    return best;
}

// ───────────────────────────────────────────────────────────────────────
// Gemeinsamer Tokenizer: Klammer-Tiefe + String-/Generic-Awareness
// ───────────────────────────────────────────────────────────────────────

/**
 * Läuft die Zeile zeichenweise ab und ruft `fn(char, index, parenDepth,
 * inString)` auf. `parenDepth` ist die Tiefe VOR Verarbeitung von `(`/`)`
 * (d. h. der Inhalt einer Gruppe liegt eine Ebene tiefer). Kommas
 * innerhalb von Generics (`Lambda1<A, B>`) werden NICHT als Top-Level
 * gezählt: ein `<` direkt hinter einem Wort-Zeichen öffnet einen Generic-
 * Kontext bis zum passenden `>`. Vergleichs-`<`/`>` sind leerzeichen-
 * umrandet und lösen das nicht aus.
 */
function forEachToken(
    line: string,
    fn: (c: string, i: number, depth: number, inString: boolean) => void,
): void {
    let depth = 0;
    let generic = 0;
    let inString = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inString) {
            if (c === '\\') { fn(c, i, depth, true); i++; continue; }
            if (c === '"') inString = false;
            fn(c, i, depth, true);
            continue;
        }
        if (c === '"') { inString = true; fn(c, i, depth, false); continue; }
        if (c === '<' && i > 0 && /[\p{L}\p{N}_]/u.test(line[i - 1])) {
            generic++;
            continue;
        }
        if (c === '>' && generic > 0) { generic--; continue; }
        // Innerhalb von Generics keine Klammer-/Komma-Semantik melden.
        if (generic > 0) continue;
        if (c === '(') { fn(c, i, depth, false); depth++; continue; }
        if (c === ')') { depth--; fn(c, i, depth, false); continue; }
        fn(c, i, depth, false);
    }
}
