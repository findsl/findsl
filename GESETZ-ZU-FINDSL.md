# Anleitung: Gesetz (XML/PDF) → FinDSL-Modul + Tests

> **Zielgruppe:** Claude Code und andere KI-Agenten. Diese Datei ist eine
> **eigenständige, vollständige Arbeitsanweisung**. Sie setzt nur voraus,
> dass `CLAUDE.md` und `SPEC.md` gelesen wurden. Sie kodifiziert die
> erprobte Methodik der Module **KStG** (`examples/kst/`), **KraftStG**
> (`examples/kraftst/`) und **GewStG** (`examples/gewst/`).
>
> **Goldene Regel:** *Absolut richtige Berechnung im modellierten Umfang* —
> die vom Gesetz selbst vorgeschriebene Arithmetik wird vollständig und
> exakt implementiert; alles, was außerhalb der reinen Steuerbetrags-
> berechnung liegt, geht als **geprüfte Eingabe** ein und wird im
> Datei-Doc-Block **explizit als nicht modelliert dokumentiert**. Niemals
> raten, niemals stillschweigend vereinfachen.

---

## 0. Eingaben, Ausgaben, Ablage

**Eingabe (Gesetzesquelle).** Liegt unter `gesetze/<ABK>/<ABK>.xml` und
`<ABK>.pdf` und/oder im Beispielordner als `examples/<slug>/<abk>.xml`.
`ABK` = juris-Abkürzung (für §-Zitate / den `gesetze/`-Baum), z. B.
`KStG`, `KraftStG_2002`, `GewStG`. `<slug>` = kurzer Kleinbuchstaben-
Ordnername im Beispielbaum (`kst`, `kraftst`, `gewst`); die Beispiel-XML
`<abk>.xml` ist kleingeschrieben (`kstg.xml`, `kraftstg_2002.xml`,
`gewstg.xml`).

- **XML ist die maßgebliche Quelle für die maschinelle Verarbeitung.**
  Es ist strukturiert (`<norm>`/`<enbez>`/`<textdaten>`), eindeutig
  paragraphenweise zerlegbar und enthält den amtlichen Wortlaut inkl.
  Satznummerierung. **Immer XML primär verwenden.**
- **PDF nur als Quervergleich/Fallback** (z. B. wenn eine Tabelle/Anlage
  im XML schwer lesbar ist, oder zur Verifikation einzelner Zahlwerte).
  PDF mit dem `pdf-viewer`/`Read`-Tool seitenweise lesen.

**Ausgabe.** **Mindestens zwei** Dateien, **separat nebeneinander** —
eine öffentliche Einstiegsdatei (der Orchestrator) plus die Testdatei:

```
examples/<slug>/<slug>.findsl        ← öffentliche Einstiegsdatei (Orchestrator)
examples/<slug>/<slug>.test.findsl   ← nur prüfe-Blöcke (Akzeptanztests)
```

Orchestrator und Testdatei werden nach dem `<slug>` (= dem
Kleinbuchstaben-Ordnernamen, § 0 oben) benannt: `<slug>.findsl` und
`<slug>.test.findsl` (z. B. `kst.findsl`/`kst.test.findsl`,
`gewst.findsl`/`gewst.test.findsl`). Die `.test.findsl` importiert die
Einstiegsdatei selektiv per Relativpfad `verwende { … } aus "./<slug>"`
(SPEC § 8.3, CLAUDE § 4.9/4.10).

> **Wichtig — Mehrdateiligkeit ist ausdrücklich erwünscht.** Zwei
> Dateien sind nur das *Minimum*. Sobald die Umsetzung größer wird, ist
> die Aufteilung über **mehrere kohäsive Quelldateien die bessere Wahl**
> (Wartbarkeit, Transparenz, Audit). Kriterien und Vorgehen: **§ 2.1**.
> Vorbild: `examples/kraftst/` (5 Dateien: Orchestrator `kraftst.findsl`
> + Testdatei `kraftst.test.findsl` nach dem Slug, die
> Dekompositions-/Helferdateien mit Gesetz-Präfix `kraftstg-`).

**Niemals ändern:** Grammatik-Duo (`SPEC.md`, `findsl.langium`),
Interpreter, Validator. Dieses Vorhaben ist
**reine Beispielarbeit** — wenn die Sprache etwas nicht kann, wird der
Umfang dokumentiert eingeschränkt, **nicht** die Sprache erweitert.
(Ausnahme: explizite, separat beauftragte Stdlib-/Sprach-Diskussion.)

---

## 1. Phase 0 — Das Gesetz vollständig lernen

### 1.1 Paragraphen-Übersicht

```bash
cd examples/<slug>
grep -o '<enbez>[^<]*</enbez>' <abk>.xml
```

### 1.2 Klartext einzelner Paragraphen extrahieren

