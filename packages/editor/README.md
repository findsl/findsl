# @findsl/editor

Einbettbarer **FinDSL-Editor** (Monaco + `@findsl/web`-LSP-Worker) für
Bundler-basierte Websites. `mountFindslEditor()` liefert den Editor mit
VS-Code-paritätischem Highlighting, Diagnostics, CodeLens „Testfälle
ausführen", Gutter-Play-Pfeilen — plus `check()`/`generate()`.

> **Scope:** nur **Editor + check/generate**. Die Preview-/Ergebnis-UI
> (Tabs, Artefakt-Rendering, PDF/PAP) bleibt beim Konsumenten.

## Installation

`@findsl/editor` hält den (versionssensiblen) Monaco-Stack als
**`peerDependencies`** — der Konsument installiert ihn, damit genau **eine**
`@codingame/*`-Instanz existiert (sonst Service-Init-Deadlock):

```bash
npm i @findsl/editor @findsl/web \
  monaco-languageclient \
  @codingame/monaco-vscode-api@25.1.2 \
  @codingame/monaco-vscode-editor-api@25.1.2 \
  @codingame/monaco-vscode-configuration-service-override@25.1.2
```

Die `@codingame/*`-Versionen müssen im **Lockstep** sein (alle `25.1.2`) —
Minor-Drift zwischen `-api` und `-editor-api` ist eine bekannte Bruchquelle.

## Worker hosten

Der LSP-Worker (`@findsl/web/dist`, ~2 MB mit Lazy-Chunks) wird als statisches
Asset ausgeliefert — kein Re-Bundling. Ein mitgeliefertes Bin kopiert ihn:

```jsonc
// package.json
{
  "scripts": {
    "predev":   "findsl-editor-copy-worker",   // → public/findsl-web/
    "prebuild": "findsl-editor-copy-worker"
  }
}
```

`mountFindslEditor` lädt ihn per Default **root-absolut** unter
`/findsl-web/worker.js` — funktioniert auch auf Unterseiten. Abweichendes
Hosting über `workerUrl`.

> **Hinweis:** Hostest du den Worker NICHT am Root (z. B. unter einem
> Base-Path), setze `workerUrl` explizit. Ein nicht gefundener Worker äußert
> sich als irreführendes `Illegal worker configuration detected` — der Editor
> mountet, scheitert erst an der Worker-Connection.

## Vite-Konfiguration

`@findsl/editor` ist **Vite-first** (webpack/CDN: best effort, ungetestet).
Der Monaco-Stack braucht ES-Module-Worker + Pre-Bundling:

```ts
import importMetaUrlPlugin from '@codingame/esbuild-import-meta-url-plugin';

export default {
  worker: { format: 'es' },
  optimizeDeps: {
    include: [
      'monaco-languageclient/vscodeApiWrapper',
      'monaco-languageclient/editorApp',
      'monaco-languageclient/lcwrapper',
      'monaco-languageclient/workerFactory',
      '@codingame/monaco-vscode-configuration-service-override',
      '@codingame/monaco-vscode-editor-api',
      '@codingame/monaco-vscode-api/extensions',
    ],
    esbuildOptions: { plugins: [importMetaUrlPlugin] },
  },
};
```

## Verwendung

```ts
import { mountFindslEditor } from '@findsl/editor';

const editor = await mountFindslEditor(document.getElementById('app')!, {
  initialCode: 'modul beispiel\n',
  theme: 'auto',                       // 'light' | 'dark' | 'auto' | ThemeSpec
  appearance: { fontFamily: "'IBM Plex Mono', monospace" },
  onRun: () => void runPruefen(),      // CodeLens / Gutter-Play
});

const result = await editor.check();              // CheckResult
const java   = await editor.generate('java');     // GenerateResult
const wert   = await editor.evaluate('Kst(50000)'); // EvalResult: { value, type, text }
editor.getCode();
editor.setCode('…');
editor.dispose();
```

### Theme an ein eigenes Design-System koppeln

`theme` akzeptiert einen `ThemeSpec` mit **aufgelösten sRGB-Hex** (kein oklch):

```ts
const handle = await mountFindslEditor(el, {
  theme: { base: 'dark', colorCustomizations: { 'editor.background': '#050f13' } },
});
// Bei eigenem Theme-Wechsel zur Laufzeit:
handle.setTheme({ base: 'light', colorCustomizations: { 'editor.background': '#fdfcfa' } });
```

Die **Theme-Quelle** (CSS-Var, `data-theme`, Toggle) bleibt beim Konsumenten;
das Paket liest kein DOM-Attribut. `'auto'` folgt `prefers-color-scheme` live.

**CSS-Custom-Properties / `data-theme` (Convenience):** Hat dein Design-System
oklch-Tokens + einen `data-theme`-Toggle, kapselt der optionale Helfer
`themeFromCssVars` das Auflösen zu sRGB-Hex (Canvas-Probe) und das Lesen der
Basis — kein API-Zwang:

```ts
import { mountFindslEditor, themeFromCssVars } from '@findsl/editor';

const colorMap = { 'editor.background': '--paper', 'editorGutter.background': '--paper' };
const handle = await mountFindslEditor(el, { theme: themeFromCssVars(colorMap) });

// Editor dem Theme-Toggle folgen lassen:
new MutationObserver(() => handle.setTheme(themeFromCssVars(colorMap)))
  .observe(document.documentElement, { attributeFilter: ['data-theme'] });
```

### Gutter-Play-Pfeile (CSS)

Die Play-Pfeile je `testfall` nutzen die Klasse `findsl-editor__playglyph` —
der Konsument stylt sie (z. B. ein ▶-Glyph):

```css
.findsl-editor__playglyph::before { content: '▶'; cursor: pointer; }
```

## API

`mountFindslEditor(container, options?) → Promise<FindslEditorHandle>`

| Handle | |
|--------|--|
| `getCode()` / `setCode(code)` | Inhalt lesen/setzen (`setCode` löst `onChange` nicht aus) |
| `check()` | `findsl/check` → `CheckResult` |
| `generate(target)` | `findsl/generate` → `GenerateResult` |
| `evaluate(expr)` | `findsl/eval` → `EvalResult` (Ausdruck im Dokument-Scope) |
| `onChange(fn)` / `onRun(fn)` | Listener; geben Unsubscribe zurück |
| `setTheme(theme)` | Theme zur Laufzeit |
| `dispose()` | alle Wrapper + Listener abräumen |
| `advanced.{client, uri}` | Escape-Hatch (KEINE stabile API) |

## Lizenz

EUPL-1.2 — siehe `LICENSE` im Repo-Root.
