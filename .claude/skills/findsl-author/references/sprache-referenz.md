# FinDSL — Sprachreferenz & Fallstricke (für die Code-Generierung)

Verdichtete, generierungsrelevante Referenz. Die **autoritative** und
vollständige Quelle ist `SPEC.md` (Repo-Wurzel); bei jedem Detailzweifel
dort nachschlagen. Diese Datei führt das, was beim Schreiben am häufigsten
schiefgeht.

## Inhalt
1. Typsystem (Kurzüberblick)
2. Geld-Arithmetik (die Regeln, an denen es scheitert)
3. Literale & deutsche Zahl-Notation
4. Rundung (§ 11.1 / § 11.6)
5. Ausdrücke & Konstrukte
6. Deklarationen, Doc-Blöcke, `@Quelle`
7. Fallstrick-Tabelle (ALLE beachten)
8. Generische Helfer (übernehmen, nicht neu erfinden)

---

## 1. Typsystem

| Typ | Bedeutung | Literal-Beispiel |
| --- | --- | --- |
| `Euro` | Geld, **ganzzahlig** (volle Euro) | `5.000`, `277.825` |
| `Cent` | Geld, **ganzzahlig** (Cent) | `250` |
| `EuroCent` | Geld, **2 Nachkommastellen** | `24.500,00`, `0,00` |
| `Ganzzahl` | ganze Zahl | `200`, `2.000` |
| `Dezimal` | Dezimalzahl | `3,5`, `1,96` |
| `Prozent` | Prozent (intern Bruch: 15 % = 0,15) | `15%`, `0,4%` |
| `Wahrheitswert` | wahr/falsch | `wahr`, `falsch` |
| `Text` | Zeichenkette, Interpolation `${…}` | `"…"` |
| `T?` | Nullable; Fehl-/Leerwert `nichts` | — |
| `Liste<T>` | Liste | `[1, 2, 3]` |
| `Bereich<T>` | numerischer Bereich | `1 bis 10`, `0 bis 100 schritt 5` |
| Aufzählung | benannte Werte | `aufzählung Tarifart { Grundtarif, Splitting }` |
| Datensatz | Produkttyp mit Feldern | `datensatz Fall(a: Euro, …)` |

- **Einheit/Präzision sind Teil des Typs** (SPEC P3). `var x: Cent = 20`
  bedeutet 20 ct. Die Typannotation ist die **Einheits-Quelle**.
- `Euro`/`Cent` **erzwingen Ganzzahligkeit auch bei berechneten Werten** →
  ein fraktionales Ergebnis ohne explizite Rundung ist ein **Laufzeitfehler**.
  `EuroCent` ist ungeprüft (2 NK).

## 2. Geld-Arithmetik (Kernregeln)

| Operation | Ergebnis-Typ |
| --- | --- |
| `Geld ± Geld` | präzisere Seite |
| `Geld * Ganzzahl` | Geld |
| `Geld * Dezimal` / `Geld * Prozent` | **EuroCent** |
| `Geld / …` | **Dezimal** |
| `Geld * Geld` | **verboten** |
| `Prozent * Prozent` | Dezimal — **vermeiden!** Statt `3,5% * 56%` eine vorab berechnete `konst …: Prozent = 1,96%` mit Doc anlegen. |

- **`==`/Vergleich ist tag-agnostisch:** verglichen wird nur der
  Euro-kanonische Wert, nicht der Tag. Darum sind ein Default-`0,00`
  (intern Dezimal) und ein EuroCent-Ergebnis wertgleich vergleichbar.
- **Zwischenwerte können mehr als 2 NK tragen:** `Geld * Prozent` rechnet
  exakt — `21 € * 4,5 % = 0,945`. Ein solcher krummer Zwischenwert lässt
  sich **nicht** als 2-NK-EuroCent-Literal asserten (`== 0,945` wäre ein
  3-NK-Literal = Fehler; `== 0,94`/`== 0,95` wären schlicht falsch). In
  Tests deshalb **bevorzugt die gerundete Endgröße prüfen**, nicht den
  krummen `Geld*Prozent`-Zwischenwert.

## 3. Literale & deutsche Zahl-Notation

- `.` = **Tausendertrenner** (Gruppen zu 3), `,` = **Dezimaltrenner**.
- **EuroCent: genau zwei Nachkommastellen Pflicht** — `0,00`,
  `200.000,00`, `6.037,50`. Ein bares `0`, `== 0`, `oder 0` im
  EuroCent-Kontext ist ein **Fehler**.
- **Euro/Cent: ganzzahlig, kein Komma** — `100`, `1.000`, `277.825`.
- **Prozent:** `42%`, `3,5%`, `0,4%`.
- **Trenn-Komma in Argument-/Listen-Folgen stets mit Folge-Leerzeichen:**
  `f(a, b)`, `[1, 2, 3]`.

