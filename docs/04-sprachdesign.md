> Teil des FinDSL-Projektkontexts — aus CLAUDE.md aufgeteilt. Gesamtindex: [../CLAUDE.md](../CLAUDE.md)

## 4. Sprachdesign — die wichtigsten Entscheidungen

### 4.1 Schlüsselwörter sind deutsch

`verwende`, `aus`, `als`, `konst`, `fn`, `datensatz`,
`aufzählung`, `prüfe`, `testfall`, `erwartet`, `abbruch`, `var`,
`wenn`/`sonst`, `wähle`/`falls`, `für`/`jeden`/`jede`/`aus`,
`bis`/`unter`/`schritt`, `nicht`/`und`/`oder`, `ist`, `nichts`,
`wahr`/`falsch`.

**Warum:** Audience ist deutsche Verwaltung. Englische Schlüsselwörter
würden eine Lernbarriere für Sachbearbeiter:innen einführen.

### 4.2 Funktions-Rückgabe mit `:`, nicht `->`

```
fn estGrundtarif(zve: Euro): Euro = ...
```

Nicht `fn foo(x: Euro) -> Euro` (Kotlin-Style abgelehnt zugunsten
Konsistenz mit Parameter-Typannotationen, die ebenfalls `:` nutzen).

**Re-evaluiert und bestätigt (2026-05-15, ehem. § 12.1).** Wieder
abgelehnt aus drei Gründen:
1. **Konsistenz**: `:` heißt projektweit *genau eines* — „Name/Ausdruck
   hat Typ" (Param, `konst`, `var`, Feld, Rückgabe). `->` ist bereits
   dreifach belegt (Funktionstyp, Lambda-Rumpf, `wähle`-Arm); Rückgabe-
   `->` wäre die vierte Bedeutung → höhere Last gegen P1.
2. **Funktionstypwertige Rückgabe wird unleserlich**: aktuell trennt
   `:` sauber „hat Typ" vom `->` *im* Typ —
   `fn ableiten(f: (Euro) -> Euro): (Euro) -> Euro` ist eindeutig.
   Mit Rückgabe-`->` entstünde `… -> (Euro) -> Euro` (drei `->`,
   mehrdeutig). Das ist das entscheidende technische Gegenargument.
3. **Kein funktionaler Gewinn**, aber breite Breaking-Migration; das
   einzige Pro „Vertrautheit" ist schwach (TS/Kotlin/Scala nutzen
   ebenfalls `:`). Endgültig: bei `:` bleiben.

### 4.3 `:` und `->` haben getrennte Rollen

- `:` — "Name hat Typ" (Deklarationen, Parameter, Variablen, Rückgabe)
- `->` — "Typ-zu-Typ" (Funktionstypen `(Euro) -> Euro` und Lambdas
  `{ x -> body }`)

### 4.4 Geld-Literale sind kontextabhängig, kein Suffix

```
konst GFB: Euro = 12.096                      // OK, Annotation gibt Typ vor
var x = 1.230 als Euro                         // OK, expliziter Cast
var y = 1.230                                  // Ganzzahl (Default)
```

Es gibt KEIN `1.230 EUR`-Suffix. Der Geldtyp ergibt sich aus dem Kontext
(Annotation, Funktionsparameter, Vergleich). Wo Kontext fehlt: `als`-Cast.
Notation ist deutsch (`.`-Tausender, `,`-Dezimal; SPEC § 2.7, § 7).

### 4.5 `Prozent` als first-class Typ

```
konst ZONE_4_SATZ: Prozent = 42%

ZONE_4_SATZ * zve - 10.911,92                  // Prozent * Euro = EuroCent
```

`9.3%` ist `Prozent(9.3)` (intern), entspricht der Bruchzahl 0.093 bei
Multiplikation. Eigene Arithmetik-Regeln (siehe SPEC § 3.4).

### 4.6 Nullable Typen `T?` mit `nichts` und `oder`

```
var x: Euro? = nichts
var y: Euro = x oder 0          // Elvis-Operator (überladen mit logischem ODER)
var z: Euro = x!!               // Force-Unwrap (Laufzeitfehler bei nichts)
person?.adresse?.straße         // Sicher-Zugriff
```

