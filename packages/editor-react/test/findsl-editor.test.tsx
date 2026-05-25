// @vitest-environment jsdom
// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Lebenszyklus-Tests der <FindslEditor>-Bindung (#162) — testet die React-
 * Logik (Mount/Dispose, cancel-Race, Ref-Delegation, Theme-live) gegen ein
 * GEMOCKTES `@findsl/editor`; kein echter Monaco/Browser nötig.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { createRef, StrictMode } from 'react';

const mocks = vi.hoisted(() => {
    const handle = {
        getCode: vi.fn(() => 'CODE'),
        setCode: vi.fn(),
        check: vi.fn(async () => ({ cases: [], passed: 0, total: 0, durationMs: 0 })),
        generate: vi.fn(async () => ({ ok: true })),
        onChange: vi.fn(() => () => {}),
        onRun: vi.fn(() => () => {}),
        setTheme: vi.fn(),
        dispose: vi.fn(async () => {}),
        advanced: { client: {}, uri: 'file:///workspace/main.findsl' },
    };
    const state = { lastOpts: undefined as Record<string, unknown> | undefined,
        deferred: false, resolve: (() => {}) as () => void };
    const mountFindslEditor = vi.fn((_el: HTMLElement, opts: Record<string, unknown>) => {
        state.lastOpts = opts;
        if (state.deferred) return new Promise((res) => { state.resolve = () => res(handle); });
        return Promise.resolve(handle);
    });
    return { handle, state, mountFindslEditor };
});

vi.mock('@findsl/editor', () => ({ mountFindslEditor: mocks.mountFindslEditor }));

// eslint-disable-next-line import/first
import { FindslEditor, type FindslEditorRef } from '../src/index.js';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.deferred = false;
});

describe('<FindslEditor> Lebenszyklus (#162)', () => {
    it('mountet mit gemappten Optionen und meldet onReady', async () => {
        const onReady = vi.fn();
        render(<FindslEditor defaultValue="modul m" theme="dark" onReady={onReady} />);
        await waitFor(() => expect(onReady).toHaveBeenCalledWith(mocks.handle));
        expect(mocks.state.lastOpts?.initialCode).toBe('modul m');
        expect(mocks.state.lastOpts?.theme).toBe('dark');
    });

    it('disposed das Handle beim Unmount', async () => {
        const onReady = vi.fn();
        const { unmount } = render(<FindslEditor onReady={onReady} />);
        await waitFor(() => expect(onReady).toHaveBeenCalled());
        unmount();
        expect(mocks.handle.dispose).toHaveBeenCalledTimes(1);
    });

    it('disposed auch bei Unmount VOR Mount-Abschluss (cancel-Race / StrictMode)', async () => {
        mocks.state.deferred = true;
        const onReady = vi.fn();
        const { unmount } = render(<FindslEditor onReady={onReady} />);
        unmount();                 // Cleanup feuert, während mount() noch pendet
        mocks.state.resolve();     // mount() löst erst JETZT auf
        await waitFor(() => expect(mocks.handle.dispose).toHaveBeenCalled());
        expect(onReady).not.toHaveBeenCalled();   // kein onReady für abgebrochenen Mount
    });

    it('Ref delegiert check/generate/getCode ans Handle', async () => {
        const ref = createRef<FindslEditorRef>();
        render(<FindslEditor ref={ref} />);
        await waitFor(() => expect(ref.current?.handle).toBe(mocks.handle));
        await ref.current!.check();
        expect(mocks.handle.check).toHaveBeenCalled();
        await ref.current!.generate('java');
        expect(mocks.handle.generate).toHaveBeenCalledWith('java', undefined);
        expect(ref.current!.getCode()).toBe('CODE');
    });

    it('StrictMode-Doppel-Mount: genau ein lebendes Handle, kein verwaister Editor', async () => {
        const onReady = vi.fn();
        // StrictMode invoked Effects im Dev-Build doppelt (mount→cleanup→mount):
        // der erste, abgebrochene Mount muss disposed werden, der zweite lebt.
        const { unmount } = render(
            <StrictMode><FindslEditor onReady={onReady} /></StrictMode>,
        );
        expect(mocks.mountFindslEditor).toHaveBeenCalledTimes(2);   // zwei Effect-Läufe
        await waitFor(() => expect(onReady).toHaveBeenCalledTimes(1));   // nur der lebende Mount
        expect(mocks.handle.dispose).toHaveBeenCalledTimes(1);          // der abgebrochene erste
        unmount();
        expect(mocks.handle.dispose).toHaveBeenCalledTimes(2);          // + der lebende beim Unmount
    });

    it('theme-Prop-Wechsel wird live via setTheme angewandt (kein Re-Mount)', async () => {
        const onReady = vi.fn();
        const { rerender } = render(<FindslEditor theme="light" onReady={onReady} />);
        await waitFor(() => expect(onReady).toHaveBeenCalled());
        mocks.mountFindslEditor.mockClear();
        rerender(<FindslEditor theme="dark" onReady={onReady} />);
        await waitFor(() => expect(mocks.handle.setTheme).toHaveBeenCalledWith('dark'));
        expect(mocks.mountFindslEditor).not.toHaveBeenCalled();   // kein Re-Mount
    });
});
