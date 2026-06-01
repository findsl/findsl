# FinDSL

Eine domänenspezifische Sprache für die deutsche steuerliche Finanzverwaltung.

## Idee

FinDSL ist eine **funktionale, getypte DSL**, mit der Fachabteilungen und
erfahrene Sachbearbeiter:innen steuerliche Berechnungen (Lohnsteuer, ESt-Tarif,
Solidaritätszuschlag, Vorsorgepauschale …) deklarativ beschreiben können.

Die Sprache ersetzt mittelfristig die handgepflegten **Programmablaufpläne
(PAPs)** des BMF: aus FinDSL-Quelle wird

- ein **Interpreter-Lauf** für sofortiges Probieren in der Fachabteilung,
- **Zielsprachencode** in Java, TypeScript und JavaScript für den produktiven
  Einsatz,
- generierte **Dokumentation** (PDF, HTML, Bundessteuerblatt-ähnliches Layout)
  aus den eingebetteten Markdown-Doc-Kommentaren,
- ein **DIN-66001-Diagramm**, das einem klassischen PAP optisch entspricht
  (Best-Effort-Export, in Roadmap).

## Designprinzipien (Auswahl)

Vollständige Diskussion in [`SPEC.md`](SPEC.md), Kapitel 1.3.

1. **Lesbarkeit vor Knappheit.** Sachbearbeiter:innen ohne Programmier-
   hintergrund müssen Regeln lesen können. Deutsche Schlüsselwörter,
   ausgeschriebene Konstrukte.
2. **Reine Funktionen, kein globaler Zustand.** Eingaben als Parameter,
   Ausgaben als Rückgabewerte. Keine Mutation, keine Seiteneffekte.
3. **Einheiten und Präzision im Typsystem.** `Euro`, `Cent`, `EuroCent`,
   `Prozent` sind verschiedene Typen. Rundung ist explizit über
   Methoden (`betrag.abrunden()`, `wert.aufrunden()`; Ziel aus dem
   Kontext, SPEC § 11.1).
4. **Gesetzliche Quelle als Pflicht-Annotation.** Jede Konstante und jede
   normgebundene Regel trägt `@Quelle("§ ...")`.
5. **Veranlagungsjahr im Datei-/Pfadnamen.** Jahres-spezifische Regeln
   liegen in jahresgebundenen Dateien/Pfaden (z. B. `…/tarif2025.findsl`).
6. **Markdown-Doc-Kommentare als Pflicht.** Generierbar zu PDF/HTML,
   maschinenlesbar für KI-Agenten.
7. **Transparenz vor Privatheit.** Alle Deklarationen sind öffentlich.

## Repository-Struktur

```
SPEC.md                    Sprachspezifikation v1.0 (autoritative Referenz,
                           inkl. kanonischer EBNF in Anhang A)
examples/
  kst/        KStG — Körperschaftsteuer (.findsl + .test + Doku-Kopf + XML)
  kraftst/    KraftStG — Kfz-Steuer (mehrdateilig: typen/tarif-*/steuer)
  gewst/      GewStG — Gewerbesteuer (.findsl + .test + Doku-Kopf + XML)
  est/        EStG — derzeit nur Gesetzesquelle (estg.xml)
package.json               npm-Workspace-Wurzel (privat)
tsconfig.json              TypeScript-Solution (project references)
LICENSE · NOTICE           EUPL-1.2 + Dual-Lizenz-Hinweis
packages/
  core/                    @findsl/core — Sprachkern
    src/language/findsl.langium    Langium-Grammatik (impl.-spezifisch)
    src/language/          Validator, Type-Checker, LSP-Provider, Stdlib
    src/interpret/         Tree-Walking-Interpreter
    src/docgen/            Doku-Generator (md/html/pdf)
    src/codegen/           Codegen: lower→ir→emit→emit-{java,ts,js}
    src/papgen/            PAP-Generator (model/mermaid/html)
    langium-config.json · syntaxes/ · test/
  lsp/   src/main.ts        @findsl/lsp — LSP-Server-Entry
  cli/   src/main.ts        @findsl/cli — CLI-Werkzeug (bin `findsl`)
  web/                     @findsl/web — Browser-Bundle (LSP-Worker + API)
  editor/                  @findsl/editor — einbettbarer Monaco-Editor
  editor-react/            @findsl/editor-react — React-<FindslEditor>
apps/
  vscode/                  VS-Code-Extension (Manifest + Activation)
  intellij/                JetBrains-Plugin (Kotlin/Gradle, via LSP4IJ)
runtimes/
  java/                    Java-Laufzeit (Gradle) — Codegen-Output
  ts/                      TypeScript-Laufzeit — Quelle für emit-ts/js
```

