---
name: findsl-author
description: >-
  Generiert valide FinDSL-Programme (+ prüfe-Tests) aus einer einfachen
  Beschreibung in Alltagssprache ODER aus Gesetzestexten (§-Zitat/Wortlaut).
  Nutze diesen Skill IMMER, wenn FinDSL-Code geschrieben, geändert oder
  generiert werden soll — also bei „.findsl"-Dateien, „modelliere § … in
  FinDSL", „bau aus diesem Gesetz/dieser Steuerregel ein FinDSL-Modul",
  „schreib eine FinDSL-Funktion/-Konstante/-Datensatz", „FinDSL-Tests dazu",
  oder wenn aus einer formlosen Steuer-/Berechnungsregel FinDSL entstehen
  soll. Auch wenn der Begriff „FinDSL" nicht fällt, aber eine Steuer-/
  Rechenvorschrift als ausführbare, auditierbare Regel modelliert werden soll.
license: EUPL-1.2
metadata:
  authors: devtank42 GmbH
  homepage: https://github.com/findsl/findsl
  compatible_agents: Claude Code, OpenCode, Codex (Agent-Skills-Standard)
---

# FinDSL Author

FinDSL ist eine deutschsprachige DSL für **auditierbare Steuerrechen-
vorschriften**. Dieser Skill verwandelt zwei Arten von Eingabe in valides,
getestetes FinDSL:

- **A) Alltagssprache** — eine formlose Beschreibung („Die Steuer ist 15 %
  des Einkommens, mindestens aber 0; ein Freibetrag von 5.000 € wird vorher
  abgezogen, höchstens bis zur Höhe des Einkommens.").
- **B) Gesetzestext** — ein Paragraph, ein Gesetz-Wortlaut, ein §-Zitat.

Beide Pfade münden in dieselbe Architektur und dieselben Tests.

> **Voraussetzung:** das installierte **`findsl`-CLI** (prüfe mit
> `findsl --help`). Die Verifikation in diesem Skill ruft `findsl parse`
> und `findsl test` auf. Geschrieben werden gewöhnliche `.findsl`-Dateien
> in deinem Projekt — du bestimmst die Pfade.

## Goldene Regel

**Absolut richtige Berechnung im modellierten Umfang.** Die vorgeschriebene
Arithmetik wird vollständig und exakt umgesetzt; alles außerhalb der reinen
Betragsberechnung (Bemessungsbasis aus anderem Recht, behördliche
Einstufungen, Verfahren) geht als **geprüfte Eingabe** ein und wird im
Datei-Doc-Block **explizit als nicht modelliert** dokumentiert. **Niemals
raten, niemals stillschweigend vereinfachen** — im Zweifel die offene Frage
benennen, nicht eine Annahme verstecken.

## FinDSL nicht „erweitern"

Verwende ausschließlich **dokumentierte Sprachkonstrukte** (siehe
`references/sprache-referenz.md`). Kann FinDSL etwas nicht ausdrücken, wird
der **Umfang dokumentiert eingeschränkt** — es wird keine Syntax erfunden.
Erfundene Schlüsselwörter/Operatoren führen nur zu Parse-Fehlern.

---

## Vorgehen (beide Pfade)

Arbeite in fünf Phasen. Lies die zwei Pflicht-Referenzen, **bevor** du Code
schreibst:

1. **`references/sprache-referenz.md`** — Typen, Geld-Arithmetik, Syntax und
   die häufigsten Fallstricke. Das ist der wichtigste Guardrail: die meisten
   Fehler entstehen an Geld-Literalen, Namen, Rundung und Statement-Grenzen.
   **Immer zuerst lesen.**
2. **`references/vorlagen.md`** — kommentierte Skelette (konst · aufzählung ·
   datensatz · fn · wähle · Orchestrator · Testdatei) plus ein vollständiges,
   verifiziertes Mini-Beispiel. Kopiere die Muster, statt frei zu erfinden.

