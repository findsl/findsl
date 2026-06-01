# Pfad B — Aus Gesetzestext ein FinDSL-Modul bauen

Wenn die Eingabe ein **Gesetzestext** ist (ein Paragraph, ein Wortlaut, ein
§-Zitat, ggf. ein Gesetz-XML/PDF), gilt derselbe Architektur- und Test-
Rahmen wie bei Pfad A — die Quelle der Wahrheit ist der amtliche Wortlaut.
**Goldene Regel:** exakt rechnen, nicht modellierten Umfang benennen, nie
raten.

## Schritt 0 — Den Wortlaut vollständig erfassen

- Liegt der Text als **strukturiertes XML** vor (juris/gesetze-im-internet:
  `<norm>`/`<enbez>`/`<textdaten>`), ist das die maßgebliche Quelle — sauber
  paragraphenweise zerlegbar, inkl. Satznummern. PDF nur als Quervergleich.
- Bei großem Gesetz **in Chargen** lesen (wenige §§ pro Schritt), nicht alles
  auf einmal.

## Schritt 1 — Berechnungskern vs. Verfahren/Außenrecht trennen

Ordne jeden Inhalt einer Kategorie zu:

| Kategorie | Behandlung in FinDSL |
| --- | --- |
| **Rechenvorschrift** (Sätze, Freibeträge, Prozentsätze, Staffeln, Rundung, Reihenfolge) | **Vollständig & exakt** als `konst` + `fn` |
| **Bemessungsbasis aus anderem Gesetz** („Gewinn nach EStG/KStG", „Einkommen i.S.d. § 8 KStG") | **Geprüfte Eingabe** (Datensatz-Feld), im Datei-Doc als nicht modelliert benennen |
| **Behördliche Einstufung / Sachverhalt** (Schadstoffklasse, Höhe einzelner Hinzurechnungen) | **Geprüfte Eingabe** (Enum/Feld), Begründung im Doc |
| **Verfahren** (Festsetzung, Vorauszahlung, Zerlegung, Fristen, Erklärungspflichten) | **Nicht modelliert**, im Datei-Doc explizit benennen |
| **Befreiungs-/Ausnahmekataloge** (lange Listen begünstigter Einrichtungen) | i. d. R. Enum-Flag „Befreiung ja/nein" als Eingabe; Katalog nicht ausmodellieren |
| **Zeitlicher Anwendungsbereich** | Fassung wählen, Stichjahr als `konst`, frühere Zeiträume per `abbruch` ausschließen |

Faustregel: der **Berechnungskern** wird abgebildet; vorgelagerte Gewinn-/
Einkommensermittlung und behördliche Einstufungen sind **immer Eingaben**.

## Schritt 2 — Architektur (Bausteine) + `@Quelle`

Die sieben Bausteine wie im Hauptdokument (`SKILL.md`): `konst` je Wert ·
`aufzählung` je Klasse · `<X>Fall`/`<X>Ergebnis` · Stufen-`fn`s · Helfer ·
Orchestrator. Jede norm-gebundene `konst`/`fn` trägt eine **`@Quelle`**.

**`@Quelle`-Zitierform** (exakt, sonst tote Doku-Links): `§ <Nr>` +
ausgeschriebene Gliederung + **Gesetzes-Abkürzung am Ende**:

```
@Quelle("§ 9 Absatz 1 Nummer 4 Buchstabe a KraftStG")
@Quelle("§ 11 Absatz 1 Satz 3 Nummer 1 GewStG")
```

Mehrere §§ in einer `@Quelle` mit gemeinsamem Gesetz am Schluss sind erlaubt.
Reine Helfer (`_NichtNegativ`, …) ohne Norm-Anker dürfen `@Quelle` weglassen.

## Schritt 3 — Schreiben

Folge `references/vorlagen.md`. Führender Datei-Doc-Block ist Pflicht:

```
--
# <Steuer> — <Kurzbeschreibung> (§§ … <ABK>)

<Was wird abgebildet, welche Fassung/Stand, gesetzliche Reihenfolge.>

**Bewusst nicht modelliert (außerhalb der reinen Steuerbetragsberechnung):**
- <Bemessungsbasis aus EStG/KStG …> geht als geprüfte Eingabe ein.
- <Verfahren §§ …, Zerlegung, …>.
--
```

- Jede Deklaration trägt **unmittelbar davor** ihren eigenen `--…--`-Block;
  `@Quelle` steht **zwischen** Doc-Block und Deklaration.
- Datensatz-Felder zusätzlich mit Trailing-`//`-Kommentar; Funktions-/
  Datensatz-Doc mit `@param`/`@rückgabe`.
- Stufenweise: eine `fn` je Norm-Stufe, gesetzliche Reihenfolge gespiegelt;
  der Orchestrator weist jede Zwischengröße im Ergebnis-Datensatz aus.
- Nicht abgedeckte Konstellationen per `abbruch("§ …: <Begründung>")`.

## Schritt 4 — Tests

`<name>.test.findsl`: führender Doc-Block, dann **nur** `verwende` +
`prüfe`. **Pro `§`/Stufe ein `prüfe`-Block**, Sollwerte **von Hand aus dem
Wortlaut** rechnen und im Label zeigen (`// z = 3,2557; (176,64·z+2397)·z+… = …`).

