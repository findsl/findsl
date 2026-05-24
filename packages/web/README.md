# @findsl/web

Browser-Bundle der **FinDSL**-Toolchain: der Langium-Sprachserver als
Web-Worker plus `check`/`generate` — läuft im Browser, ohne Node. Single
Source: [`@findsl/core`](https://www.npmjs.com/package/@findsl/core); selbst
abhängigkeitsfrei (`dependencies: {}`).

## Installation

```bash
npm install @findsl/web
```

## Exports

| Import | Inhalt |
|---|---|
| `@findsl/web` | API-Typen (`CheckResult`, `GenerateResult`, `Target`) |
| `@findsl/web/worker` | LSP-Worker; Custom-Requests `findsl/check`, `findsl/generate` |
| `@findsl/web/findsl.tmLanguage.json` | TextMate-Grammatik (Editor-Highlighting) |
| `@findsl/web/language-configuration.json` | Klammern / Kommentare / Auto-Indent |

Der Worker wird als statisches Asset gehostet (separate Datei, kein
Re-Bundling). Für einen fertig verdrahteten Monaco-Editor mit diesem Worker
siehe [`@findsl/editor`](https://www.npmjs.com/package/@findsl/editor).

## Lizenz

EUPL-1.2 — Teil des [findsl/findsl](https://github.com/findsl/findsl)-Monorepos.
