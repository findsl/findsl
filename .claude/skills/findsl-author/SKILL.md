---
name: findsl-author
description: >-
  Generiert valide FinDSL-Programme (+ prüfe-Tests) aus einer einfachen
  Beschreibung in Alltagssprache ODER aus Gesetzestexten (XML/PDF/Zitat).
  Nutze diesen Skill IMMER, wenn FinDSL-Code geschrieben, geändert oder
  generiert werden soll — also bei „.findsl"-Dateien, „modelliere § … in
  FinDSL", „bau aus diesem Gesetz/Steuerregel ein FinDSL-Modul", „schreib
  eine FinDSL-Funktion/-Konstante/-Datensatz", „FinDSL-Tests dazu", oder
  wenn aus einer formlosen Steuer-/Berechnungsregel FinDSL entstehen soll.
  Auch wenn der Begriff „FinDSL" nicht fällt, aber eine Steuer-/Rechen-
  vorschrift in dieses Repo als ausführbare, auditierbare Regel soll.
---

# FinDSL Author

FinDSL ist eine deutschsprachige DSL für **auditierbare Steuerrechen-
vorschriften**. Dieser Skill verwandelt zwei Arten von Eingabe in valides,
getestetes FinDSL:

- **A) Alltagssprache** — eine formlose Beschreibung („Die Steuer ist 15 %
  des Einkommens, mindestens aber 0; ein Freibetrag von 5.000 € wird vorher
  abgezogen, höchstens bis zur Höhe des Einkommens.").
- **B) Gesetzestext** — ein Paragraph, ein Gesetz-XML/PDF, ein §-Zitat.

Beide Pfade münden in dieselbe Architektur und dieselben Tests.

## Goldene Regel

**Absolut richtige Berechnung im modellierten Umfang.** Die vorgeschriebene
Arithmetik wird vollständig und exakt umgesetzt; alles außerhalb der reinen
Betragsberechnung (Bemessungsbasis aus anderem Recht, behördliche
Einstufungen, Verfahren) geht als **geprüfte Eingabe** ein und wird im
Datei-Doc-Block **explizit als nicht modelliert** dokumentiert. **Niemals
raten, niemals stillschweigend vereinfachen** — im Zweifel die offene Frage
benennen, nicht eine Annahme verstecken.

## Niemals ändern

Dies ist **reine Beispiel-/Modellierarbeit**. Das Grammatik-Duo
(`SPEC.md`, `packages/core/src/language/findsl.langium`), Interpreter und
Validator bleiben **unangetastet**. Kann die Sprache etwas nicht, wird der
Umfang dokumentiert eingeschränkt — nicht die Sprache erweitert.

---

## Vorgehen (beide Pfade)

Arbeite in fünf Phasen. Lies die zwei Pflicht-Referenzen, **bevor** du Code
schreibst:

1. **`references/sprache-referenz.md`** — Typen, Geld-Arithmetik, Syntax und
   die empirisch erkämpften Fallstricke. Das ist der wichtigste Guardrail:
   die meisten Fehler entstehen an Geld-Literalen, `konst`-Namen, Rundung
   und Statement-Grenzen. **Immer zuerst lesen.**
2. **`references/vorlagen.md`** — kommentierte Skelette (konst · aufzählung ·
   datensatz · fn · wähle · Orchestrator · Testdatei) plus ein vollständiges
   Mini-Beispiel. Kopiere die Muster, statt frei zu erfinden.

### Pfad-Entscheidung

| Eingabe | Pfad | Zusätzliche Referenz |
| --- | --- | --- |
| Formlose Regel, Prosa, „rechne X aus Y" | **A — Alltagssprache** | `references/workflow-alltagssprache.md` |
| § / Gesetz-XML/PDF / juristisches Zitat | **B — Gesetzestext** | **`GESETZ-ZU-FINDSL.md`** (Repo-Wurzel, autoritativ) |

Bei B ist **`GESETZ-ZU-FINDSL.md`** die vollständige, verbindliche
Arbeitsanweisung (XML-Extraktion, §-Zitierform für `@Quelle`, Mehrdatei-
Schnitt, Verifikation). Lies sie **ganz**, bevor du ein Gesetz umsetzt;
dieser Skill ergänzt sie nur um die Sprach-Guardrails und die Vorlagen.

### Phasen

0. **Verstehen & trennen.** Sammle die Regel vollständig. Ordne jeden
   Inhalt zu: **Rechenvorschrift** (→ exakt implementieren als `konst`/`fn`)
   vs. **geprüfte Eingabe** (Bemessungsbasis, Einstufung → Datensatz-Feld/
   Enum) vs. **nicht modelliert** (Verfahren, Fristen → im Doc benennen).
   Bei A: fehlt eine Zahl/Schwelle/Reihenfolge, **frag nach** statt zu raten.
