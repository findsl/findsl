# FinDSL — Sprachspezifikation v1.0

> **Status:** Sprachstand 2025-Q4. Diese Spezifikation ist die autoritative
> Referenz für FinDSL und richtet sich gleichermaßen an menschliche
> Leser:innen, Compiler-Implementierer und automatisierte Werkzeuge
> (Doc-Generatoren, KI-Agenten, Linter, IDE-Plug-ins).

---

## Inhalt

1. [Einführung und Designprinzipien](#1-einführung-und-designprinzipien)
2. [Lexikalische Struktur](#2-lexikalische-struktur)
3. [Typsystem](#3-typsystem)
4. [Ausdrücke](#4-ausdrücke)
5. [Bindungen und Schleifen](#5-bindungen-und-schleifen)
6. [Deklarationen](#6-deklarationen)
7. [Annotationen](#7-annotationen)
8. [Dateien und Imports](#8-dateien-und-imports)
9. [Doc-Kommentare](#9-doc-kommentare)
10. [Tests](#10-tests)
11. [Standard-Bibliothek](#11-standard-bibliothek)
12. [Code-Generierung](#12-code-generierung)
13. [Anhang A: EBNF-Grammatik](#anhang-a-ebnf-grammatik)
14. [Anhang B: Schlüsselwörter](#anhang-b-schlüsselwörter)
15. [Anhang C: Operator-Präzedenz](#anhang-c-operator-präzedenz)
16. [Anhang D: Glossar](#anhang-d-glossar)

---

## 1. Einführung und Designprinzipien

### 1.1 Zweck

FinDSL ist eine domänenspezifische Programmiersprache für die deutsche
steuerliche Finanzverwaltung. Ihr Ziel ist es, Berechnungsregeln des
Steuerrechts so auszudrücken, dass sie

- von Sachbearbeiter:innen, Juristen und Fachadministrator:innen
  *gelesen* und *geprüft* werden können,
- von Compilern in produktive Zielsprachen (Java, TypeScript, JavaScript)
  *übersetzt* werden können,
- in DIN-66001-Programmablaufpläne (PAPs) *exportiert* werden können
  (geplant), und
- in maschinenlesbaren Form als Wissensbasis für KI-Agenten dienen.

### 1.2 Audience

| Zielgruppe                              | Hauptverwendung                           |
| --------------------------------------- | ----------------------------------------- |
| Sachbearbeiter:innen, Verwaltungsjuristen | Lesen und Prüfen von Berechnungsregeln  |
| Steuerentwickler:innen                  | Schreiben und Pflegen von DSL-Quelltext   |
| Compiler/Tooling-Entwickler:innen       | Verbindliche Implementierungsreferenz     |
| KI-Agenten / LLMs                       | Strukturierte Wissensquelle für Audits    |

### 1.3 Designprinzipien

Die folgenden Prinzipien begründen die meisten Sprachentscheidungen:

**P1 — Lesbarkeit vor Knappheit.** Ein Tarifsachbearbeiter ohne
Programmierhintergrund muss eine FinDSL-Regel lesen und nachvollziehen
können. Deutsche Schlüsselwörter, ausgeschriebene Konstrukte, dichte
aber nicht kryptische Syntax.

**P2 — Reine Funktionen, kein globaler Zustand.** Funktionen erhalten
Eingaben als Parameter und liefern Ausgaben als Rückgabewerte. Keine
veränderbaren Variablen außerhalb lokaler Bindungen, keine
Seiteneffekte.

**P3 — Einheiten und Präzision sind Teil des Typsystems.** `Euro`,
`Cent`, `EuroCent`, `Prozent` sind unterschiedliche Typen. Rundung ist
immer explizit.

**P4 — Gesetzliche Quelle als Pflicht-Annotation.** Jede Konstante und
jede normgebundene Regel verweist über `@Quelle("...")` auf den
Paragraphen oder das BMF-Schreiben.

**P5 — Veranlagungsjahr im Datei-/Pfadnamen.** Veranlagungs-spezifische
Regeln tragen das Jahr im Datei- bzw. Verzeichnisnamen
(`einkommensteuer/tarif/tarif2025.findsl`), nicht als implizite Annotation.
Mehrjahres-Vergleiche werden so explizit und auditfähig.

**P6 — Pflicht-Dokumentation in Markdown.** Jede signifikante
Deklaration trägt einen Doc-Kommentar in Markdown — automatisch
generierbar zu PDF/HTML/Bundessteuerblatt-Format und maschinell parsbar.

**P7 — Transparenz vor Privatheit.** Deklarationen sind grundsätzlich
öffentlich; Auditierbarkeit hat Priorität gegenüber Kapselung. Einzige
Verfeinerung: ein führendes `_` macht eine Top-Level-Decl *modul-intern*
(nicht cross-file importierbar, nicht in der Doku) — die öffentliche
API-Fläche wird kleiner und damit auditierbarer, die Logik bleibt über
die öffentliche API und die zugehörige `.test.findsl` nachvollziehbar
(siehe [§ 8.4](#84-sichtbarkeit)).

> **Folgerung aus P2/P7 — kein Exception-Mechanismus.** FinDSL kennt
> bewusst kein `throw`/`catch`. Nicht-lokaler, abfangbarer Kontrollfluss
> wäre ein versteckter zweiter Rückgabekanal (verletzt P2) und macht das
> Audit-Versprechen „Ergebnis X *wegen* § Y" unmöglich (verletzt P7).
> Erwartetes Fehlen/Fehlschlagen wird explizit im Typsystem modelliert
> (`T?`, `nichts`, `oder`, `?.`). Für den begründeten, *nicht
> abfangbaren* Fachabbruch gibt es den `abbruch`-Ausdruck (§ 4.19);
> unbeabsichtigte Programmierfehler brechen über `!!` (§ 4.7) ab. Beide
> sind Fail-Fast und im Audit sichtbar — nicht abfangbar.

> **Bewusste, einzige Ausnahme von P2 — `ausgabe`.** Die
> `ausgabe`-Anweisung (§ 5.4) gibt Text auf die Konsole aus und ist ein
> echter Seiteneffekt. Sie ist die einzige zugelassene Effekt-Quelle
> (neben dem nicht-`Wert`-Fail-Fast von `abbruch`/`!!`) und bewusst in
> Kauf genommen. P2 bleibt Default-Prinzip; dass `ausgabe` eine
> *Anweisung* (kein Ausdruck, kein Wert) ist, hält das Typsystem und die
> „keine void-Funktionen"-Regel intakt. Weil der Effekt die
> Auswertungsreihenfolge beobachtbar macht, ist diese in § 5.4
> verbindlich festgelegt.

### 1.4 Konventionen in dieser SPEC

Der Begriff *muss* bedeutet eine bindende Anforderung. *Sollte* ist eine
starke Empfehlung, von der nur mit Begründung abgewichen wird. *Kann*
ist eine erlaubte, aber nicht erzwungene Wahl.

Code-Beispiele tragen die Sprachkennung `findsl`. Ausschnitte aus
Grammatik-Regeln stehen in `ebnf`-Blöcken.

---

## 2. Lexikalische Struktur

### 2.1 Quelltext-Encoding

FinDSL-Quelltextdateien *müssen* in UTF-8 kodiert sein. Die Dateiendung
*muss* `.findsl` lauten. Zeilenenden können CR, LF oder CRLF sein; der
Parser behandelt sie identisch.

### 2.2 Whitespace

Whitespace umfasst Leerzeichen (`U+0020`), Tabulator (`U+0009`) und
Zeilenwechsel. Whitespace trennt Tokens und ist sonst bedeutungslos —
FinDSL ist *nicht* einrückungssensitiv.

### 2.3 Kommentare

Zwei Formen ignorierbarer Kommentare:

```findsl
// Zeilenkommentar bis zum Zeilenende
/* Mehrzeiliger
   Block-Kommentar */
```

Kommentare dürfen überall stehen, wo Whitespace erlaubt ist.
Verschachtelung von `/* */` ist *nicht* erlaubt.

#### 2.3.1 Formatter-Direktiven

Zwei besondere Zeilenkommentare steuern ausschließlich den **Formatter**:

```findsl
// @formatter:off
…hier bleibt der Quelltext exakt erhalten…
// @formatter:on
```

Ein Zeilenkommentar gilt als Direktive, wenn sein Inhalt — nach
Entfernen des einleitenden `//` und Trimmen von Leerzeichen/Tabs —
**exakt** der Zeichenfolge `@formatter:off` bzw. `@formatter:on`
entspricht (Groß-/Kleinschreibung signifikant). Zusätzlicher Text in
derselben Kommentarzeile hebt die Erkennung auf. Normativ (Match gegen
den ganzen Kommentartext inkl. `//`):

```
OFF:  ^//[ \t]*@formatter:off[ \t]*$
ON:   ^//[ \t]*@formatter:on[ \t]*$
```

Wirkung: Der Quelltext von der Zeile mit `@formatter:off` bis
**einschließlich** der Zeile mit dem nächsten `@formatter:on` (beide
Direktiv-Zeilen eingeschlossen) wird vom Formatter **byte-für-byte
unverändert** gelassen — bei Dokument-, Bereichs- und Eingabe-
Formatierung gleichermaßen. Fehlt ein schließendes `@formatter:on`,
reicht der geschützte Bereich bis zum Dateiende. Ein `@formatter:on`
ohne vorangehendes offenes `@formatter:off` ist wirkungslos; ein
weiteres `@formatter:off` innerhalb einer bereits offenen Region ist
wirkungslos (keine Schachtelung).

Die Direktive ist eine **reine Formatter-Konvention**. Sie hat
**keinerlei Einfluss** auf Lexer, Parser, Grammatik, Validierung oder
Auswertung; der abgedeckte Quelltext wird normal geparst und
ausgewertet. Sie steht in keinem Zusammenhang mit String-Interpolation
`${…}` — ein `//` innerhalb eines String-Literals (`"…"`, `"""…"""`,
`${…}`) ist kein Zeilenkommentar und kann daher keine Direktive sein.

Die Unterdrückung ist **idempotent**: Da im geschützten Bereich nichts
geändert wird, ändern wiederholte Formatierungen das Ergebnis nicht
(`format(format(x)) = format(x)`).

### 2.4 Doc-Kommentare

Doc-Kommentare beginnen und enden mit `--` (zwei Bindestrichen) auf
einer eigenen Zeile (nur Whitespace davor und dahinter erlaubt). Der
Inhalt zwischen den Markern ist Markdown:

```findsl
--
# Überschrift

Mehrzeiliger Markdown-Inhalt.

@param x  Erster Parameter
@rückgabe   Beschreibung des Rückgabewerts
--
```

Einzeiliger Doc-Kommentar:

```findsl
-- Kurzbeschreibung in einer Zeile. --
```

Doc-Kommentare *müssen* unmittelbar (nur Whitespace und ggf.
Annotationen dazwischen) vor einer Deklaration stehen, an die sie
binden. Doc-Kommentare ohne folgende Deklaration sind ein Compile-Fehler.

Detaillierte Konventionen siehe Kapitel [9. Doc-Kommentare](#9-doc-kommentare).

### 2.5 Identifier

Identifier bestehen aus Unicode-Buchstaben (jeder `\p{L}` — also
lateinisch, Umlaute/ß, kyrillisch, griechisch, CJK …), Ziffern und
Unterstrichen und beginnen mit einem Buchstaben oder Unterstrich:

```ebnf
Identifier ::= (Letter | "_") (Letter | Digit | "_")*
Letter     ::= jeder Unicode-Buchstabe (Kategorie \p{L})
Digit      ::= jede Unicode-Ziffer (Kategorie \p{N})
```

Die früher auf `a…z A…Z ä ö ü Ä Ö Ü ß` begrenzte Definition wurde auf
den vollen Unicode-Buchstabenraum erweitert; die deutsch-fokussierten
Konventionen unten bleiben die *Empfehlung*, sind aber — mit **einer
Ausnahme** (siehe unten) — nicht erzwungen.

**Verbindlich (harte Regel): Konstanten-Namen.** Der Name einer
`konst`-Deklaration MUSS dem Muster `^[A-Z][A-Z0-9_]*$` genügen — also
ausschließlich ASCII-Großbuchstaben `A–Z`, Ziffern `0–9` und
Unterstrich `_`, beginnend mit einem Großbuchstaben (UPPER_SNAKE_CASE).
Ein Verstoß ist ein **Fehler**, kein Hinweis. Beispiele:

```findsl
konst ARBEITNEHMER_PAUSCHBETRAG: Euro = 1.230   // ✓ erlaubt
konst ZONE_4_OBERGRENZE:         Euro = 277.825 // ✓ erlaubt
konst An_Pauschalbetrag:         Euro = 1.230   // ✗ Fehler (gemischt)
konst gehalt:                    Euro = 1.230   // ✗ Fehler (klein)
```

Diese Härtung gilt **nur für Konstanten**.

**Zweite harte Regel:** Namen von **Funktionen, Datensätzen,
Aufzählungen und Aufzählungs-Werten** *müssen* mit einem
**Großbuchstaben** beginnen (Unicode-Großbuchstabe; führende
Unterstriche für die `_Intern`-Konvention erlaubt). Verstoß ist ein
**Fehler**. Eingebaute Methoden (`.abrunden()`, `.aufrunden()`,
`.zuordnen()`, …) sind ein eigener fester Namensraum (lowerCamelCase
per Konvention) und von dieser Regel nicht betroffen. `var`,
Parameter und Datensatz-**Felder** behalten lowerCamelCase (nicht
erzwungen).

Gross-/Kleinschreibung ist signifikant. Konventionen:

| Identifier-Art          | Schreibweise          | Beispiel                       |
| ----------------------- | --------------------- | ------------------------------ |
| **Funktion**            | **UpperCamelCase** (Großbuchstabe Pflicht) | `TabellenFreibetraege` |
| Variable, Parameter, Feld | lowerCamelCase      | `zuVersteuerndesEinkommen`     |
| Konstante               | SCREAMING_SNAKE_CASE  | `ZONE_4_OBERGRENZE`            |
| **Datensatz, Aufzählungstyp** | **UpperCamelCase** (Pflicht) | `TabellenFreibetraege` |
| **Aufzählungswert**     | **Großbuchstabe Pflicht** | `Splitting`, `I`, `II`, `III` |
| Dateiname / Pfad        | lower, `/`-getrennt   | `einkommensteuer/tarif/tarif2025.findsl` |

Identifier mit führendem Unterstrich (z. B. `_InternerHelfer`)
signalisieren konventionell *interne Verwendung*, sind aber nicht
sprachsemantisch privat; für Funktionen/Typen/Aufzählungs-Werte muss
nach den Unterstrichen ein Großbuchstabe folgen.

### 2.6 Schlüsselwörter

Vollständige Liste reservierter Schlüsselwörter siehe
[Anhang B](#anhang-b-schlüsselwörter). Schlüsselwörter dürfen nicht als
Identifier verwendet werden.

### 2.7 Literale

**Notation (deutsch).** `.` ist der **Tausender-Trenner** (Gruppen zu
drei Ziffern, optional), `,` ist der **Dezimaltrenner**. Es gibt keine
Unterstrich-Gruppierung. Disambiguierung: ein `.` gehört nur dann zur
Zahl, wenn ihm genau drei Ziffern folgen (sonst Member-Zugriff
`obj.feld`); ein `,` nur, wenn ihm direkt eine Ziffer folgt (sonst
Listen-/Argument-Trenner — Trenner-Komma daher stets mit folgendem
Leerzeichen: `f(a, b)`).

#### 2.7.1 Ganzzahl-Literale

Ganzzahlig, optional mit Tausender-Trenner:

```findsl
0
42
1230
1.230
12.096.000
```

Default-Typ ist `Ganzzahl`. Bei vorgegebenem Kontext (z. B. Funktions­
parameter vom Typ `Euro`) wird der Wert in den natürlichen Einheiten
des Zieltyps interpretiert (siehe [§ 3.13](#313-bidirektionale-typinferenz)).

#### 2.7.2 Dezimal-Literale

Mit Komma als Dezimaltrenner; optionaler Tausender-Trenner im
Vorkomma-Anteil:

```findsl
0,5
9,3
932,30
1.015,13
```

Default-Typ ist `Dezimal`. Im Geld-Kontext wird ein Dezimal-Literal
zu `EuroCent` koerziert.

#### 2.7.3 Geldwert-Literale

FinDSL kennt **keine** suffixierten Geldwert-Literale (kein `1.230 EUR`).
Der Geldtyp ergibt sich aus dem Kontext (Annotation, Parameter,
Rückgabe). Wo Kontext fehlt, dient der `als`-Operator zur expliziten
Typzuweisung:

```findsl
konst GFB: Euro = 12.096                  // Kontext gibt Euro vor
var x = 1.230 als Euro                     // expliziter Cast bei kontextlosem Ausdruck
```

**Schreibweise je Geldtyp ist verbindlich** — abweichende Schreibweise
ist ein Fehler:

| Typ        | Schreibweise                                  | Beispiele                      |
| ---------- | --------------------------------------------- | ------------------------------ |
| `Euro`     | ganzzahlig, kein `,`; `.`-Gruppen optional    | `100`, `1.000`, `3.332.222`    |
| `Cent`     | ganzzahlig, kein `,`; `.`-Gruppen optional    | `100`, `1.000`, `250.000`      |
| `EuroCent` | **genau zwei** Nachkommastellen Pflicht       | `3,23`, `2.003,32`, `3434,00`  |

#### 2.7.4 Prozent-Literale

Suffix `%` direkt nach Zahl-Literal:

```findsl
0%
9,3%
42%
100%
```

Typ ist `Prozent`. Der numerische Wert ist die Prozentangabe (nicht
der Bruchteil); `9.3%` repräsentiert intern den Wert "9.3 in
Prozent-Einheit", also die Bruchzahl 0.093.

#### 2.7.5 Boolean-Literale

```findsl
wahr
falsch
```

Typ ist `Wahrheitswert`.

#### 2.7.6 Text-Literale

FinDSL kennt zwei Formen von Text-Literalen.

**Einzeilige Text-Literale** mit doppelten Anführungszeichen:

```findsl
"§ 32a EStG"
"Pauschbetrag — gilt seit 1996"
```

Zeilenumbrüche innerhalb eines einzeiligen Literals sind nicht erlaubt
— verwende dafür mehrzeilige Literale oder die Escape-Sequenz `\n`.

**Mehrzeilige Text-Literale** mit dreifachen Anführungszeichen:

```findsl
"""
Sehr geehrte:r Steuerpflichtige:r,

für das Veranlagungsjahr 2025 beträgt
die festgesetzte Einkommensteuer 10.245 EUR.
"""
```

Mehrzeilige Literale dürfen `"` direkt enthalten (kein Escape nötig)
und bewahren Zeilenumbrüche, Tabulatoren und Whitespace genau so, wie
sie geschrieben sind.

**Escape-Sequenzen** (in beiden Formen identisch):

| Sequenz | Bedeutung                                   |
| ------- | ------------------------------------------- |
| `\"`    | Doppeltes Anführungszeichen                 |
| `\\`    | Backslash                                   |
| `\n`    | Zeilenumbruch                               |
| `\t`    | Tabulator                                   |
| `\$`    | Literales `$` (verhindert Interpolation)    |

**String-Interpolation** mit `${ausdruck}` in beiden Formen:

```findsl
var name = "Anna"
var grüßung = "Hallo, ${name}!"

var bescheid = """
Sehr geehrte:r ${anrede} ${nachname},

für das Veranlagungsjahr ${jahr} beträgt die festgesetzte
Einkommensteuer ${esteuer} EUR.

Mit freundlichen Grüßen
Finanzamt ${stadt}
"""
```

Innerhalb der geschweiften Klammern darf jeder gültige FinDSL-Ausdruck
stehen — von einer einfachen Variablen bis zu Funktionsaufrufen mit
Berechnungen. Das Ergebnis wird über die implizite Text-Konversion
eingefügt.

**Default-Konversion in Interpolations-Slots** (deutsche Formatierung):

| Typ                       | Text-Repräsentation                              |
| ------------------------- | ------------------------------------------------ |
| `Text`                    | unverändert                                      |
| `Ganzzahl`                | mit deutschem Tausendertrennpunkt: `12.096`      |
| `Dezimal`                 | mit deutschem Dezimalkomma: `932,30`             |
| `Prozent`                 | mit Komma und Leerzeichen vor `%`: `9,3 %`       |
| `Euro`                    | ganzzahlig, Tausender-Trenner, **kein** Suffix: `12.096`  |
| `Cent`                    | ganzzahliger Centbetrag, kein Suffix: `1`, `250.000` |
| `EuroCent`                | genau zwei Nachkommastellen, kein Suffix: `3.434,00` |
| `Wahrheitswert`           | `wahr` oder `falsch`                             |
| Aufzählungswert           | Name des Werts (z. B. `Splitting`)               |
| `nichts`                  | `(nicht angegeben)`                              |
| `Liste<T>`                | `[a, b, c]` mit Element-Konversion               |
| Datensatz                 | `Typname(feld1 = …, feld2 = …)`                  |

Wer eine andere Formatierung braucht, ruft explizit auf:
`${preis.alsText}` oder `${preis.alsText(format = "ohneEinheit")}`.

Typ aller Text-Literale ist `Text`.

**Einrückungsbehandlung.** Mehrzeilige Literale erhalten Einrückung
genau wie geschrieben. Für die häufige Situation, dass die Quelltext-
Einrückung nicht ins Ergebnis übernommen werden soll, gibt es die
Methode `.einrückungEntfernen()`:

```findsl
var nachricht = """
    Hallo
    Welt
""".einrückungEntfernen()
// → "Hallo\nWelt\n"  (gemeinsamer Leerzeichen-Prefix entfernt)
```

`.einrückungEntfernen()` strippt den minimalen gemeinsamen
Leerzeichen-Prefix aller nicht-leeren Zeilen und entfernt führende
und nachfolgende Leerzeilen.

#### 2.7.7 Null-Literal

```findsl
nichts
```

Repräsentiert die Abwesenheit eines Wertes für nullable Typen
(siehe [§ 3.9](#39-nullable-t)).

---

## 3. Typsystem

### 3.1 Übersicht

```
                       Typ
        ┌───────────────┼───────────────┐
        │               │               │
     Skalar          Verbund         Spezial
        │               │               │
   ┌────┼────┐    ┌─────┼─────┐    ┌────┴────┐
  Geld  Zahl  ...  Datensatz  Aufzählung  Liste<T>  Bereich<T>
                                              Funktion(...)→T
                                              T?  (Nullable)
```

### 3.2 Geldtypen

Drei Typen mit unterschiedlicher Präzision:

| Typ        | Bedeutung                                | Natürliche Einheit |
| ---------- | ---------------------------------------- | ------------------ |
| `Euro`     | Ganzzahliger Eurobetrag                  | 1 Euro             |
| `Cent`     | Ganzzahliger Centbetrag                  | 1 Cent             |
| `EuroCent` | Eurobetrag mit zwei Nachkommastellen     | 1 Euro (mit Cent)  |

#### 3.2.1 Wertebereich

Implementierungen *müssen* Geldwerte als willkürlich präzise Dezimal­
zahlen führen. Kein Rundungsverlust durch Float-Arithmetik.

#### 3.2.2 Implizite Konversion

Implizit nur in Richtung höherer Präzision:

```
Euro → EuroCent → Cent
```

Die Rückrichtung verlangt explizite Rundung über die Methoden
`.abrunden()`/`.aufrunden()` auf einem `EuroCent`-Wert; die
Zieleinheit (`Euro` oder `Cent`) ergibt sich aus dem Kontext
([§ 11.1](#111-rundungs-methoden)).

#### 3.2.3 Arithmetik

Geld-Geld-Operationen:

| Operation              | Ergebnistyp        |
| ---------------------- | ------------------ |
| `Geld + Geld`          | Präzisere Seite    |
| `Geld - Geld`          | Präzisere Seite    |
| `Geld * Geld`          | **Verboten**       |
| `Geld / Geld`          | `Dezimal`          |

Geld mit Nichtgeld:

| Operation              | Ergebnistyp        |
| ---------------------- | ------------------ |
| `Geld * Ganzzahl`      | gleicher Geldtyp   |
| `Geld * Dezimal`       | `EuroCent`         |
| `Geld * Prozent`       | `EuroCent`         |
| `Geld / Ganzzahl`      | `Dezimal`*         |

\* PAP-Konvention: Division eines Geldwertes durch eine dimensionslose
Ganzzahl normalisiert die Einheit weg. Wer einen Geldwert braucht,
rundet danach explizit.

### 3.3 Zahltypen

#### 3.3.1 Ganzzahl

`Ganzzahl` repräsentiert vorzeichenbehaftete Ganzzahlen mit
willkürlicher Präzision (`BigInteger`-Semantik).

#### 3.3.2 Dezimal

`Dezimal` repräsentiert Festkommazahlen mit willkürlicher Präzision
(`BigDecimal`-Semantik, mindestens 50 Stellen). Implementierungen
*müssen* dieses Präzisionsniveau garantieren.

### 3.4 Prozent

`Prozent` repräsentiert einen Prozentsatz. Der numerische Wert ist
die Prozentangabe (z. B. ist `9.3%` intern der Wert `9.3` in
Prozent-Einheit, was dem Bruchteil 0.093 entspricht).

Arithmetik:

| Operation                | Ergebnistyp            | Beispiel                       |
| ------------------------ | ---------------------- | ------------------------------ |
| `Prozent + Prozent`      | `Prozent`              | `9.3% + 1.7% == 11.0%`         |
| `Prozent - Prozent`      | `Prozent`              | `100% - 9.3% == 90.7%`         |
| `Prozent * Geld`         | `EuroCent`             | `42% * 100 als Euro == 42 EuroCent` |
| `Geld * Prozent`         | `EuroCent`             | (kommutativ)                   |
| `Prozent / Prozent`      | `Dezimal`              | `42% / 14% == 3`               |
| `Prozent * Ganzzahl`     | `Prozent`              | `9.3% * 2 == 18.6%`            |
| `Prozent / Ganzzahl`     | `Prozent`              | `9.3% / 2 == 4.65%`            |

`Prozent + Geld`, `Prozent + Dezimal` sind *Typfehler*.

### 3.5 Wahrheitswert

`Wahrheitswert` mit Werten `wahr` und `falsch`. Operatoren `und`,
`oder`, `nicht` (siehe [§ 4.4](#44-logische-operatoren)).

### 3.6 Text

`Text` repräsentiert Unicode-Zeichenketten beliebiger Länge. Literale
in einzeiliger und mehrzeiliger Form unterstützen Interpolation mit
`${ausdruck}` (siehe [§ 2.7.6](#276-text-literale)).

Wichtige Methoden (vollständige Liste in [§ 11.5](#115-text-methoden)):

- `.länge` — Anzahl der Unicode-Zeichen
- `.leer` — `wahr`, wenn die Länge `0` ist
- `.einrückungEntfernen()` — entfernt gemeinsamen Leerzeichen-Prefix von allen Zeilen
- `.alsText` — Identitäts-Konversion (für andere Typen die Default-Konversion)
- `+` (Operator) — Konkatenation: `"abc" + "def" == "abcdef"`

### 3.7 Aufzählungen

Aufzählungstypen werden mit `aufzählung` deklariert:

```findsl
aufzählung Tarifart { Grundtarif, Splitting }
aufzählung Steuerklasse { I, II, III, IV, V, VI }
```

Aufzählungswerte sind Singletons des deklarierten Typs.

**Eingebaute Aufzählungen** (Standard-Definition, immer verfügbar):

| Typ                    | Werte                                  |
| ---------------------- | -------------------------------------- |
| `Steuerklasse`         | `I`, `II`, `III`, `IV`, `V`, `VI`      |
| `Tarifart`             | `Grundtarif`, `Splitting`              |
| `Lohnzahlungszeitraum` | `Jahr`, `Monat`, `Woche`, `Tag`        |

### 3.8 Datensätze

Datensätze sind benannte Tupel mit getypten Feldern, deklariert mit
`datensatz`:

```findsl
datensatz Adresse(
    straße:   Text,
    plz:      Text,
    ort:      Text,
)

datensatz Person(
    name:     Text,
    alter:    Ganzzahl,
    adresse:  Adresse,
)
```

Felder können Default-Werte tragen:

```findsl
datensatz Einkünfte(
    landUndForstwirtschaft:  Euro = 0,
    gewerbebetrieb:          Euro = 0,
    // ...
)
```

Konstruktion erfolgt mit benannten oder positionalen Argumenten:

```findsl
Einkünfte(landUndForstwirtschaft = 5.000)        // benannt, andere Defaults
Einkünfte()                                       // alle Defaults
Adresse("Hauptstr. 1", "10115", "Berlin")        // positional
```

Felder werden mit `.` zugegriffen: `person.adresse.straße`.

Datensätze sind **immutable** — Felder können nach der Konstruktion
nicht mehr geändert werden.

### 3.9 Nullable T?

Jeder Typ `T` hat einen Nullable-Begleittyp `T?`, dessen Werte entweder
ein Wert von `T` oder `nichts` sind.

```findsl
var werbungskosten: Euro?         = 2.500           // ein Wert
var entlastungsbetrag: Euro?       = nichts         // kein Wert
```

`T?` ist *nicht* mit `T` zuweisungskompatibel:

```findsl
var x: Euro? = 5.000                                // OK
var y: Euro  = x                                    // ❌ Compile-Fehler
var y: Euro  = x oder 0                             // ✓ mit Fallback
var y: Euro  = x!!                                  // ✓ mit Force-Unwrap
```

`T??` ist äquivalent zu `T?` (Nullable-Wrapping ist idempotent).

Operatoren für Nullable: `?.` (Sicher-Zugriff), `oder` (Elvis), `!!`
(Force-Unwrap), `ist nichts`, `ist nicht nichts`.
Siehe [§ 4.5–4.7](#45-elvis-operator-oder).

### 3.10 Liste<T>

Liste von Werten gleichen Typs `T`. Listen sind *immutable*.

```findsl
Liste<Euro>
Liste<Steuerfall>
Liste<Liste<Euro>>             // verschachtelt
Liste<Euro?>                   // Liste mit potentiell fehlenden Einträgen
Liste<Euro>?                   // Optionale Liste (kann selbst nichts sein)
```

Konstruktion mit eckigen Klammern:

```findsl
[1, 2, 3]
[]                             // leere Liste, Elementtyp aus Kontext
[]<Euro>                       // leere Liste mit explizitem Elementtyp
[fall1, fall2, fall3]
```

Methoden siehe [§ 11.2](#112-listen-methoden).

### 3.11 Bereich<T>

Halbgeordnete Sequenzen über numerischen Typen oder Aufzählungen, mit
optionaler Schrittweite:

```findsl
0 bis 10                           // Bereich<Ganzzahl>: [0, 1, …, 10]
0 bis unter 10                     // [0, 1, …, 9]
0 bis 10 schritt 2                 // [0, 2, 4, 6, 8, 10]
I bis VI                           // Bereich<Steuerklasse>
```

Bereiche sind kompatibel mit `Liste<T>` — alle Listen-Methoden
funktionieren auch auf Bereichen, ohne dass man explizit
materialisieren muss.

### 3.12 Funktionstypen

Funktionstypen werden mit `(T1, T2, …) -> R` notiert:

```findsl
(Euro) -> Euro
(Euro, Euro) -> Euro
() -> Euro
(Steuerklasse) -> Tarifart
```

Funktionstypen sind **first-class** — können als Parameter, Variablen
und Rückgabewerte verwendet werden.

```findsl
fn AufVolleEuro(x: EuroCent): Euro = x.abrunden()
fn anwenden(f: (EuroCent) -> Euro, x: EuroCent): Euro = f(x)

anwenden(123,45, AufVolleEuro)                                // benannte Funktion
anwenden(123,45, { x -> x.aufrunden() })                      // Lambda (Ziel Euro aus f-Typ)
```

### 3.13 Bidirektionale Typinferenz

Numerische Literale ohne Suffix erhalten ihren Typ aus dem Kontext.
Wenn der Compiler einen erwarteten Typ ableiten kann, wird das Literal
in der natürlichen Einheit dieses Typs interpretiert.

**Quellen für den erwarteten Typ:**

1. Typ-Annotation einer Variable, Konstante oder eines Felds
2. Parameter-Typ einer aufgerufenen Funktion
3. Rückgabetyp der umgebenden Funktion (für die letzte Anweisung)
4. Operandentyp einer arithmetischen oder Vergleichs-Operation

**Regeln:**

```findsl
konst GFB: Euro = 12.096          // 12.096 → Euro
GFB + 1                            // 1 → Euro (aus Kontext GFB:Euro)
1 + 2                              // beide → Ganzzahl (kein Geldkontext)
1 + 2 als Euro                     // 1 → Euro (rechte Seite explizit Euro)

(123,45).abrunden() als Euro       // 123,45 → EuroCent (Empfänger-Anforderung)

var z: Dezimal = (zve - GFB) / 10.000
//   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ Resultattyp Dezimal aus Annotation
```

**Wenn kein Kontext verfügbar ist**, gilt der Default-Typ:

- Ganzzahl-Literal → `Ganzzahl`
- Dezimal-Literal → `Dezimal`

Wer dann einen Geldtyp will, schreibt explizit `als Euro` (siehe
[§ 4.8](#48-cast-operator-als)).

### 3.14 never (Bottom-Typ)

`never` ist der **Bottom-Typ**: der Typ eines Ausdrucks, der niemals
normal zu einem Wert auswertet, sondern den Lauf terminiert. Einziger
Erzeuger ist der `abbruch`-Ausdruck (§ 4.19); intern tragen ihn auch
nicht erreichbare Zweige.

Regeln:

- `never` ist zu **jedem** erwarteten Typ zuweisungskompatibel (Subtyp
  von allem). Damit darf `fn f(...): Euro = abbruch("...")` und ein
  `abbruch`-Zweig in `wähle`/`wenn` neben `Euro`-Zweigen stehen.
- `never` ist **kein** Supertyp: beim Vereinen der Zweigtypen eines
  `wähle`/`wenn` werden `never`-Zweige übersprungen; den Ergebnistyp
  bestimmen die übrigen Zweige. Ein `sonst -> abbruch(...)` macht ein
  `wähle` vollständig, ohne den Typ zu erweitern.
- `never` ist **nicht schreibbar**: es gibt keine Typ-Annotation
  `: never`. Der Typ entsteht ausschließlich durch Inferenz.

---

## 4. Ausdrücke

### 4.1 Literale und Variablen

Literale (siehe [§ 2.7](#27-literale)) sind primäre Ausdrücke. Variablen
(via `var`-Bindung), Konstanten (via `konst`) und importierte Namen
sind ebenfalls primäre Ausdrücke.

### 4.2 Arithmetische Operatoren

Die binären Operatoren `+`, `-`, `*`, `/` sind links-assoziativ. Unary
`-` (Negation) ist erlaubt.

| Operator    | Bedeutung      |
| ----------- | -------------- |
| `+`         | Addition       |
| `-`         | Subtraktion    |
| `*`         | Multiplikation |
| `/`         | Division       |
| unary `-`   | Negation       |

Typregeln siehe [§ 3.2.3](#323-arithmetik) (Geld), [§ 3.4](#34-prozent)
(Prozent), und Standard-Regeln für Zahltypen.

### 4.3 Vergleichsoperatoren

| Operator   | Bedeutung         |
| ---------- | ----------------- |
| `==`       | Gleichheit        |
| `!=`       | Ungleichheit      |
| `<`        | Kleiner           |
| `<=`       | Kleiner oder gleich |
| `>`        | Größer            |
| `>=`       | Größer oder gleich |

Ergebnistyp ist immer `Wahrheitswert`. Beide Operanden *müssen*
typkompatibel sein (numerisch, Aufzählung, oder Wahrheitswert).

Für nullable Werte: `x ist nichts` und `x ist nicht nichts` sind
spezielle Vergleichs-Konstrukte (Bool-Ergebnis).

### 4.4 Logische Operatoren

```findsl
nicht x         // Negation; x: Wahrheitswert
x und y         // Konjunktion; Kurzschluss-Auswertung
x oder y        // Disjunktion (siehe Hinweis)
```

`und` und `oder` werten **kurz-schlüssig** aus: der zweite Operand
wird nur ausgewertet, wenn das Ergebnis vom ersten Operanden noch nicht
feststeht.

**Hinweis: `oder` ist überladen.** Wenn der linke Operand vom Typ
`Wahrheitswert` ist, bedeutet `oder` logische Disjunktion; wenn er
vom Typ `T?` ist, bedeutet `oder` Elvis-Fallback (siehe nächster
Abschnitt). Das Typsystem entscheidet eindeutig.

### 4.5 Elvis-Operator (`oder`)

Für Nullable-Werte liefert `oder` den linken Wert, wenn er nicht
`nichts` ist, sonst den rechten:

```findsl
var werbungskosten: Euro? = nichts
var abzug: Euro = werbungskosten oder ARBEITNEHMER_PAUSCHBETRAG
```

Ergebnistyp ist der nicht-nullable Begleittyp des linken Operanden.
Der rechte Operand *muss* zuweisungskompatibel sein.

### 4.6 Sicher-Zugriff (`?.`)

Verkettet Feldzugriffe und Methodenaufrufe auf nullable Werten:

```findsl
person?.adresse?.straße                       // Text? (nichts wenn person oder adresse null)
liste?.zähle { x -> x > 0 }                  // Ganzzahl?
```

Wenn ein Glied der Kette `nichts` ist, bricht die Auswertung ab und
der Gesamtausdruck liefert `nichts`. Ergebnistyp ist *immer* nullable.

### 4.7 Force-Unwrap (`!!`)

Erzwungenes Auspacken eines nullable Werts:

```findsl
var x: Euro? = ...
var y: Euro = x!!                             // Laufzeitfehler bei nichts
```

Erzeugt zur Laufzeit einen Fehler, wenn der Operand `nichts` ist.
Verwende mit Bedacht — bevorzuge `oder` oder `wenn ... ist nichts`.

### 4.8 Cast-Operator (`als`)

Explizite Typumwandlung. Erlaubt zwischen numerisch verwandten Typen:

```findsl
1.230 als Euro                                // Ganzzahl → Euro
9,3 als Prozent                               // Dezimal → Prozent
0,42 als Dezimal                              // (No-op bei gleichem Typ)
```

Nicht erlaubt:

```findsl
"123" als Ganzzahl                           // ❌ Text → Zahl nicht via `als`
42 als Steuerklasse                           // ❌ Zahl → Aufzählung nicht via `als`
```

Bei Geldtypen gilt: Cast in höhere Präzision ist verlustfrei (`Euro
als Cent` multipliziert mit 100). Cast in niedrigere Präzision ist
ein Fehler — verwende explizite Rundung.

### 4.9 Wenn-Sonst-Ausdruck

`wenn` ist immer ein Ausdruck (kein Statement) und liefert einen Wert.
Beide Zweige *müssen* denselben Typ haben.

```findsl
wenn (bedingung) wert1 sonst wert2

wenn (stkl == I)
    0
sonst
    ANP_REGEL
```

Klammern um die Bedingung sind *Pflicht*.

### 4.10 Wähle-Ausdruck

Mehrweg-Verzweigung über Bedingungen oder Pattern. Liefert einen Wert.

#### 4.10.1 Wähle ohne Subjekt (Guards)

Mehrere Bedingungen, der erste passende Zweig gewinnt:

```findsl
wähle {
    falls bedingung1 -> wert1
    falls bedingung2 -> wert2
    sonst -> standardwert
}
```

`sonst` ist *Pflicht* (Vollständigkeitsgarantie).

#### 4.10.2 Wähle mit Subjekt (Pattern-Matching)

Vergleicht ein Subjekt mit mehreren Patterns:

```findsl
fn Kinderfreibetrag(stkl: Steuerklasse, zkf: EuroCent): Euro = wähle (stkl) {
    falls I, II      -> 0
    falls III        -> (zkf * KFB_SATZ_III).abrunden()
    falls IV, V, VI  -> (zkf * KFB_SATZ_IV_VI).abrunden()
}
```

Mehrere Patterns pro Zweig werden mit Komma getrennt.

Wenn die Patterns alle Werte des Subjekt-Typs (z. B. eines Aufzählungstyps)
abdecken, ist `sonst` optional. Der Compiler prüft Vollständigkeit
statisch.

Für nullable Subjekte:

```findsl
wähle (werbungskosten) {
    falls nichts -> ARBEITNEHMER_PAUSCHBETRAG
    sonst -> werbungskosten     // hier automatisch Euro (Smart-Cast)
}
```

Im `sonst`-Zweig nach einem `falls nichts`-Match weiß der Compiler,
dass das Subjekt nicht null ist — der Typ wird automatisch zu `T`
(non-nullable) verfeinert.

### 4.11 Funktionsaufruf

Standardform mit positionalen oder benannten Argumenten:

```findsl
foo(1, 2, 3)                                  // positional
foo(x = 1, y = 2, z = 3)                     // benannt
foo(1, z = 3)                                 // gemischt: positional zuerst
```

Methoden-Aufruf-Notation auf Listen, Bereichen und Datensätzen:

```findsl
liste.zuordnen(transformer)
person.adresse.straße
```

Methoden-Notation mit nachfolgendem Lambda:

```findsl
liste.filtern { x -> x > 0 }                  // Lambda direkt nach Methodenname
```

### 4.12 Lambda-Ausdruck

Anonyme Funktion. Geschweifte Klammern enthalten Parameter, dann `->`,
dann Rumpf:

```findsl
{ x: Euro -> x + 1 }                          // expliziter Typ
{ x -> x * 2 }                                // Typ aus Kontext inferiert
{ x, y -> x + y }                             // mehrere Parameter
{ -> 0 }                                       // null Parameter

{ x: Euro ->                                   // Block-Body
    var doppelt = x * 2
    doppelt + 100
}
```

Lambdas sind Werte vom Funktionstyp `(T1, T2, …) -> R`.

### 4.13 Feldzugriff

Lese-Zugriff auf Datensatz-Felder mit `.`:

```findsl
person.name
ergebnis.tariflicheEinkommensteuer
```

Verkettung mit `.` für tiefe Zugriffe. Für nullable Glieder verwende
`?.` (siehe [§ 4.6](#46-sicher-zugriff-)).

### 4.14 Datensatz-Konstruktor

Aufruf des Datensatz-Namens mit Argumentliste, wie ein Funktionsaufruf:

```findsl
Person(name = "Anna", alter = 35, adresse = Adresse(...))
Einkünfte()                                              // alle Defaults
TabellenFreibetraege(anp = 0, sap = 0, efa = 0, kfb = 0, kztab = Grundtarif, ztabfb = 0)
```

Felder ohne Default-Wert *müssen* angegeben werden.

### 4.15 Listen-Konstruktor

Eckige Klammern um eine durch Komma getrennte Liste von Ausdrücken:

```findsl
[1, 2, 3]
[]
[]<Euro>                                      // mit explizitem Elementtyp
[transformer1, transformer2, transformer3]
```

Trailing-Komma erlaubt.

### 4.16 Bereich-Konstruktor

Zwei Schlüsselwörter: `bis` (inkl.) und `bis unter` (exkl.):

```findsl
0 bis 10                                      // [0..10]
0 bis unter 10                                // [0..9]
0 bis 10 schritt 2                            // [0, 2, 4, 6, 8, 10]
0 bis unter 100 schritt 5
```

`bis`, `bis unter`, `schritt` sind ein Multi-Wort-Konstrukt (kein
beliebiger Operator).

### 4.17 Block-Ausdruck

Geschweifte Klammern umfassen eine Folge von `var`-Bindungen, gefolgt
vom Schluss-Ausdruck. Der Wert des Blocks ist der Wert des
Schluss-Ausdrucks.

```findsl
{
    var a = 5
    var b = 10
    a + b                                     // → 15
}
```

Block-Ausdrücke kommen typischerweise als Zweige in `wenn`/`wähle`
oder als Funktionsrumpf vor.

### 4.18 Operator-Präzedenz und -Assoziativität

Siehe [Anhang C](#anhang-c-operator-präzedenz).

### 4.19 Abbruch-Ausdruck

```findsl
abbruch(begründung)
```

`abbruch` terminiert den **gesamten Lauf** mit einer Pflicht-Begründung.
Es ist das prinzipientreue Gegenstück zu `throw` (siehe Folgerung in
[§ 1.3](#13-designprinzipien)): kein versteckter, abfangbarer
Kontrollfluss, sondern eine explizite, typisierte, audit-sichtbare
Aussage „diese Konstellation ist nach § X unzulässig oder nicht
definiert".

**Syntax.** `abbruch` ist ein primärer Ausdruck (Atom). Das Argument
`begründung` ist ein beliebiger Ausdruck vom Typ `Text` — Interpolation
ist erlaubt, sodass die Begründung den auslösenden Wert nennen kann.

**Typ.** `abbruch(...)` hat den Bottom-Typ `never` (§ 3.14). Es darf
daher als Funktionsbody oder als Zweig stehen, wo ein beliebiger Typ
erwartet wird:

```findsl
@Quelle("§ 32a EStG")
fn estGrundtarif(zve: Euro): Euro = wähle {
    falls zve < 0 als Euro       -> abbruch("§ 32a: negatives zvE unzulässig: ${zve}")
    falls zve <= 12.096 als Euro -> 0 als Euro
    sonst                        -> /* … Tarifformel … */
}
```

**Semantik.**

- **Nicht abfangbar.** Kein Sprachkonstrukt fängt `abbruch`. Es bricht
  den Lauf bis zur Aufruf-Grenze ab; dort entsteht ein strukturiertes
  Ergebnis (Begründung, Ort, Aufrufkette).
- **Pflicht-Begründung.** Das `Text`-Argument ist syntaktisch erzwungen.
  Eine leere Begründung *sollte* vom Validator beanstandet werden.
- **Audit-sichtbar.** Begründung, umschließende Funktion und deren
  `@Quelle` werden für den Doku-Anhang „Explizit ausgeschlossene
  Konstellationen" maschinell gesammelt.
- **Geschwister von `!!`** ([§ 4.7](#47-force-unwrap)): `!!` ist der
  *unbeabsichtigte* Bug-Abbruch, `abbruch` der *beabsichtigte,
  begründete* Fachabbruch. Beide sind Fail-Fast und nicht abfangbar.

In `prüfe`-Blöcken lässt sich ein erwarteter Abbruch positiv testen,
siehe [§ 10.2](#102-testfall-items).

---

## 5. Bindungen und Schleifen

### 5.1 var

Lokale unveränderliche Bindung mit explizitem Typ:

```findsl
var name: Typ = ausdruck
```

Beispiel:

```findsl
var anp: Euro = 1.230
var y:   Dezimal = (zve - GFB) / 10.000
var f:   (Euro) -> Euro = { x -> x * 2 }
```

Trotz des Schlüsselworts `var` sind Bindungen **single-assignment**:
einmal zugewiesen, bleibt der Wert konstant. (Die Wahl von `var` statt
`val` folgt dem Sprachgebrauch.)

`var`-Bindungen sind nur innerhalb von Funktions- und Block-Bodies
zulässig. Top-Level-Werte werden mit `konst` deklariert.

### 5.2 Block

Siehe [§ 4.17](#417-block-ausdruck). Blöcke sind Ausdrücke und liefern
einen Wert.

### 5.3 Für-Jeden-Schleife

Iterations-Konstrukt für Listen und Bereiche; produziert eine
Liste der Body-Werte.

```findsl
für jeden x aus liste {
    body
}
```

Semantisch äquivalent zu:

```findsl
liste.zuordnen { x -> body }
```

Beispiel:

```findsl
für jede stkl aus (I bis VI) {
    für jede lohnstufe aus (0 bis 60.012 schritt 36) {
        berechneLohnsteuerZeile(stkl, lohnstufe)
    }
}
// → Liste<Liste<TabellenZeile>>
```

`für jeden` und `für jede` sind synonym und nur sprachlich-grammatisch
unterschiedlich. Der Compiler unterscheidet nicht.

**Es gibt kein `solange` (while)-Konstrukt.** Iteration mit
unbestimmtem Ende geschieht via Rekursion oder
`zusammenfassen`-Aggregation.

### 5.4 ausgabe-Anweisung

```findsl
ausgabe(text)
```

`ausgabe` gibt `text` (Typ `Text`, Interpolation erlaubt) auf die
Konsole aus. Es ist eine **Anweisung, kein Ausdruck**: sie liefert
**keinen Wert** und darf ausschließlich als eigene Zeile in einem Block
stehen (`{ … }` von Funktions-Body oder Lambda), neben `var`-Bindungen
und vor dem Ergebnis­ausdruck:

```findsl
fn estGrundtarif(zve: Euro): Euro {
    ausgabe("Tarifberechnung für zvE=${zve}")
    var t: Euro = /* … */
    t
}
```

`ausgabe` ist **nicht** in `atom` — in Ausdrucksposition ist es ein
Syntaxfehler (kein `var x = ausgabe(...)`, kein `fn f() = ausgabe(...)`,
kein `falls … -> ausgabe(...)`).

**`ausgabe` ist ein echter Seiteneffekt** und damit eine **bewusste,
einzige zugelassene Ausnahme von P2** (§ 1.3). Damit das Verhalten
definiert ist, gilt verbindlich: **Block-Anweisungen werden eager in
Quelltext-Reihenfolge (oben nach unten), Teilausdrücke links-nach-rechts
ausgewertet.** (In rein funktionalem Code ist diese Reihenfolge nicht
beobachtbar; mit `ausgabe` wird sie es — daher die Festlegung.)

`ausgabe` erfordert **keinen** Unit/void-Typ: da es kein Ausdruck ist,
gibt es nichts zu typisieren — die „keine void-Funktionen"-Regel bleibt
unberührt. Reine Logging-Funktionen gibt es nicht; `ausgabe` ist eine
Trace-Zeile in einem wertproduzierenden Block.

---

## 6. Deklarationen

### 6.1 konst

Top-Level-Konstante mit Typ-Annotation:

```findsl
[doc-comment]
[annotations]
konst NAME: Typ = ausdruck
```

Beispiel:

```findsl
@Quelle("§ 32a Absatz 1 Nr. 1 EStG")
konst GFB: Euro = 12.096
```

Der Initialisierungsausdruck *muss* zur Compilezeit auswertbar sein
(reine, deterministische Funktionen ohne Schleifen-Iteration).

### 6.2 fn

Der Rückgabetyp wird mit `:` eingeführt (`fn name(…): RückgabeTyp`),
**nicht** mit `->`. `:` bedeutet in FinDSL durchgängig „Name/Ausdruck
hat Typ" (Parameter, `konst`, `var`, Feld, Rückgabe); `->` ist
ausschließlich Funktionstypen (`(Euro) -> Euro`), Lambda-Rümpfen
(`{ x -> … }`) und `wähle`-Armen vorbehalten. Diese Trennung hält
funktionstypwertige Rückgaben eindeutig lesbar — vgl.
`fn ableiten(f: (Euro) -> Euro): (Euro) -> Euro`, wo `:` sauber „hat
Typ" vom `->` *innerhalb* des Typs trennt. (Bewusste, mehrfach
bestätigte Entscheidung.)

#### 6.2.1 Block-Body

```findsl
[doc-comment]
[annotations]
fn name(p1: T1, p2: T2 = default, …): RückgabeTyp {
    var lokal1 = ...
    var lokal2 = ...
    schluss-ausdruck                         // implizite Rückgabe
}
```

Der **letzte Ausdruck** im Block ist der Rückgabewert. Es gibt kein
explizites `return`-Schlüsselwort.

#### 6.2.2 Expression-Body

Wenn der ganze Funktionsrumpf ein Ausdruck ist:

```findsl
fn name(p: T): R = ausdruck

fn estSplitting(zve: Euro): Euro =
    2 * estGrundtarif((zve / 2).abrunden())
```

#### 6.2.3 Default-Parameter

Parameter können Default-Werte haben:

```findsl
fn einkünfteAusNichtselbständigerArbeit(
    bruttoArbeitslohn:           Euro,
    tatsächlicheWerbungskosten:  Euro? = nichts,
): Euro = ...
```

Bei Aufruf können Default-tragende Parameter weggelassen werden.

#### 6.2.4 Closures

Lambdas und benannte Funktionen, die innerhalb anderer Funktionen
deklariert werden, *erfassen* Variablen aus dem umgebenden Scope:

```findsl
fn erzeugeRabattRechner(rabattSatz: Prozent): (Euro) -> Euro =
    { preis -> preis * (100% - rabattSatz) }    // erfasst rabattSatz

var zehnProzent = erzeugeRabattRechner(10%)
zehnProzent(100 als Euro)                       // → 90 EuroCent
```

Erfasste Werte werden zum Erstellzeitpunkt der Closure festgehalten.

### 6.3 datensatz

Siehe [§ 3.8](#38-datensätze). Vollständige Form:

```findsl
[doc-comment]
[annotations]
datensatz Name(
    feld1: T1,
    feld2: T2 = default,
    …
)
```

### 6.4 aufzählung

```findsl
aufzählung Name { Wert1, Wert2, …, WertN }
```

Beispiel:

```findsl
aufzählung Bundesland {
    BadenWürttemberg, Bayern, Berlin, Brandenburg, Bremen, Hamburg,
    Hessen, MecklenburgVorpommern, Niedersachsen, NordrheinWestfalen,
    RheinlandPfalz, Saarland, Sachsen, SachsenAnhalt, SchleswigHolstein,
    Thüringen
}
```

Aufzählungswerte sind Singletons. Vergleich mit `==` und `!=`. In
`wähle`-Pattern-Matching ist Vollständigkeit statisch prüfbar.

---

## 7. Annotationen

Annotationen sind typisierte Metadaten an Deklarationen. Syntax:

```findsl
@Name(arg1, arg2, …)
```

Annotationen stehen *zwischen* Doc-Kommentar und Deklaration:

```findsl
--
Doc-Text
--
@Quelle("§ 32a EStG")
@Stand("2025-01-22")
konst GFB: Euro = 12.096
```

### 7.1 @Quelle

Standard-Annotation für gesetzliche Quellangabe:

```findsl
@Quelle("§ 32a Absatz 1 Nr. 1 EStG")
@Quelle("PAP 2025 Subroutine MZTABFB")
@Quelle("BMF-Schreiben vom 22.1.2025")
```

Argument ist ein Text-Literal. Mehrere `@Quelle`-Annotationen an
derselben Deklaration sind erlaubt (für Regeln, die aus mehreren
Normen abgeleitet sind).

`@Quelle` ist *konventionell verpflichtend* für Konstanten und
Funktionen, die unmittelbar einer Norm entspringen. Helper-Funktionen
ohne Norm-Anker können sie weglassen.

### 7.2 Zukünftige Annotationen

Die folgenden Annotationen sind in zukünftigen Sprachversionen geplant
und werden hier nur informativ erwähnt:

- `@Stand("YYYY-MM-DD")` — letzter inhaltlicher Stand
- `@Veraltet("Begründung", ersatzDurch = "anderer Name")` — Deprecation
- `@SeitVersion("v1.2")` — Einführungs-Versionsmarker

---

## 8. Dateien und Imports

### 8.1 Datei als Übersetzungseinheit

Eine `.findsl`-Datei ist die Übersetzungseinheit. Dateien stehen für
sich und werden über ihren **Dateipfad** referenziert. Eine Datei
besteht aus einem optionalen
führenden Doc-Block (§ 8.2), darauf folgenden `verwende`-Direktiven und
den Deklarationen.

### 8.2 Datei-Dokumentation

Der erste `--…--`-Doc-Block (optional mit `@…`-Annotationen) am
Dateianfang — vor allen `verwende`-Direktiven und Deklarationen — ist die
**Datei-Dokumentation**. Jede Deklaration trägt ihren eigenen
`--…--`-Block unmittelbar davor.

> **Konvention:** Stets einen Datei-Doc-Block voranstellen. Fehlt er, ordnet
> der Parser den ersten Block (greedy) der Datei-Dokumentation zu, und die
> erste Deklaration bliebe ohne eigenen Doc — das verletzt P6.

### 8.3 verwende-Direktive

Importiert selektiv benannte Deklarationen aus einer anderen Datei über
einen **relativen Dateipfad**:

```findsl
verwende { estEinkommensteuer, Tarifart } aus "../tarif/tarif2025"

// Verwendung unqualifiziert:
estEinkommensteuer(zve, art)
Splitting                                       // Aufzählungswert direkt
```

- Der Pfad ist ein **String-Literal**, aufgelöst **relativ zum
  Verzeichnis der importierenden Datei**.
- Er trägt **kein** `.findsl`-Suffix (wird automatisch angehängt) und
  **muss** mit `./` oder `../` beginnen.
- `.test` ist reiner Dateinamensbestandteil:
  `"./foo.test"` → `foo.test.findsl`.
- Der Pfad-String ist ein **einfaches** Literal: keine `"""…"""`-Form
  und keine `${…}`-Interpolation (Compile-Fehler).

#### Umbenennung mit `als`

Pro importiertem Symbol optionaler Alias:

```findsl
verwende {
    foo als xfoo,
    bar als yfoo,
} aus "./pfad/foobar"
```

#### Mehrjahres-Import

```findsl
verwende { estGrundtarif als grundtarif2024 } aus "../tarif/tarif2024"
verwende { estGrundtarif als grundtarif2025 } aus "../tarif/tarif2025"

fn vergleich(zve: Euro): Liste<Euro> = [
    grundtarif2024(zve),
    grundtarif2025(zve),
]
```

### 8.4 Sichtbarkeit

**Top-Level-Deklarationen sind grundsätzlich öffentlich.** FinDSL hat
*kein* `privat`/`öffentlich`-Konstrukt. Auditierbarkeit hat Priorität.

**Ausnahme — modul-intern via führendem `_`.** Eine Top-Level-Decl
(`fn`, `konst`, `datensatz`, `aufzählung`), deren Name mit `_` beginnt,
ist **modul-intern**: sie ist *nicht* Teil der öffentlichen API.

- Sie darf **nicht** cross-file mit `verwende` importiert werden —
  Verstoß = **Fehler** (`findsl.import-intern`). Innerhalb ihrer eigenen
  Datei ist sie uneingeschränkt verwendbar.
- **Einzige Ausnahme:** eine `<basis>.test.findsl` darf die Interna
  ihrer **zugehörigen** Quelldatei `<basis>.findsl` importieren (direkte
  Unit-Tests interner Logik). Test-Datei → fremde Datei bleibt gesperrt.
- Sie erscheint **nicht** in der generierten Dokumentation
  (Doc-Generator filtert `_`-Decls; der abbruch-Anhang bleibt
  vollständig, da Audit-Katalog).

Das ist eine bewusste Verfeinerung von **P7**: die *öffentliche*
API-Fläche wird kleiner und damit auditierbarer; die interne Logik
bleibt transitiv über die öffentliche API und über die zugehörigen
`.test.findsl` prüf- und nachvollziehbar (keine echte Verbergung von
Rechtslogik). Rein namensbasiert — kein eigenes Token (`IDENT` bleibt
generisch), Enforcement im Validator und Doc-Generator.

### 8.5 Eingebaute Standard-Definitionen

Die folgenden Definitionen sind in jeder Datei implizit verfügbar
(kein `verwende` nötig):

- Geld- und Zahltypen: `Euro`, `Cent`, `EuroCent`, `Ganzzahl`,
  `Dezimal`, `Prozent`, `Wahrheitswert`, `Text`
- Sammlungen: `Liste<T>`, `Bereich<T>`
- Eingebaute Aufzählungen: `Steuerklasse`, `Tarifart`,
  `Lohnzahlungszeitraum`
- Eingebaute Funktionen: siehe [§ 11](#11-standard-bibliothek)

Diese Namen sind reserviert; eine Datei darf sie nicht erneut
deklarieren.

### 8.6 Konfliktauflösung

Importiert eine Datei zwei gleichnamige Symbole aus verschiedenen
Pfaden, ist das eine Namenskollision; Lösung ist ein `als`-Alias:

```findsl
verwende { tarif2025 als estTarif } aus "../einkommensteuer/tarif2025"
verwende { tarif2025 als kstTarif } aus "../körperschaftsteuer/tarif2025"
```

**Wildcards** (`verwende * aus …`) sind *nicht* erlaubt.
Importe müssen explizit benannt werden.

**Re-Exports** sind in v1.0 nicht vorgesehen.

**Zyklische Datei-Abhängigkeiten** sind verboten und werden zur
Compilezeit gemeldet.

---

## 9. Doc-Kommentare

### 9.1 Syntax

Doc-Kommentare beginnen und enden mit `--` auf einer eigenen Zeile
(nur Whitespace davor und dahinter). Inhalt ist Markdown.

```findsl
--
# Überschrift

Markdown-Inhalt mit beliebiger Tiefe.

@param x  Erster Parameter
@rückgabe   Beschreibung
--
```

Einzeilige Variante:

```findsl
-- Kurze Beschreibung. --
```

Doc-Kommentare *müssen* unmittelbar (ggf. mit dazwischenliegenden
Annotationen) vor der zu dokumentierenden Deklaration stehen.

### 9.2 Strukturkonventionen

Empfohlene Markdown-Sektionen, alle optional:

| Sektion          | Zweck                                          |
| ---------------- | ---------------------------------------------- |
| `# Name`         | Datei-Top-Level: Name und Kurzbeschreibung    |
| `## Zweck`       | Was die Regel bewirkt (1–2 Sätze)             |
| `## Anmerkungen` | Sonderfälle, Wahlrechte, Ausnahmen            |
| `## Beispiel`    | Worked example, möglichst als ausführbarer Doc-Test |
| `## Verweise`    | Verwandte §§ und Funktionen                   |
| `## Historie`    | Wann eingeführt/geändert                       |

Für Funktionen empfohlen mit JavaDoc-Stil-Tags:

```findsl
--
Beschreibung der Funktion.

@param p1   Beschreibung des ersten Parameters.
@param p2   Beschreibung des zweiten Parameters.
@rückgabe     Beschreibung des Rückgabewerts.

## Anmerkungen
…
--
```

### 9.3 Trailing-Comment-Konvention für Felder

Datensatz-Felder werden idiomatisch mit trailing `//`-Kommentaren
dokumentiert:

```findsl
datensatz TabellenFreibetraege(
    anp:    Euro,     // Arbeitnehmer-Pauschbetrag (§ 9a EStG)
    sap:    Euro,     // Sonderausgaben-Pauschbetrag (§ 10c EStG)
    efa:    Euro,     // Entlastungsbetrag für Alleinerziehende (§ 24b EStG)
)
```

`//`-Kommentare sind syntaktisch normale Code-Kommentare; per
Konvention extrahiert der Doc-Generator trailing `//`-Kommentare auf
Feld-Zeilen als Feld-Doc.

Längere Feld-Beschreibungen verwenden einen `--`-Block davor.

### 9.4 Doc-Tests

Markdown-Code-Blöcke mit der Sprachkennung ` ```findsl ` innerhalb
eines Doc-Kommentars *können* vom Compiler als ausführbare Tests
behandelt werden. Jede Zeile, die ein Vergleichs-Ausdruck ist, wird
geprüft:

```findsl
--
@param zve  …
@rückgabe     …

## Beispiel

```findsl
estGrundtarif(50.000) == 10.691
estGrundtarif(100.000) == 31.088
```
--
fn estGrundtarif(...) ...
```

Schlägt eine Zeile fehl, ist der Doc veraltet — der Build bricht ab.

### 9.5 Mathematische Notation

Doc-Kommentar-Prosa darf mathematische Formeln in TeX-Notation
enthalten. Geltungsbereich: `--…--`-Datei-/Deklarations-Doc-Kommentare,
`@param`-/`@rückgabe`-Beschreibungen sowie längere Feld-Beschreibungen
(§ 9.3).

- **Inline:** `$ … $` — kurze Formel im Fließtext.
- **Block:** `$$ … $$` — abgesetzte Formel (ein- oder mehrzeilig).

**Erkennungsregel (normativ):**

1. `$$ … $$` wird **vor** `$ … $` erkannt.
2. Ein öffnendes `$` zählt nur, wenn ihm **kein** Whitespace
   unmittelbar folgt; das schließende `$` nur, wenn ihm **kein**
   Whitespace unmittelbar vorausgeht und **keine Ziffer** folgt.
   Dadurch bleiben `5 $`, `100 $` und ein einzelnes `$` **literal**.
3. `\$` ist stets ein literales Dollarzeichen (keine Formel).
4. Ein ungepaartes `$`/`$$` bleibt **wörtlich** (verschluckt keinen
   Folgetext).
5. In Code-Spans (`` `…` ``) und Code-Fences (` ``` `) wird Mathe
   **nicht** interpretiert (bleibt literal).

**Rendering-Zusicherung:**

| Format   | Verhalten                                                   |
| -------- | ----------------------------------------------------------- |
| Markdown | roh/kanonisch (`$…$`/`$$…$$` unverändert; GitHub-renderbar)  |
| HTML     | KaTeX-gerendert, self-contained (CSS+Fonts inline), Light/Dark |
| PDF      | Block-Mathe als echtes Vektor-SVG; Inline-Mathe als TeX-Fallback in Code-Schrift (pdfmake platziert kein SVG im Textfluss) |

Die Ausgabe ist **idempotent** (erneuter Lauf ⇒ byte-identisch).
Der unterstützte Makro-Umfang ist der KaTeX-Standard; ungültiges TeX
wird als Fehlerhinweis dargestellt, nicht als Build-Abbruch
(`strict:'ignore'`, `trust:false`).

**Abgrenzung:** Mathe-Notation ist reine **Doku-Konvention** und hat
**keinen** Einfluss auf Grammatik, Parsing oder Auswertung. `$…$` in
einem Doc-Kommentar ist unabhängig von der `${…}`-String-Interpolation
(§ 2) in FinDSL-Quelltext — letztere wird zur Laufzeit ausgewertet,
erstere nur vom Doc-Generator gerendert.

---

## 10. Tests

### 10.1 prüfe-Block

Ein `prüfe`-Block enthält benannte Beispielrechnungen. Jeder
`testfall` ist ein **Block** `{ … }`: optionale `var`-Setup-
Anweisungen und ein abschließender boolescher Ausdruck, der zur
Wahrheit auswerten muss.

```findsl
prüfe "Bezeichnung des Test-Sets" {
    testfall "Beschreibung Beispiel 1" { ausdruck1 }
    testfall "Beschreibung Beispiel 2" {
        var hilfswert: Euro = …
        ausdruck2
    }
    …
}
```

Beispiel:

```findsl
prüfe "§ 32a EStG 2025 — Knotenpunkte der Tarifzonen" {
    testfall "Zone 1 — Existenzminimum" {
        estGrundtarif(12.096) == 0
    }

    testfall "Zone 4 — 100.000 EUR zvE" {
        estGrundtarif(100.000) == 31.088
    }
}
```

### 10.2 testfall-Items

`testfall` als Schlüsselwort wurde bewusst gewählt, weil das
deutsche Steuervokabular `fall` (Steuerfall, Sachfall, Erbfall,
Einzelfall, …) intensiv als Identifier verwendet — eine
Reservierung würde diese natürliche Benennung blockieren. `testfall`
ist im Test-Kontext ohnehin semantisch präziser: ein `prüfe`-Eintrag
ist eine *Beispielrechnung* mit erwartetem Output, kein juristischer
"Fall".

Der Block enthält null oder mehr `var`-Anweisungen (Test-Setup,
„Arrange") und als letzten Ausdruck die boolesche Assertion. Das ist
dieselbe Blockform wie ein `fn`-Rumpf `{ … }` (SPEC § 6.2) — kein
Sonderkonstrukt. Whitespace ist nicht signifikant.

**Erwarteter Abbruch.** Mit der Variante

```findsl
testfall "negatives zvE wird abgelehnt" erwartet abbruch {
    estGrundtarif(-100 als Euro)
}
```

wird der Ablehnungspfad positiv getestet: der Testfall **besteht**
genau dann, wenn die Auswertung des Ausdrucks einen `abbruch` (§ 4.19)
auslöst. Wertet er stattdessen normal zu einem Wert aus, **scheitert**
der Testfall. Ohne `erwartet abbruch` gilt umgekehrt: löst ein Testfall
einen `abbruch` aus, scheitert er (mit Anzeige der Begründung).

---

## 11. Standard-Bibliothek

### 11.1 Rundungs-Methoden

`.abrunden()` (Floor, Richtung −∞) und `.aufrunden()` (Ceiling,
Richtung +∞) sind **Methoden** auf Werten **mit Nachkommastellen** —
also auf `EuroCent`, `Dezimal` und `Prozent`. Auf allen anderen
Typen (`Euro`, `Cent`, `Ganzzahl`, `Text`, …) ist ihr Aufruf ein
**Fehler**: ohne Nachkommastellen gibt es nichts zu runden.

| Empfänger  | Methode                      | Ergebnistyp            | Wirkung                                   |
| ---------- | ---------------------------- | ---------------------- | ----------------------------------------- |
| `EuroCent` | `.abrunden()`/`.aufrunden()` | `Euro` **oder** `Cent` | Floor/Ceiling zur vollen Zieleinheit      |
| `Dezimal`  | `.abrunden()`/`.aufrunden()` | `Ganzzahl`             | Floor/Ceiling zur Ganzzahl; `.aufrunden()` für „je angefangene Einheit"-Tarife (z. B. KraftStG § 9) |
| `Prozent`  | `.abrunden()`/`.aufrunden()` | `Prozent`              | Floor/Ceiling zur **vollen Prozent** (Einheit bleibt); z. B. `42,7%.abrunden()` → `42 %`, `5,5%.aufrunden()` → `6 %` |

**Zielbestimmung bei `EuroCent`-Empfänger.** Welche Zieleinheit gilt —
voller `Euro` oder voller `Cent` —, ergibt sich aus dem erwarteten Typ
(bidirektionale Inferenz, dieselben Kontextquellen wie in
[§ 3.13](#313-bidirektionale-typinferenz)):

1. Typ-Annotation einer Bindung — `var/konst x: Euro = e.abrunden()`
2. Expliziter `als`-Cast — `e.abrunden() als Cent`
3. Rückgabetyp der umgebenden Funktion — `fn F(…): Euro = e.abrunden()`
4. Geld-Operandentyp eines Vergleichs (§ 3.13 Punkt 4)

Fehlt ein solcher Kontext, ist der Aufruf ein **Fehler**
(„Zielgenauigkeit unbestimmt — `: Euro`/`: Cent` annotieren oder `als`
casten"). FinDSL rät die Einheit nicht. Bei `Dezimal`-Empfänger ist
`Ganzzahl`, bei `Prozent`-Empfänger `Prozent` (volle Prozent) das
einzige sinnvolle Ziel — kein Kontext nötig.

### 11.2 Listen-Methoden

Auf `Liste<T>` und `Bereich<T>`:

| Methode                                         | Ergebnistyp        | Bedeutung                       |
| ----------------------------------------------- | ------------------ | ------------------------------- |
| `.länge`                                        | `Ganzzahl`         | Anzahl der Elemente             |
| `.leer`                                         | `Wahrheitswert`    | true wenn länge == 0            |
| `.kopf`                                         | `T`                | Erstes Element (Fehler bei leer) |
| `.rest`                                         | `Liste<T>`         | Alle außer dem ersten           |
| `[i]` oder `.bei(i)`                            | `T`                | Element bei Index `i`           |
| `.enthält(x)`                                   | `Wahrheitswert`    | true wenn `x` enthalten         |
| `.zuordnen(f: (T) -> U)`                        | `Liste<U>`         | Map                             |
| `.filtern(p: (T) -> Wahrheitswert)`             | `Liste<T>`         | Filter                          |
| `.zusammenfassen(start: A, f: (A, T) -> A)`     | `A`                | Fold/Reduce                     |
| `.zähle()` oder `.zähle(p)`                     | `Ganzzahl`         | Anzahl insgesamt oder mit Predikat |
| `.summe()`                                      | `T`                | Summe (für numerische T)        |
| `.größtes()`, `.kleinstes()`                    | `T`                | Max/Min                         |

### 11.3 Bereich-Konstruktoren

Sprachintegriert (siehe [§ 4.16](#416-bereich-konstruktor)):

```findsl
a bis b
a bis unter b
a bis b schritt s
```

### 11.4 Eingebaute Aufzählungen

Siehe [§ 3.7](#37-aufzählungen).

### 11.5 Text-Methoden

| Methode                                | Ergebnistyp        | Bedeutung                            |
| -------------------------------------- | ------------------ | ------------------------------------ |
| `.länge`                               | `Ganzzahl`         | Anzahl Unicode-Zeichen               |
| `.leer`                                | `Wahrheitswert`    | `länge == 0`                         |
| `.einrückungEntfernen()`               | `Text`             | Gemeinsamen Whitespace-Prefix entfernen |
| `.alsText`                             | `Text`             | Identitäts-Konversion                |
| `.alsGroßbuchstaben()`                 | `Text`             | Komplette Großschreibung             |
| `.alsKleinbuchstaben()`                | `Text`             | Komplette Kleinschreibung            |
| `.beginntMit(prefix: Text)`            | `Wahrheitswert`    | Präfix-Test                          |
| `.endetMit(suffix: Text)`              | `Wahrheitswert`    | Suffix-Test                          |
| `.enthält(teil: Text)`                 | `Wahrheitswert`    | Substring-Test                       |
| `.geteiltAn(trenner: Text)`            | `Liste<Text>`      | Split an Trennzeichenfolge           |
| `+` (Operator)                         | `Text`             | Konkatenation                        |

**Default-Konversion in Interpolations-Slots `${...}`** für alle Typen:

- Alle Typen haben implizit eine `.alsText`-Methode mit deutscher
  Default-Formatierung (siehe Tabelle in [§ 2.7.6](#276-text-literale)).
- Wer abweichende Formatierung braucht, ruft `.alsText(format = …)`
  mit einem Format-Bezeichner auf. Vorgesehene Bezeichner:
  - `"ohneEinheit"` — nur Zahl (Geldtypen haben ohnehin **kein**
    Suffix; betrifft also v. a. das `%` von `Prozent`)
  - `"reinAscii"`   — keine Tausenderpunkte/Komma-Dezimaltrenner
  - `"langform"`    — ausgeschriebene Form, z. B. "12 096 Euro"

  > **v1.0-Status:** Die parameterlose `.alsText` ist verfügbar. Die
  > `.alsText(format = …)`-Variante samt Bezeichner-Katalog ist in
  > v1.0 **noch nicht implementiert** und nicht endgültig fixiert
  > (eigene Designrunde offen).

---

## 12. Code-Generierung

FinDSL ist als Quelle für die Übersetzung in mehrere Zielsprachen
konzipiert. Die folgenden Zuordnungen sind verbindlich für
Implementierungen.

### 12.1 Java/Kotlin

| FinDSL-Konzept            | Java/Kotlin-Mapping                         |
| ------------------------- | ------------------------------------------- |
| `Ganzzahl`                | `BigInteger`                                |
| `Dezimal`, `Prozent`      | `BigDecimal` mit `MathContext.DECIMAL128`   |
| `Euro`, `Cent`, `EuroCent`| `BigDecimal` (in EUR-Einheit)               |
| `Wahrheitswert`           | `boolean`                                   |
| `Text`                    | `String`                                    |
| `Liste<T>`                | `List<T>` (immutable)                       |
| `Bereich<T>`              | `List<T>` (materialisiert oder Stream)      |
| `T?`                      | `@Nullable T` oder `Optional<T>` (konfigurierbar) |
| `aufzählung Name { … }`   | `enum class Name { … }`                     |
| `datensatz Name(…)`       | `data class Name(…)`                        |
| `fn …`              | `fun …` (Top-Level oder Object-Methode)    |
| `konst NAME`              | `const val NAME` oder `@JvmField val NAME`  |
| `Lambda { x -> … }`       | Kotlin-Lambda                               |
| `oder` (Elvis)            | `?:`                                        |
| `?.` (Sicher-Zugriff)     | `?.`                                        |
| `!!`                      | `!!`                                        |
| `als`                     | `as` mit Konvertierungs-Helfer              |

### 12.2 TypeScript

| FinDSL-Konzept            | TypeScript-Mapping                          |
| ------------------------- | ------------------------------------------- |
| `Ganzzahl`                | `bigint`                                    |
| `Dezimal`, `Prozent`      | `Decimal` aus `decimal.js`                  |
| `Euro`, `Cent`, `EuroCent`| `Decimal` mit Type-Brand                    |
| `Wahrheitswert`           | `boolean`                                   |
| `Text`                    | `string`                                    |
| `Liste<T>`                | `readonly T[]`                              |
| `T?`                      | `T \| null`                                 |
| `aufzählung Name { … }`   | `enum Name { … }` oder discriminated union  |
| `datensatz Name(…)`       | `interface Name` mit Konstruktor-Funktion   |
| `Lambda { x -> … }`       | `(x) => …`                                  |
| `oder` (Elvis)            | `??`                                        |
| `?.`                      | `?.`                                        |

### 12.3 JavaScript

Wie TypeScript, aber ohne statische Typprüfung. Geld-Wrapper als
Klasse mit `value`-Property; arithmetische Operationen über
explizite Methoden (`euro.plus(other)`).

---

## Anhang A: EBNF-Grammatik

Vollständige Grammatik der Sprache. Tokens in `GROSSBUCHSTABEN`
sind lexikalische Einheiten; Whitespace und Code-Kommentare zwischen
Tokens werden überall geignored. Die kanonische Grammatik liegt
zusätzlich als eigenständige Datei `grammar/findsl.ebnf` vor.

```ebnf
(* === Programm-Struktur === *)
(* Optionaler führender Doc-/Annotations-Block (`decl_prefix?`) ist
   die Datei-Dokumentation. *)
program            ::= decl_prefix? import_decl* top_decl*

(* === Imports === *)
(* Selektiver Import aus relativem Dateipfad-String (ohne `.findsl`,
   `./`/`../`-Präfix); pro Symbol optionaler `als`-Alias. *)
import_decl        ::= "verwende" "{" import_item ("," import_item)* ","? "}"
                       "aus" STR_LIT
import_item        ::= IDENT ("als" IDENT)?

(* === Deklarationen === *)
top_decl           ::= konst_decl | funktion_decl | datensatz_decl
                     | aufzählung_decl | prüfe_decl
decl_prefix        ::= doc_comment? annotation*
doc_comment        ::= "--" markdown_text "--"
annotation         ::= "@" IDENT "(" arg_list? ")"

konst_decl         ::= decl_prefix? "konst" IDENT ":" type "=" expr

funktion_decl      ::= decl_prefix? "fn" IDENT "(" param_list? ")" ":" type funktion_body
funktion_body      ::= "=" expr | block_expr
param_list         ::= param ("," param)* ","?
param              ::= IDENT ":" type ("=" expr)?

datensatz_decl     ::= decl_prefix? "datensatz" IDENT "(" field_list? ")"
field_list         ::= field ("," field)* ","?
field              ::= IDENT ":" type ("=" expr)?

aufzählung_decl    ::= decl_prefix? "aufzählung" IDENT "{" IDENT ("," IDENT)* ","? "}"

prüfe_decl         ::= decl_prefix? "prüfe" STR_LIT "{" prüfe_beispiel+ "}"
prüfe_beispiel     ::= "testfall" STR_LIT ("erwartet" "abbruch")? block_expr

(* === Bindungen und Blöcke === *)
let_stmt           ::= "var" IDENT ":" type "=" expr
ausgabe_stmt       ::= "ausgabe" "(" expr ")"
block_stmt         ::= let_stmt | ausgabe_stmt
block_expr         ::= "{" body "}"
body               ::= block_stmt* expr

(* === Typen === *)
type               ::= type_atom "?"?
type_atom          ::= IDENT type_args?
                     | "(" (type ("," type)*)? ")" "->" type                          (* Funktionstyp *)
type_args          ::= "<" type ("," type)* ">"

(* === Ausdrücke (von niedrigster zu höchster Präzedenz) === *)
expr               ::= or_expr
or_expr            ::= and_expr ("oder" and_expr)*
and_expr           ::= not_expr ("und" not_expr)*
not_expr           ::= "nicht" not_expr
                     | nullcheck_expr
nullcheck_expr     ::= cmp_expr ("ist" "nicht"? "nichts")?
cmp_expr           ::= range_expr (CMP_OP range_expr)?
range_expr         ::= add_expr ("bis" "unter"? add_expr ("schritt" add_expr)?)?
add_expr           ::= mul_expr (ADD_OP mul_expr)*
mul_expr           ::= cast_expr (MUL_OP cast_expr)*
cast_expr          ::= unary_expr ("als" type)?
unary_expr         ::= "-" atom | atom

atom               ::= literal
                     | wenn_expr
                     | wähle_expr
                     | für_expr
                     | lambda
                     | list_literal
                     | abbruch_expr
                     | paren_expr
                     | call_chain

abbruch_expr       ::= "abbruch" "(" expr ")"

list_literal       ::= "[" arg_list? "]" type_args?

(* Geklammerter Ausdruck, optional mit Postfix-Kette:
   `(a * b).abrunden()`, `(liste).länge`, `(wert)[0]`.
   Ohne folgende chain_op* = reine Klammer-Gruppierung. *)
paren_expr         ::= "(" expr ")" chain_op*

call_chain         ::= IDENT chain_op*
chain_op           ::= "(" arg_list? ")"                                              (* Funktions-/Methodenaufruf *)
                     | "." IDENT                                                       (* Feldzugriff *)
                     | "?." IDENT                                                      (* Sicher-Zugriff *)
                     | "!!"                                                            (* Force-Unwrap, postfix *)
                     | "[" expr "]"                                                    (* Index *)

arg_list           ::= arg ("," arg)* ","?
arg                ::= (IDENT "=")? expr

wenn_expr          ::= "wenn" "(" expr ")" expr "sonst" expr

wähle_expr         ::= "wähle" ("(" expr ")")? "{" wähle_arm+ "}"
wähle_arm          ::= "falls" pattern ("," pattern)* "->" expr
                     | "sonst" "->" expr
pattern            ::= literal | IDENT | "nichts" | expr
                     (* Hinweis: ohne Subjekt sind Patterns Bedingungs-Ausdrücke;
                        mit Subjekt sind es Werte zum Vergleich. Der Type-Checker
                        disambiguiert kontextbasiert. *)

für_expr           ::= "für" ("jeden" | "jede") IDENT "aus" expr block_expr

lambda             ::= "{" (lambda_params "->")? body "}"
lambda_params      ::= lambda_param ("," lambda_param)* ","?
lambda_param       ::= IDENT (":" type)?

(* === Literale === *)
literal            ::= INT_LIT | DEC_LIT | PCT_LIT | STR_LIT
                     | "wahr" | "falsch" | "nichts"

(* === Lexikalische Tokens === *)
(* Deutsche Notation: "." Tausender-Trenner (Gruppen zu 3, optional),*)
(* "," Dezimaltrenner. Per-Typ-Schreibweise im Type-Checker.        *)
GROUPED_INT        ::= /[0-9]+(\.[0-9]{3})*/
INT_LIT            ::= GROUPED_INT
DEC_LIT            ::= GROUPED_INT "," /[0-9]+/
PCT_LIT            ::= INT_LIT "%" | DEC_LIT "%"

STR_LIT            ::= SINGLE_STRING | MULTI_STRING
SINGLE_STRING      ::= '"' (escape_seq | interp | NOT_QUOTE_NL_DOLLAR_BACKSLASH)* '"'
MULTI_STRING       ::= '"""' (escape_seq | interp | NOT_TRIPLE_QUOTE_DOLLAR_BACKSLASH)* '"""'
escape_seq         ::= "\\" ('"' | "\\" | "n" | "t" | "$")
interp             ::= "${" expr "}"

CMP_OP             ::= "==" | "!=" | "<=" | ">=" | "<" | ">"
ADD_OP             ::= "+" | "-"
MUL_OP             ::= "*" | "/"

IDENT              ::= /[A-Za-zÄÖÜäöüß_][A-Za-z0-9ÄÖÜäöüß_]*/

(* Whitespace und ignorable Kommentare zwischen Tokens *)
WS                 ::= /[ \t\r\n]+/
LINE_COMMENT       ::= "//" /[^\n]*/
BLOCK_COMMENT      ::= "/*" /([^*]|\*[^\/])*/ "*/"
```

**Anmerkungen zur Grammatik:**

- `markdown_text` ist informal: alles zwischen den `--`-Markern bis zur
  nächsten Zeile, die nur `--` enthält. Wird nicht weiter strukturell
  geparst — der Doc-Generator interpretiert den Inhalt als Markdown.
- `wähle_arm` mit `pattern`: das Disambiguieren zwischen "Pattern" (bei
  wähle mit Subjekt) und "Bedingung" (ohne Subjekt) erfolgt im
  Type-Checker, nicht im Parser.
- `lambda` ohne Parameterliste (`{ -> body }`) ist eine null-stellige
  Funktion; ohne `->` ist `{ body }` ein Block-Ausdruck — der Parser
  unterscheidet beides anhand des Vorhandenseins von `->`.
- Code-Kommentare (`//`, `/* */`) sind Whitespace-äquivalent. Doc-
  Kommentare (`-- ... --`) sind syntaktisch signifikant und werden
  Deklarationen zugeordnet.

---

## Anhang B: Schlüsselwörter

Reserviert und nicht als Identifier verwendbar:

```
abbruch     als           aufzählung   aus
ausgabe     bis           datensatz    erwartet
falls       falsch        fn           für
ist         jeden/jede    konst        nicht
nichts      oder          prüfe        schritt
sonst       testfall      und          unter
var         verwende      wähle        wahr
wenn
```

Markdown-Marker und Operatoren (nicht Identifier-fähig):

```
--          // /* */
( ) [ ] { } , : . ; ?. !! ?
+ - * /     == != < <= > >=
@           ->          %
"           '           =
```

---

## Anhang C: Operator-Präzedenz

Höchste zu niedrigste Bindungsstärke:

| Stufe | Operatoren                                        | Assoziativität |
| ----- | ------------------------------------------------- | -------------- |
| 1     | `()` `[]` `.` `?.` (Gruppierung, Index, Zugriff) | links          |
| 2     | `!!` (Force-Unwrap, postfix)                      | links          |
| 3     | `als` (Cast)                                      | links          |
| 4     | unary `-`, `nicht`                                | rechts         |
| 5     | `*` `/`                                           | links          |
| 6     | `+` `-` (binär)                                   | links          |
| 7     | `bis` `bis unter` `schritt` (Bereich)             | nicht-assoziativ |
| 8     | `<` `<=` `>` `>=`                                 | nicht-assoziativ |
| 9     | `==` `!=` `ist nichts` `ist nicht nichts`         | nicht-assoziativ |
| 10    | `und`                                              | links          |
| 11    | `oder` (logisch und Elvis)                        | links          |

Beim `oder`-Operator bestimmt der Typ des linken Operanden die
Bedeutung (logisch vs. Elvis).

---

## Anhang D: Glossar

**Annotation** — Typisiertes Metadatum an einer Deklaration, eingeleitet
mit `@`. Beispiel: `@Quelle("§ 32a EStG")`.

**Bereich** — Halbgeordnete Sequenz über numerischen Typen oder
Aufzählungen, deklariert mit `bis`/`bis unter`/`schritt`.

**Closure** — Lambda-Ausdruck, der Variablen aus dem umgebenden Scope
erfasst.

**Datensatz** — Benanntes Tupel mit getypten Feldern, deklariert mit
`datensatz`. Entspricht Kotlins `data class`.

**Doc-Kommentar** — Markdown-Block zwischen `--`-Markern, der eine
Deklaration dokumentiert.

**Doc-Test** — Code-Beispiel im Doc-Kommentar (` ```findsl `-Fence),
das vom Compiler ausgeführt wird.

**Elvis-Operator** — Der Operator `oder` angewendet auf einen
nullable Wert: liefert den Wert oder einen Fallback bei `nichts`.

**FinDSL** — Domänenspezifische Sprache für deutsche steuerliche
Finanzverwaltung.

**Geldtyp** — Einer der drei Typen `Euro`, `Cent`, `EuroCent`.

**Lambda** — Anonyme Funktion. Syntax: `{ params -> body }`.

**Datei (Übersetzungseinheit)** — Eine `.findsl`-Datei. Wird über ihren
relativen Dateipfad referenziert.

**Nullable Typ** — Ein Typ `T?`, dessen Werte entweder ein `T` oder
`nichts` sind.

**Pattern-Matching** — Vergleich eines Subjekts mit Mustern in einem
`wähle (subjekt) { … }`-Block.

**PAP** — Programm-Ablauf-Plan; DIN-66001-Diagramm-Standard, der von
der deutschen Steuerverwaltung zur Spezifikation von Lohnsteuer-
Berechnungen verwendet wird.

**Prozent** — First-class Typ für Prozentsätze (`9.3%`). Unterscheidet
sich semantisch von `Dezimal`.

**`@Quelle`** — Pflicht-Annotation für gesetzliche Norm-Verweise.

**Smart-Cast** — Automatische Verfeinerung eines nullable Typs zu
non-nullable nach einem Vergleich mit `nichts`.

**Standard-Definitionen** — Die implizit (ohne `verwende`) verfügbaren
eingebauten Typen, Funktionen und Aufzählungen.

**Veranlagungszeitraum** — Steuerrechtlicher Begriff für das
Kalenderjahr, dem Einkünfte zugerechnet werden. In FinDSL Bestandteil
des Datei-/Pfadnamens.

**`verwende`** — Schlüsselwort für selektive Datei-Importe per
relativem Pfad.

**`wähle`** — Mehrweg-Verzweigung; entspricht Kotlins `when`.

---

*Ende der FinDSL-Sprachspezifikation v1.0*
