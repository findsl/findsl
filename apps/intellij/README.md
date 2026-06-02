# FinDSL — IntelliJ-/JetBrains-Plugin

Sprachunterstützung für [FinDSL](../../README.md) in IntelliJ IDEA (Community +
Ultimate) und allen JetBrains-IDEs. Das Plugin bindet über
[LSP4IJ](https://github.com/redhat-developer/lsp4ij) **denselben** FinDSL-
Language-Server an wie die VS-Code-Erweiterung — es gibt keinen zweiten
Sprachkern. Dieses Modul ist nur die dünne Präsentationsschicht (vgl.
[`apps/vscode`](../vscode)).

Teil von Epic **#237**.

## Voraussetzungen

- **JDK 21** (Temurin o. Ä.)
- Kein globales Gradle/Kotlin nötig — der eingecheckte Gradle-Wrapper (9.5.0)
  und das Kotlin-Plugin bringen alles mit.

## Architektur

| Bestandteil | Zweck |
|---|---|
| `FinDslLanguage` / `FinDslFileType` | `.findsl`-Dateierkennung + IntelliJ-`Language`-Anker |
| `FinDslLanguageServerFactory` | LSP4IJ-Einstieg: startet das native `findsl-lsp`-Binary über `--stdio` |
| `plugin.xml` | `<depends>com.redhat.devtools.lsp4ij</depends>` + `server`/`languageMapping`-Extension-Points |
| `src/main/resources/syntaxes/` | TextMate-Grammar (aus VS Code wiederverwendet) |

Syntax-Highlighting, Completion, Hover, Diagnosen, Rename, Formatierung usw.
kommen alle über LSP vom Server — keine Logik-Duplikation.

## Server-Binary bereitstellen

Das Plugin startet das native, Node-freie Binary `findsl-lsp` (#239). Zwei Wege:

**A. Override für die Entwicklung (empfohlen, kein Kopieren):**
```bash
# Im Repo-Root einmalig bauen:
npm run binary:lsp        # → packages/lsp/dist/findsl-lsp
# Dann beim IDE-Start den Pfad übergeben (siehe runIde unten).
```
Setze `FINDSL_LSP_PATH` (Umgebung) oder die System-Property `findsl.lsp.path`
auf das gebaute Binary.

**B. Ins Plugin einbetten (für `buildPlugin`/lokal):**
Liegt `packages/lsp/dist/findsl-lsp` vor, kopiert der Gradle-Task
`embedLspServer` es automatisch nach `server/` in die Plugin-Ressourcen; die
Factory extrahiert und startet es dann ohne weiteres Zutun. Fehlt das Binary,
bleibt der Build grün (der Server fehlt nur zur Laufzeit).

> **Release-Distribution** (Marketplace) läuft **nicht** über das Einbetten:
> Entschieden ist **Lazy-Download** des passenden OS/Arch-Binaries vom
> versions-gepinnten GitHub-Release (SHA-256-verifiziert, IDE-Cache) mit
> manuellem Pfad-Fallback für Air-Gap-Netze. Spezifikation:
> [docs/binary-distribution.md](docs/binary-distribution.md) (#243). Die
> CI-/Upload-Seite ist #244.

**Zusätzlich: CLI-Binary für den Test-Runner (#256).** Das Test-Runner-Fenster
startet das native CLI `findsl` (nicht den LSP-Server). Analog: `npm run
binary:cli` (→ `packages/cli/dist/findsl`) + Override `FINDSL_CLI_PATH` /
`findsl.cli.path`, oder Einbettung über den Gradle-Task `embedCliBinary`
(nach `cli/` in die Plugin-Ressourcen).

### Air-Gap: Binary-Pfade in den Einstellungen (#275)

Für abgeschottete Netze ohne GitHub-Zugriff gibt es **Einstellungen → FinDSL**
mit zwei Pfad-Feldern (LSP-Server-Binary, CLI-Binary). Der Administrator lädt
die Binaries einmal manuell von der GitHub-Release-Seite und trägt die Pfade
ein. Die Auflösung in `FinDslNativeBinary` nutzt sie als **Stufe 2** —
Reihenfolge: `FINDSL_*_PATH`/`findsl.*.path`-Override → **Settings-Pfad** →
gebündeltes Binary. Nach einer Änderung den LSP-Server (oder die IDE) neu
starten, damit der neue Pfad greift.

## Entwickeln & Testen

```bash
# Plugin in einer Sandbox-IDE starten (lädt beim ersten Mal die IntelliJ-
# Platform herunter). Mit Binary-Overrides (LSP-Server + Test-Runner-CLI):
FINDSL_LSP_PATH="$(pwd)/../../packages/lsp/dist/findsl-lsp" \
FINDSL_CLI_PATH="$(pwd)/../../packages/cli/dist/findsl" \
  ./gradlew runIde

# Plugin-ZIP bauen (Artefakt unter build/distributions/):
./gradlew buildPlugin
```

In der gestarteten IDE eine `.findsl`-Datei öffnen — Highlighting, Completion,
Hover, Diagnosen, Gehe-zu-Definition, Rename und Formatierung sind aktiv.

## `prüfe`-Tests ausführen

- **CodeLens „▶ N Testfälle ausführen"** über jedem `prüfe`-Block (führt den
  ganzen Block aus).
- **Run-Gutter-Icon** links pro `testfall` (führt genau diesen Testfall aus).

Beide gehen über das Server-Kommando `findsl.pruefe.run`; das Ergebnis erscheint
als Notification, fehlgeschlagene Testfälle als Annotation.

- **Test-Runner-Fenster** (#256): Rechtsklick auf eine `.findsl`-Datei →
  „Run 'FinDSL-Test: …'" (oder eine FinDSL-Test-RunConfiguration anlegen).
  Startet `findsl test … --reporter=teamcity` und zeigt die `prüfe`-Blöcke als
  Test-Baum mit Pass/Fail, Re-Run-Failed, Statistiken und Doppelklick-Navigation
  zur Quelldatei — die zentrale Übersicht analog zum VS-Code-Test-Explorer.

## Dokumentation generieren

- **Action „FinDSL-Dokumentation generieren"** (#242) im Editor-Kontextmenü und
  im Tools-Menü, aktiv bei `.findsl`-Dateien. Ruft das Server-Kommando
  `findsl.doku.generate` auf und öffnet das erzeugte Markdown in einem
  ungespeicherten Tab; die `.md`-Endung aktiviert die Vorschau des gebündelten
  IntelliJ-Markdown-Plugins. Pendant zu `findsl.generateDocs` in VS Code.

## Bekannte Einschränkungen

- **Gutter-Icons aktualisieren sich beim Öffnen der Datei:** Werden Testfälle
  hinzugefügt/entfernt, erscheinen/verschwinden die Icons erst beim erneuten
  Öffnen. (Bestehende Icons wandern bei Edits korrekt mit.) Ein Live-Refresh ist
  als Folge geplant.
- **§-/`@Quelle`-Links (documentLink):** Cmd/Ctrl+Click öffnet die Norm im
  Browser, aber der Mauszeiger wird beim Hover nicht zur Hand. LSP4IJ rendert
  documentLinks PSI-gebunden (`ExternalAnnotator` + `GotoDeclarationHandler`);
  bei TextMate-Dateien ohne echtes PSI fehlt daher nur das Hand-Cursor-Feedback
  — die Navigation funktioniert.

## Status / Roadmap

- **#240** (Gerüst): LSP-Anbindung über `fileNamePatternMapping`,
  TextMate-Highlighting, Datei-Icon, Server-Start. ✅
- **#241**: `prüfe`-Testfälle per CodeLens ausführen. ✅
- **#255**: Run-Gutter-Icons pro Testfall. ✅
- **#250**: Formel-Rendering im Hover (file://-SVG, theme-bewusst). ✅
- **#256**: Test-Runner-Fenster (RunConfiguration + TeamCity-Reporter). ✅
- **#242**: Action „Dokumentation generieren" (Markdown-Tab mit Vorschau). ✅
- **#243**: Binary-Distribution — Lazy-Download entschieden (ADR). ✅
- **#244**: CI — Multi-Plattform-Binaries + `checksums.json` + `buildPlugin`
  als Release-Assets; `signPlugin`/`publishPlugin` gated. ✅
  *(Folge: Client-Lazy-Download in `FinDslNativeBinary` — lädt das Binary zur
  Laufzeit; erst nach erstem Release mit Assets sinnvoll testbar.)*
- **#245**: Binary-Signierung/Notarisierung — bewusst unsigniert; für den
  Lazy-Download nicht nötig (Integrität via SHA-256-Pinning, ADR
  [docs/binary-signing.md](docs/binary-signing.md)). ✅
- **Marketplace-Aktivierung**: JetBrains-Vendor/-Account + Secrets
  (`JETBRAINS_PUBLISH_TOKEN` …) nötig. Die **erste** Veröffentlichung muss laut
  JetBrains **manuell** erfolgen (Plugin-`.zip` aus dem GitHub-Release über
  plugins.jetbrains.com hochladen); erst **ab der zweiten** Version greift
  `publishPlugin` automatisch (der CI-Schritt ist dafür nicht-blockierend).
