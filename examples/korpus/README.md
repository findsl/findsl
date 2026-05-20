# `examples/korpus/` — Sprach-Konstrukt-Referenzkorpus

Aufgabe: das `examples/korpus/`-Verzeichnis ist das **Referenzkorpus
für SPEC-Konstrukte** (Issue #43). Jede Datei deckt einen kohärenten
Cluster aus der Sprachspezifikation ab, jede `korpus-X.findsl` hat
eine begleitende `korpus-X.test.findsl`. Wer eine neue Sprach-Demo
einbauen will, legt einen neuen Cluster nach demselben Schema an.

## Aktuelle Cluster

| Datei | SPEC-Abdeckung |
|---|---|
| `korpus-typen.findsl` | § 2.7 Literale (Ganzzahl mit Tausenderpunkten, Dezimal, Geld, Prozent, Wahrheitswert, Text einzeilig+triple-quoted, `nichts`), § 3 alle Skalar-/Container-Typen, § 3.7 Aufzählung, § 3.8 Datensatz (inkl. Default + Nullable-Default), § 4.16 Bereich (inkl./exkl./schritt), § 6.1 `konst`, § 7.1 `@Quelle` |
| `korpus-ausdruecke.findsl` | komplette SPEC § 4 (§ 4.2-§ 4.19): Arithmetik, Vergleich, Logik (`und`/`oder`/`nicht`), Elvis-`oder`, Sicher-Zugriff (`?.`), Force-Unwrap (`!!`), `als`-Cast, Wenn-Sonst, Wähle (Guards + Subjekt), Funktionsaufruf (positional/benannt/String-Interpolation/Default-Param), Lambda im HOF-Method-Kontext, Feldzugriff, Datensatz-/Listen-/Bereich-Konstruktor, Block-Ausdruck, Abbruch (`never`) |
| `korpus-funktionen.findsl` | § 6.2 `fn` Block-/Expression-Body + Default-Param + Closures, § 3.12 Funktionstyp als Rückgabe, § 8.4 `_`-Sichtbarkeit, § 3.13 bidirektionale Inferenz |
| `korpus-stdlib.findsl` | § 11.1 Rundungs-Methoden (EuroCent → Euro/Cent, Dezimal → Ganzzahl, Prozent → Prozent), § 11.2 alle 12 Listen-Methoden, § 11.5 Text-`+`-Konkatenation |
| `korpus-schleifen.findsl` | § 5.3 `für jeden` / `für jede` über Liste + Bereich + geschachtelt + Block-Lambda-Body, § 5.4 `ausgabe`-Anweisung als Seiteneffekt im Block |
| `korpus-*.test.findsl` | § 10 `prüfe` / `testfall` — inkl. `erwartet abbruch` (§ 10.2 + § 4.19) |

Cross-Modul-`verwende` (§ 8.3) ist mehrfach gegeben: `korpus-ausdruecke`
und `korpus-funktionen` importieren beide aus `korpus-typen`; jede
`*.test.findsl` importiert aus ihrer Quell-Datei. Die `prüfe`-Suite
deckt jeden zugesagten Konstrukt-Cluster mit mindestens einem
Behavior-Test ab.

## Abdeckungsstatus

Nach dem Abschluss von [Issue #44](https://github.com/findsl/findsl/issues/44)
(alle 14 Codegen-Lücken + Folge-Lücken gefixt, 17 PRs) deckt der Korpus
die volle SPEC § 2–§ 11-Breite ab, soweit der Java-Codegen sie
unterstützt. Im Codegen offen sind aktuell nur die § 11.5-Text-Methoden
jenseits von `+` (`.alsGroßbuchstaben`/`.alsKleinbuchstaben`,
`.beginntMit`/`.endetMit`/`.enthält(teil)`, `.geteiltAn`,
`.einrückungEntfernen`) — Folge-PR.

## Workflow

```bash
# Alle prüfe-Items über den Interpreter:
node packages/cli/out/main.js test examples/korpus/

# Java-Codegen + Bit-genauer Differential-Test (= Gradle-Gate):
cd runtimes/java && ./gradlew check

# Vitest-Integrationstest (Parse + Validation + Cross-Modul + Determinismus):
npx vitest run packages/core/test/integration/korpus.test.ts
```

## Erweiterung

1. Neue Datei `korpus-<thema>.findsl` anlegen (kebab-case-Cluster-Name).
2. Begleit-Datei `korpus-<thema>.test.findsl` mit `prüfe`-Block.
3. `npm run build` (CLI), dann `cd runtimes/java && ./gradlew check`.
4. Der Vitest-Integrationstest (`korpus.test.ts`) iteriert dynamisch
   via `readdirSync` — neue Datei wird automatisch mitgeprüft.