## 4. Rundung (SPEC § 11.1 / § 11.6)

Rundung ist **immer explizit** und eine **Methode** auf dem Empfänger:

- `.abrunden()` / `.aufrunden()` auf `EuroCent` (Ziel `Euro`/`Cent` aus dem
  **Kontext**), auf `Dezimal` (→ `Ganzzahl`) oder `Prozent` (→ volle
  `Prozent`, kontextfrei). Anderer Empfänger = Fehler.
- **Zuverlässiger Kontext = typgebundene `var` / Annotation am Rundungsort:**
  ```
  var steuer: Euro = (bemessung * satz).abrunden()   // ✓ rundet auf volle Euro
  ```
  **Verlasse dich NICHT** darauf, dass der fn-Rückgabetyp die Rundung *durch
  einen `wähle`/`wenn`-Arm hindurch* erzwingt — empirisch tut er das nicht
  zuverlässig (das Ergebnis bleibt dann ungerundet, z. B. `1.000,02` statt
  `1.000`). Auch ein nachgestellter `als Euro`-Cast genügt nicht. Lasse den
  `wähle`-Arm `EuroCent` liefern und runde danach an einer `var: Euro`.
- Beliebiger Ausdruck als Empfänger via **Klammer**: `(satz * basis).abrunden()`.
- **„Auf volle 100 € abrunden":** `((betrag / 100).abrunden() * 100) als EuroCent`.
- **„Je angefangene Einheit":** `((wert / teiler) als Dezimal).aufrunden()`.
- **§ 11.6 Grenzwert/Stufen (typ-erhaltend, kontextfrei):** `.höchstens(grenze)`
  (Cap nach oben = Minimum), `.mindestens(grenze)` (Floor = Maximum),
  `.abrundenAuf(vielfaches)` / `.aufrundenAuf(vielfaches)`.

## 5. Ausdrücke & Konstrukte

- **`wähle`** (Pattern-Match):
  ```
  wähle (rechtsform) {
      falls Kapitalgesellschaft -> SATZ_KAP
      falls Personengesellschaft -> SATZ_PERS
      sonst -> abbruch("§ …: unbekannte Rechtsform")
  }
  ```
  Bei `wähle (enum)` alle Enum-Werte mit `falls` abdecken; `sonst` dann
  optional (der Type-Checker prüft Vollständigkeit).
- **`wenn … sonst …`** — Ausdruck (kein Statement): `wenn x > 0 sonst 0`.
- **Block-Body** `{ (var name: Typ = expr)* ergebnis }`: `var` ist
  single-assignment, **Typannotation Pflicht**, jede `var` muss benutzt
  werden (sonst Unused-Hint). Das letzte Element ist das Ergebnis (Ausdruck).
- **`abbruch("…")`** — begründeter, nicht abfangbarer Abbruch, Typ `never`,
  in jeden Zweig/Body einsetzbar. Form:
  `falls <bedingung> -> abbruch("§ …: <Begründung mit ${wert}>")`.
  **Nicht** in eine sonst ungenutzte `var` legen — in die erste *genutzte*
  Größe einfädeln.
- **Listen / `für jeden` / Lambdas** sind ausführbar: `Liste<T>`,
  `a bis b [schritt s]`, `für jeden x aus … { }`, Index `[i]` und die
  Listen-Methoden (`.länge`/`.summe`/`.zuordnen`/`.filtern`/`.zusammenfassen`/
  `.größtes`/`.kleinstes`/…). **Mehr-Entitäten-Fälle** (n Kinder/Objekte)
  SIND zu modellieren, wenn die Regel sie vorschreibt — z. B.
  `kinder.zuordnen({ k -> … }).summe()`. Leere `.summe()` → 0; `.kopf`/
  `.größtes`/Index out-of-bounds → Laufzeitfehler (Bug-Klasse, kein
  `abbruch`). **Noch nicht ausführbar:** Aufzählungs-Bereiche (`I bis VI`)
  — statt dessen `für jeden` über ein Listen-Literal der Werte.
- **`als`** — Cast/Einheitenwechsel: `(…) als EuroCent`, `betrag als Cent`.
- **Nullable-Werkzeuge:** `?.` (Sicher-Zugriff), `oder` (Elvis),
  `ist [nicht] nichts`, `!!` (Force-Unwrap; bricht ab, wenn `nichts`).

## 6. Deklarationen, Doc-Blöcke, `@Quelle`

- **Führender Datei-Doc-Block ist Pflicht** (`--…--` am Dateianfang). Fehlt
  er, „stiehlt" er den Doc/`@Quelle` der ersten Deklaration.
- **Jede** Deklaration trägt unmittelbar davor ihren eigenen `--…--`-Block;
  Annotationen (`@Quelle`) stehen **zwischen** Doc-Block und Deklaration.
