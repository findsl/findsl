# @findsl/core

Sprachkern von **FinDSL** — der DSL für ausführbare, prüfbare Modelle des
deutschen Steuerrechts. Bündelt Grammatik/AST, Validator + Typsystem,
Interpreter (bit-genaues Semantik-Orakel), Dokumentations-Generator und
Codegen (Java/TS/JS).

> Programmier-Schnittstelle für Tooling. Für die Kommandozeile siehe
> [`@findsl/cli`](https://www.npmjs.com/package/@findsl/cli), für den Browser
> [`@findsl/web`](https://www.npmjs.com/package/@findsl/web).

## Installation

```bash
npm install @findsl/core
```

## Module (Subpath-Exports)

| Import | Inhalt |
|---|---|
| `@findsl/core/language/*` | Langium-Grammatik, AST, Validator, Typsystem |
| `@findsl/core/interpret/*` | Interpreter — bit-genaues Semantik-Orakel |
| `@findsl/core/codegen/*` | IR + Emitter für Java / TypeScript / JavaScript |
| `@findsl/core/docgen/*` | Dokumentation (Markdown / HTML / PDF) |
| `@findsl/core/papgen/*` | Programmablaufpläne (DIN 66001, Mermaid) |

## Lizenz

EUPL-1.2 — Teil des [findsl/findsl](https://github.com/findsl/findsl)-Monorepos.