Das juris/gesetze-im-internet-XML kapselt jeden Paragraphen in einem
`<norm>` mit `<enbez>§ N</enbez>`, `<titel>` und `<textdaten>…</textdaten>`.
Dieses Python-Snippet liefert sauberen Klartext (Tags entfernt,
Entities aufgelöst, Satznummern bleiben erhalten):

```bash
python3 -c "
import re, html
xml = open('<abk>.xml', encoding='utf-8').read()
norms = re.findall(r'<norm[^>]*>.*?</norm>', xml, re.S)
def strip(t):
    t = re.sub(r'<[^>]+>', ' ', t); t = html.unescape(t)
    t = re.sub(r'[ \t]+', ' ', t); t = re.sub(r'\n\s*\n+', '\n', t)
    return t.strip()
want = {'§ 7','§ 8','§ 9','§ 10','§ 10a','§ 11','§ 16','§ 36'}   # anpassen!
for n in norms:
    eb = re.search(r'<enbez>(.*?)</enbez>', n, re.S)
    if not eb: continue
    name = html.unescape(eb.group(1)).strip()
    if name not in want: continue
    tx = re.search(r'<textdaten>(.*?)</textdaten>', n, re.S)
    ti = re.search(r'<titel[^>]*>(.*?)</titel>', n, re.S)
    print('==== '+name+' '+(strip(ti.group(1)) if ti else '')+' ====')
    print(strip(tx.group(1)) if tx else '(kein Text)'); print()
"
```

Bei großer Ausgabe in Chargen extrahieren (wenige `§§` pro Lauf), nicht
das ganze Gesetz auf einmal.

### 1.3 Berechnungskern vs. Verfahren/Außenrecht trennen

Lies die §§ und ordne jeden Inhalt einer Kategorie zu:

| Kategorie | Behandlung in FinDSL |
| --- | --- |
| **Rechenvorschrift** (Sätze, Freibeträge, Prozentsätze, Staffeln, Rundung, Reihenfolge) | **Vollständig & exakt implementieren** (konst + fn) |
| **Bemessungsbasis aus anderem Gesetz** (z. B. „Gewinn nach EStG/KStG", „Einkommen i.S.d. § 8 Abs. 1 KStG") | **Geprüfte Eingabe** (Datensatz-Feld), im Datei-Doc als nicht modelliert dokumentieren |
| **Behördliche Einstufung / Sachverhaltsfeststellung** (z. B. Schadstoffklasse durch Zulassungsbehörde, Höhe einzelner Hinzurechnungen) | **Geprüfte Eingabe** (Enum/Feld), Begründung im Doc |
| **Verfahren** (Festsetzung, Vorauszahlung, Zerlegung auf mehrere Einheiten, Erklärungspflichten, Fristen) | **Nicht modelliert**, im Datei-Doc explizit benennen |
| **Befreiungs-/Ausnahmekataloge** (lange Aufzählungen begünstigter Einrichtungen) | i. d. R. Enum-Flag „Befreiung ja/nein" als Eingabe; Katalog nicht ausmodellieren |
| **Zeitlicher Anwendungsbereich** (§ 36 o. ä.) | Fassung wählen, Stichjahr als `konst`, frühere Zeiträume per `abbruch` ausschließen |

Faustregel aus den Referenzmodulen: Bildet der Berechnungskern
(z. B. KStG §§ 7/23/24, KraftStG § 9, GewStG §§ 7–11/16) ab; die
EStG/KStG-Gewinnermittlung und behördliche Einstufungen sind **immer**
Eingaben.

---

## 2. Phase 1 — Architektur entwerfen

Spiegele die **gesetzliche Reihenfolge** 1:1 in einer Funktionskette.
Jede Funktion = eine normative Stufe, einzeln testbar, mit `@Quelle`.

**Bausteine (verbindliches Schema):**

1. **`konst` pro Gesetzeswert** — jeder Satz/Freibetrag/jede Schwelle
   eine eigene Konstante mit eigenem `--…--`-Doc-Block und `@Quelle`.
   - Name: **ASCII `^[A-Z][A-Z0-9_]*$`** (harte Regel, SPEC § 2.5).
     Sprechend + §-Bezug, z. B. `FREIBETRAG_NAT_PERSON_11`,
     `KST_SATZ_BIS_2027`, `NR4A_KUM_2000`.
   - Kumulierte Staffelwerte aus den Stufensätzen **ableiten**
     (`konst NR3_KUM_3000: EuroCent = NR3_KUM_2000 + NR3_2000_3000 * 5`),
     nicht handsummieren — Audit-Nachvollziehbarkeit.
2. **`aufzählung` pro Klassifizierung** — Rechtsform, Schadstoffklasse,
   Ausschlusstatbestand, Tarifart. Jeder Wert im Doc per `@param`
   erklärt + `@Quelle`.
