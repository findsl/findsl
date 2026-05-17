// FinDSL Grammar — Langium-Syntax
//
// Übersetzung der kanonischen EBNF aus ../../../grammar/findsl.ebnf
// bzw. SPEC.md Anhang A. Bei Sprachänderungen müssen alle drei
// Artefakte synchron gepflegt werden.

grammar Findsl

// ===========================================================================
// Programm-Struktur
// ===========================================================================

// Eine `.findsl`-Datei wird über ihren Dateipfad identifiziert. Der erste
// `--…--`-Doc-Block (optional mit `@…`-Annotationen) am Dateianfang ist die
// Datei-Dokumentation (`fileDoc`); jede Deklaration trägt ihren eigenen
// `--…--`-Block direkt davor. `verwende`-Direktiven importieren selektiv
// aus einem relativen Dateipfad-String.
entry Program:
    fileDoc=DeclPrefix?
    imports+=ImportDecl*
    decls+=TopDecl*;


// ===========================================================================
// Imports
// ===========================================================================

// Einzige Importform: selektiver Import aus einem relativen Dateipfad.
// `source` ist ein einfacher String-Literal (relativer Pfad ohne `.findsl`,
// `./`/`../`-Präfix); pro Symbol optionaler `als`-Alias.
ImportDecl:
    'verwende'
    '{' items+=ImportItem (',' items+=ImportItem)* ','? '}'
    'aus' source=STRING;

ImportItem:
    name=ID ('als' alias=ID)?;


// ===========================================================================
// Top-Level-Deklarationen
// ===========================================================================

TopDecl:
    KonstDecl | FunktionDecl | DatensatzDecl | AufzaehlungDecl | PruefeDecl;

DeclPrefix:
    doc=DOC_COMMENT? annotations+=Annotation*;

Annotation:
    '@' name=ID '(' (args+=Expr (',' args+=Expr)* ','?)? ')';


// Namens-Härtungen (SPEC § 2.5) werden als Validator-FEHLER erzwungen,
// nicht über eigene Terminals — `ID` bleibt generisch (Fehlertoleranz):
//   - konst: UPPER_SNAKE (findsl-validator.checkKonstNameUppercase)
//   - fn / datensatz / aufzählung + Aufzählungs-Werte: müssen mit
//     Großbuchstaben beginnen, führende „_" erlaubt
//     (findsl-validator.checkFunktion/Datensatz/AufzaehlungNameGross,
//     Code `findsl.name-grossschreibung`). Builtins ausgenommen.
//   - Führendes `_` = modul-INTERN (SPEC § 4.16): Top-Level-Decl ist
//     NICHT cross-file mit `verwende` importierbar (Ausnahme: zugehörige
//     `<basis>.test.findsl` → `<basis>.findsl`) und erscheint NICHT in
//     der generierten Doku. Validator-FEHLER `findsl.import-intern`
//     (findsl-validator.checkInternalImports); Doc-Generator filtert.

// === Konstanten ===

KonstDecl:
    docPrefix=DeclPrefix?
    'konst' name=ID ':' type=Type '=' value=Expr;


// === Funktionen ===

FunktionDecl:
    docPrefix=DeclPrefix?
    'fn' name=ID
    '(' (params+=Param (',' params+=Param)* ','?)? ')'
    ':' returnType=Type
    body=FunktionBody;

FunktionBody:
    '=' expr=Expr
    | block=BlockExpr;

Param:
    name=ID ':' type=Type ('=' default=Expr)?;


// === Datensätze ===

DatensatzDecl:
    docPrefix=DeclPrefix?
    'datensatz' name=ID
    '(' (fields+=Field (',' fields+=Field)* ','?)? ')';

Field:
    name=ID ':' type=Type ('=' default=Expr)?;


// === Aufzählungen ===

AufzaehlungDecl:
    docPrefix=DeclPrefix?
    'aufzählung' name=ID
    '{' values+=ID (',' values+=ID)* ','? '}';


// === Tests ===

PruefeDecl:
    docPrefix=DeclPrefix?
    'prüfe' name=STRING '{' beispiele+=Beispiel+ '}';

Beispiel:
    'testfall' label=STRING (erwartetAbbruch?='erwartet' 'abbruch')? body=BlockExpr;


// ===========================================================================
// Bindungen und Blöcke
// ===========================================================================

LetStmt:
    'var' name=ID ':' type=Type '=' value=Expr;

// `ausgabe(text)` — Seiteneffekt-ANWEISUNG (kein Ausdruck, kein Wert,
// SPEC § 5.4 / § 4.18 CLAUDE). Bewusste, dokumentierte P2-Ausnahme.
// Nur als Block-Zeile erlaubt (NICHT in `Atom` → in Ausdrucksposition
// automatisch Parse-Fehler).
AusgabeStmt:
    {infer AusgabeStmt}
    'ausgabe' '(' text=Expr ')';