- Datensatz-Felder zusätzlich mit Trailing-`//`-Kommentar dokumentieren
  (der Doc-Generator extrahiert ihn). Funktions-/Datensatz-Doc mit
  `@param`/`@rückgabe`.
- **`@Quelle`-Zitierform** (sonst tote Doku-Links): `§ <Nr>` +
  ausgeschriebene Gliederung + **Gesetzes-Abkürzung am Ende**:
  `@Quelle("§ 9 Absatz 1 Nummer 4 Buchstabe a KraftStG")`. Pflicht für jede
  norm-gebundene `konst`/`fn`; reine Helfer dürfen es weglassen.
- **Sichtbarkeit:** führendes `_` macht eine Top-Level-Decl modul-intern
  (nicht cross-file importierbar, nicht in der Doku) — gut für Helfer.

## 7. Fallstrick-Tabelle (ALLE beachten — empirisch erkämpft)

| Thema | Regel |
| --- | --- |
| **`konst`-Name** | MUSS `^[A-Z][A-Z0-9_]*$` (ASCII UPPER_SNAKE). Verstoß = Fehler. |
| **fn/Datensatz/Aufzählung/Enumwert-Name** | MUSS mit **Großbuchstaben** beginnen (UpperCamelCase, führendes `_` erlaubt), SPEC § 2.5. `fn freibetrag` = **Fehler** → `fn Freibetrag`. **Nur** `var`/Parameter/Felder sind lowerCamelCase (nicht erzwungen). Eingebaute Methoden (`.abrunden`, `.zuordnen`) sind eigener lowerCamelCase-Namensraum. |
| **EuroCent-Literale** | Genau 2 NK Pflicht (`0,00`). Bares `0`/`== 0`/`oder 0` im EuroCent-Kontext = Fehler. |
| **Euro/Cent-Literale** | Ganzzahlig, kein `,`: `100`, `277.825`. |
| **Geld-Arithmetik** | Siehe § 2. `Geld*Geld` verboten; `Prozent*Prozent` meiden (vorab-`konst`). |
| **Typannotation = Einheit** | `Euro`/`Cent` erzwingen Ganzzahligkeit → fraktional ⇒ Laufzeitfehler, explizit runden. |
| **Rundung** | Methode, Empfänger typgebunden, Ziel aus Kontext. Siehe § 4. |
| **Statement-Grenze `)(`** | Block-Zeile endet `)`, nächste beginnt `(` → Parser liest Aufrufkette `f(...)(...)` → Fehler. Fix: an `var` binden, blanken Identifier zurückgeben. Block-Ende idealerweise blanker Identifier oder `Name(...)`-Konstruktor. |
| **`abbruch`** | Typ `never`, in jeden Zweig/Body. Nicht in ungenutzte `var` — in die erste genutzte Größe einfädeln. |
| **`wähle (enum)`** | Alle Enum-Werte mit `falls`; `sonst` optional (Vollständigkeit wird geprüft). |
| **Block-`var`** | Single-assignment, Typannotation Pflicht, jede `var` muss benutzt werden. |
| **Datensatz-Defaults** | Skalare/Enum-Defaults nutzen (`= 0,00`, `= falsch`, `= Keiner`). Verschachtelte Record-Defaults meiden — Pflichtfeld lassen, im Test konstruieren. |
| **Ungenutzte Importe/`var`** | erzeugen `hint`s → vor „erfolgreich, keine Diagnosen" beseitigen. |
| **Identität = Dateipfad** | `.test.findsl` importiert `aus "./<slug>"` (relativ, ohne `.findsl`). Keine Wildcards, keine Re-Exports — jedes Symbol aus der **definierenden** Datei importieren. |

## 8. Generische Helfer (übernehmen, nicht neu erfinden)

Aus den Referenzmodulen; führendes `_` (modul-intern), kein `@Quelle` nötig:

```
-- Floor bei 0: gibt nie einen negativen Betrag zurück. --
fn _NichtNegativ(betrag: EuroCent): EuroCent = betrag.mindestens(0,00)

-- Cap: begrenzt `betrag` nach oben auf `grenze`. --
fn _Hoechstens(betrag: EuroCent, grenze: EuroCent): EuroCent = betrag.höchstens(grenze)

-- „Je angefangene Einheit von `teiler`" (z. B. je 200 kg): aufgerundete Einheitenzahl. --
fn _Einheiten(wert: Ganzzahl, teiler: Ganzzahl): Ganzzahl =
    ((wert / teiler) als Dezimal).aufrunden()
```

(Funktionsnamen mit Großbuchstaben — auch nach führendem `_`: `_NichtNegativ`,
nicht `_nichtNegativ`.)

Bei „größeres von zwei Werten" / „Spanne" o. ä.: das passende Muster aus
`examples/est/` bzw. `examples/kraftst/` übernehmen.
