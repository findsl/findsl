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
├── grammar/findsl.ebnf                 ← kanonische EBNF-Grammatik
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
│   │       └── codegen/   (LEER — TODO Java/TS/JS)
│   ├── lsp/    @findsl/lsp — src/main.ts (LSP-Server-Entry → @findsl/core)
│   └── cli/    @findsl/cli — src/main.ts (bin `findsl`: parse/test/docgen)
└── apps/
    └── vscode/ Extension — src/main.ts + package.json (VS-Code-Manifest)
                 + language-configuration.json + syntaxes/ (für .vsix)
```

Modul-Graph (azyklisch): `lsp → @findsl/core`, `cli → @findsl/core`,
`apps/vscode` bündelt `lsp` (esbuild → `apps/vscode/out/{extension,
language}/main.cjs`; kein TS-Import von core). `language ↔ interpret`
und `language ↔ docs` sind bewusst **paketintern** in `core` (Variante A).

**Drei Artefakte halten die Sprache zusammen — bei Sprachänderungen MÜSSEN alle drei synchron gepflegt werden:**

1. `SPEC.md` — autoritative Sprachreferenz, Kapitel + Anhang A EBNF
2. `grammar/findsl.ebnf` — eigenständige Grammatik-Datei (für Tooling)
3. `packages/core/src/language/findsl.langium` — ausführbare Langium-Grammatik

---

