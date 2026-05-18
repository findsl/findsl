/**
 * Doc-Generator — strukturiertes Zwischenmodell (`DocModel`).
 *
 * Extrahiert aus geparsten FinDSL-Modulen alles Audit-Relevante:
 * Modul-/Deklarations-Doc-Kommentare (Markdown), Signaturen
 * (quelltext-treu aus dem CST), `@Quelle`-Referenzen (mit
 * gesetze-im-internet-Links via `parseQuelleRefs`), `datensatz`-Feld-
 * Doku aus trailing `//` (SPEC § 4.15), Aufzählungs-Werte, `konst`-
 * Werte, `prüfe`/`testfall` als „Worked Examples" und den Anhang
 * „Explizit ausgeschlossene Konstellationen" aus `collectAbbruchSites()`.
 *
 * Reines Datenmodell — Renderer (Markdown/HTML/PDF) hängen daran.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import { createFindslServices } from '../language/findsl-module.js';
import {
    isAufzaehlungDecl,
    isDatensatzDecl,
    isFunktionDecl,
    isKonstDecl,
    isPruefeDecl,
    type Program,
} from '../language/generated/ast.js';
import { collectAbbruchSites, type AbbruchSite } from '../language/findsl-abbruch-sites.js';
import { commonBase, displayId, isInternalName } from '../language/import-path.js';
import { parseQuelleRefs, linkifyQuelleProsa, type QuelleRef } from './quelle.js';

export interface QuelleEntry {
    /** Roher `@Quelle`-Text ohne Anführungszeichen. */
    readonly text: string;
    /** Aufgelöste Paragraf-Referenzen mit Links (kann leer sein). */
    readonly refs: ReadonlyArray<QuelleRef>;
}

export interface FieldDoc {
    readonly name: string;
    readonly type: string;
    /** Trailing-`//`-Doku der Feldzeile (SPEC § 4.15), falls vorhanden. */
    readonly doc?: string;
}

export interface ParamDoc {
    readonly name: string;
    readonly desc: string;
}

export interface DeclDoc {
    readonly kind: 'konst' | 'fn' | 'datensatz' | 'aufzählung' | 'prüfe';
    readonly name: string;
    /** Quelltext-treue Signatur (ohne Body / ohne Doc-Block). */
    readonly signature: string;
    /** Doc-Kommentar als Markdown (Marker + `@param`/`@rückgabe`
     *  entfernt), ggf. leer. */
    readonly doc: string;
    readonly quellen: ReadonlyArray<QuelleEntry>;
    /** `@param`-Tags (Funktionen u. Ä.); bei `datensatz` in `fields`
     *  eingewoben und daher hier nicht gesetzt. */
    readonly params?: ReadonlyArray<ParamDoc>;
    /** `@rückgabe`-Tag (Funktionen). */
    readonly returns?: string;
    /** Nur `datensatz`: Felder mit Typ + §4.15-/`@param`-Doku. */
    readonly fields?: ReadonlyArray<FieldDoc>;
    /** Nur `aufzählung`: Werte. */
    readonly values?: ReadonlyArray<string>;
    /** Nur `prüfe`: Beispiele (Label + Block-Quelltext + erwartetAbbruch). */
    readonly examples?: ReadonlyArray<{
        readonly label: string;
        readonly code: string;
        readonly erwartetAbbruch: boolean;
    }>;
}

export interface ModuleDoc {
    /** Kapitelname = Datei-Identität (relativer Pfad ohne `.findsl`). */
    readonly name: string;
    /** Relativer Dateipfad **mit** `.findsl` (gleiche Basis wie `name`),
     *  als kleine, ausgegraute Zeile unter dem Kapitelnamen gerendert. */
    readonly pfad: string;
    readonly doc: string;
    readonly decls: ReadonlyArray<DeclDoc>;
    readonly abbruchSites: ReadonlyArray<AbbruchSite>;
}

export interface DocModel {
    readonly modules: ReadonlyArray<ModuleDoc>;
}

/** Entfernt die `--`-Doc-Marker und führende/abschließende Leerzeile. */
function stripDocMarkers(raw: string | undefined): string {
    if (!raw) return '';
    let s = raw;
    if (s.startsWith('--')) s = s.slice(2);
    if (s.endsWith('--'))   s = s.slice(0, -2);
    return s.replace(/^\s*\n/, '').replace(/\n\s*$/, '').trim();
}

/**
 * Trennt `@param <name> …` / `@rückgabe …` aus dem Doc-Markdown
 * heraus → strukturierte Tags + bereinigte Prosa. Fortsetzungszeilen
 * sind eingerückt (Ausrichtung); eine nicht-eingerückte oder leere
 * Zeile beendet einen Tag. Innerhalb von ``` … ```-Codeblöcken wird
 * NICHT geparst (Tags bleiben dort wörtlich in der Prosa).
 */
