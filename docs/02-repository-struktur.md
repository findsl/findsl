> Teil des FinDSL-Projektkontexts — aus CLAUDE.md aufgeteilt. Gesamtindex: [../CLAUDE.md](../CLAUDE.md)

## 2. Repository-Struktur

> **⚠ Struktur seit 2026-05-17: npm-Monorepo, Wurzel = Repo-Top-Level.**
> `findsl-ts/` **gibt es nicht mehr.** Pfad-Mapping (gilt für ALLE
> noch nicht aktualisierten `findsl-ts/src/...`-Verweise weiter unten
> in dieser Datei): `findsl-ts/src/language/*` →
> `packages/core/src/language/*`; `…/interpret/*` →
> `packages/core/src/interpret/*`; `…/docs/*` →
> `packages/core/src/docgen/*` (umbenannt); `…/codegen/*` →
> `packages/core/src/codegen/*`; `…/language/main.ts` →
> `packages/lsp/src/main.ts`; `…/cli/*` → `packages/cli/src/*`;
> `…/extension/*` → `apps/vscode/src/*`; `findsl-ts/test/*` →
> `packages/core/test/*`. Build/Run **vom Repo-Root**, kein
> `cd findsl-ts`. (Der Monorepo-Umbau ist abgeschlossen und verifiziert;
> der frühere `RESTRUCTURE-PLAN.md`-Migrationsplan wurde nach Abschluss
> entfernt — diese Mapping-Regel bleibt für Altverweise maßgeblich.)

```
FinDSL/                                 ← npm-Workspace-Wurzel (privat)
├── package.json                        (Workspace-Manifest + Dev-Tooling)
├── tsconfig.json                       (Solution: project references)
├── esbuild.mjs · scripts/              (Build-Tooling: copy-assets, enhance-textmate)
├── CLAUDE.md · README.md · SPEC.md · GESETZ-ZU-FINDSL.md
├── LICENSE (EUPL-1.2, SPDX-kanonisch) · LICENSE-COMMERCIAL.md
├── NOTICE · CONTRIBUTING.md · CLA.md   ← Dual-Lizenz: EUPL-1.2 + kommerziell
│                                          (© devtank42 GmbH; CLA-Pflicht
│                                          erhält den Verwertungshebel; EUPL
│                                          = beste DE/EU-Verwaltungs-Akzeptanz.
│                                          Publish .vsix/Open VSX/npm offen
│                                          → Publisher-/Namespace-Entscheidung)
├── gesetze/                            (Gesetzesquellen XML/PDF)
├── examples/                           ← *.findsl + *.test.findsl + *-doku.*
│   ├── kst/ · kraftst/ · gewst/ · est/  (je <slug>.findsl + .test + XML)
├── doku/                               (projektweite Aggregat-Doku)
├── packages/
│   ├── core/   @findsl/core — Sprachkern (kein Prozess)
│   │   ├── package.json (exports: ./*.js → out, source-Cond. → src)
│   │   ├── tsconfig.json (composite) · langium-config.json · syntaxes/
│   │   ├── test/                       (vitest; relativ zu src/)
│   │   └── src/
│   │       ├── language/  (Grammatik findsl.langium + generated/ +
│   │       │               alle LSP-Provider, Validator, Type-Checker,
│   │       │               Scope, Stdlib/builtins.json, import-path.ts)
│   │       ├── interpret/ (Tree-Walker: values/interpreter/
│   │       │               module-loader/pruefe …)
│   │       ├── docgen/    (Doku-Generator: model/markdown/html/pdf/
│   │       │               kopf/quelle/findsl-tokens — war „docs")
│   │       ├── codegen/   (Codegen-Pipeline: lower/ → ir/ → emit/
│   │       │               Pretty-Printer → emit-java/emit-ts/emit-js;
│   │       │               path-naming + eingebettete Java-/TS-Runtimes)
│   │       └── papgen/    (PAP-Generator: model/mermaid/html — Programm-
│   │                       ablaufpläne als Mermaid + self-contained HTML)
│   ├── lsp/    @findsl/lsp — src/main.ts (LSP-Server-Entry → @findsl/core)
│   ├── cli/    @findsl/cli — src/main.ts (bin `findsl`: parse/test/docgen)
│   ├── web/    @findsl/web — Browser-Bundle (Langium-LSP-Worker +
│   │            check/generate-API; Single Source → @findsl/core)
│   ├── editor/ @findsl/editor — einbettbarer Monaco-Editor (mountFindsl-
│   │            Editor() + @findsl/web-Worker; ohne Preview-/Ergebnis-UI)
│   └── editor-react/ @findsl/editor-react — React-<FindslEditor> um
│                @findsl/editor (Ref-API check/generate)
├── apps/
│   └── vscode/ Extension — src/main.ts + package.json (VS-Code-Manifest)
│                + language-configuration.json + syntaxes/ (für .vsix)
└── runtimes/                          ← als Codegen-Output eingebettet
    ├── java/   Java-Laufzeit (Gradle; FinDslNumber u. a.)
    └── ts/     TypeScript-Laufzeit (Quelle für emit-ts/emit-js)
```

Modul-Graph (azyklisch): `lsp → @findsl/core`, `cli → @findsl/core`,
`web → @findsl/core`, `editor → @findsl/web`, `editor-react → @findsl/editor`;
`apps/vscode` bündelt `lsp` (esbuild → `apps/vscode/out/{extension,
language}/main.cjs`; kein TS-Import von core). `language ↔ interpret`,
`language ↔ docgen` und `language → codegen` sind bewusst **paketintern**
in `core` (Variante A); `codegen` wird vom CLI-Subkommando `codegen`
(`--lang java|ts|js`) konsumiert; die `runtimes/{java,ts}` werden von
`codegen` als eingebettete Laufzeit-Outputs ausgeliefert.

**Zwei Artefakte halten die Sprache zusammen — bei Sprachänderungen MÜSSEN beide synchron gepflegt werden:**

1. `SPEC.md` — autoritative Sprachreferenz, Kapitel + Anhang A EBNF
2. `packages/core/src/language/findsl.langium` — ausführbare Langium-Grammatik

Maschinell abgesichert durch `packages/core/test/grammar-spec-coupling.test.ts`
(jedes Keyword-Literal aus `findsl.langium` muss in `SPEC.md` vorkommen). Die
früher separate `grammar/findsl.ebnf` wurde mit Issue #205 entfernt — sie war
eine nicht eingekoppelte, bereits divergierte Zweitkopie von SPEC Anhang A.

---