`oder` ist überladen: bei booleschen Operanden = logisches Oder,
bei nullable Operand = Elvis. Type-Checker disambiguiert.

### 4.7 Doc-Kommentare mit `--`-Markern, Inhalt ist Markdown

```
--
# Überschrift

Markdown-Text mit @param und @rückgabe.
--
@Quelle("§ 32a EStG")
konst GFB: Euro = 12.096
```

`--` muss von Whitespace umgeben sein (verhindert Konflikt mit Markdown-
Horizontal-Rule `------` oder Tabellen-Separatoren `|----|`).

### 4.8 String-Interpolation mit `${...}`

```
var bescheid = """
Sehr geehrte:r ${anrede} ${nachname},
festgesetzte Einkommensteuer: ${steuer}
"""
```

Mehrzeilige Strings mit `"""..."""`. **TODO: Lexer-Modes für Interpolation
sind in der Grammatik noch nicht implementiert.**

### 4.9 Datei = Übersetzungseinheit (Identität = Dateipfad)

Eine `.findsl`-Datei steht für sich; ihre Identität ist ihr
**Dateipfad**. Grammatik:
`Program: fileDoc=DeclPrefix? imports+=ImportDecl* decls+=TopDecl*;`

**Führender Datei-Doc-Block (D3):** Der erste `--…--`-Block (optional
mit `@…`-Annotationen) am Dateianfang ist `program.fileDoc` (die Datei-
Doku, vom Doc-Generator als Kapitelbeschreibung genutzt). **Konvention
(Pflicht):** stets einen Datei-Doc-Block voranstellen; jede Deklaration
trägt ihren eigenen `--…--`-Block direkt davor. Begründung: ein
führender Doc/Annotation-Block ist grammatikalisch greedy — Chevrotain
bindet ihn an `fileDoc` (deterministisch, erste Alternative). Fehlt ein eigener
Datei-Doc-Block, „stiehlt" `fileDoc` den Doc/`@Quelle` der ersten
Deklaration → P4/P6-Verstoß. Alle Beispieldateien + Test-Fixtures
erfüllen die Konvention (zwei getrennte `--…--`-Blöcke: Datei + erste
Decl).

**Test-Konvention `.test`:** `prüfe`-Blöcke liegen in einer separaten
Datei `<basis>.test.findsl`. `.test` ist reiner Dateinamensbestandteil;
ein `*.test.findsl` gilt als Akzeptanztest-Datei (`isTestFile` in
`src/language/import-path.ts`). Die Testdatei importiert die Quelldatei
selektiv per relativem Pfad (`verwende { … } aus "./<basis>"`);
`pruefe`/`loadModuleGraph` folgen dem Import. Builtin-Aufzählungen
(`Tarifart`/`Steuerklasse` mit `Grundtarif`/`Splitting`/`I…VI`) sind
global, kein Import nötig. Der Doc-Generator nimmt `.test`-Dateien als
eigene Kapitel auf (transparent fürs Audit).

**Geteilte Quelle `src/language/import-path.ts`**:
`resolveImportPath`, `displayId`, `commonBase`,
`isTestFile`, `programFilePath`, `collectImportBindings`,
`checkImportPathLiteral`. Genutzt von Validator, Scope, Type-Checker,
allen LSP-Providern UND Interpreter-Modul-Loader, damit alle denselben
Registry-Schlüssel (**absoluter, normalisierter Dateipfad**) verwenden.

### 4.10 Imports mit `verwende` — nur selektiv, relativer Pfad (D1/D2)

```
// Datei: examples/<slug>/<slug>.findsl
verwende { BerechneStufe1, KONSTANTE } aus "./helfer"
verwende { foo als xfoo, bar als yfoo } aus "../pfad/foobar"
```