function parseDocTags(doc: string): {
    prose: string;
    params: ParamDoc[];
    returns?: string;
} {
    const proseLines: string[] = [];
    const params: ParamDoc[] = [];
    let returns: string | undefined;
    let fence = false;
    let mathBlock = false;
    let active: { kind: 'param' | 'return'; name?: string; parts: string[] } | null = null;
    const flush = (): void => {
        if (!active) return;
        const desc = active.parts.join(' ').replace(/\s+/g, ' ').trim();
        if (active.kind === 'param' && active.name) {
            params.push({ name: active.name, desc });
        } else if (active.kind === 'return') {
            returns = desc;
        }
        active = null;
    };
    for (const ln of doc.split('\n')) {
        if (/^\s*```/.test(ln)) { flush(); fence = !fence; proseLines.push(ln); continue; }
        if (fence) { proseLines.push(ln); continue; }
        // Mehrzeilige `$$…$$`-Mathe wie Fences behandeln: Zeilen darin
        // sind Prosa und dürfen `@param`/`@rückgabe` NICHT triggern
        // (eine ungerade `$$`-Anzahl öffnet/schließt den Block).
        const dd = (ln.match(/\$\$/g) ?? []).length;
        if (mathBlock) { proseLines.push(ln); if (dd % 2 === 1) mathBlock = false; continue; }
        if (dd % 2 === 1) { flush(); mathBlock = true; proseLines.push(ln); continue; }
        const pm = ln.match(/^@param\s+(\S+)\s*(.*)$/u);
        const rm = ln.match(/^@rückgabe\s*(.*)$/u);
        if (pm) { flush(); active = { kind: 'param', name: pm[1], parts: pm[2] ? [pm[2]] : [] }; continue; }
        if (rm) { flush(); active = { kind: 'return', parts: rm[1] ? [rm[1]] : [] }; continue; }
        if (active) {
            if (/^\s+\S/.test(ln)) { active.parts.push(ln.trim()); continue; }
            flush();
        }
        proseLines.push(ln);
    }
    flush();
    const prose = proseLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { prose, params, returns };
}

/** Sammelt rekursiv alle `.findsl`-Dateien unter `root` (Datei → [Datei]). */
export async function findFinFiles(root: string): Promise<string[]> {
    const st = await fs.stat(root);
    if (st.isFile()) return root.endsWith('.findsl') ? [root] : [];
    const out: string[] = [];
    for (const entry of await fs.readdir(root, { withFileTypes: true })) {
        const p = path.join(root, entry.name);
        if (entry.isDirectory()) out.push(...await findFinFiles(p));
        else if (entry.isFile() && entry.name.endsWith('.findsl')) out.push(p);
    }
    return out.sort();
}

/**
 * Baut das aggregierte `DocModel` über alle übergebenen `.findsl`-Dateien.
 * Die Modul-Identität ist der Dateipfad relativ zur gemeinsamen Basis
 * aller Dateien (ohne `.findsl`); es gibt keinen `modul`-Header mehr. Der
 * erste `--…--`-Block der Datei (`fileDoc`) ist die Kapitel-Beschreibung.
 * Sortiert nach dieser Identität; Parsefehler einzelner Dateien werden
 * toleriert (Datei wird mit dem geparsten Teil aufgenommen).
 */
export async function buildDocModel(files: ReadonlyArray<string>): Promise<DocModel> {
    const services = createFindslServices(NodeFileSystem).Findsl;
    const modules: ModuleDoc[] = [];
    const absFiles = files.map((f) => path.resolve(f));
    const base = commonBase(absFiles);

    for (const file of files) {
        const abs = path.resolve(file);
        const content = await fs.readFile(file, 'utf-8');
        const document = services.shared.workspace.LangiumDocumentFactory.fromString(
            content, URI.file(abs),
        );
        await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
        const program = document.parseResult.value as Program;
        const src = document.textDocument.getText();

        // Relativer Dateipfad MIT `.findsl` (gleiche Basis wie `name`,
        // `/`-getrennt) — als ausgegraute Zeile unter dem Kapitelnamen.
        const pfad = (base
            ? path.relative(base, path.normalize(abs))
            : path.basename(abs)
        ).split(path.sep).join('/');

        modules.push({
            name: displayId(abs, base),
            pfad,
            doc: linkifyQuelleProsa(stripDocMarkers(program.fileDoc?.doc)),
            // `_`-Interne (SPEC § 4.16) sind nicht Teil der öffentlichen
            // API → nicht in der generierten Doku. Der abbruch-Anhang
            // bleibt vollständig (Audit-Katalog ausgeschlossener
            // Konstellationen — auch aus internen Helfern).
            decls: program.decls
                .filter((d) => !isInternalName(d.name ?? ''))
                .map((d) => declDoc(d, src)),
            abbruchSites: collectAbbruchSites(program),
        });
    }

    modules.sort((a, b) => a.name.localeCompare(b.name));
    return { modules };
}

/** Quelltext-Slice eines CST-Knotens. */
function cstText(node: { $cstNode?: { offset: number; length: number } } | undefined, src: string): string {
    const c = node?.$cstNode;
    return c ? src.slice(c.offset, c.offset + c.length) : '';
}

/** Offset, an dem die Deklaration NACH ihrem Doc-Prefix beginnt. */
function keywordOffset(
    decl: { $cstNode?: { offset: number }; docPrefix?: { $cstNode?: { offset: number; length: number } } },
): number {
    const dp = decl.docPrefix?.$cstNode;
    if (dp) return dp.offset + dp.length;
    return decl.$cstNode?.offset ?? 0;
}

function quellenOf(
    decl: { docPrefix?: { annotations: ReadonlyArray<{ name: string; args: ReadonlyArray<unknown> }> } },
): QuelleEntry[] {
    const anns = decl.docPrefix?.annotations ?? [];
    const out: QuelleEntry[] = [];
    for (const a of anns) {
        if (a.name !== 'Quelle') continue;
        const arg = a.args[0] as { $type?: string; value?: string } | undefined;
        if (!arg || arg.$type !== 'StringLiteral' || typeof arg.value !== 'string') continue;
        const raw = arg.value;                       // inkl. Anführungszeichen
        out.push({ text: raw.replace(/^"|"$/g, ''), refs: parseQuelleRefs(raw) });
    }
    return out;
}

/** Trailing-`//`-Kommentar der Zeile, in der der Feld-CST endet (§ 4.15). */
function trailingLineComment(
    node: { $cstNode?: { offset: number; length: number } }, src: string,
): string | undefined {
    const c = node.$cstNode;
    if (!c) return undefined;
    const after = c.offset + c.length;
    const nl = src.indexOf('\n', after);
    const rest = src.slice(after, nl === -1 ? src.length : nl);
    const m = rest.match(/\/\/[ \t]?(.*)$/);
    return m ? m[1].trim() : undefined;
}

function declDoc(decl: Program['decls'][number], src: string): DeclDoc {
    // §-Referenzen schon vor dem Tag-Split verlinken → Prosa,
    // `@param`- und `@rückgabe`-Beschreibungen erhalten alle Links.
    const { prose: doc, params, returns } = parseDocTags(
        linkifyQuelleProsa(stripDocMarkers(decl.docPrefix?.doc)),
    );
    const quellen = quellenOf(decl);
    const name = decl.name ?? '?';
    // `@param`/`@rückgabe` als strukturierte Felder (außer datensatz —
    // dort in die Feld-Tabelle eingewoben, s. u.).
    const tags = params.length > 0 || returns !== undefined
        ? { params: params.length > 0 ? params : undefined, returns }
        : {};

    if (isFunktionDecl(decl)) {
        // Signatur = ab Keyword bis Body-Start (Body ausgeschlossen).
        const kw = keywordOffset(decl);
        const bodyStart = decl.body?.$cstNode?.offset
            ?? (decl.$cstNode ? decl.$cstNode.offset + decl.$cstNode.length : kw);
        return { kind: 'fn', name, signature: src.slice(kw, bodyStart).trim(), doc, quellen, ...tags };
    }
    if (isKonstDecl(decl)) {
        const kw = keywordOffset(decl);
        const end = decl.$cstNode ? decl.$cstNode.offset + decl.$cstNode.length : kw;
        return { kind: 'konst', name, signature: src.slice(kw, end).trim(), doc, quellen, ...tags };
    }
    if (isDatensatzDecl(decl)) {
        const kw = keywordOffset(decl);
        const end = decl.$cstNode ? decl.$cstNode.offset + decl.$cstNode.length : kw;
        // `@param <feld>` gewinnt gegen den §4.15-Trailing-//-Kommentar
        // (reichere Erklärung) — keine separate Parameter-Liste am
        // Datensatz, damit nichts doppelt gerendert wird.
        const byName = new Map(params.map((p) => [p.name, p.desc]));
        const fields: FieldDoc[] = decl.fields.map((f) => {
            const tc = trailingLineComment(f, src);
            return {
            name: f.name,
            type: cstText(f.type, src).trim() || '?',
            doc: byName.get(f.name)
                ?? (tc ? linkifyQuelleProsa(tc) : undefined),
            };
        });
        return { kind: 'datensatz', name, signature: src.slice(kw, end).trim(), doc, quellen, fields };
    }
    if (isAufzaehlungDecl(decl)) {
        const kw = keywordOffset(decl);
        const end = decl.$cstNode ? decl.$cstNode.offset + decl.$cstNode.length : kw;
        return {
            kind: 'aufzählung', name, signature: src.slice(kw, end).trim(),
            doc, quellen, values: [...decl.values], ...tags,
        };
    }
    if (isPruefeDecl(decl)) {
        const examples = decl.beispiele.map((b) => ({
            label: b.label,
            code: cstText(b.body, src).replace(/^\{\s*|\s*\}$/g, '').trim(),
            erwartetAbbruch: b.erwartetAbbruch === true,
        }));
        return {
            kind: 'prüfe', name, signature: `prüfe "${name}"`,
            doc, quellen, examples, ...tags,
        };
    }
    return { kind: 'fn', name, signature: cstText(decl, src).trim(), doc, quellen, ...tags };
}
