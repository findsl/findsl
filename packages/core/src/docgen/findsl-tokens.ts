/**
 * Gemeinsamer, abhängigkeitsfreier FinDSL-Tokenizer für die Doc-
 * Renderer. EINE Quelle für Syntax-Highlighting — HTML (Spans) und PDF
 * (pdfmake-Runs) mappen die Token-Arten nur unterschiedlich.
 *
 * Scanner (kein Regex-Ersetzen) → korrekt bei Keywords in Strings/
 * Kommentaren. Unbekanntes wird als `plain` durchgereicht.
 */

export type TokenKind =
    | 'kw' | 'type' | 'str' | 'num' | 'com' | 'anno' | 'plain';

export interface FindslToken {
    readonly kind: TokenKind;
    readonly text: string;
}

const KEYWORDS = new Set([
    'modul', 'verwende', 'aus', 'als', 'konst', 'fn', 'datensatz',
    'aufzählung', 'prüfe', 'testfall', 'erwartet', 'abbruch', 'var',
    'wenn', 'sonst', 'wähle', 'falls', 'für', 'jeden', 'jede', 'bis',
    'unter', 'schritt', 'nicht', 'und', 'oder', 'ist', 'nichts',
    'wahr', 'falsch', 'ausgabe',
]);
const TYPES = new Set([
    'Euro', 'EuroCent', 'Cent', 'Prozent', 'Ganzzahl', 'Dezimal',
    'Text', 'Wahrheitswert', 'Liste', 'Bereich',
]);
const ID_START = /[A-Za-zÀ-ÿ_]/;
const ID_CONT = /[A-Za-zÀ-ÿ0-9_]/;

/** Zerlegt FinDSL-Quelltext in Highlight-Token (zusammenhängend). */
export function tokenizeFindsl(code: string): FindslToken[] {
    const toks: FindslToken[] = [];
    const push = (kind: TokenKind, text: string): void => {
        if (!text) return;
        const last = toks[toks.length - 1];
        if (last && last.kind === kind && kind === 'plain') {
            toks[toks.length - 1] = { kind, text: last.text + text };
        } else {
            toks.push({ kind, text });
        }
    };
    let i = 0;
    const n = code.length;
    while (i < n) {
        const c = code[i];
        if (c === '/' && code[i + 1] === '/') {
            const e = code.indexOf('\n', i); const end = e === -1 ? n : e;
            push('com', code.slice(i, end)); i = end; continue;
        }
        if (code.startsWith('"""', i)) {
            const e = code.indexOf('"""', i + 3);
            const end = e === -1 ? n : e + 3;
            push('str', code.slice(i, end)); i = end; continue;
        }
        if (c === '"') {
            let j = i + 1;
            while (j < n && code[j] !== '"') j += code[j] === '\\' ? 2 : 1;
            j = Math.min(j + 1, n);
            push('str', code.slice(i, j)); i = j; continue;
        }
        if (c === '@' && ID_START.test(code[i + 1] ?? '')) {
            let j = i + 1; while (j < n && ID_CONT.test(code[j])) j++;
            push('anno', code.slice(i, j)); i = j; continue;
        }
        if (/[0-9]/.test(c)) {
            let j = i; while (j < n && /[0-9.,]/.test(code[j])) j++;
            if (code[j] === '%') j++;
            push('num', code.slice(i, j)); i = j; continue;
        }
        if (ID_START.test(c)) {
            let j = i; while (j < n && ID_CONT.test(code[j])) j++;
            const w = code.slice(i, j);
            const kind: TokenKind = KEYWORDS.has(w) ? 'kw'
                : TYPES.has(w) || /^[A-ZÄÖÜ]/.test(w) ? 'type'
                : 'plain';
            push(kind, w); i = j; continue;
        }
        push('plain', c); i++;
    }
    return toks;
}
