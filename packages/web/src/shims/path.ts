// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Browser-Shim für `node:path` (posix-Teilmenge). Die Sprachdienste nutzen
 * nur basename/dirname/normalize/relative/resolve/sep/join — `EmptyFileSystem`
 * arbeitet mit posix-URIs, volle node:path-Semantik ist nicht nötig. Per
 * esbuild-`alias` im Browser-Bundle eingehängt (Single-File-Playground; ohne
 * cwd ankert `resolve` an `/`).
 */

export const sep = '/';

export function normalize(p: string): string {
    const isAbs = p.startsWith('/');
    const out: string[] = [];
    for (const part of p.split('/')) {
        if (part === '' || part === '.') continue;
        if (part === '..') {
            if (out.length && out[out.length - 1] !== '..') out.pop();
            else if (!isAbs) out.push('..');
        } else {
            out.push(part);
        }
    }
    let res = out.join('/');
    if (isAbs) res = '/' + res;
    if (p.endsWith('/') && res !== '' && res !== '/') res += '/';
    return res === '' ? (isAbs ? '/' : '.') : res;
}

export function join(...segs: string[]): string {
    const joined = segs.filter((s) => s.length > 0).join('/');
    return joined === '' ? '.' : normalize(joined);
}

export function dirname(p: string): string {
    if (/^\/+$/.test(p)) return '/'; // Wurzel (Node: dirname('/') === '/')
    const n = p.replace(/\/+$/, '');
    const i = n.lastIndexOf('/');
    if (i < 0) return '.';
    if (i === 0) return '/';
    return n.slice(0, i);
}

export function basename(p: string, ext?: string): string {
    let b = p.replace(/\/+$/, '');
    b = b.slice(b.lastIndexOf('/') + 1);
    if (ext && b.length > ext.length && b.endsWith(ext)) b = b.slice(0, -ext.length);
    return b;
}

export function extname(p: string): string {
    const b = basename(p);
    const i = b.lastIndexOf('.');
    return i > 0 ? b.slice(i) : '';
}

export function isAbsolute(p: string): boolean {
    return p.startsWith('/');
}

export function resolve(...segs: string[]): string {
    let resolved = '';
    let isAbs = false;
    for (let i = segs.length - 1; i >= 0 && !isAbs; i--) {
        const seg = segs[i];
        if (!seg) continue;
        resolved = resolved ? `${seg}/${resolved}` : seg;
        isAbs = seg.startsWith('/');
    }
    if (!isAbs) resolved = '/' + resolved; // kein cwd im Browser → Wurzel-Anker
    return normalize(resolved) || '/';
}

export function relative(from: string, to: string): string {
    const f = resolve(from).split('/').filter(Boolean);
    const t = resolve(to).split('/').filter(Boolean);
    let i = 0;
    while (i < f.length && i < t.length && f[i] === t[i]) i++;
    return [...f.slice(i).map(() => '..'), ...t.slice(i)].join('/');
}

const posix = { sep, normalize, join, dirname, basename, extname, isAbsolute, resolve, relative };
export { posix };
export default { ...posix, posix };
