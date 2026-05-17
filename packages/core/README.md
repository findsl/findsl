# findsl-ts

TypeScript-Implementierung des FinDSL-Compilers, Interpreters und Language-Servers,
gebaut auf [Langium](https://langium.org).

## Komponenten in einem Paket

| Komponente            | Pfad                              | Status     |
|-----------------------|-----------------------------------|------------|
| Langium-Grammatik     | `src/language/findsl.langium`     | 🟡 initial |
| LSP-Server            | `src/language/main.ts`            | 🟡 stub    |
| VS-Code-Extension     | `src/extension/main.ts`           | 🟡 stub    |
| CLI-Werkzeug          | `src/cli/main.ts`                 | 🟡 parse-Subkommando |
| Validator             | `src/language/findsl-validator.ts`| ⬜ leer    |
| Interpreter           | `src/interpret/`                  | ⬜ offen   |
| Codegen Java          | `src/codegen/java-target.ts`      | ⬜ offen   |
| Codegen TypeScript    | `src/codegen/typescript-target.ts`| ⬜ offen   |
| Codegen JavaScript    | `src/codegen/javascript-target.ts`| ⬜ offen   |
| Doku-Generator        | `src/docs/`                       | ⬜ offen   |
| TextMate-Highlighting | `syntaxes/findsl.tmLanguage.json` | 🟢 vollständig |
| VS-Code-Konfig        | `language-configuration.json`     | 🟢 vollständig |

## Voraussetzungen

- **Node.js ≥ 18 LTS**
- **npm** (kommt mit Node.js)

Keine JVM, kein JDK, kein separater Runtime — alles läuft im Node.js-Prozess.

## Quick Start

```bash
cd findsl-ts

# Abhängigkeiten installieren
npm install

# Parser, AST-Typen und LSP-Glue aus der Grammatik generieren
npm run langium:generate

# TypeScript kompilieren
npm run build

# Eine FinDSL-Datei parsen (Diagnose)
node out/cli/main.js parse ../examples/einkommensteuer/tarif/tarif2025.fin --verbose

# Tests
npm test
```

## In VS Code testen

```bash
# Im Repository-Wurzel-Verzeichnis VS Code öffnen
code .

# Im VS-Code-Debugger: F5 startet die Extension in einem Extension-Host-Fenster.
# Dort öffne eine .fin-Datei — Syntax-Highlighting und LSP-Features sind aktiv.
```

Nach `vsce package` entsteht eine `.vsix`-Datei, die du per "Install from VSIX..."
in jeden VS-Code-Installation einfügen kannst — ohne Marketplace-Veröffentlichung.

## Architektur — Pipeline

```
.fin-Datei
   │
   ▼
Chevrotain-Lexer + -Parser    ←  generiert aus findsl.langium
   │
   ▼
AST (TypeScript-Interfaces)   ←  generiert aus findsl.langium
   │
   ▼
Linker (Cross-References) + Validator  ←  src/language/findsl-validator.ts
   │
   ▼
       ┌───────────────────────────┴───────────────────────────┐
       ▼                                                        ▼
LSP-Endpunkte (Hover,                                Tree-Walking-Interpreter
Completion, Definition,                              + Codegen-Visitors
Diagnostics, Format, …)                              (Java / TS / JS / Doku)
       │                                                        │
       ▼                                                        ▼
   VS Code / Editor                                  Quelltext / Test-Reports
```

## Sprachstand

Die kanonische Sprachreferenz liegt im Repository-Wurzel als
[`SPEC.md`](../SPEC.md). Bei Sprachänderungen müssen drei Artefakte
synchron gepflegt werden:

1. `SPEC.md` — autoritative Sprachspezifikation
2. `grammar/findsl.ebnf` — kanonische Grammatik
3. `findsl-ts/src/language/findsl.langium` — ausführbare Langium-Grammatik

## Bekannte TODOs in der initialen Grammatik

| Thema                               | Lösungsweg                                           |
|-------------------------------------|------------------------------------------------------|
| Mehrzeilige Strings (`"""..."""`)   | Chevrotain-Lexer-Mode                                |
| String-Interpolation `${...}`       | Lexer-Mode + Sub-Parser                              |
| Robuste Doc-Comment-Erkennung       | Lexer-Mode mit `--`-am-Zeilenanfang-Anker            |
| `verwende`-Disambiguierung          | Validator-Pass nach dem Parse                        |
| Number-Literal-Klassifizierung      | Im Validator: Token-Text in INT / DEC / PCT trennen  |

## Beziehung zum übergeordneten Repository

```
FinDSL/
├── SPEC.md                  (Sprachspezifikation)
├── grammar/findsl.ebnf      (kanonische EBNF)
├── examples/                (FinDSL-Beispieldateien)
└── findsl-ts/               (dieses Verzeichnis)
```