Einzige Form: `verwende { name [als alias], … } aus "<relpfad>"`.
Qualifizierter Modulimport / Modul-Alias / klammerloser Einzelimport
sind **abgeschafft**. Der Pfad ist ein einfaches String-Literal,
**relativ zum Verzeichnis der importierenden Datei**, ohne `.findsl`
(automatisch angehängt), mit `./`/`../`-Pflichtpräfix; kein `"""…"""`,
keine `${…}`-Interpolation (Validator-Fehler `findsl.import-pfad-*`).
Fehlende Zieldatei → `findsl.import-datei-fehlt` (nur wenn die
importierende Datei real auf Platte liegt). Keine Wildcards, keine
Re-Exports, zyklische Datei-Abhängigkeiten verboten.

### 4.11 Veranlagungsjahr im Datei-/Pfadnamen, nicht als Annotation

```
.../tarif2024.findsl            // 2024er Tarif
.../tarif2025.findsl            // 2025er Tarif
```

`@Jahr(2025)` als Annotation wurde verworfen — Datei-/Pfadnaming ist
explizit, audit-friendly, und macht Mehrjahres-Vergleiche trivial
(Import beider via `als`-Alias, SPEC § 8.6).

### 4.12 `falls` (Konjunktion) in `wähle`, `testfall` (Substantiv) in `prüfe`

```
wähle (stkl) {
    falls I, II  -> 0
    falls III    -> ...
}

prüfe "Test-Set" {
    testfall "STKL I, keine Kinder" {
        tabellenFreibetraege(I, 0).ztabfb == 0
    }
    testfall "mit Setup" {
        var erwartet: Euro = 9.600
        tabellenFreibetraege(III, 2).kfb == erwartet
    }
}
```

`fall` als Schlüsselwort wurde verworfen, weil es das natürliche deutsche
Identifier-Wort blockiert (Steuerfall, Sachfall, Erbfall, …). `testfall`
ist im Test-Kontext sogar semantisch präziser.