Knotenpunkte abdecken: Zonengrenzen, Freibetrag genau/darunter/darüber,
Schwellen ±1, Null-/Negativfall, Höchstbetrag erreicht, **jede** Enum-
Variante, **jede** Staffelstufe. Für jede per `abbruch` ausgeschlossene
Konstellation ein `erwartet abbruch`-Test. EuroCent-Sollwerte 2-stellig.

## Schritt 5 — Verifizieren

```bash
findsl parse <verzeichnis>                 # 0 Diagnosen (auch keine hints)
findsl test  <name>.test.findsl            # N/N bestanden — N = deine testfall-Zahl
```

Vollständige Erfolgskriterien (notwendig **und** hinreichend) in `SKILL.md` →
**Verifizieren**. Kurz: `test` auf die `.test.findsl`/das Verzeichnis zielen und
prüfen, dass **die gelaufene Fallzahl deiner `testfall`-Zahl entspricht**
(„keine prüfe-Blöcke" / `0/0` = **kein** Erfolg, trotz Exit 0). Bei Fehlern
Sollwerte gegen den **Wortlaut** nachrechnen — nie den Test passend machen.
Häufige Parse-Fehler: Statement-Grenze `)(`, EuroCent-Literal ohne genau 2 NK,
`modul`-Header (gibt es nicht). Zeigt das wiederholte Nachrechnen, dass der
**Wortlaut selbst mehrdeutig** ist → **anhalten und fragen** (s. u.), nicht
eine Lesart bis zum grünen Test erzwingen.

> **Mehrdeutiger/widersprüchlicher Wortlaut ist ein Stopp-Trigger, nicht eine
> stille Designentscheidung.** Lassen zwei Auslegungen unterschiedliche Beträge
> zu, fehlt eine Rundungsrichtung/-einheit, oder widersprechen sich Normen —
> benenne die Auslegungsfrage und frag nach, bevor du eine Variante festschreibst
> (goldene Regel: nie raten).

---

## Mehrere Dateien — wann und wie ein Gesetz aufteilen

**Eine Datei pro Gesetz ist nicht das Ziel.** Steuergesetze sind groß; eine
1.000+-Zeilen-Datei ist schwer zu prüfen und zu pflegen. Aufteilung über
**mehrere kohäsive Dateien** ist für diese Domäne die empfohlene Architektur.

**Wann aufteilen?** Sobald **eines** zutrifft: die Datei überschreitet grob
~500–700 Zeilen; sie deckt **mehrere klar trennbare Rechtsbereiche** ab (z. B.
§ 9 Abs. 1 Nr. 1–5: Krafträder / PKW / Wohnmobile / Nutzfahrzeuge / Anhänger);
es gibt ein **wiederverwendbares Vokabular** (Aufzählungen, Eingabe-/
Ergebnis-Datensätze, generische Helfer). Kleine Gesetze **nicht** künstlich
zersplittern.

**Schnittkriterien (in dieser Reihenfolge):**

1. **Nach Rechtsbereich, nicht nach Datei-Typ.** Schneide entlang der
   Gesetzesstruktur (§§/Absätze/Nummern), **nicht** in „alle Konstanten" /
   „alle Funktionen". FinDSL kennt nur **selektive Importe** (keine
   Wildcards, keine Re-Exports) — eine reine Konstanten-Datei erzwingt
   riesige `verwende`-Listen.
2. **Konstanten zur Logik legen.** Sätze/Freibeträge eines Bereichs gehören
   in **dieselbe** Datei wie die Funktionen, die sie verbrauchen.
3. **Geteiltes Vokabular in eine Blatt-Datei** (`…-typen`): Aufzählungen,
   Eingabe-/Ergebnis-Datensatz, generische Helfer. Importiert **nichts** →
   Wurzel des Modul-Graphen.
4. **Öffentliche Einstiegsdatei = Orchestrator** mit `Berechne<X>` und der
   gesetzlichen Gesamtreihenfolge; importiert die Bereichs-Dateien.
5. **Azyklischer, geschichteter Graph:** `…-typen ← …-tarif-<bereich>* ←
   <einstieg>`. Zyklen sind verboten und ein Zeichen falscher Schnittführung.
6. **Schnitt am Importvolumen validieren:** kleine `verwende`-Listen =
   richtiger Schnitt. Muss eine Datei Dutzende Konstanten importieren →
   Schnitt neu legen (Konstanten gehören zum Verbraucher, Kriterium 2).

**Mechanik:** Code **verbatim** verschieben (Doc-Blöcke/`@Quelle`/Leerzeilen
unverändert — kein Verhalten ändert sich); jede Datei mit eigenem führenden
Doc-Block + den nötigen `verwende { … } aus "./<datei>"`-Blöcken (Pfad =
Dateiname **ohne** `.findsl`, relativ); **nur tatsächlich genutzte Symbole**
importieren (Enum-Werte, die in `falls`/`==` vorkommen; Enum-Typnamen nur,
wenn als Typ referenziert); einheitliches Datei-Präfix (Gesetz-Kürzel).
Nach dem Schnitt: alle Teildateien diagnosefrei `parse`, `test` unverändert
grün.

> Vorbild dieses Musters im FinDSL-Repository: `examples/kraftst/`
> (`kraftstg-typen.findsl ← kraftstg-tarif-*.findsl ← kraftst.findsl`).