### Pfad-Entscheidung

| Eingabe | Pfad | Zusätzliche Referenz |
| --- | --- | --- |
| Formlose Regel, Prosa, „rechne X aus Y" | **A — Alltagssprache** | `references/workflow-alltagssprache.md` |
| § / Gesetz-Wortlaut / juristisches Zitat | **B — Gesetzestext** | `references/workflow-gesetz.md` |

### Phasen

0. **Verstehen & trennen.** Sammle die Regel vollständig. Ordne jeden
   Inhalt zu: **Rechenvorschrift** (→ exakt implementieren als `konst`/`fn`)
   vs. **geprüfte Eingabe** (Bemessungsbasis, Einstufung → Datensatz-Feld/
   Enum) vs. **nicht modelliert** (Verfahren, Fristen → im Doc benennen).
   Bei A: fehlt eine Zahl/Schwelle/Reihenfolge, **frag nach** statt zu raten.
1. **Architektur** — Reihenfolge der Regel 1:1 als Funktionskette (Bausteine
   unten). Bei Größe/mehreren Bereichen auf **mehrere kohäsive Dateien**
   aufteilen (`references/workflow-gesetz.md` → Abschnitt „Mehrere Dateien").
2. **`<name>.findsl` schreiben** — führender Datei-Doc-Block (Pflicht!),
   dann Konstanten/Typen/Stufen-Funktionen/Orchestrator, jede Decl mit
   eigenem `--…--`-Doc + (norm-gebunden) `@Quelle`.
3. **`<name>.test.findsl` schreiben** — nur `verwende` + `prüfe`-Blöcke;
   Sollwerte von Hand aus der Regel rechnen, Knotenpunkte abdecken
   (bevorzugt **gerundete Endgrößen** prüfen — krumme `Geld*Prozent`-
   Zwischenwerte tragen >2 NK und lassen sich nicht als EuroCent-Literal
   asserten).
4. **Verifizieren** (Pflicht, keine Abkürzung) — siehe unten.

---

## Architektur-Bausteine (verbindliches Schema)

Spiegele die Reihenfolge der Regel als Kette aus kleinen, einzeln testbaren
Funktionen. Jede Stufe = eine `fn` mit `@Quelle` (bei Gesetzespfad).

1. **`konst` pro Regelwert** — jeder Satz/Freibetrag/jede Schwelle eine
   eigene Konstante mit Doc-Block. Kumulative Staffelwerte **ableiten**
   (`konst NR3_KUM_3000: EuroCent = NR3_KUM_2000 + NR3_2000_3000 * 5`),
   nicht handsummieren (Audit-Nachvollziehbarkeit).
2. **`aufzählung` pro Klassifizierung** — Rechtsform, Klasse, Ausschluss­
   tatbestand, Tarifart. Jeder Wert per `@param` erklärt.
3. **`datensatz <X>Fall`** — alle Eingaben (Bemessungsbasis, Klassifizierung,
   geprüfte Einzelbeträge); skalare Eingaben mit sinnvollem `= default`.
4. **`datensatz <X>Ergebnis`** — **jede** Zwischengröße der Reihenfolge als
   eigenes Feld (Schritt-für-Schritt-Audit).
5. **Stufen-Funktionen** — eine `fn` je Norm-/Logikstufe, typisiert.
6. **Allgemeine Helfer** — `_NichtNegativ` (max 0), `_Hoechstens` (Cap),
   `_Einheiten` („je angefangene Einheit": `((wert / teiler) als Dezimal).aufrunden()`).
   Helfer ohne Norm-Anker dürfen `@Quelle` weglassen und ein führendes `_`
   tragen (modul-intern).
7. **Orchestrator** `Berechne<X>(fall): <X>Ergebnis = { … }` — ruft die
   Stufen in Reihenfolge, füllt das Ergebnis, schließt nicht abgedeckte
   Konstellationen per `abbruch("…")` aus.

---

## Kritische Sprach-Guardrails (immer beachten)

Diese verursachen die meisten Fehler — Details + alle weiteren in
`references/sprache-referenz.md`:

- **Namen (harte Regel):** `konst` MUSS `^[A-Z][A-Z0-9_]*$` sein
  (UPPER_SNAKE). **`fn`, `datensatz`, `aufzählung` und Aufzählungswerte
  MÜSSEN mit Großbuchstaben beginnen** (UpperCamelCase, führendes `_`
  erlaubt) — `fn freibetrag` ist ein Fehler, `fn Freibetrag` korrekt. Nur
  `var`/Parameter/Felder sind lowerCamelCase.
- **`EuroCent`-Literale: genau zwei Nachkommastellen** — `0,00`,
  `200.000,00`. Ein bares `0` oder `== 0` im EuroCent-Kontext ist ein
  **Fehler**. `Euro`/`Cent` dagegen ganzzahlig, **kein** Komma: `5.000`.
  (Deutsche Notation: `.` = Tausender, `,` = Dezimal.)
- **Rundung ist immer explizit** und eine Methode (`.abrunden()`/
  `.aufrunden()` auf `EuroCent`/`Dezimal`/`Prozent`). Das Ziel kommt aus
  einer **typgebundenen `var`/Annotation am Rundungsort** —
  `var steuer: Euro = (basis * satz).abrunden()`. **Nicht** auf den
  fn-Rückgabetyp durch einen `wähle`/`wenn`-Arm verlassen.
- **Statement-Grenze `)(`** — endet eine Block-Zeile mit `)` und beginnt die
  nächste mit `(`, parst FinDSL eine Aufrufkette `f(...)(...)` → Fehler.
  Block-Ergebnis nie mit `(` beginnen lassen; an `var` binden und als
  blanken Identifier (oder `Name(...)`-Konstruktor) zurückgeben.

---

## Verifizieren (Pflicht)

Mit dem installierten **`findsl`-CLI**:

```bash
# 1. Modul + Test müssen DIAGNOSEFREI parsen (Verzeichnis = beide Dateien):
findsl parse <verzeichnis-oder-datei>
# 2. Alle prüfe-Fälle grün:
findsl test <name>.test.findsl
```

`findsl parse|test` akzeptieren eine Datei, ein Verzeichnis (rekursiv) oder
ein gequotetes Glob (`'**/*.test.findsl'`).

**Erfolgskriterien:** `parse` meldet *„keine Diagnosen"*; `test` meldet
`N/N bestanden`. Bei Fehlern Sollwerte gegen die Regel nachrechnen — **nie
den Test passend biegen**. `hint`s (z. B. ungenutzte Importe) vorher
beseitigen. Die `@Quelle`-**Warnung** für gesetzlose Konstanten (Pfad A)
ist erwartbar und kein Fehler. Die benigne Meldung `Ambiguous Alternatives
Detected … <Program>` ist **kein** Fehler.

---

## Referenzen in diesem Skill

| Datei | Inhalt |
| --- | --- |
| `references/sprache-referenz.md` | Typen, Geld-Arithmetik, Rundung, Fallstrick-Tabelle, Helfer |
| `references/vorlagen.md` | kommentierte Skelette + verifiziertes Mini-Beispiel |
| `references/workflow-alltagssprache.md` | Pfad A — von der Prosa zum Modul |
| `references/workflow-gesetz.md` | Pfad B — vom Gesetzestext zum Modul + Mehrdatei-Schnitt |

Die vollständige Sprachspezifikation (SPEC) und ausgearbeitete
Beispielmodule (KStG/KraftStG/GewStG/EStG) finden sich in der FinDSL-
Dokumentation bzw. im FinDSL-Repository
(`github.com/findsl/findsl`, Verzeichnis `examples/`).
