# `examples/simple/` — Sprach-Konstrukt-Referenzkorpus

Aufgabe: das `examples/simple/`-Verzeichnis ist das **Referenzkorpus
für SPEC-Konstrukte** (Issue #43). Jede Datei deckt einen kohärenten
Cluster aus der Sprachspezifikation ab, jede `simple-X.findsl` hat
eine begleitende `simple-X.test.findsl`. Wer eine neue Sprach-Demo
einbauen will, legt einen neuen Cluster nach demselben Schema an.

## Aktuelle Cluster (PR 1)

| Datei | SPEC-Abdeckung |
|---|---|
| `simple-typen.findsl` | § 2.7 numerische Literale, § 3 Geld-/Zahl-/Prozent-/Aufzählung-/Datensatz-Typen, § 6.1 `konst`, § 7.1 `@Quelle` |
| `simple-ausdruecke.findsl` | § 4.2 Arithmetik, § 4.3 Vergleich, § 4.4 `und`/`nicht`, § 4.10 `wähle` (Guards), § 4.11 Funktionsaufruf, § 4.13/§ 4.14/§ 4.15 Feld-/Datensatz-/Listen-Konstruktor, § 4.17 Block, § 4.19 `abbruch` |
| `simple-funktionen.findsl` | § 6.2 `fn` Block-/Expression-Body + Default-Param, § 8.4 `_`-Sichtbarkeit, § 3.13 bidirektionale Inferenz |
| `simple-*.test.findsl` | § 10 `prüfe` / `testfall` — inkl. `erwartet abbruch` (§ 10.2 + § 4.19) |

Cross-Modul-`verwende` (§ 8.3) ist mehrfach gegeben: `simple-ausdruecke`
und `simple-funktionen` importieren beide aus `simple-typen`; jede
`*.test.findsl` importiert aus ihrer Quell-Datei. Die `prüfe`-Suite
deckt jeden zugesagten Konstrukt-Cluster mit mindestens einem
Behavior-Test ab.

## Codegen-Lücken (Issue #44)

Folgende SPEC-Konstrukte sind aktuell **bewusst** nicht im Korpus, weil
der Java-Codegen sie noch nicht (vollständig) unterstützt — sie würden
den Gradle-`check`-Sweep brechen. Markiert mit `TODO(#44)` an der
jeweiligen Stelle:

- `Range`-Literale (`1 bis 10`, `0 bis unter 10`, `0 bis 20 schritt 5`)
- `NullLiteral` (`nichts`) — auch als Default-Wert (`feld: T? = nichts`)
- `oder` (alle Verwendungen — Boolean-Logik, Elvis-Operator)
- Lambda (auch in Higher-Order-Method-Kontext)
- `wenn`-Ausdruck (§ 4.9)
- `!!` Force-Unwrap, `?.` Sicher-Zugriff
- `als`-Cast (in manchen Kontexten)
- `.enthält()` und andere Listen-Methoden außer `.länge`/`.zuordnen`/`.summe`
- Text-`konst` (z. B. `konst X: Text = "…"` — Codegen-Bug: Text wird als FinDslNumber typisiert)
- String-Interpolation `"${x}"` auf Text-Variablen
- Default-Parameter beim Aufruf (nicht expandiert)
- Cross-Modul-Aufzählungs-Werte in generierten JUnit-Tests

Sobald [Issue #44](https://github.com/findsl/findsl/issues/44) geschlossen
ist, kommen diese Konstrukte zurück in den Korpus (PR-Reihe Phase 2).

## Workflow

```bash
# Alle prüfe-Items über den Interpreter:
node packages/cli/out/main.js test examples/simple/

# Java-Codegen + Bit-genauer Differential-Test (= Gradle-Gate):
cd runtimes/java && ./gradlew check

# Vitest-Integrationstest (Parse + Validation + Cross-Modul + Determinismus):
npx vitest run packages/core/test/integration/simple-corpus.test.ts
```

## Erweiterung

1. Neue Datei `simple-<thema>.findsl` anlegen (kebab-case-Cluster-Name).
2. Begleit-Datei `simple-<thema>.test.findsl` mit `prüfe`-Block.
3. `npm run build` (CLI), dann `cd runtimes/java && ./gradlew check`.
4. Der Vitest-Integrationstest (`simple-corpus.test.ts`) iteriert
   dynamisch via `readdirSync` — neue Datei wird automatisch mitgeprüft.
