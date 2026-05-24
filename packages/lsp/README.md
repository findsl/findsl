# @findsl/lsp

Language-Server (LSP) für **FinDSL** — der DSL für Modelle des deutschen
Steuerrechts. Liefert Diagnostics, Hover, Completion, Semantic Tokens,
CodeLens („Testfälle ausführen"), Formatierung und Refactorings für
`.findsl`-Dateien.

Treibt die FinDSL-VS-Code-Extension und dient als Basis eigener Editor-
Integrationen. Für den Browser (ohne Node) siehe
[`@findsl/web`](https://www.npmjs.com/package/@findsl/web) /
[`@findsl/editor`](https://www.npmjs.com/package/@findsl/editor).

## Installation

```bash
npm install @findsl/lsp
```

Server-Entry: `@findsl/lsp` (`out/main.js`) stellt über `vscode-languageserver`
eine LSP-Connection bereit; ein LSP-fähiger Client startet ihn und wählt den
Transport (stdio / Node-IPC). Sprachkern:
[`@findsl/core`](https://www.npmjs.com/package/@findsl/core).

## Lizenz

EUPL-1.2 — Teil des [findsl/findsl](https://github.com/findsl/findsl)-Monorepos.