**`testfall` nutzt die Blockform `{ … }`, nicht `: ausdruck`**
(Entscheidung 2026-05-16, Breaking, alte `:`-Form ersetzt). Der Block
ist exakt dieselbe `BlockExpr` wie ein `fn`-Rumpf `{ (var …)* result }`
— kein Sonderkonstrukt: optionales `var`-Setup („Arrange") plus finale
boolesche Assertion. `erwartet abbruch` steht weiterhin VOR dem Block
(`testfall "…" erwartet abbruch { … }`). Begründung: mehrteilige
Test-Arrangements bleiben self-contained statt in öffentliche
Hilfsfunktionen ausgelagert zu werden (FinDSL hat keine private/Test-
Sichtbarkeit, P7 — Helfer würden die geprüfte API aufblähen).
Konsistent mit der bestehenden `fn`-Body-Dualität.

### 4.13 `var` für lokale Bindungen, `konst` für Top-Level

`var` ist trotz des Namens **single-assignment** — das Wort war ein
bewusster Kompromiss zugunsten Lesbarkeit (vs. `let`/`val`).

### 4.14 `datensatz`, nicht `datenklasse`

```
datensatz Einkünfte(
    landUndForstwirtschaft: Euro = 0,
    gewerbebetrieb:         Euro = 0,
    // ...
)
```

`datensatz` ist im deutschen Verwaltungs-Sprachgebrauch das Standardwort
("Steuerdatensatz", "ELSTER-Datensatz") — `datenklasse` (Kotlin-Übersetzung)
klingt programmierer-y.

### 4.15 Trailing-Field-Kommentare als Doc-Konvention

Datensatz-Felder werden mit trailing `//`-Kommentaren dokumentiert:

```
datensatz TabellenFreibetraege(
    anp: Euro,    // Arbeitnehmer-Pauschbetrag (§ 9a EStG)
    sap: Euro,    // Sonderausgaben-Pauschbetrag (§ 10c EStG)
)
```

Doc-Generator extrahiert sie per Konvention (NICHT Sprachsemantik) als
Feld-Beschreibung.

**Ausrichtung ist Formatter-Aufgabe (2026-05-17, ehem. § 4.15-Schutz
aufgehoben):** mehrzeilige `datensatz`-Felder bringt der Formatter in
ein **Zwei-Spalten-Layout** — Feldname + `:` linksbündig, alle Typen
auf einer Spalte (Breite = längster Feldname + 1 Space). Nicht mehr von
Hand ausrichten; der Abstand `,`→`//` (Kommentarspalte) bleibt
unangetastet (Hidden-Token, keine Regel). Rein AST-basiert (Feldnamen-
Längen) ⇒ idempotent.

### 4.16 Deklarationen öffentlich — außer `_`-intern (2026-05-17, verschärft)

Keine `privat`/`öffentlich`-Modifier. Auditierbarkeit hat Priorität.
**Ausnahme:** eine Top-Level-Decl (`fn`/`konst`/`datensatz`/
`aufzählung`) mit führendem `_` ist **modul-intern** — vorher nur
Lese-Hinweis, jetzt erzwungen (SPEC § 8.4, Nutzer-Entscheidung
„alle Top-Level-Decls"):

- **Nicht cross-file `verwende`-importierbar** → Fehler
  `findsl.import-intern` (`findsl-validator.checkInternalImports`,
  registriert vor `checkImportTargetsExist`). Eigene Datei: frei.
- **Ausnahme:** `<basis>.test.findsl` darf Interna ihrer **zugehörigen**
  `<basis>.findsl` importieren (direkte Unit-Tests; Test→fremde Datei
  bleibt gesperrt). Prädikat `mayImportInternal` in `import-path.ts`.
- **Nicht in der Doku** (`docs/model.ts` filtert `isInternalName`;
  abbruch-Anhang bleibt vollständig = Audit-Katalog).
- LSP-Konsistenz: Import-Completion schlägt `_`-Namen nicht vor
  (außer Test→Quelle).

Eine Regel-Quelle: `import-path.ts` `isInternalName`/`mayImportInternal`/
`associatedSourcePath`, geteilt von Validator + Completion; Doc-Gen
nutzt `isInternalName`. Rein namensbasiert, kein Token (`IDENT`
generisch). Bestehende Beispiele nutzen kein `_`-Top-Level → nicht-
breaking. Bewusste P7-Verfeinerung (kleinere, auditierbarere öffentliche
API; Logik bleibt transitiv + via `.test` prüfbar).

### 4.17 Kein Exception-Mechanismus — stattdessen `abbruch`

FinDSL kennt bewusst kein `throw`/`catch` (Folgerung aus P2/P7, SPEC
§ 1.3). Erwartetes Fehlen/Fehlschlagen wird explizit im Typsystem
modelliert (`T?`, `nichts`, `oder`, `?.`). Für den begründeten, **nicht
abfangbaren** Fachabbruch gibt es den Ausdruck `abbruch(begründung)`
(SPEC § 4.19): primärer Ausdruck mit Pflicht-`Text`-Argument
(Interpolation erlaubt, D1), Bottom-Typ `never` (SPEC § 3.14) — darf als
Funktionsbody oder `wähle`/`wenn`-Zweig stehen, wo ein beliebiger Typ
erwartet wird. Geschwister von `!!` (unbeabsichtigter Bug-Abbruch).
Positiv testbar via `testfall "…" erwartet abbruch { … }` (D2). Ein
projektweiter Audit-Collector (`findsl-abbruch-sites.ts`) sammelt alle
Stellen für den Doku-Anhang „Explizit ausgeschlossene Konstellationen".
`§` bleibt Teil der Begründung — kein separates Quelle-Argument (D3).

### 4.18 `ausgabe("...")` — bewusste, dokumentierte P2-Ausnahme

**Entscheidung 2026-05-15 (ehem. § 12.2): Variante C — voller
Seiteneffekt.** `ausgabe(text)` gibt Text auf die Konsole aus. Das ist
ein **echter Seiteneffekt** und damit eine **bewusst in Kauf genommene
Ausnahme von P2** (reine Funktionen, keine Seiteneffekte).

Tragweite — explizit festgehalten, damit P2 nicht *still* erodiert:
- P2 gilt weiterhin als Default-Prinzip; `ausgabe` ist die **einzige**
  zugelassene Effekt-Quelle (neben dem nicht abfangbaren Fail-Fast von
  `abbruch`/`!!`, die kein „Wert"-Effekt sind).
- **SPEC muss die Auswertungsreihenfolge verbindlich festlegen**
  (vorher unbeobachtbar → unspezifiziert): eager, links-nach-rechts.
  Das ist eine semantische SPEC-Änderung, kein bloßes Keyword.
- Audit (P4/P7): Reviewer müssen `ausgabe` als Effekt erkennen können
  → eigener Token-Scope (SemanticTokens) + Doku-Hinweis.
- Empfehlung der Bewertung war (D) „nicht aufnehmen" (Bedarf durch
  `Text`-Rückgabe + `prüfe`/Test-Controller gedeckt); C wurde bewusst
  trotzdem gewählt — diese Begründung steht hier, damit künftige
  Entscheidungen den Kontext kennen.

Design (Resolution A, 2026-05-15): `ausgabe` ist eine **Anweisung, kein
Ausdruck** — gibt **keinen Wert** zurück (deine Vorgabe), erfordert
**keinen Unit/void-Typ** (Void-Entscheidung bleibt intakt). Keyword
`ausgabe`, `Text`-Pflichtargument (Interpolation erlaubt). Nur als
eigene Zeile in einem Block erlaubt — **nicht** in Ausdrucksposition
(`var x = ausgabe(...)`, `fn f() = ausgabe(...)`, `falls … -> ausgabe(...)`
sind verboten/Parse-Fehler). Grammatik-Konsequenz: `BlockExpr`/`Lambda`
bekommen eine Statement-Liste `(LetStmt | AusgabeStmt)* result` — das
ist die **erste echte Anweisung** der bisher reinen Ausdruckssprache,
bewusste Strukturerweiterung. Selbstkonsistent mit „keine void-
Funktionen": reine Logging-Funktionen gibt es nicht; `ausgabe` ist eine
Trace-Zeile in einem wertproduzierenden Block. Sink injizierbar: CLI →
stdout; LSP/Test-Controller → gesammelt, im `prüfe`-Report / Test-Output
sichtbar (der Server hat kein Terminal).

---

## Mathematische Notation in Doku-Kommentaren (Issue #6, SPEC § 9.5)

`$…$`/`$$…$$` in Doc-Kommentar-Prosa. **Keine Grammatik-/Trias-
Änderung:** `DOC_COMMENT` ist ein einzelnes sichtbares Token; `$`
kollidiert nicht mit dem Lexer, `${…}`-Interpolation ist Laufzeit
(Quelltext), unabhängig. Eine gemeinsame Schicht (`docgen/math.ts`)
speist alle drei Renderer; das Modell trägt **rohes `$…$`-Markdown**
(Fixpunkt wie §-Links ⇒ Idempotenz trivial, kein Sentinel-Roundtrip).
Schutz vor §-Linkify/Highlighter via `quelle.ts PROTECT_RE` (wie
Code-Spans).

**Designentscheidungen:**

- **HTML = KaTeX server-seitig**, CSS **und** woff2-Fonts als `data:`-URI
  ins bestehende `THEME`-`<style>` inlined (Generator
  `scripts/gen-katex-css.mjs` → `docgen/katex-assets.ts`). Bewusst
  ~360 KiB pro HTML — erhält das harte „eine Datei, kein externes
  Asset, offline"-Prinzip; Volltreue browserunabhängig.
- **PDF = MathJax tex→SVG** (liteAdaptor, kein Browser), lazy geladen,
  `fontCache:'none'` + inhaltsabhängiger ID-Präfix ⇒ byte-stabil.
  **Block** = echter `{svg}`-Vektorknoten. **Inline** = TeX-Fallback in
  Code-Schrift, weil pdfmake **kein** SVG im fließenden Text-Array
  platzieren kann (reale Werkzeug-Grenze, bewusst akzeptiert; HTML
  rendert Inline voll). Kompromiss vor Mikro-Layout-Akrobatik.
- **Markdown** unverändert (kanonisch, GitHub-renderbar).

---

