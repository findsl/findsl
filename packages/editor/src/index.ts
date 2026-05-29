// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * `@findsl/editor` — einbettbarer FinDSL-Editor (Monaco + `@findsl/web`-LSP-
 * Worker). `mountFindslEditor()` kapselt das (fragile, versionssensible)
 * Monaco-↔-Worker-↔-Grammatik-Wiring inkl. Service-Init-Reihenfolge,
 * CodeLens „Testfälle ausführen" und Gutter-Play-Pfeilen — und liefert eine
 * kleine Oberfläche: Editor + `check()`/`generate()` + `onChange`/`onRun`.
 *
 * NICHT enthalten (Non-Goal, Issue #151): Preview-/Ergebnis-UI (Tabs,
 * Artefakt-Rendering, PDF/PAP). Das bleibt Sache des Konsumenten.
 *
 * Browser-only. Der Monaco-Stack (`monaco-languageclient`, `@codingame/*`)
 * ist `peerDependencies` — der Konsument-Bundler löst ihn auf, sodass genau
 * EINE `@codingame/*`-Instanz existiert (Singleton-/Deadlock-Garantie).
 */

import { MonacoVscodeApiWrapper } from 'monaco-languageclient/vscodeApiWrapper';
import { EditorApp } from 'monaco-languageclient/editorApp';
import { LanguageClientWrapper } from 'monaco-languageclient/lcwrapper';
import { configureDefaultWorkerFactory } from 'monaco-languageclient/workerFactory';
import type { MonacoLanguageClient } from 'monaco-languageclient';
import { updateUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override';
import * as monaco from '@codingame/monaco-vscode-editor-api';

// Volle TextMate-Grammatik + language-configuration aus dem versionierten
// `@findsl/web` (Single Source) — kein Vendoring. `?raw` löst der Konsumenten-
// Bundler auf (Vite/webpack `asset/source`); siehe README.
import findslGrammar from '@findsl/web/findsl.tmLanguage.json?raw';
import findslLanguageConfig from '@findsl/web/language-configuration.json?raw';

import type { CheckResult, EvalResult, GenerateOptions, GenerateResult, Target } from '@findsl/web';

export type { CheckResult, EvalResult, GenerateOptions, GenerateResult, Target } from '@findsl/web';
export { themeFromCssVars, type ThemeFromCssVarsOptions } from './theme-css-vars.js';

const LANGUAGE_ID = 'findsl';
const SCOPE_NAME = 'source.findsl';
// Eindeutige Modell-URI je Mount: `createModelReference` ist refcounted —
// eine konstante URI würde ein zweites `mountFindslEditor` still dasselbe
// Modell teilen lassen (überschriebener Text, cross-feuernde Listener) und
// das `lensRunByUri`-Fan-out kollabieren lassen (#152-Review). Der Zähler
// ist modul-global; siehe `mountCounter`.
const FILE_PATH_BASE = '/workspace/main';

// Client-Kommando, auf das der Server-CodeLens „▶ N Testfälle ausführen"
// zeigt (findsl-codelens.ts → LENS_RUN_COMMAND). Im Browser ist es nicht
// registriert; wir registrieren es und lösen denselben Prüf-Lauf aus.
const LENS_RUN_COMMAND = 'findsl.pruefe.runFromLens';
const TESTFALL_RE = /^\s*testfall\b/;

// ---------------------------------------------------------------------------
// Öffentliche Typen
// ---------------------------------------------------------------------------

/** Logisches Editor-Theme. `'auto'` folgt `prefers-color-scheme`. */
export type FindslEditorTheme = 'light' | 'dark' | 'auto' | FindslEditorThemeSpec;

export interface FindslEditorThemeSpec {
    base: 'light' | 'dark';
    /**
     * VS-Code-`colorCustomizations` als **sRGB-Hex** (`#rrggbb`) — KEIN oklch.
     * Der Konsument liefert bereits aufgelöste Farben (Theme-Quelle bleibt
     * beim Konsumenten). Beispiel: `{ "editor.background": "#fdfcfa" }`.
     */
    colorCustomizations?: Record<string, string>;
    /** Überschreibt die Default-Regel `*.internal → italic`. */
    semanticTokenColorCustomizations?: Record<string, unknown>;
}

export interface FindslEditorAppearance {
    /** Default: `"ui-monospace, monospace"`. */
    fontFamily?: string;
    /** Default: `13`. */
    fontSize?: number;
    /** Default: `4`. */
    tabSize?: number;
    /** Default: `false`. */
    minimap?: boolean;
    /** Gutter-Play-Pfeile je `testfall`. Default: `true`. */
    glyphMargin?: boolean;
}

export interface FindslEditorBehavior {
    /** Default: `false`. */
    wordWrap?: boolean;
    /** Default: `false`. */
    scrollBeyondLastLine?: boolean;
}

export interface FindslEditorOptions {
    /** Anfangsinhalt. Default: `""`. */
    initialCode?: string;
    /**
     * URL des LSP-Workers (aus `@findsl/web/worker`). Default: **root-absolut**
     * `/findsl-web/worker.js` (funktioniert auch auf Unterseiten). Der Konsument
     * hostet den Worker (Copy-Step; siehe README + `findsl-editor-copy-worker`).
     * Eine relative Angabe wird gegen `document.baseURI` aufgelöst.
     */
    workerUrl?: string | URL;
    /** Logisches Theme. Default: `'auto'`. */
    theme?: FindslEditorTheme;
    appearance?: FindslEditorAppearance;
    behavior?: FindslEditorBehavior;
    /** Bei echten Nutzer-Änderungen (NICHT bei `setCode`). */
    onChange?: () => void;
    /** Prüf-Auslöser aus dem Editor: CodeLens „Testfälle ausführen" / Gutter-Play. */
    onRun?: () => void;
    /** Nicht-fatale Fehlerpfade (z. B. CodeLens-Registrierung). Default: `console.warn`. */
    onError?: (err: unknown, context: string) => void;
}

export interface FindslEditorHandle {
    getCode(): string;
    setCode(code: string): void;
    /** `findsl/check` gegen das aktuelle Dokument. */
    check(): Promise<CheckResult>;
    /** `findsl/generate` für ein Ziel. `opts.className` setzt einen
     *  sprechenden Klassennamen fürs Generat (statt URI-Ableitung, #157). */
    generate(target: Target, opts?: GenerateOptions): Promise<GenerateResult>;
    /** `findsl/eval` — wertet einen FinDSL-Ausdruck (z. B. `Kst(50000)`) im
     *  Scope des Dokuments aus; liefert Wert + Typ + formatierten Text (#164). */
    evaluate(expr: string): Promise<EvalResult>;
    /** Listener bei Nutzer-Änderungen; gibt eine Unsubscribe-Funktion zurück. */
    onChange(listener: () => void): () => void;
    /** Listener bei Editor-Prüf-Auslöser; gibt eine Unsubscribe-Funktion zurück. */
    onRun(listener: () => void): () => void;
    /** Theme zur Laufzeit wechseln (z. B. aus dem Theme-Toggle des Konsumenten). */
    setTheme(theme: FindslEditorTheme): void;
    dispose(): Promise<void>;
    /**
     * @experimental Escape-Hatch für Power-User (eigene Custom-Requests,
     * direkter Decorations-Zugriff). **KEINE stabile API** — `MonacoLanguageClient`
     * und die URI-Form können sich mit Monaco-/`@codingame`-Versionen ändern.
     */
    readonly advanced: {
        readonly client: MonacoLanguageClient;
        readonly uri: string;
    };
}

// ---------------------------------------------------------------------------
// Theme / User-Settings
// ---------------------------------------------------------------------------

function resolveBase(theme: FindslEditorTheme): 'light' | 'dark' {
    if (typeof theme === 'object') return theme.base;
    if (theme === 'auto') {
        return typeof matchMedia === 'function'
            && matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
    }
    return theme;
}

/** VS-Code-User-Settings-JSON aus Theme + Appearance + Behavior. */
function buildUserSettings(
    theme: FindslEditorTheme,
    appearance: FindslEditorAppearance,
    behavior: FindslEditorBehavior,
): string {
    const base = resolveBase(theme);
    const colorCustomizations = typeof theme === 'object'
        ? theme.colorCustomizations ?? {}
        : {};
    const semanticTokens = (typeof theme === 'object' && theme.semanticTokenColorCustomizations)
        ? theme.semanticTokenColorCustomizations
        : { enabled: true, rules: { '*.internal': { fontStyle: 'italic' } } };
    return JSON.stringify({
        'workbench.colorTheme': base === 'dark' ? 'Default Dark Modern' : 'Default Light Modern',
        'workbench.colorCustomizations': colorCustomizations,
        'editor.wordBasedSuggestions': 'off',
        'editor.minimap.enabled': appearance.minimap ?? false,
        'editor.glyphMargin': appearance.glyphMargin ?? true,
        'editor.fontSize': appearance.fontSize ?? 13,
        'editor.fontFamily': appearance.fontFamily ?? 'ui-monospace, monospace',
        'editor.tabSize': appearance.tabSize ?? 4,
        'editor.renderLineHighlight': 'line',
        'editor.scrollBeyondLastLine': behavior.scrollBeyondLastLine ?? false,
        'editor.wordWrap': (behavior.wordWrap ?? false) ? 'on' : 'off',
        // Semantic Tokens des Langium-Servers über die TextMate-Färbung legen
        // (spiegelt configurationDefaults der echten Extension: `_`-intern kursiv).
        'editor.semanticHighlighting.enabled': true,
        'editor.semanticTokenColorCustomizations': semanticTokens,
    });
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

/**
 * Startet API-Wrapper, Editor und Language-Client (in genau dieser
 * Reihenfolge — siehe `registerLensCommand` zur Deadlock-Vermeidung) und
 * liefert ein {@link FindslEditorHandle}.
 */
export async function mountFindslEditor(
    container: HTMLElement,
    opts: FindslEditorOptions = {},
): Promise<FindslEditorHandle> {
    const onError = opts.onError ?? ((err, ctx) => console.warn(`[findsl-editor] ${ctx}`, err));
    const appearance = opts.appearance ?? {};
    const behavior = opts.behavior ?? {};
    let activeTheme: FindslEditorTheme = opts.theme ?? 'auto';

    const apiWrapper = new MonacoVscodeApiWrapper({
        $type: 'extended',
        viewsConfig: { $type: 'EditorService' },
        userConfiguration: { json: buildUserSettings(activeTheme, appearance, behavior) },
        // Sprach-Registrierung als synthetische Extension (Grammatik +
        // language-configuration) — wie die echte VS-Code-Extension.
        extensions: [
            {
                config: {
                    name: 'findsl-editor',
                    publisher: 'findsl',
                    version: '1.0.0',
                    engines: { vscode: '*' },
                    contributes: {
                        languages: [{
                            id: LANGUAGE_ID,
                            extensions: ['.findsl'],
                            aliases: ['FinDSL', 'findsl'],
                            configuration: './language-configuration.json',
                        }],
                        grammars: [{
                            language: LANGUAGE_ID,
                            scopeName: SCOPE_NAME,
                            path: './findsl.tmLanguage.json',
                        }],
                    },
                },
                filesOrContents: new Map<string, string | URL>([
                    ['./findsl.tmLanguage.json', findslGrammar],
                    ['./language-configuration.json', findslLanguageConfig],
                ]),
            },
        ],
        monacoWorkerFactory: configureDefaultWorkerFactory,
        advanced: { enforceSemanticHighlighting: true },
    });
    await apiWrapper.start();

    // Default ROOT-absolut (`/findsl-web/worker.js`): so findet der Editor den
    // am Root gehosteten Worker (Copy-Step → `public/findsl-web/`) auch auf
    // Unterseiten. Ein `baseURI`-relativer Default ergäbe auf z. B.
    // `/playground/` fälschlich `/playground/findsl-web/worker.js` → 404 mit
    // irreführendem „Illegal worker configuration" (#151-Dogfooding Finding #1).
    // Absolute `workerUrl` ignoriert die Basis; eine vom Konsumenten gesetzte
    // relative wird gegen `baseURI` aufgelöst (dessen bewusste Wahl).
    const workerUrl = new URL(opts.workerUrl ?? '/findsl-web/worker.js', document.baseURI);
    const lcWrapper = new LanguageClientWrapper({
        languageId: LANGUAGE_ID,
        connection: {
            options: {
                $type: 'WorkerConfig',
                url: workerUrl,
                type: 'module',
                workerName: 'findsl-language-server',
            },
        },
        clientOptions: { documentSelector: [LANGUAGE_ID] },
    });

    const filePath = `${FILE_PATH_BASE}-${++mountCounter}.findsl`;
    const editorApp = new EditorApp({
        codeResources: { modified: { text: opts.initialCode ?? '', uri: filePath } },
    });

    // Reihenfolge: Editor zuerst (öffnet das Dokument → didOpen), dann Client.
    await editorApp.start(container);
    await lcWrapper.start();

    const client = lcWrapper.getLanguageClient();
    if (!client) throw new Error('FinDSL-Language-Client konnte nicht starten.');

    const editor = editorApp.getEditor();
    const model = editor?.getModel();
    const uri = model?.uri.toString() ?? `file://${filePath}`;

    // ---- Prüf-Auslöser aus dem Editor (CodeLens + Gutter-Pfeil) ------------
    const disposables: monaco.IDisposable[] = [];
    let disposed = false;
    const runListeners = new Set<() => void>();
    const fireRun = (): void => {
        for (const listener of runListeners) listener();
    };
    if (opts.onRun) runListeners.add(opts.onRun);

    // Ein globales CodeLens-Kommando, fan-out je Dokument-URI → mehrere Mounts
    // auf einer Seite lösen jeweils den richtigen Editor aus.
    lensRunByUri.set(uri, fireRun);
    void registerLensCommand(onError);

    // Gutter-Play-Pfeile je `testfall` (Glyph-Margin-Decoration); neu gesetzt
    // bei jeder Inhaltsänderung (auch nach setCode/Beispielwechsel).
    let testfallLines = new Set<number>();
    const playMarkers = editor?.createDecorationsCollection([]);
    const refreshTestfallGutter = (): void => {
        const m = editor?.getModel();
        if (!m || !playMarkers) return;
        testfallLines = new Set();
        const decos: monaco.editor.IModelDeltaDecoration[] = [];
        for (let line = 1; line <= m.getLineCount(); line++) {
            if (!TESTFALL_RE.test(m.getLineContent(line))) continue;
            testfallLines.add(line);
            decos.push({
                range: new monaco.Range(line, 1, line, 1),
                options: {
                    glyphMarginClassName: 'findsl-editor__playglyph',
                    glyphMarginHoverMessage: { value: 'Testfall ausführen' },
                    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                },
            });
        }
        playMarkers.set(decos);
    };
    const mouseDown = editor?.onMouseDown((e) => {
        // Monaco-eigener Enum-Vergleich (MouseTargetType) — Typen korrekt.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return;
        const line = e.target.position?.lineNumber;
        if (line && testfallLines.has(line)) fireRun();
    });
    if (mouseDown) disposables.push(mouseDown);
    const gutterRefresh = model?.onDidChangeContent(() => refreshTestfallGutter());
    if (gutterRefresh) disposables.push(gutterRefresh);
    refreshTestfallGutter();

    // ---- Nutzer-Änderungen -------------------------------------------------
    const changeListeners = new Set<() => void>();
    if (opts.onChange) changeListeners.add(opts.onChange);
    const contentChange = model?.onDidChangeContent((e) => {
        // isFlush = programmatisches setValue (setCode) — ignorieren.
        if (!e.isFlush) for (const listener of changeListeners) listener();
    });
    if (contentChange) disposables.push(contentChange);

    // ---- `auto`-Theme: prefers-color-scheme live nachziehen ----------------
    const media = typeof matchMedia === 'function'
        ? matchMedia('(prefers-color-scheme: dark)')
        : undefined;
    const applyTheme = (): void => {
        void updateUserConfiguration(buildUserSettings(activeTheme, appearance, behavior));
    };
    const onMediaChange = (): void => {
        if (activeTheme === 'auto') applyTheme();
    };
    media?.addEventListener('change', onMediaChange);

    return {
        getCode: () => editorApp.getEditor()?.getModel()?.getValue() ?? '',
        setCode: (code) => editorApp.getEditor()?.getModel()?.setValue(code),
        async check() {
            try {
                return await client.sendRequest<CheckResult>('findsl/check', { uri });
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                return { cases: [], passed: 0, total: 0, durationMs: 0, error: msg };
            }
        },
        async generate(target, opts) {
            try {
                return await client.sendRequest<GenerateResult>(
                    'findsl/generate', { uri, target, className: opts?.className },
                );
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
        async evaluate(expr) {
            try {
                return await client.sendRequest<EvalResult>('findsl/eval', { uri, expr });
            } catch (err) {
                return { ok: false, error: err instanceof Error ? err.message : String(err) };
            }
        },
        onChange(listener) {
            changeListeners.add(listener);
            return () => changeListeners.delete(listener);
        },
        onRun(listener) {
            runListeners.add(listener);
            return () => runListeners.delete(listener);
        },
        setTheme(theme) {
            activeTheme = theme;
            applyTheme();
        },
        async dispose() {
            if (disposed) return;             // idempotent
            disposed = true;
            media?.removeEventListener('change', onMediaChange);
            for (const d of disposables) d.dispose();
            playMarkers?.clear();
            lensRunByUri.delete(uri);
            runListeners.clear();
            changeListeners.clear();
            await lcWrapper.dispose(true);
            await editorApp.dispose();
            // dispose() ist hier synchron (void) — kein await.
            apiWrapper.dispose();
        },
        advanced: { client, uri },
    };
}

// ---------------------------------------------------------------------------
// CodeLens-Kommando
// ---------------------------------------------------------------------------

let lensCommandRegistered = false;
// Dokument-URI → fireRun des jeweiligen Editors. Das CodeLens-Kommando ist
// global (ein Name); der Server liefert die URI als erstes Argument, sodass
// wir den passenden Editor auslösen — mehrere Mounts pro Seite sind sicher.
const lensRunByUri = new Map<string, () => void>();
// Monoton steigender Zähler für eindeutige Modell-URIs je Mount (s. FILE_PATH_BASE).
let mountCounter = 0;

/**
 * Registriert das Client-Kommando {@link LENS_RUN_COMMAND}, auf das der
 * Server-CodeLens „▶ N Testfälle ausführen" zeigt.
 *
 * Bewusst über eine synthetische Extension (`registerExtension(...).getApi()`
 * aus dem Basis-Paket `@codingame/monaco-vscode-api`) statt über den globalen
 * `@codingame/monaco-vscode-extension-api`-Import: Letzterer würde als
 * zweiter, schwerer vscode-API-Stack mit dem `MonacoVscodeApiWrapper` um die
 * Service-Initialisierung konkurrieren und den Editor-Start verklemmen. Der
 * dynamische Import läuft erst NACH `apiWrapper.start()` (Services stehen) und
 * non-blocking — ein Verzug bei der Aktivierung darf den Start nicht aufhalten.
 */
async function registerLensCommand(
    onError: (err: unknown, context: string) => void,
): Promise<void> {
    if (lensCommandRegistered) return;
    lensCommandRegistered = true;
    try {
        const { registerExtension, ExtensionHostKind } =
            await import('@codingame/monaco-vscode-api/extensions');
        const { getApi } = registerExtension(
            {
                name: 'findsl-editor-run',
                publisher: 'findsl',
                version: '1.0.0',
                engines: { vscode: '*' },
            },
            ExtensionHostKind.LocalProcess,
        );
        const api = await getApi();
        // Server-CodeLens übergibt [uri, pruefeIndex] → den Editor dieser URI
        // auslösen; Fallback auf den einzigen/ersten Editor (Single-Mount).
        api.commands.registerCommand(LENS_RUN_COMMAND, (uriArg?: unknown) => {
            const byUri = typeof uriArg === 'string' ? lensRunByUri.get(uriArg) : undefined;
            const fn = byUri ?? [...lensRunByUri.values()][0];
            fn?.();
        });
    } catch (err) {
        lensCommandRegistered = false;
        onError(err, 'CodeLens-Kommando (Testfälle ausführen) nicht registriert');
    }
}
