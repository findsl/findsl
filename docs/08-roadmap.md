> Teil des FinDSL-Projektkontexts — aus CLAUDE.md aufgeteilt. Gesamtindex: [../CLAUDE.md](../CLAUDE.md)

## 8. Roadmap — was als nächstes ansteht

**Erledigt** (frühere Roadmap-Punkte a–f, plus weit darüber hinaus):
Validator-Härtung, vollständiger Interpreter, CLI `pruefe`, Type-Checker
mit bidirektionaler Inferenz, Modul-Auflöser, `abbruch`/`never`,
Unicode-Identifier, freundliche Lexer-Meldungen, komplette LSP-Provider-
Suite (Hover, Definition, Type-Definition, References, Rename,
Document-Highlight, Folding, DocumentSymbol, Completion, CodeAction,
WorkspaceSymbol, CallHierarchy, SemanticTokens, InlayHints,
SignatureHelp, DocumentLink, Formatter, CodeLens), VS-Code Test-
Controller, `ausgabe(text)`, Bundle-Smoke-CI-Gate, Teil-Parse-
Robustheit; **deutsche Zahl-Notation** (`.`-Tausender, `,`-Dezimal),
**Euro-kanonisches Geldmodell + deutsche Geldformatierung**,
**type-checker-getriebene Inlay-Geld-Symbole** (€/¢, range-stabil),
**`testfall`-Blockform** (`{ … }` statt `:`), **harte
`konst`-UPPER_SNAKE-Regel** (§ 2.5), **DocumentLink Mehrfach-§ /
geteiltes Gesetz**, **Doc-Generator Phase 1** (CLI `doku` →
aggregiertes MD/HTML/PDF), **Codegen Java** (siehe (a) unten).

### Offen — Kurzfristig (NÄCHSTE TODOs)

