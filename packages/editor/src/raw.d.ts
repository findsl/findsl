// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * `?raw`-Importe (Vite/webpack-`asset/source`): liefern den Roh-Textinhalt
 * eines Assets als Default-String. `@findsl/editor` nutzt das für die
 * TextMate-Grammatik + language-configuration aus `@findsl/web`. tsc bündelt
 * nicht — der Suffix wird vom Konsumenten-Bundler aufgelöst; hier nur die
 * ambient-Typdeklaration, damit der Editor-Build typcheckt.
 */
declare module '*?raw' {
    const content: string;
    export default content;
}