3. **`datensatz` Eingaben** — ein `<Steuer>Fall`/`<Objekt>`-Datensatz
   mit allen Eingaben (Bemessungsbasis, Klassifizierungen, geprüfte
   Einzelbeträge). Skalare Eingaben mit sinnvollem `= default`.
4. **`datensatz` Ergebnis** — `<Steuer>Ergebnis` mit **jeder
   Zwischengröße** der gesetzlichen Reihenfolge als eigenem Feld
   (Schritt-für-Schritt-Audit gegen das Gesetz).
5. **Stufen-Funktionen** — eine `fn` je Norm-Stufe, Eingabe/Ausgabe
   typisiert, `@Quelle` auf die exakte Fundstelle.
6. **Allgemeine Helfer** — `nichtNegativ` (max 0), `hoechstens` (min /
   Höchstbetrag), `begrenze` (Cap), `groesseres` (max), `einheiten`
   („je angefangene Einheit" = `((wert / teiler) als Dezimal).aufrunden()`). Aus den
   Referenzmodulen übernehmen, nicht neu erfinden.
7. **Orchestrator** `berechne<Steuer>(fall): <Steuer>Ergebnis` —
   ruft die Stufen in gesetzlicher Reihenfolge, füllt das
   Ergebnis-Datensatz, behandelt Rand-/Nullfälle und schließt
   nicht abgedeckte Konstellationen per `abbruch` aus.

### 2.1 Mehrere Dateien — wann und wie ein Gesetz aufteilen

**Grundsatz: Eine Datei pro Gesetz ist nicht das Ziel.** Steuergesetze
sind groß; eine 1.000+-Zeilen-Datei ist schwer zu prüfen, zu
reviewen und zu pflegen. Die Aufteilung über **mehrere kohäsive
Dateien** ist für diese Domäne **die empfohlene Architektur** — nicht
eine Notlösung. Sie zahlt direkt auf die Projektziele ein:

- **Wartbarkeit** — eine Norm-Änderung (z. B. neuer § 9-Satz) betrifft
  genau eine kleine Datei statt eines Monolithen.
- **Transparenz / Audit (P1, P4, P7)** — eine Sachbearbeiterin findet
  „§ 9 Abs. 1 Nr. 4" in `…-tarif-nutzfahrzeug.findsl` statt in Zeile 980
  von 1.191. Datei = abgegrenzter Rechtsbereich.
- **Review-Diffs** bleiben lokal; **Tests** referenzieren gezielt die
  geänderte Teildatei.

**Wann aufteilen?** Sobald **eines** zutrifft:

- Die Datei überschreitet grob **~500–700 Zeilen** oder wächst absehbar
  dorthin.
- Sie deckt **mehrere klar trennbare Rechtsbereiche** ab (z. B. KraftStG
  § 9 Abs. 1 Nr. 1–5: Krafträder / PKW / Wohnmobile / Nutzfahrzeuge /
  Anhänger — eigenständige Tarife).
- Es gibt ein **wiederverwendbares „Vokabular"** (Aufzählungen,
  Eingabe-/Ergebnis-Datensätze, generische Helfer), das mehrere
  Tarif-Bereiche teilen.
- Kleine Gesetze (KStG §§ 7/23/24 — 1 Datei) **nicht** künstlich
  zersplittern: Aufteilung muss Kohäsion erhöhen, nicht Zeremonie.

**Schnittkriterien (in dieser Reihenfolge):**

1. **Nach Rechtsbereich, nicht nach Datei-Typ.** Schneide entlang der
   Gesetzes­struktur (§§, Absätze, Nummern), **nicht** in „alle
   Konstanten" / „alle Funktionen". Grund: FinDSL kennt nur selektive
   Importe (**keine Wildcards, keine Re-Exports**, SPEC § 8.6) — eine
   reine Konstanten-Datei erzwingt 100-Namen-`verwende`-Listen. Das ist
   das entscheidende Sprach-Constraint, das den Schnitt bestimmt.
2. **Konstanten zur Logik legen.** Die Sätze/Freibeträge eines
   Bereichs gehören in **dieselbe** Datei wie die Funktionen, die sie
   verbrauchen (Kohäsion, minimale modulübergreifende Importe, lokal
   auditierbar).
3. **Geteiltes Vokabular in eine Blatt-Datei** (`…-typen`):
   Aufzählungen, Eingabe-/Ergebnis-Datensatz, generische Helfer
   (`einheiten`, `begrenze`, `nichtNegativ`, …). Importiert **nichts** →
   Wurzel des Modul-Graphen.
4. **Öffentliche Einstiegsdatei = Orchestrator** mit
   `berechne<Steuer>` und der gesetzlichen Gesamtreihenfolge; sie
   importiert die Bereichs-Dateien. Hierhin auch Querschnitt-/
   Rest-Konstanten ohne eigene Bereichsdatei.
