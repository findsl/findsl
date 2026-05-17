/**
 * Ambient-Deklarationen für die kompilierten CJS-Submodule von
 * `pdfmake` 0.3 (`js/*`). `@types/pdfmake` deckt nur das Hauptmodul ab;
 * die Server-API (`Printer`/`virtual-fs`/`URLResolver`) wird in
 * `docgen/pdf.ts` per statischem Default-Import geladen (esbuild-
 * bündelbar → self-contained CLI) und dort über `cjsDefault<T>()`
 * runtime-robust auf den konkreten Typ ausgepackt.
 */
declare module 'pdfmake/js/Printer.js' {
    const mod: unknown;
    export default mod;
}
declare module 'pdfmake/js/virtual-fs.js' {
    const mod: unknown;
    export default mod;
}
declare module 'pdfmake/js/URLResolver.js' {
    const mod: unknown;
    export default mod;
}
