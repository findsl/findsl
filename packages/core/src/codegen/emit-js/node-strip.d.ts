// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

/**
 * Typ-Augmentation für `node:module.stripTypeScriptTypes` (Node ≥ 22.13 /
 * Repo-Standard Node 24). Das Repo pinnt aktuell `@types/node@20`, das die
 * (in Node 24 vorhandene, dort noch experimentelle) API noch nicht kennt
 * → minimale, mergende Modul-Augmentation statt eines breiten
 * `@types/node`-Bumps. Bei einem späteren Bump auf `@types/node@≥22.13`
 * kann diese Datei entfallen.
 *
 * Quelle: https://nodejs.org/api/module.html#modulestriptypescripttypescode-options
 */
declare module 'node:module' {
    interface StripTypeScriptTypesOptions {
        /** `'strip'` (Default) entfernt nur Typen; `'transform'` wandelt
         *  zusätzlich `enum`/Namespace/`readonly`-ctor-Params in JS um. */
        readonly mode?: 'strip' | 'transform';
        readonly sourceMap?: boolean;
        readonly sourceUrl?: string;
    }
    export function stripTypeScriptTypes(
        code: string, options?: StripTypeScriptTypesOptions,
    ): string;
}