5. **Azyklischer, geschichteter Graph:**
   `…-typen ← …-tarif-<bereich>* ← <slug>` (Einstieg). Zyklen sind
   verboten (SPEC § 8.6) und ein Zeichen falscher Schnittführung.
6. **Schnitt validieren am Importvolumen:** Sind die `verwende`-Listen
   klein (Typen/Helfer + Einstiegsfunktionen)? Dann ist der Schnitt
   richtig. Muss eine Datei Dutzende Konstanten importieren → Schnitt
   neu legen (Konstanten gehören zum Verbraucher, Kriterium 2).

**Mechanik (verlustfrei, rein strukturell):**

- Code **verbatim** verschieben — Doc-Blöcke, `@Quelle`,
  §-4.15-Trailing-`//`-Ausrichtung, Leerzeilen, §-Banner **unverändert**.
  Es ändert sich **kein** Verhalten; `pruefe`/Test-Suite müssen davor
  und danach **identisch** grün sein.
- Jede neue Datei: **eigener führender Datei-Doc-Block** (CLAUDE § 4.9,
  was sie enthält + Stellung im Modul-Graph) und die nötigen
  `verwende { … } aus "./<datei>"`-Blöcke (Pfad = Dateiname **ohne**
  `.findsl`, relativ).
- **Nur tatsächlich genutzte Symbole importieren** (sonst Unused-Hint):
  Enum-**Werte** importieren, die in `falls`/`==` vorkommen; Enum-
  **Typnamen** nur, wenn als Typ (`: T`) referenziert — nicht, wenn sie
  bloß im Kommentar stehen.
- **Testdatei:** `verwende` **nach Quelldatei gruppieren**; jedes
  Symbol aus der Datei importieren, die es **definiert** (keine
  Re-Exports — ein Fassaden-Re-Export ist unmöglich).
- **Einheitliches Datei-Präfix** (Gesetz-Kürzel, z. B. `kraftstg-`):
  generierte Dateien gut auffindbar; nur die Law-Quelle
  (`<ABK>.xml`/`.pdf`) bleibt unpräfixiert. Generierte Doku folgt dem
  Präfix (`<abk>-doku.*`).
- Nach dem Schnitt: **alle** Teildateien diagnosefrei `parse`,
  `pruefe` unverändert grün, volle Test-Suite ohne Regression
  (§ 5); danach `CLAUDE.md`/diesen Leitfaden auf neue Dateinamen
  nachziehen.

Referenz-Implementierung dieses Musters: `examples/kraftst/`
(`kraftstg-typen.findsl` ← `kraftstg-tarif-leicht.findsl` /
`kraftstg-tarif-nutzfahrzeug.findsl` ← `kraftst.findsl`).

---

## 3. Phase 2 — `<slug>.findsl` schreiben

### 3.1 Pflicht-Struktur

```
--
# <Steuer> — <Kurzbeschreibung> (§§ … <ABK>)

<Was wird abgebildet, welche Fassung/Stand, gesetzliche Reihenfolge.>

**Bewusst nicht modelliert (dokumentiert, außerhalb der reinen
Steuerbetragsberechnung):**
- <Bemessungsbasis aus EStG/KStG …> geht als geprüfte Eingabe ein.
- <Verfahren §§ …, Zerlegung, …>.
--

// ====== <§-Abschnitt> ======
--<Doc-Block>--
@Quelle("§ … <ABK>")
konst NAME: Typ = wert
…
@Quelle("§ … <ABK>")
fn stufe(…): Typ = …
…
@Quelle("§ … <ABK>")
fn berechne<Steuer>(fall: <Steuer>Fall): <Steuer>Ergebnis = { … }
```

- **Führender Datei-Doc-Block ist Pflicht** (CLAUDE § 4.9, D3). Sonst
  „stiehlt" er den Doc/`@Quelle` der ersten Deklaration.
- **Jede** Deklaration trägt **unmittelbar davor** ihren eigenen
  `--…--`-Block; Annotationen (`@Quelle`) stehen *zwischen* Doc-Block
  und Deklaration.
- Datensatz-Felder zusätzlich mit Trailing-`//`-Kommentar dokumentieren
  (SPEC § 4.15) — der Doc-Generator extrahiert ihn.
- Funktions-/Datensatz-Doc mit `@param`/`@rückgabe`-Tags.

### 3.2 `@Quelle` — exakte Zitierform (sonst tote Links)

Der Doku-Generator/DocumentLink baut aus `@Quelle` Tiefenlinks auf
gesetze-im-internet.de (`src/docs/quelle.ts`, `GESETZ_PFAD`). Form:

```
@Quelle("§ 9 Absatz 1 Nummer 4 Buchstabe a KraftStG")
@Quelle("§ 11 Absatz 1 Satz 3 Nummer 1 GewStG")
@Quelle("§ 32a Absatz 1 EStG, PAP 2025 Subroutine UPTAB25")
```