## Implementierungs-Status

- **Sprachgestaltung:** v1.0 abgeschlossen, dokumentiert in `SPEC.md`.
- **Grammatik:** EBNF kanonisch in `SPEC.md` Anhang A, ausführbare
  Langium-Grammatik in `packages/core/src/language/findsl.langium`.
- **TypeScript/Langium-Implementation:** npm-Monorepo mit Workspace-
  Wurzel im Repo-Top-Level (`packages/core` Sprachkern, `packages/lsp`
  LSP-Server, `packages/cli` CLI, `apps/vscode` VS-Code-Extension,
  `apps/intellij` JetBrains-Plugin). Build/Test vom Repo-Root
  (`npm install && npm run build && npm test`).
- **Self-contained CLI:** `npm run bundle` → ein eigenständiges
  `packages/cli/dist/findsl.cjs` (+ `data/`); `npm run binary` → ein
  **natives, Node-freies** `findsl`-Binary (Node-SEA, Host-Plattform).
  Öffentliches Publishing (`.vsix`/Open VSX/npm) ist offen (Phase 6b,
  Publisher-Entscheidung).

## Editoren & Installation

Sprachunterstützung (Highlighting, Completion, Hover, Diagnostics,
`prüfe`-CodeLens, Doku-Generierung) gibt es für **zwei Editoren** — beide über
**denselben** LSP-Server, ohne zweiten Sprachkern. Marktplatz-Veröffentlichungen
sind noch offen; bis dahin Installation aus dem Quellcode (Repo-Root einmalig
`npm install`).

**VS Code / VSCodium** (`apps/vscode`)

```bash
npm run bundle            # Extension-Bundle bauen (apps/vscode/out/…)
```

