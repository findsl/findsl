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

**B. Ins Plugin einbetten (für `buildPlugin`/Distribution):**
Liegt `packages/lsp/dist/findsl-lsp` vor, kopiert der Gradle-Task
`embedLspServer` es automatisch nach `server/` in die Plugin-Ressourcen; die
Factory extrahiert und startet es dann ohne weiteres Zutun. Fehlt das Binary,
bleibt der Build grün (der Server fehlt nur zur Laufzeit). Die robuste
Distributionsstrategie (Bündeln vs. Lazy-Download) ist **#243**.

## Entwickeln & Testen

```bash
# Plugin in einer Sandbox-IDE starten (lädt beim ersten Mal die IntelliJ-
# Platform herunter). Mit Binary-Override:
FINDSL_LSP_PATH="$(pwd)/../../packages/lsp/dist/findsl-lsp" \
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
- **Formeln im Hover:** LaTeX-Formeln in der Doku werden (anders als in VS Code)
  noch nicht gerendert — LSP4IJ kann im Hover-Markdown kein Math. Geplant:
  server-seitig TeX-freier Unicode-Hover für IntelliJ (#250).

## Status / Roadmap

- **#240** (Gerüst): LSP-Anbindung über `fileNamePatternMapping`,
  TextMate-Highlighting, Datei-Icon, Server-Start. ✅
- **#241**: `prüfe`-Testfälle per CodeLens ausführen. ✅
- **#255**: Run-Gutter-Icons pro Testfall. ✅
- **#242**: Action „Dokumentation generieren".
- **#250**: LaTeX-Hover server-seitig.
- **#243/#244/#245**: Binary-Distribution, CI/Publishing, Signierung.