- Immer `§ <Nr>` + ausgeschriebene Gliederung + **Gesetzes-Abkürzung
  am Ende**. Mehrere §§ in einer `@Quelle` mit gemeinsamem Gesetz am
  Schluss sind erlaubt.
- **Neues Gesetz?** Prüfe, ob die Abkürzung in `GESETZ_PFAD`
  (`packages/core/src/docgen/quelle.ts`) steht. Wenn nicht: erst das
  korrekte Slug verifizieren (`https://www.gesetze-im-internet.de/<slug>/__<para>.html`
  muss existieren — Achtung: Slug ist NICHT immer
  `kleinbuchstaben(Abk)`, z. B. `kstg_1977`, `kraftstg`), dann den
  Eintrag dort ergänzen. Ein falsches Slug = toter Link (schlimmer
  als kein Link). `quelle.ts` ist die einzige verwaltete URL-Quelle.
- `@Quelle` ist konventionell **Pflicht** für jede norm-gebundene
  `konst`/`fn` (P4). Reine Helfer (`nichtNegativ`, `begrenze`) ohne
  Norm-Anker dürfen es weglassen.

### 3.3 FinDSL-Fallstricke (ALLE beachten — empirisch erkämpft)

| Thema | Regel |
| --- | --- |
| **`konst`-Name** | MUSS `^[A-Z][A-Z0-9_]*$` (ASCII UPPER_SNAKE). Verstoß = **Fehler**. Nur `konst`; fn/var/Param/Datensatz dürfen Unicode/camelCase. |
| **EuroCent-Literale** | **Genau zwei** Nachkommastellen Pflicht: `0,00`, `200.000,00`, `6.037,50`. Bare `0`, `== 0`, `oder 0` im EuroCent-Kontext = **Fehler**. |
| **Euro/Cent-Literale** | Ganzzahlig, **kein** `,`: `100`, `1.000`, `277.825`. |
| **Deutsche Zahl-Notation** | `.` = Tausender (Gruppen zu 3), `,` = Dezimal. Trenner-Komma in Arg-/Listen **stets mit Folge-Leerzeichen**: `f(a, b)`. |
| **Prozent-Literal** | `42%`, `3,5%`, `0,4%`. Intern Bruch (42% = 0,42). |
| **Geld-Arithmetik** | `Geld±Geld`→präzisere Seite; `Geld*Ganzzahl`→Geld; `Geld*{Dezimal,Prozent}`→**EuroCent**; `Geld/…`→**Dezimal**; `Geld*Geld` **verboten**. `Prozent*Prozent`→Dezimal (vermeiden! statt `3,5% * 56%` eine vorab berechnete `konst …: Prozent = 1,96%` mit Doc anlegen). |
| **Typannotation = Einheits-Quelle** | `var x: Cent = 20` ⇒ 20 ct (CLAUDE § 7). `Euro`/`Cent` erzwingen Ganzzahligkeit auch bei berechneten Werten → fraktional ⇒ Laufzeitfehler, explizit runden. `EuroCent` ungeprüft. |
| **`==`/Vergleich tag-agnostisch** | Numerische Gleichheit vergleicht nur den Euro-kanonischen Wert, nicht den Tag. Darum sind Default-`0,00` (intern Dezimal) und EuroCent-Ergebnisse wertgleich vergleichbar — Korrektheit hängt am Wert, nicht am Tag. |
| **Rundung** | Methoden (SPEC § 11.1): `.abrunden()`/`.aufrunden()` auf `EuroCent` (Ziel `Euro`/`Cent` aus dem Kontext: Annotation/`als`-Cast/fn-Rückgabetyp), `Dezimal` (→ `Ganzzahl`) oder `Prozent` (→ volle `Prozent`, kontextfrei). Empfänger sonst = Fehler. Beliebiger Ausdruck als Empfänger via Klammer: `(satz * basis).abrunden()`. „Auf volle 100 € ab": `((betrag / 100).abrunden() * 100) als EuroCent`. „Je angefangene Einheit": `((wert / teiler) als Dezimal).aufrunden()`. |
| **Statement-Grenze `)(`** | Endet eine Block-Anweisung mit `)` und beginnt die nächste/das Ergebnis mit `(`, parst der Parser eine **Aufrufkette** `f(...)(...)` → Fehler. **Fix:** Zwischenergebnis an `var` binden und als **blanken Identifier** zurückgeben. Block-Ergebnis nie mit `(` beginnen, wenn die Vorzeile mit `)` endet. Ende eines Blocks idealerweise blanker Identifier oder `Name(...)`-Konstruktor (wie `KörperschaftsteuerErgebnis(…)`). |
| **`abbruch`** | `falls <bedingung> -> abbruch("§ …: <Begründung mit ${wert}>")`. Typ `never`, in jeden Zweig/Body einsetzbar. **Nicht** in eine eigene, sonst ungenutzte `var` legen (Unused-Hint) — in die erste *genutzte* Größe einfädeln (`var ertrag = wähle { falls jahr < … -> abbruch(…) sonst -> … }`). |
| **`wähle (enum)`** | Alle Enum-Werte mit `falls` abdecken; `sonst` dann optional (Type-Checker prüft Vollständigkeit). Muster aus KStG übernehmen. |
| **Listen/`für jeden`/parametrische Lambdas — verfügbar** | `Liste<T>`, numerische `Bereich<T>` (`a bis b [schritt s]`), `für jeden x aus … { }`, parametrische Lambdas/Closures, Index `[i]` und **alle 12 Listen-Methoden** (SPEC § 11.2: `.länge`/`.leer`/`.kopf`/`.rest`/`.bei`/`.enthält`/`.zuordnen`/`.filtern`/`.zusammenfassen`/`.zähle`/`.summe`/`.größtes`/`.kleinstes`) sind **ausführbar** (Parser+Type-Checker+Interpreter). **Mehr-Entitäten-Fälle SIND zu modellieren**, wenn das Gesetz sie vorschreibt: z. B. n Kinder/Objekte als `datensatz`-Liste, Aggregat per `kinder.zuordnen({ k -> … }).summe()` oder `für jeden`. Leere `.summe()` → 0; `.kopf`/`.größtes`/`.kleinstes`/Index out-of-bounds → Laufzeitfehler (Bug-Klasse, kein `abbruch`). **Noch nicht ausführbar:** Aufzählungs-Bereiche (`I bis VI`) — klare Fehlermeldung; statt dessen `für jede` über ein Listen-Literal der Werte. |
| **Block-Body** | `{ (var name: Typ = expr)* ergebnis }`. `var` ist single-assignment, **Typannotation Pflicht**. Jede `var` muss verwendet werden (sonst Unused-Hint). |
| **Datensatz-Defaults** | Skalare/Enum-Defaults nutzen (`= 0,00`, `= falsch`, `= Keine`, `= 200%`). Verschachtelte Record-Defaults meiden — Pflichtfeld lassen, im Test explizit konstruieren. |
| **Identität = Dateipfad** | `.test.findsl` importiert `aus "./<slug>"` (relativ, ohne `.findsl`). |

