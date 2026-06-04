# FinDSL

Eine domänenspezifische Sprache für die deutsche steuerliche Finanzverwaltung.

**Hintergründe, Doku und Beispiele: [findsl.org](https://findsl.org).**

## Idee

FinDSL ist eine **funktionale, getypte DSL**, mit der Fachabteilungen und
erfahrene Sachbearbeiter:innen steuerliche Berechnungen (Lohnsteuer, ESt-Tarif,
Solidaritätszuschlag, Vorsorgepauschale …) deklarativ beschreiben. Sie ersetzt
mittelfristig die handgepflegten **Programmablaufpläne (PAPs)** des BMF: aus
einer FinDSL-Quelle entstehen ein Interpreter-Lauf, **Zielsprachencode** (Java,
TypeScript, JavaScript), generierte **Dokumentation** (PDF/HTML) und ein
**DIN-66001-Diagramm**.

Die Designprinzipien (Lesbarkeit vor Knappheit, reine Funktionen, Einheiten im
Typsystem, `@Quelle`-Pflicht u. a.) und die vollständige Sprachreferenz stehen in
[`SPEC.md`](SPEC.md) — Kapitel 1.3 bzw. Anhang A (kanonische EBNF).

## Editoren & Installation

Sprachunterstützung (Highlighting, Completion, Hover, Diagnostics,
`prüfe`-CodeLens, Doku-Generierung) gibt es für **zwei Editoren** über
**denselben** LSP-Server. Bis zur Marktplatz-Veröffentlichung aus dem Quellcode
(Repo-Root einmalig `npm install`):

**VS Code / VSCodium** (`apps/vscode`)

```bash
npm run bundle   # Extension-Bundle bauen, dann im Extension-Host starten
```

**JetBrains-IDEs** (`apps/intellij`, via [LSP4IJ](https://github.com/redhat-developer/lsp4ij))

```bash
npm run binary:lsp                         # natives LSP-Server-Binary
cd apps/intellij && ./gradlew buildPlugin  # Plugin-ZIP → build/distributions/
```

Details zum JetBrains-Plugin: [`apps/intellij/README.md`](apps/intellij/README.md).

## Build & Beispiele

```bash
npm install && npm run build && npm test   # vom Repo-Root
npm run bundle                             # eigenständige CLI (findsl.cjs)
npm run binary                             # natives, Node-freies findsl-Binary
```

Vollständige Beispielmodule (Quelle + Tests + Doku) unter
[`examples/`](examples) (`kst`, `kraftst`, `gewst`, `est`). Aufbau des
Monorepos: [`docs/02-repository-struktur.md`](docs/02-repository-struktur.md).

## Lizenz & kommerzielle Nutzung

Copyright © 2026 **devtank42 GmbH**, bereitgestellt unter einem **Dual-Lizenz-Modell**:

- **Open Source — [EUPL-1.2](LICENSE)** (reziprok/Copyleft; erfasst — näher an der
  AGPL — auch die Bereitstellung als Online-Dienst).
- **Kommerzielle Lizenz** ohne Copyleft-Pflichten, mit Gewährleistung/Support/SLA:
  [`LICENSE-COMMERCIAL.md`](LICENSE-COMMERCIAL.md).

Solange keine schriftliche kommerzielle Vereinbarung besteht, gilt ausschließlich
die EUPL-1.2. Eingebettete Gesetzeswortlaute/Berechnungsregeln sind amtliche Werke
(§ 5 UrhG) und gemeinfrei; geschützt sind Sprachdesign, Implementierung und
Toolchain. Beiträge erfordern ein CLA — siehe [`CONTRIBUTING.md`](CONTRIBUTING.md)
und [`CLA.md`](CLA.md).

**Kooperation / kommerzielle Anfragen:** contact@devtank42.de

<!-- Umami Tracking -->
![](https://analytics.devtank42.de/p/TS7EtYYoW)
