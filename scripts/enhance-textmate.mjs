/**
 * Post-Processing für die von Langium auto-generierte TextMate-Grammatik.
 *
 * Langium kennt nur `LINE_COMMENT`/`BLOCK_COMMENT` (hidden terminals) als
 * Kommentar-Tokens und überspringt:
 *   - Doc-Kommentare `-- ... --` (sind im AST, nicht hidden)
 *   - Numerische Literale (`12_096`, `932.30`, `42%`)
 *   - Annotations (`@Quelle(...)`)
 *
 * Dieses Skript läuft direkt nach `langium generate` und fügt die
 * fehlenden Patterns deklarativ ergänzend in `syntaxes/findsl.tmLanguage.json`
 * ein. Da der Auto-Generator das File jedes Mal vollständig neu schreibt,
 * sind manuelle Edits dort sinnlos — das Skript ist die richtige Adresse.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Workspace-Wurzel/scripts → Sprachkern liegt in packages/core.
const coreDir = path.resolve(__dirname, '..', 'packages', 'core');
const tmPath = path.resolve(coreDir, 'syntaxes', 'findsl.tmLanguage.json');

// Kanonische Builtin-Quelle (geteilt mit findsl-stdlib.ts) — keine
// duplizierten Listen mehr. Änderungen ausschließlich in builtins.json.
const builtinsPath = path.resolve(coreDir, 'src', 'language', 'builtins.json');
const BUILTINS = JSON.parse(fs.readFileSync(builtinsPath, 'utf-8'));
const BUILTIN_FUNCTION_NAMES = BUILTINS.functions.map((f) => f.name);
const BUILTIN_TYPE_NAMES = [
    ...BUILTINS.primitiveTypes,
    ...BUILTINS.enums.map((e) => e.name),
];
const BUILTIN_ENUM_VALUE_NAMES = BUILTINS.enums.flatMap((e) => e.values);

const tm = JSON.parse(fs.readFileSync(tmPath, 'utf-8'));

// --- String-Interpolation: ${...}-Slots in Strings -----------------------
//
// Wiederverwendbares Sub-Pattern, das innerhalb von Single-Line- und
// Multi-Line-String-Bodies gematcht wird. Die geschweiften Klammern werden
// als Punctuation, der Slot-Body als Variable + Punkt-Accessor gehighlightet.
// Komplexere Slot-Inhalte (Arithmetik, Aufrufe) sind im Skelett nicht
// erlaubt; das Highlighting bleibt trotzdem nutzbar, weil der Variable-
// Scope für Identifier-Tokens generisch passt.

tm.repository ??= {};
tm.repository.stringInterpolation = {
    // Scope-Konvention nach TypeScript-Vorbild: `punctuation.section.embedded.*`
    // wird von Themes wie Block-Klammern im Code gefärbt (Foreground), nicht
    // wie der umgebende String. `contentName: meta.embedded.line` verhindert
    // außerdem, dass der Slot-Body die String-Farbe der `"""…"""`-Umgebung
    // erbt.
    name: 'meta.embedded.expression.findsl',
    begin: '\\$\\{',
    beginCaptures: {
        '0': { name: 'punctuation.section.embedded.begin.findsl' },
    },
    end: '\\}',
    endCaptures: {
        '0': { name: 'punctuation.section.embedded.end.findsl' },
    },
    contentName: 'meta.embedded.line.findsl',
    patterns: [
        {
            name: 'variable.other.findsl',
            match: '[a-zA-ZäöüÄÖÜß_][a-zA-Z0-9äöüÄÖÜß_]*',
        },
        {
            name: 'punctuation.accessor.findsl',
            match: '\\.',
        },
    ],
};

// Bestehendes Single-Line-String-Pattern um Interpolation erweitern.
for (const pat of tm.patterns) {
    if (pat && pat.name === 'string.quoted.double.findsl') {
        pat.patterns ??= [];
        // Davor stellen, damit ${...} VOR Escape-Sequenzen geprüft wird
        // (sonst würde `\$` aus dem Escape-Pattern den `$`-Anfang des Slots
        // verschlucken).
        pat.patterns.unshift({ include: '#stringInterpolation' });
    }
}

// Langium erkennt das `"""`-Vorkommen in der STRING-Terminal-Regex und
// fügt sein eigenes `string.quoted.delimiter.findsl`-Pattern ein — das
// schlägt aber leider vor unserem zu, ohne `${...}`-Sub-Patterns. Wir
// filtern es raus.
tm.patterns = tm.patterns.filter(
    (p) => !p || p.name !== 'string.quoted.delimiter.findsl',
);

// Multi-Line-String-Pattern davor einfügen — TextMate probiert Patterns in
// Reihenfolge und das Single-Line-Pattern würde sonst `"""` als drei
// einzelne Strings matchen.
const singleStringIdx = tm.patterns.findIndex(
    (p) => p && p.name === 'string.quoted.double.findsl',
);
if (singleStringIdx >= 0) {
    tm.patterns.splice(singleStringIdx, 0, {
        name: 'string.quoted.triple.findsl',
        begin: '"""',
        beginCaptures: {
            '0': { name: 'punctuation.definition.string.begin.findsl' },
        },
        end: '"""',
        endCaptures: {
            '0': { name: 'punctuation.definition.string.end.findsl' },
        },
        patterns: [
            { include: '#stringInterpolation' },
        ],
    });
}

// --- Doc-Comments: mehrzeilig und inline ---------------------------------
//
// Mehrzeilig:  --
//              <markdown body>
//              --
//
// Inline:      -- <text> --
//
// Die `--`-Marker dürfen laut SPEC nur whitespace-umgeben sein (sonst
// Konflikt mit Markdown-Horizontal-Rules `------` und Tabellen-Separatoren).
// Die Regexes prüfen das mit Wort-Boundaries und Whitespace-Lookarounds.

tm.repository ??= {};
tm.repository.docComments = {
    patterns: [
        {
            // Mehrzeilige Form: Zeile beginnt mit `--` (umgeben von Whitespace),
            // alles bis zur nächsten reinen `--`-Zeile.
            name: 'comment.block.documentation.findsl',
            begin: '(?<=^|\\s)--\\s*$',
            end: '^\\s*--(?=\\s|$)',
        },
        {
            // Inline-Form auf einer Zeile: `-- text --`
            name: 'comment.block.documentation.findsl',
            match: '(?<=^|\\s)--\\s+[^\\r\\n]+?\\s+--(?=\\s|$)',
        },
    ],
};
// Doc-Comments VOR den anderen Patterns prüfen, damit sie keine Operatoren
// (`-`) oder Markdown-Inneres falsch matchen.
tm.patterns.unshift({ include: '#docComments' });

// --- Annotations: @Name(...) ---------------------------------------------
//
// Wir highlighten nur den Annotation-Namen mit `@`. Der String-Inhalt wird
// vom bestehenden `string.quoted.double`-Pattern erfasst.

tm.patterns.push({
    name: 'entity.name.tag.annotation.findsl',
    match: '@[A-Za-zäöüÄÖÜß_][A-Za-z0-9äöüÄÖÜß_]*',
});

// --- Numerische Literale -------------------------------------------------
//
// Ganzzahl, Dezimal und Prozent-Suffix. Unterstriche sind erlaubt.

tm.patterns.push({
    name: 'constant.numeric.findsl',
    match: '\\b\\d[\\d_]*(?:\\.\\d[\\d_]*)?%?',
});

// --- Funktions- und Datensatz-Definitionen: Namen herausheben ------------
//
// Beim Lesen ist die Augenführung „hier wird etwas deklariert" wichtig —
// der Name nach den Keywords `funktion`, `konst`, `datensatz`, `aufzählung`
// bekommt einen eigenen Scope.

tm.patterns.push({
    name: 'meta.declaration.findsl',
    match: '\\b(fn|konst|datensatz|aufzählung)\\s+([A-Za-zäöüÄÖÜß_][A-Za-z0-9äöüÄÖÜß_]*)',
    captures: {
        '1': { name: 'keyword.control.findsl' },
        '2': { name: 'entity.name.function.findsl' },
    },
});

// --- Builtin-Funktionen --------------------------------------------------
//
// `support.function.builtin.*` ist die Standardklassifizierung für
// Sprach-Builtins (vgl. `console.log` in TypeScript). Themes färben das
// anders als User-Funktionen — meist hellblau-türkis. Match nur, wenn
// direkt ein `(` folgt, damit User-Variablen mit gleichem Namen außerhalb
// von Aufrufen nicht versehentlich eingefärbt werden.
//
// Quelle der Liste: kanonische `builtins.json` (oben geladen) — keine
// Duplizierung mehr.
tm.patterns.push({
    name: 'support.function.builtin.findsl',
    match: `\\b(${BUILTIN_FUNCTION_NAMES.join('|')})\\b(?=\\s*\\()`,
});

// --- Builtin-Typen -------------------------------------------------------
//
// Primitive Typen aus SPEC § 3 plus die eingebauten Aufzählungstypen aus
// § 3.7. Match-Anker als ganze Wortgrenze; in den Type-Annotation-
// Positionen sind das die einzigen Stellen, an denen sie überhaupt
// vorkommen können.
tm.patterns.push({
    name: 'support.type.builtin.findsl',
    match: `\\b(${BUILTIN_TYPE_NAMES.join('|')})\\b`,
});

// --- Builtin-Aufzählungs-Werte -------------------------------------------
//
// Die Werte der eingebauten Aufzählungen aus § 3.7. `support.constant.*`
// signalisiert "vom System bereitgestellte Konstante" — Themes färben das
// typisch in der Konstanten-Farbe (oft orange/gold).
tm.patterns.push({
    name: 'support.constant.builtin.findsl',
    match: `\\b(${BUILTIN_ENUM_VALUE_NAMES.join('|')})\\b`,
});

fs.writeFileSync(tmPath, JSON.stringify(tm, null, 2) + '\n');
console.log('[enhance-textmate] Doc-Comments, @Annotations, Zahl-Literale und Decl-Namen ergänzt.');