---

## 4. Phase 3 — `<slug>.test.findsl` schreiben

- **Eigene Datei**, führender Datei-Doc-Block (fasst die handgerechneten
  Sollwert-Quellen zusammen), dann **nur** `verwende` + `prüfe`-Blöcke.
- **Selektiver Import** `verwende { … } aus "./<slug>"`:
  - **Alle** als Aufrufziel/Konstruktor genutzten Namen importieren —
    `datensatz`-Konstruktoren (`Fall`, `Ergebnis`, Teil-Datensätze) und
    Funktionen. Unbekannter PascalCase als Aufrufziel = **Fehler**
    (CLAUDE: PascalCase-Fallback nicht mehr still bei Calls).
  - Genutzte **Enum-Werte** importieren (`Keiner`, `Kapitalgesellschaft`).
  - Enum-**Typen** nur importieren, wenn auch als Typ verwendet — sonst
    Unused-Hint.
- **Pro `§`/Stufe ein `prüfe`-Block**, je `testfall` ein Knotenpunkt.
  Sollwert **von Hand aus dem Wortlaut** rechnen und im Label/Kommentar
  die Rechnung zeigen (`// z = 3.2557; (176.64*z+2397)*z+1015.13 = …`).
- **Knotenpunkte abdecken:** Zonengrenzen, Freibetrag-genau/-darunter/
  -darüber, Schwellen (±1), Null-/Negativfall, Höchstbetrag erreicht,
  jede Enum-Variante, jede Staffelstufe.
- **`erwartet abbruch`** für jede per `abbruch` ausgeschlossene
  Konstellation (Stichjahr-Schranke, unzulässige Eingabe).
- **Gesamtberechnung:** mehrere `testfall` über `berechne<Steuer>(…)`
  mit `var e: <Steuer>Ergebnis = …`, dann `e.feld == soll und …` über
  alle Zwischengrößen.
- EuroCent-Sollwerte **immer 2-stellig** (`== 24.150,00`), Prozent als
  `== 3,5%`, Negativwerte `== -50.000,00` (unäres `-`).

`testfall`-Blockform (CLAUDE § 4.12):

```
testfall "Beschreibung mit Sollrechnung" {
    var e: <Steuer>Ergebnis = berechne<Steuer>(<Steuer>Fall( … ))
    e.gewerbeertrag == 197.000,00
        und e.steuermessbetrag == 6.037,50
        und e.gewerbesteuer == 24.150,00
}
testfall "Unzulässige Konstellation" erwartet abbruch {
    berechne<Steuer>(<Steuer>Fall( … ))
}
```

