> Teil des FinDSL-Projektkontexts — aus CLAUDE.md aufgeteilt. Gesamtindex: [../CLAUDE.md](../CLAUDE.md)

## 6. Build- und Test-Workflow

### Voraussetzungen

- Node.js ≥ 20.10 (Langium-4-Pflicht), npm ≥ 10.2.3
- TypeScript ≥ 5.8 (Langium-4-Pflicht; Projekt nutzt ~5.9)

Keine JVM, kein JDK, kein separater Runtime.

### Standard-Workflow

```bash
# Alles vom Repo-Root (npm-Workspaces) — KEIN `cd findsl-ts` mehr.

# Initial: Abhängigkeiten installieren (verlinkt @findsl/core|lsp|cli)
npm install

# Bei Grammatik-Änderungen: Parser, AST, TextMate neu generieren
npm run langium:generate            # = npm -w @findsl/core run langium:generate

# TypeScript kompilieren (tsc -b Solution: core → lsp → cli → vscode) + Assets
npm run build

# Volle Test-Suite (vitest, inkl. Bundle-Smoke)
npm test                            # 706 Tests grün

# CLI ausprobieren — parse/test/docgen nehmen JE BELIEBIG VIELE Ziele:
#   Datei | Verzeichnis (rekursiv) | Glob-Muster (shell- ODER in-process
#   via fs.glob, daher Muster ggf. quoten). Exit 1 bei Fehlern/keinem Treffer.
node packages/cli/out/main.js parse examples/kst/kst.findsl   # Einzeldatei
node packages/cli/out/main.js parse examples/kst                              # Verzeichnis (rekursiv)
node packages/cli/out/main.js parse 'examples/**/*.findsl'                     # Glob (quoted → in-process)
# test: Verzeichnis/Glob möglich; Dateien OHNE prüfe-Blöcke werden
# übersprungen, am Ende eine „Gesamt:"-Zeile.
node packages/cli/out/main.js test 'examples/**/*.test.findsl'                # alle Tests, aggregiert
node packages/cli/out/main.js test examples/kst/kst.test.findsl  # Einzeldatei
# VS-Code-Extension-Bundles + self-contained CLI-Bundle bauen:
npm run bundle                      # → apps/vscode/out/{extension,language}/main.cjs
                                    #   + packages/cli/dist/findsl.cjs (+ data/)
# Natives, Node-freies CLI-Binary (Host-Plattform):
npm run binary                      # → packages/cli/dist/findsl  (Node-SEA + postject)
npm run dist                        # build && bundle (Auslieferungsstand)
```

**Self-contained CLI (Phase 6a, fertig).** `npm run bundle` erzeugt
`packages/cli/dist/findsl.cjs` — ein esbuild-CJS-Bundle mit allem
eingerollt (`@findsl/core` aus TS-Quelle via `source`-Export-Condition,
`builtins.json` inline, pdfmake/langium/markdown-it); braucht **kein**
`node_modules` und **keinen** `@findsl/core`-Build. `npm run binary`
macht daraus via **Node-SEA + postject** ein **natives, Node-freies**
`packages/cli/dist/findsl` (Host-Plattform; SEA kann nicht
cross-kompilieren → andere OS je CI-Runner). **`doku -f pdf` braucht
das mitgelieferte `dist/data/`** neben Bundle/Binary (pdfkit liest
Standard-14-AFM via `fs` aus `__dirname/data` — esbuild bündelt diese
nicht). **§7-Erweiterung — vierter Runtime:** das CLI-CJS-Bundle ist
neben vitest/tsc-ESM/LSP-Bundle ein vierter Runtime; `pdf.ts` lädt
pdfmake jetzt per statischem Import + `cjsDefault()`-Interop ( kein
`createRequire(import.meta.url)` mehr — das war im Bundle `undefined`).
`scripts/build-binary.mjs` liest den `NODE_SEA_FUSE_…` aus dem
Node-Binär (Node 24 ≠ postject-alpha-Default → sonst „sentinel not
found"). Gate: 3 CLI-Bundle-Smoke-Tests in `bundle-smoke.test.ts`.

### VS Code mit FinDSL-Extension testen

```bash
# Im FinDSL-Wurzelverzeichnis:
code .

# In VS Code: F5 startet die Extension in einem Debug-Fenster.
# Dort .findsl-Dateien öffnen — Syntax-Highlighting und LSP-Features sind aktiv.
```

### Erwartetes Ergebnis nach `npm run build`

Alle Beispieldateien parsen ohne Diagnosen, z. B. (vom Repo-Root):

```
✓ examples/kst/kst.findsl erfolgreich geparst, keine Diagnosen.
✓ examples/gewst/gewst.findsl erfolgreich geparst, keine Diagnosen.
✓ examples/kraftst/kraftst.findsl erfolgreich geparst, keine Diagnosen.
```

### Test, dass der Validator greift

In einer Beispieldatei (z. B. `examples/kst/kst.findsl`)
temporär die `@Quelle(...)`-Zeile vor einer Konstanten auskommentieren —
schematisch:

```
//@Quelle("§ … ")
konst IRGENDEINE_KONSTANTE: Euro = 1.000
```

Re-parsen — es muss exakt eine Warnung für diese Konstante erscheinen.

---

