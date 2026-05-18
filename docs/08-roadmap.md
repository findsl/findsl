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
aggregiertes MD/HTML/PDF).

### Offen — Kurzfristig (NÄCHSTE TODOs)

**(a) Codegen Java.** AST-Visitor mit Java-Text-Templates: `BigDecimal`
für Geld, `Optional`/`@Nullable` für `T?`, `throw`-Mapping für `abbruch`
(unchecked RuntimeException), Enum-Mapping für Aufzählungen. Pfad:
`findsl-ts/src/codegen/java-target.ts` (neu) + CLI-`uebersetze`.

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

- **Codegen TypeScript + JavaScript** (analog Java-Target).
- **Restliche LSP-Politur**: SelectionRange, Refactoring-CodeActions
  (Konstante extrahieren, Importe organisieren, ungenutzten Import
  entfernen), LinkedEditing.
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