---

## 5. Phase 4 — Verifizieren (Pflicht, keine Abkürzung)

Alles **vom Repo-Root** (npm-Workspaces, kein `cd findsl-ts`).
Beispielarbeit braucht **kein** `langium:generate`/`build`/`bundle`
(Grammatik unverändert). Falls `packages/*/out/` veraltet ist, einmal
`npm run build`. Dateiendung ist **`.findsl`**.

# parse/test/docgen nehmen Datei | Verzeichnis (rekursiv) | Glob
# (Muster quoten → in-process); test überspringt Nicht-Test-Dateien.
```bash
# 1. Modul + Test müssen DIAGNOSEFREI parsen (Verzeichnis = beides):
node packages/cli/out/main.js parse examples/<slug>
# 2. Alle prüfe-Fälle müssen grün sein:
node packages/cli/out/main.js test examples/<slug>/<slug>.test.findsl
# 3. Keine Regression — alle Beispiele in einem Lauf:
node packages/cli/out/main.js test 'examples/**/*.test.findsl'
# 4. Volle Test-Suite — alles grün, keine Regression:
npm test
```

**Erfolgskriterien:**

- `parse` beider Dateien: *„erfolgreich geparst, keine Diagnosen."*
  (Hinweise/`hint` wie ungenutzte Importe vorher beseitigen.)
- `test`: `N/N bestanden`.
- `npx vitest run`: alle Test-Dateien grün, Anzahl **≥** vorheriger
  Stand (keine Regression).
- Die Meldung `Ambiguous Alternatives Detected … <Program>` im
  vitest-Log ist die **bekannte, benigne** Datei-Doc-Greedy-Ambiguität
  (CLAUDE § 5, nur Dev/Test sichtbar) — **kein** Fehler, nicht
  „wegfixen".

**Bei Fehlern:** Sollwerte gegen den Gesetzeswortlaut nachrechnen
(nicht den Test „passend machen"); Parse-Fehler i. d. R.
Statement-Grenze `)(` (siehe 3.3) oder EuroCent-Literal ohne 2 NK.

---

## 6. Phase 5 — Dokumentation & Buchführung

- **Nur auf ausdrückliche Anweisung** Doku generieren — dann
  modul-isoliert in `examples/<slug>/`:
  `node packages/cli/out/main.js docgen examples/<slug> -f all -o examples/<slug>/<abk>-doku`
  (erzeugt `*-doku.md|html|pdf`; vom Repo-Root).
- **Titelseite/Einleitung** über eine optionale Front-Matter-Datei
  steuern: `--kopf <datei>` (Markdown mit `--- name/untertitel/autor/
  beschreibung/lizenz/metadaten --- <Einleitung>`). Fehlt sie, werden
  **Titel/Untertitel automatisch aus dem ersten Modul abgeleitet**
  (erste Überschrift bzw. erster Satz des Datei-Doc-Blocks) — der
  generische „FinDSL-Dokumentation"-Default greift nur ohne Kopf in
  direkten Renderer-Aufrufen. Eine `<abk>-doku.kopf.md` neben dem
  Modul ist die empfohlene Ablage.
- `CLAUDE.md` aktualisieren: Beispiel-Liste in § 2 und die
  „*Letzte Aktualisierung*"-Fußzeile (neues Modul, Testzahlen,
  `pruefe`-Ergebnisse) ergänzen. Grammatik-Duo-Sync ist hier **nicht**
  betroffen (keine Sprachänderung).
- `@Quelle`-Links stichprobenartig prüfen (richtiges `GESETZ_PFAD`-Slug).

---

## 7. Abschluss-Checkliste

- [ ] Gesetz vollständig gelesen (XML primär), Kern/Verfahren getrennt.
- [ ] `examples/<slug>/<slug>.findsl` + `<slug>.test.findsl` separat.
- [ ] Bei Größe/mehreren Rechtsbereichen über **mehrere kohäsive
      Dateien** aufgeteilt (§ 2.1): Schnitt nach Rechtsbereich,
      Konstanten beim Verbraucher, geteiltes `…-typen`-Blatt,
      azyklischer `verwende`-Graph, einheitliches Datei-Präfix,
      Code verbatim, Tests unverändert grün.
- [ ] Führender Datei-Doc-Block in **beiden** Dateien; jede Decl mit
      eigenem `--…--`-Block + `@Quelle`.
- [ ] **Alle** Datenstrukturen feldweise dokumentiert (`@param` +
      Trailing-`//`).
- [ ] Jede Norm-Stufe = eigene `fn`, gesetzliche Reihenfolge gespiegelt;
      Orchestrator weist jede Zwischengröße aus.
