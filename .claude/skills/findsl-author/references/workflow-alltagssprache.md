# Pfad A — Aus Alltagssprache ein FinDSL-Modul bauen

Wenn die Eingabe eine **formlose Beschreibung** ist (keine §§, kein Gesetz-
XML), gilt derselbe Architektur- und Test-Rahmen wie beim Gesetzespfad —
nur die Quelle der Wahrheit ist die Beschreibung des Nutzers statt eines
Normtextes. Die **goldene Regel** bleibt: exakt rechnen, Lücken benennen,
nie raten.

## Schritt 1 — Regel vollständig erfassen, Lücken aktiv schließen

Lies die Beschreibung und extrahiere strukturiert:

- **Werte/Sätze/Schwellen** — jede Zahl wird eine `konst`.
- **Eingaben** — welche Größen kommen von außen (Bemessungsbasis,
  Klassifizierungen)? → Datensatz-Felder / Aufzählungen.
- **Stufen & Reihenfolge** — in welcher Reihenfolge wird gerechnet?
  (Freibetrag *vor* Satz? Cap *nach* Satz? Rundung *zuletzt*?)
- **Rand-/Sonderfälle** — Null/negativ, Höchst-/Mindestbetrag,
  Fallunterscheidung nach Klasse/Jahr.

**Mehrdeutigkeit ist die Hauptfehlerquelle bei Pfad A.** Fehlt eine Zahl,
eine Reihenfolge, eine Rundungsregel oder eine Einheit — **frag den Nutzer
gezielt**, statt eine Annahme zu verstecken. Typische Klärfragen:

- „Ist der Freibetrag *vor* oder *nach* Anwendung des Satzes abzuziehen?"
- „Soll auf volle Euro gerundet werden — ab- oder aufrunden?"
- „Was passiert bei negativer Bemessungsgrundlage — auf 0 kappen oder Fehler?"
- „In welcher Einheit ist der Eingabebetrag (volle Euro oder mit Cent)?"

Wenn der Nutzer ausdrücklich „nimm sinnvolle Defaults" sagt, **dokumentiere
die getroffene Annahme im Doc-Block** sichtbar — nicht stillschweigend.

## Schritt 2 — Auf die Bausteine abbilden

Dieselben sieben Bausteine wie im Hauptdokument (`SKILL.md`):
`konst` je Wert · `aufzählung` je Klasse · `<X>Fall`/`<X>Ergebnis`-Datensätze
· Stufen-`fn`s · Helfer · Orchestrator. Ohne Gesetz entfällt nur `@Quelle`
(optional eine `-- Quelle: <freie Referenz> --`-Zeile, falls der Nutzer
eine angibt).

**Naming ohne §-Bezug:** sprechende `UPPER_SNAKE`-Konstanten
(`STEUERSATZ`, `FREIBETRAG`, `SCHWELLE_HOCH`); Funktionen/Datensätze/
Aufzählungen mit **Großbuchstaben** (UpperCamelCase, harte Regel SPEC § 2.5):
`WendeFreibetragAn`, `BerechneSteuer`, `SteuerFall` — `var`/Parameter/Felder
lowerCamelCase (`umsatz`, `freibetrag`).

## Schritt 3 — Schreiben

Folge `references/vorlagen.md`. Führender Datei-Doc-Block mit:

```
--
# <Titel> — <Kurzbeschreibung>

<Was wird gerechnet, in welcher Reihenfolge.>

**Bewusst nicht modelliert / angenommen:**
- <Annahme X> (mangels Angabe so gewählt).
- <Eingabe Y> geht als geprüfte Eingabe ein.
--
```

## Schritt 4 — Tests von Hand rechnen

Auch ohne Gesetz: **Sollwerte selbst ausrechnen** und im `testfall`-Label
die Rechnung zeigen. Knotenpunkte abdecken: Schwellen ±1, Freibetrag
genau/darunter/darüber, Null-/Negativfall, jede Enum-Variante,
Höchstbetrag erreicht, jede ausgeschlossene Konstellation per
`erwartet abbruch`.

## Schritt 5 — Verifizieren

Wie im Hauptdokument: `parse` (0 Diagnosen) · `test` (N/N) · keine
Regression über `examples/**/*.test.findsl`.

---

### Mini-Beispiel: von der Prosa zur Struktur

> „Die Abgabe beträgt 2 % vom Umsatz. Liegt der Umsatz unter 10.000 €,
> fällt keine Abgabe an. Es wird auf volle Euro abgerundet."

Zerlegung:

| Prosa | FinDSL |
| --- | --- |
| „2 % vom Umsatz" | `konst SATZ: Prozent = 2%`; `umsatz * SATZ` (→ EuroCent) |
| „Umsatz unter 10.000 € → keine Abgabe" | `konst FREIGRENZE: Euro = 10.000`; `wenn`/`wähle`-Stufe |
| „auf volle Euro abgerundet" | `var betrag: Euro = roh.abrunden()` (typgebundene var) |
| „Umsatz" | Eingabe → `datensatz AbgabeFall(umsatz: Euro)` |

Daraus wird eine Stufe `fn Abgabe(fall: AbgabeFall): Euro` (Großbuchstabe!)
plus ein `prüfe`-Block mit Sollwerten bei Umsatz 9.999 € (= 0), 10.000 €
(= 200 €) und z. B. 50.001 € (2 % = 1.000,02 € → abgerundet 1.000 €). Das
vollständige, **verifizierte** Beispiel steht in `references/vorlagen.md`.