BlockStmt:
    LetStmt | AusgabeStmt;

BlockExpr:
    '{' stmts+=BlockStmt* result=Expr '}';


// ===========================================================================
// Typen
// ===========================================================================

Type:
    atom=TypeAtom optional?='?'?;

TypeAtom:
    NamedType | FunctionType;

NamedType:
    name=ID typeArgs=TypeArgs?;

TypeArgs:
    '<' args+=Type (',' args+=Type)* '>';

FunctionType:
    {infer FunctionType}
    '(' (paramTypes+=Type (',' paramTypes+=Type)*)? ')'
    '->' returnType=Type;


// ===========================================================================
// Ausdrücke (von niedrigster zu höchster Präzedenz)
// ===========================================================================

Expr: OrExpr;

OrExpr infers Expr:
    AndExpr ({infer BinaryOp.left=current} op='oder' right=AndExpr)*;

AndExpr infers Expr:
    NotExpr ({infer BinaryOp.left=current} op='und' right=NotExpr)*;

NotExpr infers Expr:
    {infer UnaryOp} op='nicht' operand=NotExpr
    | NullCheckExpr;

NullCheckExpr infers Expr:
    CmpExpr ({infer NullCheck.value=current} 'ist' negated?='nicht'? 'nichts')?;

CmpExpr infers Expr:
    RangeExpr ({infer BinaryOp.left=current} op=CmpOp right=RangeExpr)?;

CmpOp returns string:
    '==' | '!=' | '<=' | '>=' | '<' | '>';

RangeExpr infers Expr:
    AddExpr ({infer Range.from=current} 'bis' exclusive?='unter'? to=AddExpr ('schritt' step=AddExpr)?)?;

AddExpr infers Expr:
    MulExpr ({infer BinaryOp.left=current} op=('+' | '-') right=MulExpr)*;

MulExpr infers Expr:
    CastExpr ({infer BinaryOp.left=current} op=('*' | '/') right=CastExpr)*;

CastExpr infers Expr:
    UnaryExpr ({infer Cast.value=current} 'als' targetType=Type)?;

UnaryExpr infers Expr:
    {infer UnaryOp} op='-' operand=Atom
    | Atom;

Atom infers Expr:
    Literal
    | WennExpr
    | WaehleExpr
    | FuerExpr
    | Lambda
    | ListLiteral
    | AbbruchExpr
    | '(' Expr ')'
    | CallChain;


// === Abbruch (begründeter, nicht abfangbarer Programmabbruch) ===
//
// `abbruch(begründung)` terminiert den gesamten Lauf mit einer Pflicht-
// Begründung (beliebiger Text-Ausdruck, Interpolation erlaubt). Es ist
// das prinzipientreue Gegenstück zu `throw`: kein versteckter Kontroll-
// fluss, sondern eine explizite, typisierte (Bottom-Typ `never`), audit-
// sichtbare Aussage. NICHT abfangbar — kein Sprachkonstrukt fängt es.
// Geschwister von `!!`: `!!` = unbeabsichtigter Bug-Abbruch, `abbruch`
// = beabsichtigter, begründeter Fachabbruch.

AbbruchExpr:
    {infer AbbruchExpr}
    'abbruch' '(' grund=Expr ')';


// === Listen-Literal ===

ListLiteral:
    {infer ListLiteral}
    '[' (items+=Expr (',' items+=Expr)* ','?)? ']'
    typeArgs=TypeArgs?;


// === Funktions-/Methodenaufruf-Kette ===
// IDENT, optional gefolgt von Aufrufen, Feldzugriffen, Index, Force-Unwrap

CallChain:
    {infer CallChain}
    name=ID
    chain+=ChainOp*;

ChainOp:
    Call | FieldAccess | SafeFieldAccess | ForceUnwrap | Index;

Call:
    {infer Call}
    '(' (args+=CallArg (',' args+=CallArg)* ','?)? ')';

CallArg:
    (name=ID '=')? value=Expr;

FieldAccess:
    {infer FieldAccess}
    '.' name=ID;

SafeFieldAccess:
    {infer SafeFieldAccess}
    '?.' name=ID;

ForceUnwrap:
    {infer ForceUnwrap}
    '!!';

Index:
    {infer Index}
    '[' index=Expr ']';


// === Wenn-Sonst (If-Else als Ausdruck) ===

WennExpr:
    {infer WennExpr}
    'wenn' '(' condition=Expr ')' then=Expr 'sonst' else=Expr;


// === Wähle (Pattern-Matching / Guard) ===

WaehleExpr:
    {infer WaehleExpr}
    'wähle' ('(' subject=Expr ')')? '{' arms+=WaehleArm+ '}';

WaehleArm:
    FallArm | SonstArm;