- [ ] Vom Gesetz vorgeschriebene Arithmetik **vollständig & exakt**;
      nicht modellierter Umfang im Datei-Doc **explizit benannt**.
- [ ] Nicht abgedeckte Konstellationen per `abbruch` ausgeschlossen +
      `erwartet abbruch`-Test.
- [ ] `konst` ASCII-UPPER_SNAKE; EuroCent-Literale 2-stellig; keine
      `)(`-Statement-Grenzen; keine ungenutzten `var`/Importe.
- [ ] `parse` (0 Diagnosen) · `pruefe` (N/N) · `npx vitest run`
      (keine Regression) · andere Beispiele unverändert grün.
- [ ] `CLAUDE.md`-Fußzeile/Beispielliste aktualisiert.

---

## 8. Referenz-Module (Vorlagen)

| Modul | Lehrwert |
| --- | --- |
| `examples/kst/kst.findsl` | **Klein & klar.** Staffel-Satz (`wähle`), Freibetrag mit Höchstgrenze, Ausschluss-Enum, gesetzliche Rundung, sauberer Orchestrator. **Bester Startpunkt.** |
| `examples/kraftst/` | **Groß, progressiv & mehrdateilich.** Viele abgeleitete Kumulativ-Konstanten, „je angefangene Einheit" (`einheiten`/`aufrunden`), Höchstbetrags-Caps (`begrenze`), viele Enums, breite Tarifauswahl. **Vorbild für Modul-Dekomposition + einheitliches Datei-Präfix:** auf `kraftstg-typen.findsl` (Aufzählungen/Datensätze/Helfer), `kraftstg-tarif-leicht.findsl` und `kraftstg-tarif-nutzfahrzeug.findsl` (je Rechtsbereich Konstanten **+** Funktionen zusammen) und `kraftst.findsl` (Orchestrator) verteilt — azyklischer `verwende`-Graph (`kraftstg-typen ← kraftstg-tarif-* ← kraftst`), keine Wildcards/Re-Exports, `.test.findsl` quelldatei-gruppiert. Dekompositions-/Helferdateien tragen das Gesetz-Präfix `kraftstg-`; Orchestrator + Testdatei den Slug (`kraftst.findsl`/`kraftst.test.findsl`). Law-Quelle `kraftstg_2002.xml` bleibt unpräfixiert. |
| `examples/gewst/gewst.findsl` | **Verrechnungslogik.** Gewichtete Summe + Freibetrag (§ 8 Nr. 1), Höchstbetrag aus Maximum zweier Sätze (§ 9 Nr. 5), Mindestbesteuerung (§ 10a), Stichjahr-`abbruch`, voll dokumentierte Scope-Grenze. |
| `examples/est/est.findsl` | **Veranlagungskaskade § 2 EStG + Tarif § 32a + mehr-entitätige Rechenvorschriften.** Stufen-Funktionen Summe der Einkünfte → Gesamtbetrag → Einkommen → zvE → tariflich (§ 32a, Fünf-Zonen-`wähle` + Splitting Abs. 5) → festzusetzend (§ 2 Abs. 6). **Listen-Konstrukte (§ 11.2):** § 32 Abs. 6 Kinderfreibetrag/BEA je `Liste<Kind>` (`zuordnen`/`summe`, Faktor/Zwölftel/Auslandsfaktor je Kind), § 33 Abs. 1/3 außergewöhnliche Belastungen mit **staffelweiser** zumutbarer Belastung (drei GdE-Stufen × vier Personengruppen, `_Spanne`-Helfer), § 10b Spenden ≤ max(20 % GdE; 4 ‰ Umsätze+Löhne). `EinkommensteuerFall`/`-Ergebnis`-Datensätze, **eingebaute** `Tarifart`, Helfer `_NichtNegativ`/`_Hoechstens`/`_Groesseres`/`_Spanne`. **Lehrwerte:** (1) Fassungswahl (estg.xml VZ-2026-konsolidiert); (2) **Unterscheidung Skalar-Eingabe ⇄ echte mehr-entitätige Rechenvorschrift**: anderes Recht/Verfahren bleibt Eingabe (Einkunftsarten-Ermittlung, § 24a/§24b, Vorsorge-SA, § 10d, § 2-Abs.-6-Komponenten), aber EStG-Rechenvorschriften über n Entitäten (Kinder/agB-/Spenden-Posten) werden via `Liste` **gerechnet** — nicht mehr als vorsummierter Skalar; (3) Statut-stille Rundung deterministisch dokumentiert (Kategorie-Abzüge `.abrunden()` mit Euro-Kontext, konsistent § 32a Satz 1); (4) `wähle`-Tarifkern mit `abbruch`, im Orchestrator via `_NichtNegativ` entschärft. |

Bei Unsicherheit über ein Idiom: **erst** das nächstliegende
Referenzmodul ansehen, dessen Muster exakt übernehmen, **dann** schreiben.
