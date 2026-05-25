# @findsl/editor-react

React-Komponente für den einbettbaren **FinDSL**-Editor — `<FindslEditor>` um
[`@findsl/editor`](https://www.npmjs.com/package/@findsl/editor). Kapselt
Mount/Dispose im Komponenten-Lebenszyklus (StrictMode- und async-race-fest)
und bietet eine Ref-API für `check()`/`generate()`.

> **Scope:** nur die React-Bindung — Komponente + Ref + Props/Callbacks. Keine
> Preview-/Ergebnis-UI (bleibt beim Konsumenten, wie bei `@findsl/editor`).

## Installation

`react` und (über `@findsl/editor`) der Monaco-Stack sind **`peerDependencies`**:

```bash
npm i @findsl/editor-react @findsl/editor @findsl/web react react-dom \
  monaco-languageclient \
  @codingame/monaco-vscode-api@25.1.2 \
  @codingame/monaco-vscode-editor-api@25.1.2 \
  @codingame/monaco-vscode-configuration-service-override@25.1.2
```

Worker hosten (wie `@findsl/editor`): `findsl-editor-copy-worker` als
`prebuild`/`predev` → `public/findsl-web/`. Vite-Konfiguration
(`worker.format: 'es'`, `optimizeDeps`) siehe README von `@findsl/editor`.

## Verwendung

```tsx
import { useRef } from 'react';
import { FindslEditor, type FindslEditorRef } from '@findsl/editor-react';

function Playground() {
  const ref = useRef<FindslEditorRef>(null);
  return (
    <FindslEditor
      ref={ref}
      defaultValue={'modul beispiel\n'}
      theme="auto"                                  // Wechsel wird live angewandt
      appearance={{ fontFamily: "'IBM Plex Mono', monospace" }}
      onChange={(code) => { /* Ergebnisse veralten */ }}
      onRun={() => ref.current?.check()}            // CodeLens / Gutter-Play
      style={{ height: 420 }}
    />
  );
}

// imperativ über den Ref:
const result = await ref.current?.check();
const java   = await ref.current?.generate('java');
const wert   = await ref.current?.evaluate('Kst(50000)');  // EvalResult: { value, type, text }
```

## Next.js (App Router) — client-only

Der Editor ist browser-only (Monaco + Worker), kann also **nicht** serverseitig
gerendert werden:

```tsx
'use client';
import dynamic from 'next/dynamic';

const FindslEditor = dynamic(
  () => import('@findsl/editor-react').then((m) => m.FindslEditor),
  { ssr: false },
);
```

## Props & Ref

| Prop | Bedeutung |
|---|---|
| `defaultValue` | Anfangsinhalt (**uncontrolled** — spätere Änderungen nur über `key`) |
| `workerUrl` | Worker-URL (Mount-Zeit; Wechsel ⇒ Re-Mount) |
| `theme` | `'light' \| 'dark' \| 'auto' \| ThemeSpec` — Wechsel **live** via `setTheme` |
| `appearance` / `behavior` | Optik / Verhalten (Mount-Zeit) |
| `onChange(code)` / `onRun` / `onError` / `onReady(handle)` | Callbacks |
| `className` / `style` | Container-`div` |

`FindslEditorRef`: `check()`, `generate(target, opts?)`, `evaluate(expr)`,
`getCode()`, `setCode()`, `setTheme()`, `handle` (rohes `@findsl/editor`-Handle).

## Lizenz

EUPL-1.2 — Teil des [findsl/findsl](https://github.com/findsl/findsl)-Monorepos.