**(a) ✓ ERLEDIGT 2026-05-19 — Codegen Java (Issue #7).** Architektur
weicht bewusst vom ursprünglichen Plan ab (statt direkter AST→Java-
Text-Templates):
- **IR + Emitter** statt monolithischer Text-Templates:
  `packages/core/src/codegen/{ir,lower,emit,emit-java}/` — sprach-
  neutrale IR, AST-Lowering, gemeinsame Emit-Utilities, Java-Emitter.
- **`findsl-runtime` (Gradle, JDK 21)** unter `runtimes/java/` mit
  `FinDslNumber` als `sealed` Basisklasse + IS-A-Sicht-Subtypen
  (`Euro`/`EuroCent`/`Cent`/`Prozent`/`Ganzzahl`/`Dezimal`) statt rohem
  `BigDecimal` — kein Unboxing-Leak, sprechende öffentliche Signaturen.
- **`abbruch` → Exception** (`FinDslAbbruch` extends RuntimeException);
  Geld bit-genau via `BigDecimal` mit identischer Rundung/Skalierung
  wie der Interpreter (`decimal.js`).
- **Listen/Lambda/Closures/Cross-Modul `verwende`/`ausgabe`** voll-
  ständig; `testfall`/`prüfe` → JUnit-5-Klassen, Interface+Impl je
  Modul (paket-private Impl, `<Name>.newInstance()`-Factory).
- **Phase 4 `var = wähle`** als Statement-Lowering (Switch statt
  verschachtelter Ternäre).
- **Gradle-Codegen-Gate** an `check`: `generateFindslJava` (Node-CLI →
  generated/{,-test}) + `generatedTest` (bit-genaues `prüfe`→JUnit
  gegen `runPruefeDecl`-Orakel) + `structureTest` (JavaParser-Form-
  Invarianten: Interface+Impl-Trennung, sprechende Typen, keine
  `.zahl()`/`_kern`-Leckage, Cross-Modul-Komposition nur via
  `newInstance`).
- **CLI**: `findsl codegen <pfad> -l java [-o <main>] [-t <test>]`;
  deterministische byte-identische Ausgabe.
- **CI**: paralleler `java`-Job in `.github/workflows/ci.yml` (JDK 21
  Temurin + Gradle, Audit-Modus `--no-daemon --no-configuration-cache
  --rerun-tasks`); Bundle-Delegator `scripts/codegen-difftest.mjs`.

PRs: #38, #39 (Phase 4 + Gate + CI), #37 (FinDslNumber sealed/IS-A),
plus Phase-0–3-Commits `733c471`, `05b33e4`, `72ee2fe`, `75b0dfc`,
`988a455`. Folge-Codegen-Targets (TS/JS): **Issue #41**.

**(b) Doc-Generator — ✓ Phase 1 erledigt (2026-05-16).** `src/docs/`:
`model.ts` (aggregiertes `DocModel` über alle `.findsl`), `markdown.ts`
(kanonisch, deterministisch), `html.ts` (markdown-it + Theme,
Single-File), `pdf.ts` (pdfmake, Standard-14-Fonts, Deckblatt/ToC/
Kopf/Seitenzahlen, Anhang aus `collectAbbruchSites()`), `quelle.ts`
(geteilte §-Link-Logik, auch vom DocumentLink-Provider genutzt). CLI
`doku <pfad> [-f md|html|pdf|all] [-o ziel]`. Deps: `markdown-it`,
`pdfmake`. **Phase 2 (optional, offen):** Starlight-Site-Export als
zusätzlicher Modus (kanonisches MD bleibt Quelle).

**(c) ✓ ENTSCHIEDEN & UMGESETZT 2026-05-18 — Stdlib = Empfänger-
Methoden, kontextgetrieben.** Die Grundsatzdiskussion (angefordert
2026-05-16) wurde geführt und vollständig implementiert:
- Built-ins sind **Methoden** (`x.methode()`), nicht freie Funktionen
  — eine einheitliche Dispatch-Architektur (§ 11.2 Liste, § 11.5 Text,
  § 11.1 Skalar-Rundung); freie Rundungsfunktionen **hart entfernt**
  (kein Doppel-Mechanismus, konsistent § 4.10/§ 4.18-Linie).
- `.abrunden()`/`.aufrunden()`: nur `EuroCent` (Ziel `Euro`/`Cent` aus
  dem Kontext) / `Dezimal` (→ `Ganzzahl`); SPEC § 11.1.
- `Text.einrückungEntfernen()` und die weiteren § 11.5-Text-Methoden:
  **implementiert**.
- `.alsText`: als **Property** implementiert (Identität/Default-
  Format); `.alsText(format = …)` bleibt v1.0-offen (eigene
  Designrunde, SPEC § 11.5-Status).
- Grammatik-Trias erweitert: Postfix auf `( Expr )` (`ParenChain`) →
  beliebiger Ausdruck als Methoden-Empfänger.
Details: [changelog.md](changelog.md) (2026-05-18).

**Teilentscheidung 2026-05-17 (Nutzer):** Generische Zahl-Rundung
`aufrunden(Dezimal): Ganzzahl` / `abrunden(Dezimal): Ganzzahl` wurde
**ergänzt** (Politik „Builtins werden ergänzt, sobald reale Beispiele
sie nachfragen" — KraftStG § 9 „je angefangene Einheit"). Single
Source `builtins.json` (Type-Checker/LSP/Highlight) + Interpreter-
`builtins.ts` (`rundung`-Fabrik, `ROUND_CEIL`/`FLOOR` → `Ganzzahl`-
Tag) + SPEC § 11.1. TDD: `test/interpret/stdlib-runden.test.ts`. Die
breitere Methoden-/Syntax-Frage bleibt davon unberührt offen.

### Offen — Mittelfristig

- **Codegen TypeScript + JavaScript** (analog Java-Target — gleiche
  IR/Lowering/Emitter-Architektur aus (a) wiederverwenden). **Issue #41.**
- **Restliche LSP-Politur**: SelectionRange, Refactoring-CodeActions
  (Konstante extrahieren, Importe organisieren, ungenutzten Import
  entfernen). ~~LinkedEditing~~ → **erledigt (#21)**: `textDocument/
  linkedEditingRange` koppelt gleich benannte Vorkommen eines lokalen
  Symbols im selben Dokument; importierte (cross-modul) Symbole bleiben dem
  Rename überlassen.
- **Lokale Gesetzestexte**: das Repo enthält `gesetze/<Gesetz>/*.xml`
  (z. B. `gesetze/KStG/`). DocumentLink/Hover könnten optional auf diese
  lokalen Dateien statt gesetze-im-internet verweisen (offline-/audit-
  tauglich) — derzeit nur Online-Tiefenlink.

### Offen — Langfristig

- DIN-66001-PAP-Diagrammexport (Best-Effort).
- Aufzählungs-Bereiche (`I bis VI`) ausführbar machen (brauchen
  Enum-Ordnungs-Kontext im Interpreter; numerische Bereiche +
  Listen/`für jeden`/Closures/§-11.2-Methoden sind erledigt — s. § 5).
- Optionaler Lexer-Mode für String-Interpolation (Sauberkeit, nicht
  funktional nötig).

---