FallArm:
    {infer FallArm}
    'falls' patterns+=Pattern (',' patterns+=Pattern)* '->' result=Expr;

SonstArm:
    {infer SonstArm}
    'sonst' '->' result=Expr;

// Pattern: in subject-Form sind es Werte zum Vergleich,
// in subjektloser Form sind es boolesche Bedingungs-Ausdrücke.
// Disambiguierung im Validator.
Pattern:
    Expr;


// === Für-Jeden-Schleife ===

FuerExpr:
    {infer FuerExpr}
    'für' jeden=('jeden' | 'jede') iter=ID 'aus' source=Expr body=BlockExpr;


// === Lambda ===

Lambda:
    {infer Lambda}
    '{' (params+=LambdaParam (',' params+=LambdaParam)* ','? '->')? stmts+=BlockStmt* result=Expr '}';

LambdaParam:
    name=ID (':' type=Type)?;


// ===========================================================================
// Literale
// ===========================================================================

Literal:
    NumberLiteral | StringLiteral | BoolLiteral | NullLiteral;

NumberLiteral:
    value=NUMBER_TOKEN;

StringLiteral:
    value=STRING;

BoolLiteral:
    {infer BoolLiteral} value=('wahr' | 'falsch');

NullLiteral:
    {infer NullLiteral} 'nichts';


// ===========================================================================
// Terminals (Tokens)
// ===========================================================================

// Numerische Token (deutsche Notation, SPEC § 2.7):
//   `.` = Tausender-Trenner (Gruppen zu 3, optional), `,` = Dezimal-
//   trenner, optionales `%`-Suffix. Differenzierung Ganzzahl/Dezimal/
//   Prozent + Per-Typ-Schreibweise im Type-Checker. Disambiguierung:
//   `.` gehört zur Zahl nur bei genau 3 Folgeziffern (sonst Member-
//   Zugriff `obj.feld`); `,` nur bei direkt folgender Ziffer (sonst
//   Listen-/Argument-Trenner `f(a, b)`).
terminal NUMBER_TOKEN returns string:
    /[0-9]+(\.[0-9]{3})*(,[0-9]+)?%?/;

// String-Literale — zwei Formen unter einem Terminal:
//
//   (1) Einzeilig: "..."  mit Backslash-Escape-Sequenzen, keine Zeilenumbrüche
//   (2) Mehrzeilig: """..."""  rohe Form, Inhalt kann beliebige Zeichen
//       inkl. einfacher `"` enthalten (aber keine drei `"`-am-Stück).
//
// Interpolation mit `${...}` ist KEIN separates Token (Chevrotain bräuchte
// dafür Lexer-Modes). Stattdessen wird der String-Wert zur Eval-/Check-Zeit
// von `values.parseStringLiteral` in Parts+Slots zerlegt; Slot-Inhalte sind
// im Skelett auf CallChain-Formen beschränkt (`name`, `name.feld.unterfeld`).
//
// Die Multi-Line-Alternative steht VOR der Einzeilen-Alternative, damit
// `"""..."""` greedy als Multi-Line erkannt wird, nicht als drei leere
// Einzelstrings.
terminal STRING returns string:
    /"""[\s\S]*?"""|"(\\.|[^"\\\r\n])*"/;

// Doc-Kommentare
//
// Zwei Formen werden unterstützt:
//
//   (1) Mehrzeilig — `--` als alleiniges Token auf einer Zeile öffnet,
//       gleiches Muster schließt:
//
//           --
//           Markdown-Inhalt
//           --
//
//   (2) Einzeilig — `--` mit umgebenden Whitespaces auf einer Zeile:
//
//           -- Kurze Beschreibung. --
//
// Die Whitespace-Anforderung in beiden Formen verhindert, dass Markdown-
// Konstrukte wie `------` (Horizontal-Rule) oder `|------|` (Tabellen-
// separator) als Doc-Comment-Marker interpretiert werden.
terminal DOC_COMMENT returns string:
    /--(?:[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*|[ \t]+[^\r\n]+?[ \t]+)--/;

// Identifier — beliebige Unicode-Buchstaben (\p{L}) plus `_`; ab dem
// zweiten Zeichen auch Unicode-Ziffern (\p{N}). Das `u`-Flag aktiviert die
// Unicode-Property-Escapes. Deckt damit a-z/A-Z/Umlaute/ß weiterhin ab und
// zusätzlich kyrillisch, griechisch, CJK etc. — SPEC § 2.5.
terminal ID returns string:
    /[\p{L}_][\p{L}\p{N}_]*/u;

// Whitespace und Code-Kommentare werden geignored
hidden terminal WS: /\s+/;
hidden terminal LINE_COMMENT: /\/\/[^\n\r]*/;
hidden terminal BLOCK_COMMENT: /\/\*[\s\S]*?\*\//;