Die Extension aus `apps/vscode` im Extension-Entwicklungshost starten (VS Code:
„Run Extension") oder als `.vsix` paketieren und installieren.

**JetBrains-IDEs** (IntelliJ IDEA Community & Ultimate u. a.; `apps/intellij`)

Plugin in Kotlin/Gradle, bindet via [LSP4IJ](https://github.com/redhat-developer/lsp4ij)
denselben LSP-Server ein (Ziel: IntelliJ IDEA Community 2024.2+). **Die
JetBrains-Marketplace-Veröffentlichung ist in Vorbereitung** — bis dahin aus dem
Quellcode:

```bash
npm run binary:lsp                        # natives LSP-Server-Binary bauen
cd apps/intellij && ./gradlew buildPlugin # Plugin-ZIP → build/distributions/
```

Das ZIP in der IDE über **Einstellungen → Plugins → ⚙ → Plugin von Datenträger
installieren…** laden. Sandbox-Start (`runIde`) und Details:
[`apps/intellij/README.md`](apps/intellij/README.md).

## Beispieldatei

Eine vollständige, eigenständige `.findsl`-Datei. Sie zeigt die
Kernideen auf engem Raum: deutsche Schlüsselwörter, getypte Geldwerte
mit explizit erzwungener Rundung, gesetzliche Quelle als Pflicht-
Annotation, und Akzeptanztests im selben Sprachkern.

```
--
# Solidaritätszuschlag 2025 — Nullzone (§§ 3, 4 SolzG)

Eigenständige Beispieldatei: sie wird über ihren Pfad identifiziert;
der erste `--…--`-Block ist die Datei-Doku. Zahlen folgen deutscher
Notation (`.` Tausender, `,` Dezimal).

Modelliert ist die **Nullzone** für Einzelveranlagung (VZ 2025): bis
zur Freigrenze fällt kein Zuschlag an. Die Milderungszone (§ 4 Satz 2
SolzG) ist hier bewusst *nicht* modelliert.
--

-- Zuschlagssatz auf die festgesetzte Einkommensteuer. --
@Quelle("§ 4 Satz 1 SolzG 1995")
konst SOLI_SATZ: Prozent = 5,5%

-- Freigrenze: bis einschließlich hier kein Zuschlag (Einzelveranlagung). --
@Quelle("§ 3 Absatz 3 SolzG 1995")
konst FREIGRENZE: Euro = 19.950

--
Solidaritätszuschlag auf die festgesetzte Einkommensteuer.

@param est festgesetzte Einkommensteuer (ganzzahliger Euro-Betrag)
@rückgabe  der Solidaritätszuschlag in Euro (abgerundet)
--
@Quelle("§ 3 Absatz 1, § 4 SolzG 1995")
fn Solidaritaetszuschlag(est: Euro): Euro = wähle {
    falls est < FREIGRENZE + 1 -> 0
    sonst                      -> (SOLI_SATZ * est).abrunden()
}

prüfe "§§ 3, 4 SolzG — Nullzone & Satz" {
    testfall "in der Nullzone → kein Zuschlag" {
        Solidaritaetszuschlag(19.950) == 0
    }
    testfall "über der Freigrenze → 5,5 %" {
        Solidaritaetszuschlag(30.000) == 1.650
    }
}
```

## Lizenz & kommerzielle Nutzung

FinDSL ist Copyright © 2026 **devtank42 GmbH** und wird unter einem
**Dual-Lizenz-Modell** bereitgestellt:

1. **Open Source — EUPL-1.2.** Frei nutzbar unter der
   [European Union Public Licence v. 1.2](LICENSE). Die EUPL-1.2 ist
   reziprok (Copyleft) und erfasst — anders als GPLv2/v3, näher an der
   AGPL — auch die Bereitstellung als Online-Dienst. Bearbeitungen und
   Weitergaben unterliegen wieder der EUPL-1.2; Quelltext ist offenzulegen
   bzw. zugänglich zu halten.

2. **Kommerzielle Lizenz.** Wer FinDSL **ohne** die Copyleft-Pflichten
   der EUPL-1.2 nutzen, in proprietäre Produkte einbetten oder als SaaS
   anbieten möchte — oder vertragliche Gewährleistung, Haftung, Support
   bzw. ein SLA benötigt — kann eine separate kommerzielle Lizenz
   erwerben. Details: [`LICENSE-COMMERCIAL.md`](LICENSE-COMMERCIAL.md).

Solange keine schriftliche kommerzielle Vereinbarung mit der devtank42
GmbH besteht, gilt ausschließlich die EUPL-1.2. Eingebettete
Gesetzeswortlaute/Berechnungsregeln sind amtliche Werke (§ 5 UrhG) und
gemeinfrei; geschützt sind Sprachdesign, Implementierung und Toolchain.
„FinDSL" und „devtank42" sind Kennzeichen der devtank42 GmbH.

**Beiträge** erfordern ein Contributor License Agreement, damit das
Dual-Modell tragfähig bleibt — siehe [`CONTRIBUTING.md`](CONTRIBUTING.md)
und [`CLA.md`](CLA.md).

**Kooperation / kommerzielle Anfragen:** contact@devtank42.de

