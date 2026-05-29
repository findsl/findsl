// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

// Regel-Overrides für die typ-bewussten Blöcke (src der Pakete/Apps + Web-
// Runtime). Einmal definiert, in beiden Blöcken wiederverwendet (DRY).
const typedRules = {
    // `_`-präfigierte Parameter/Variablen sind bewusst ungenutzt
    // (Signatur-Konformität, Destructuring-Reste) — Standard-Konvention.
    '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
    }],
    // Aus: erzeugt hier ausschließlich Fehlalarme. (1) Langium bindet die
    // an `registry.register(checks, validator)` übergebenen Validator-
    // Methoden selbst (findsl-validator.ts); (2) extrahierte statische
    // Factories (`NumericValue.cent/euro`) und Node-Core `fs.glob` sind
    // `this`-unabhängig. Ein erzwungenes `.bind` wäre reines Rauschen.
    '@typescript-eslint/unbound-method': 'off',
};

export default tseslint.config(
    {
        ignores: [
            '**/out/**',
            '**/dist/**',
            '**/node_modules/**',
            '**/*.generated.ts',
            '**/generated/**',
            '.ts-gate-*/**',
            'runtimes/java/**',
        ],
    },

    // Typ-bewusster, strikter Lint nur für Produktiv-`src` der Pakete/Apps —
    // dort lohnt das volle Programm (no-floating-promises, unsichere Casts,
    // no-explicit-any; Issue #208/#H5). Diese Dateien hängen alle an einem
    // tsconfig-Projekt (Root-References → core/lsp/cli/apps/vscode), das der
    // projectService auflöst.
    {
        files: ['packages/*/src/**/*.ts', 'apps/*/src/**/*.ts'],
        // `packages/web/src` wird über die nicht-standardisierte
        // `tsconfig.check.json` typgeprüft (der projectService kennt nur die
        // Standard-`tsconfig.json`, die dort nur index/types umfasst) — eigener
        // Block weiter unten mit explizitem Projekt.
        ignores: ['packages/web/**'],
        extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                projectService: true,
                tsconfigRootDir: import.meta.dirname,
            },
            globals: { ...globals.node },
        },
        rules: typedRules,
    },

    // Web-Runtime (Worker/Browser): bündelt esbuild separat; Typprüfung läuft
    // über `tsconfig.check.json` (src/**), nicht die Standard-`tsconfig.json`.
    {
        files: ['packages/web/src/**/*.ts'],
        extends: [eslint.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
        languageOptions: {
            parserOptions: {
                project: './packages/web/tsconfig.check.json',
                tsconfigRootDir: import.meta.dirname,
            },
            globals: { ...globals.node, ...globals.browser, ...globals.worker },
        },
        rules: typedRules,
    },

    // Untypisierter Lint für Tests, Build-Skripte, Configs und die
    // eingebettete TS-Runtime: kein tsconfig-Projekt umfasst sie (core/test
    // ist aus dem core-tsconfig exkludiert; `.mjs`-Skripte gar nicht), und
    // Korrektheit deckt hier bereits tsc/Vitest bzw. die Codegen-Gates ab.
    // `recommended` (ohne Typinfo) fängt trotzdem echte Bugs (no-undef etc.).
    {
        files: [
            '**/test/**/*.ts',
            'runtimes/ts/**/*.ts',
            '**/*.mjs',
            '**/*.config.{js,ts,mjs}',
        ],
        extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
        ...tseslint.configs.disableTypeChecked,
        languageOptions: {
            globals: { ...globals.node },
        },
        rules: {
            // Tests casten bewusst auf interne AST-/Programm-Formen
            // (`modules[0].program as any`), um Implementierungsdetails zu
            // prüfen — hier ist `any` ein pragmatisches Test-Werkzeug.
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },

    prettier,
);
