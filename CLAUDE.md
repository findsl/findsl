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

**Grammatik-Trias — bei JEDER Sprachänderung alle drei synchron pflegen:**

1. `SPEC.md` — autoritative Sprachreferenz (Kapitel + Anhang A EBNF)
2. `grammar/findsl.ebnf` — eigenständige Grammatik-Datei (für Tooling)
3. `packages/core/src/language/findsl.langium` — ausführbare Langium-Grammatik

Danach Pflicht-Roundtrip:
`npm run langium:generate && npm run build && npm run bundle && npm test`
(inkl. Bundle-Smoke). Sonst läuft im Editor ein veralteter Server.

**Aufgabe „aus Gesetz X ein FinDSL-Modul + Tests generieren"?** Zuerst und
verbindlich [`GESETZ-ZU-FINDSL.md`](GESETZ-ZU-FINDSL.md) lesen (schrittweise
Arbeitsanweisung). Vorlagen: `examples/kst/` (klein), `examples/kraftst/`
(groß, Modul-Dekomposition), `examples/gewst/` (Verrechnungslogik).

**Teststand (Stand 2026-05-17, verifiziert):** 778 Tests grün, 54 Dateien,
Bundle-Smoke 4/4. Beispielmodule: `kst` · `kraftst` · `gewst` · `est`.

---

## Regel-Dateien (`docs/`)

| Datei | Inhalt |
|-------|--------|
| [docs/01-projekt-mission.md](docs/01-projekt-mission.md) | § 1 — Mission, Zielgruppe, erzeugte Artefakte |
| [docs/02-repository-struktur.md](docs/02-repository-struktur.md) | § 2 — Monorepo-Layout, Modul-Graph, Grammatik-Trias |
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
