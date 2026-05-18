# findsl-runtime (Java)

Invariante Java-Laufzeitsemantik für den FinDSL→Java-Codegen (Issue #7,
ADR2). **Kein** generierter Code — die hier liegende Bibliothek ist ein
verifizierter 1:1-Port der sprachinvarianten Interpreter-Helfer; der
generierte Java-Code (konst/fn/datensatz/aufzählung/prüfe) hängt von ihr ab.

## Warum eine Bibliothek?

Sie ist für Java das, was `decimal.js` + die Helfer-Schicht des
Interpreters für TypeScript sind. Inline-Kopie pro Modul wäre nicht
auditierbar (die bit-genaue Geldarithmetik müsste in jeder generierten
Datei neu geprüft werden), nicht DRY (eine Semantik-Korrektur =
alle Module neu generieren) und bräche Cross-Modul-Typidentität
(`FinDslAbort`/`FinDslNumber` müssen *ein* geteilter Typ sein, damit
`assertThrows`/Vergleiche über Modulgrenzen tragen). Vollständige
Begründung: `docs/`/Issue #7-Plan.

## Inhalt (Phase 0)

- `FinDslNumber` (Java `record`) — Euro-kanonisches Zahlmodell, **ein**
  Typ für alle sechs `FinDslNumber.Type`s. Bit-genau zum Interpreter
  (`interpret/values.ts` + `interpreter.ts`): `+ - *`/Negation exakt;
  **jede Division** mit `MathContext(20, HALF_UP)` = `decimal.js`-Default
  (Gate 0); Java-Package `org.findsl.runtime` (generierter Code:
  `org.findsl.generated`, Phase-3-pfad-deterministisch). Englische
  Typbezeichner; FinDSL-Oberflächen-Identifier (Factories `euro/cent/…`,
  Stdlib `abrunden/aufrunden`) bewusst verbatim (1:1-Lowering, Audit).
  `combineAddSub/Mul/Div`, `castNumeric`, `applyMoneyAnnotation`,
  Skalar-Rundung (`abrunden`=FLOOR/`aufrunden`=CEILING), deutsche
  Darstellung.
- `FinDslNumber.Type` (= Interpreter `values.ts`) · `FinDslAbort` (unchecked) ·
  `FinDslRuntimeError` (unchecked, = Orakel-`error`) · `Output`
  (injizierbare `ausgabe`-Senke).

Listen-/Text-Methoden, `Bereich`, `germanFormat`-Ausbau folgen in Phase 2.

## Bauen & Testen

JDK 21 (Toolchain, kein Auto-Download — siehe `gradle.properties`).
Gradle via gepinntem Wrapper (v9.5.1, SHA-256-fixiert):

```bash
./gradlew test          # JUnit-5-Suite (Bit-Genauigkeits-Gate)
```

Aus dem Repo-Root als Differential-Gate (ADR10; überspringt sauber ohne JDK):

```bash
npm run codegen:difftest
```

Lizenz: EUPL-1.2 OR kommerziell (© devtank42 GmbH) — wie das Hauptprojekt.
