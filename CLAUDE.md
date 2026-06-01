# FinDSL — Projektkontext für Claude Code (Index)

> **Zweck:** Einstiegspunkt für Claude Code. Der ausführliche Projektkontext
> wurde in thematische Regel-Dateien unter [`docs/`](docs/) aufgeteilt. Diese
> Datei ist der **Index/Router** — beim Start lesen, dann gezielt die
> relevante `docs/`-Datei öffnen. Inhalt der `docs/`-Dateien ist die
> autoritative, ungekürzte Fassung der früheren monolithischen `CLAUDE.md`.

---

## ⚠ Sofort wissen (gilt immer, ohne Nachschlagen)

**Repository = npm-Monorepo, Wurzel = Repo-Top-Level. `findsl-ts/` gibt es
nicht mehr.** Pfad-Mapping für Altverweise (Doku/Code/Commits):

- `findsl-ts/src/language/*` → `packages/core/src/language/*`
- `findsl-ts/src/interpret/*` → `packages/core/src/interpret/*`
- `findsl-ts/src/docs/*` → `packages/core/src/docgen/*` (umbenannt)
- `findsl-ts/src/codegen/*` → `packages/core/src/codegen/*`
- `findsl-ts/src/language/main.ts` → `packages/lsp/src/main.ts`
- `findsl-ts/src/cli/*` → `packages/cli/src/*`
- `findsl-ts/src/extension/*` → `apps/vscode/src/*`
- `findsl-ts/test/*` → `packages/core/test/*`

Build/Run **immer vom Repo-Root** (npm-Workspaces), kein `cd findsl-ts`.

**Zwei Editoren, ein Sprachkern.** Neben `apps/vscode` (VS Code) gibt es
`apps/intellij` (JetBrains-Plugin, Kotlin/Gradle via LSP4IJ) — beide nutzen
**denselben** LSP-Server (`packages/lsp`), kein zweiter Sprachkern. VS Code
bündelt das `.cjs`; IntelliJ startet das **native `findsl-lsp`-SEA-Binary**
(`npm run binary:lsp` bzw. `npm run all` — `npm run bundle` allein baut es
NICHT). Details + Editor-Matrix: [docs/02-repository-struktur.md](docs/02-repository-struktur.md).

**Grammatik-Duo — bei JEDER Sprachänderung beide synchron pflegen:**

1. `SPEC.md` — autoritative Sprachreferenz (Kapitel + Anhang A EBNF)
2. `packages/core/src/language/findsl.langium` — ausführbare Langium-Grammatik

Maschinell abgesichert: `packages/core/test/grammar-spec-coupling.test.ts`
prüft, dass jedes Keyword-Literal aus `findsl.langium` in `SPEC.md` vorkommt
(fängt „Keyword zur Grammatik hinzu, SPEC vergessen" ab). Die früher separate
`grammar/findsl.ebnf` wurde entfernt (Issue #205): sie war eine nicht
eingekoppelte, bereits divergierte Zweitkopie von SPEC Anhang A.

Danach Pflicht-Roundtrip:
`npm run langium:generate && npm run build && npm run bundle && npm test`
(inkl. Bundle-Smoke). Sonst läuft im Editor ein veralteter Server.

**Aufgabe „aus Gesetz X (oder aus Alltagssprache) ein FinDSL-Modul + Tests
generieren"?** Das ausgelieferte Skill
[`skills/findsl-author/`](skills/findsl-author/SKILL.md) ist die
verbindliche Arbeitsanweisung (Sprache, Architektur, Fallstricke, Tests).
Die **Repo-Konventionen** für ein Beispielmodul im `examples/`-Baum
(Gesetzesquelle, Ablage, `@Quelle`-Slug, Verifikation, Buchführung) stehen
in [`CONTRIBUTING.md`](CONTRIBUTING.md) → „Beispielmodul aus einem Gesetz
beitragen". Vorlagen: `examples/kst/` (klein), `examples/kraftst/` (groß,
Modul-Dekomposition), `examples/gewst/` (Verrechnungslogik).

**Teststand (Stand 2026-05-18, verifiziert):** 836 Tests grün, 56 Dateien,
Bundle-Smoke 4/4, Aggregat 122/122. Beispielmodule: `kst` · `kraftst` ·
`gewst` · `est`. **§ 11-Stdlib = Empfänger-Methoden** (`.abrunden()`/
`.aufrunden()` kontextgetrieben, § 11.5-Text-Methoden); freie Rundungs-
funktionen entfernt; Postfix-Kette auf `( … )` (`ParenChain`). Details:
[docs/changelog.md](docs/changelog.md) (2026-05-18).

---

## Regel-Dateien (`docs/`)

| Datei | Inhalt |
|-------|--------|
| [docs/01-projekt-mission.md](docs/01-projekt-mission.md) | § 1 — Mission, Zielgruppe, erzeugte Artefakte |
| [docs/02-repository-struktur.md](docs/02-repository-struktur.md) | § 2 — Monorepo-Layout, Modul-Graph, Grammatik-Duo |
| [docs/03-tech-stack.md](docs/03-tech-stack.md) | § 3 — TypeScript/Langium/Chevrotain/Vitest, Vorgeschichte |
| [docs/04-sprachdesign.md](docs/04-sprachdesign.md) | § 4.1–4.18 — alle Sprach-Designentscheidungen |
| [docs/05-implementierungs-status.md](docs/05-implementierungs-status.md) | § 5 — Status-Matrix, Grammatik-Hinweise |
| [docs/06-build-test-workflow.md](docs/06-build-test-workflow.md) | § 6 — Build/Test/Bundle/Binary, VS-Code-Test |
| [docs/07-pitfalls-lessons-learned.md](docs/07-pitfalls-lessons-learned.md) | § 7 — Fallstricke (ESM, Teil-Parse, Geldmodell, Formatter …) |
| [docs/08-roadmap.md](docs/08-roadmap.md) | § 8 — Erledigt / offen (Codegen, Stdlib-Diskussion) |
| [docs/09-designprinzipien.md](docs/09-designprinzipien.md) | § 9 — P1–P7 (Konsistenz künftiger Entscheidungen) |
| [docs/10-einstieg-claude-code.md](docs/10-einstieg-claude-code.md) | § 10 — empfohlener Einstieg, Schritt für Schritt |
| [docs/11-code-stil-konventionen.md](docs/11-code-stil-konventionen.md) | § 11 — TS-Stil, harte Namensregeln (SPEC § 2.5) |
| [docs/12-design-diskussionen.md](docs/12-design-diskussionen.md) | § 12 — § 12.1/§ 12.2 (beide entschieden) |
| [docs/changelog.md](docs/changelog.md) | Chronologie / „Letzte Aktualisierung" der Arbeitsstände |

> Die `docs/`-Dateien sind 1:1 verbatim aus der früheren `CLAUDE.md`
> übernommen (nach Zeilenbereich geschnitten, kein Inhalt verloren oder
> umgeschrieben). Bei künftigen Kontext-Updates die jeweils thematisch
> passende `docs/`-Datei pflegen und neue Arbeitsstände vorne in
> [docs/changelog.md](docs/changelog.md) eintragen.
