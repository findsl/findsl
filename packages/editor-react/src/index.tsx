// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * `@findsl/editor-react` — React-Bindung um {@link mountFindslEditor}
 * (`@findsl/editor`). `<FindslEditor>` kapselt Mount/Dispose im Komponenten-
 * Lebenszyklus (StrictMode- und async-Race-fest) und exponiert über einen
 * Ref `check`/`generate`/`getCode`/`setCode`/`setTheme`.
 *
 * Browser-only (Monaco + Worker): in SSR/Next.js client-only verwenden
 * (`"use client"` + `dynamic(…, { ssr: false })`); siehe README. KEIN
 * Bundling — `react` und `@findsl/editor` sind `peerDependencies`.
 *
 * Non-Goal (#162): keine Preview-/Ergebnis-UI — wie `@findsl/editor` Sache
 * des Konsumenten.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { CSSProperties } from 'react';
import {
    mountFindslEditor,
    type CheckResult,
    type EvalResult,
    type FindslEditorAppearance,
    type FindslEditorBehavior,
    type FindslEditorHandle,
    type FindslEditorTheme,
    type GenerateOptions,
    type GenerateResult,
    type Target,
} from '@findsl/editor';

export type {
    CheckResult, EvalResult, FindslEditorAppearance, FindslEditorBehavior, FindslEditorHandle,
    FindslEditorTheme, FindslEditorThemeSpec, GenerateOptions, GenerateResult, Target,
} from '@findsl/editor';
export { themeFromCssVars, type ThemeFromCssVarsOptions } from '@findsl/editor';

/** Imperative Schnittstelle der Komponente (via `ref`). */
export interface FindslEditorRef {
    /** `findsl/check` gegen das aktuelle Dokument. Wirft vor dem Mount. */
    check(): Promise<CheckResult>;
    /** `findsl/generate` für ein Ziel. Wirft vor dem Mount. */
    generate(target: Target, opts?: GenerateOptions): Promise<GenerateResult>;
    /** `findsl/eval` — wertet einen FinDSL-Ausdruck im Dokument-Scope aus
     *  (Wert + Typ + formatierter Text, #164). Wirft vor dem Mount. */
    evaluate(expr: string): Promise<EvalResult>;
    /** Aktueller Code; `''` solange nicht gemountet (tolerant, kein Wurf). */
    getCode(): string;
    /** Code setzen. **No-op vor dem Mount** (anders als `check`/`generate`, die werfen). */
    setCode(code: string): void;
    /** Theme setzen. No-op vor dem Mount. */
    setTheme(theme: FindslEditorTheme): void;
    /** Rohes `@findsl/editor`-Handle (Escape-Hatch); `null` vor dem Mount. */
    readonly handle: FindslEditorHandle | null;
}

export interface FindslEditorProps {
    /** Anfangsinhalt. **Uncontrolled** — spätere Änderungen wirken nur über `key`-Wechsel. */
    defaultValue?: string;
    /** Worker-URL (Mount-Zeit). Wechsel ⇒ Re-Mount. Default: `/findsl-web/worker.js`. */
    workerUrl?: string | URL;
    /** Theme — Wechsel wird **live** via `setTheme` angewandt (kein Re-Mount). */
    theme?: FindslEditorTheme;
    /** Editor-Optik (Mount-Zeit). */
    appearance?: FindslEditorAppearance;
    /** Editor-Verhalten (Mount-Zeit). */
    behavior?: FindslEditorBehavior;
    /** Bei echten Nutzer-Änderungen (NICHT bei `setCode`); erhält den aktuellen Code. */
    onChange?: (code: string) => void;
    /** Prüf-Auslöser aus dem Editor (CodeLens / Gutter-Play). */
    onRun?: () => void;
    /** Nicht-fatale Fehlerpfade des Editors. */
    onError?: (err: unknown, context: string) => void;
    /** Sobald der Editor gemountet ist. */
    onReady?: (handle: FindslEditorHandle) => void;
    className?: string;
    style?: CSSProperties;
}

function requireHandle(h: FindslEditorHandle | null): FindslEditorHandle {
    if (!h) throw new Error('FindslEditor: Editor ist noch nicht gemountet.');
    return h;
}

export const FindslEditor = forwardRef<FindslEditorRef, FindslEditorProps>(
    function FindslEditor(props, ref) {
        const containerRef = useRef<HTMLDivElement>(null);
        const handleRef = useRef<FindslEditorHandle | null>(null);
        // Props/Callbacks stets aktuell halten, OHNE den Mount-Effect neu
        // auszulösen (sonst re-mountet jeder Callback-Wechsel den Editor).
        const propsRef = useRef(props);
        propsRef.current = props;

        // Mount-Zeit-Optionen: nur `workerUrl` triggert Re-Mount. `defaultValue`/
        // `appearance`/`behavior` sind Mount-Zeit (Wechsel via `key`); `theme`
        // läuft live über den Effect unten.
        // Sentinel '\0' für „nicht gesetzt": unterscheidet undefined/null von
        // einem (degenerierten) Leerstring, damit ein Wechsel ""→URL re-mountet.
        const workerUrlKey = props.workerUrl == null ? '\0' : String(props.workerUrl);

        useEffect(() => {
            const el = containerRef.current;
            if (!el) return;                       // SSR/kein DOM → kein Mount
            let cancelled = false;
            let mounted: FindslEditorHandle | undefined;
            const p = propsRef.current;
            void (async () => {
                const handle = await mountFindslEditor(el, {
                    initialCode: p.defaultValue,
                    workerUrl: p.workerUrl,
                    theme: p.theme,
                    appearance: p.appearance,
                    behavior: p.behavior,
                    // `mounted` ist erst nach erfolgreichem (nicht abgebrochenem)
                    // Mount gesetzt — der Editor feuert onChange ohnehin erst dann;
                    // so referenziert die Closure kein noch ununitialisiertes Handle.
                    onChange: () => { if (mounted) propsRef.current.onChange?.(mounted.getCode()); },
                    onRun: () => propsRef.current.onRun?.(),
                    onError: (e, c) => propsRef.current.onError?.(e, c),
                });
                if (cancelled) {
                    // Unmount kam VOR Mount-Abschluss (StrictMode/async-Race) →
                    // sofort abräumen, kein verwaister Editor/Worker.
                    void handle.dispose();
                    return;
                }
                mounted = handle;
                handleRef.current = handle;
                propsRef.current.onReady?.(handle);
            })();
            return () => {
                cancelled = true;
                handleRef.current = null;
                void mounted?.dispose();
            };
        }, [workerUrlKey]);

        // Theme-Wechsel live anwenden (kein Re-Mount). ThemeSpec-Objekte ggf.
        // memoizen, sonst feuert der Effect bei jedem Render (setTheme ist billig).
        useEffect(() => {
            if (props.theme !== undefined) handleRef.current?.setTheme(props.theme);
        }, [props.theme]);

        useImperativeHandle(ref, (): FindslEditorRef => ({
            check: () => requireHandle(handleRef.current).check(),
            generate: (target, opts) => requireHandle(handleRef.current).generate(target, opts),
            evaluate: (expr) => requireHandle(handleRef.current).evaluate(expr),
            getCode: () => handleRef.current?.getCode() ?? '',
            setCode: (code) => handleRef.current?.setCode(code),
            setTheme: (theme) => handleRef.current?.setTheme(theme),
            get handle() { return handleRef.current; },
        }), []);

        return <div ref={containerRef} className={props.className} style={props.style} />;
    },
);