1. **Architektur** — gesetzliche/logische Reihenfolge 1:1 als Funktionskette
   (siehe Bausteine unten). Bei Größe/mehreren Bereichen auf **mehrere
   kohäsive Dateien** aufteilen (Kriterien in `GESETZ-ZU-FINDSL.md` § 2.1).
2. **`<slug>.findsl` schreiben** — führender Datei-Doc-Block (Pflicht!),
   dann Konstanten/Typen/Stufen-Funktionen/Orchestrator, jede Decl mit
   eigenem `--…--`-Doc + (norm-gebunden) `@Quelle`.
3. **`<slug>.test.findsl` schreiben** — nur `verwende` + `prüfe`-Blöcke;
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
   Aus den Referenzmodulen übernehmen, nicht neu erfinden. Helfer ohne
   Norm-Anker dürfen `@Quelle` weglassen und ein führendes `_` tragen
   (modul-intern, SPEC § 8.4).
7. **Orchestrator** `Berechne<X>(fall): <X>Ergebnis = { … }` — ruft die
   Stufen in Reihenfolge, füllt das Ergebnis, schließt nicht abgedeckte
   Konstellationen per `abbruch("…")` aus.

---

## Kritische Sprach-Guardrails (immer beachten)

Diese vier verursachen die meisten Fehler — Details + alle weiteren in
`references/sprache-referenz.md`:

- **Namen (harte Regel, SPEC § 2.5):** `konst` MUSS `^[A-Z][A-Z0-9_]*$`
  sein (UPPER_SNAKE). **`fn`, `datensatz`, `aufzählung` und Aufzählungs-
  werte MÜSSEN mit Großbuchstaben beginnen** (UpperCamelCase, führendes `_`
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
  fn-Rückgabetyp durch einen `wähle`/`wenn`-Arm verlassen (rundet dort
  nicht zuverlässig). Details: `references/sprache-referenz.md` § 4.
- **Statement-Grenze `)(`** — endet eine Block-Zeile mit `)` und beginnt die
  nächste mit `(`, parst der Parser eine Aufrufkette `f(...)(...)` → Fehler.
  Block-Ergebnis nie mit `(` beginnen lassen; an `var` binden und als
  blanken Identifier (oder `Name(...)`-Konstruktor) zurückgeben.

---

## Verifizieren (Pflicht)

Alles **vom Repo-Root** (npm-Workspaces). Beispielarbeit braucht **kein**
`langium:generate`/`build`/`bundle` (Grammatik unverändert); nur falls
`packages/*/out/` veraltet ist, einmal `npm run build`.

```bash
# 1. Modul + Test müssen DIAGNOSEFREI parsen (Verzeichnis = beides):
node packages/cli/out/main.js parse examples/<slug>
# 2. Alle prüfe-Fälle grün:
node packages/cli/out/main.js test examples/<slug>/<slug>.test.findsl
# 3. Keine Regression über alle Beispiele:
node packages/cli/out/main.js test 'examples/**/*.test.findsl'
```

**Erfolgskriterien:** `parse` meldet *„keine Diagnosen"* (auch keine
`hint`s wie ungenutzte Importe), `test` meldet `N/N bestanden`. Bei Fehlern
Sollwerte gegen die Regel nachrechnen — **nie den Test passend biegen**.
Die benigne Meldung `Ambiguous Alternatives Detected … <Program>` ist
**kein** Fehler.

---

## Referenz-Module (Vorlagen im Repo)

Bei Unsicherheit über ein Idiom: **erst** das nächstliegende Referenzmodul
ansehen, dessen Muster exakt übernehmen, **dann** schreiben.

| Modul | Lehrwert |
| --- | --- |
| `examples/kst/` | **Klein & klar — bester Startpunkt.** Staffel-Satz (`wähle`), Freibetrag mit Höchstgrenze, Ausschluss-Enum, gesetzliche Rundung, sauberer Orchestrator. |
| `examples/kraftst/` | **Groß, progressiv, mehrdateilich.** Abgeleitete Kumulativ-Konstanten, „je angefangene Einheit", Caps, Modul-Dekomposition (`…-typen ← …-tarif-* ← <slug>`). |
| `examples/gewst/` | **Verrechnungslogik.** Gewichtete Summe + Freibetrag, Höchstbetrag aus Maximum zweier Sätze, Mindestbesteuerung, Stichjahr-`abbruch`. |
| `examples/est/` | **Mehr-entitätige Rechenvorschriften.** `Liste<Kind>`/`zuordnen`/`summe`, staffelweise Belastung, Fünf-Zonen-Tarif. |

Vollständige Sprachreferenz: **`SPEC.md`** (Repo-Wurzel). Projektkontext:
**`CLAUDE.md`**.
