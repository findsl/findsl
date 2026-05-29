/**
 * Doc-Generator — **Dokumentkopf** (Titelseite/Einleitung).
 *
 * Quelle des Titelseiten-Inhalts ist eine optionale Markdown-Datei mit
 * YAML-artigem Front-Matter (CLI: `findsl doku … --kopf <datei>`):
 *
 * ```
 * ---
 * name: Kraftfahrzeugsteuer
 * autor: Max Mustermann
 * untertitel: Jahressteuer nach §§ 8, 9 KraftStG
 * beschreibung: Vollständige, prüfbare Abbildung des Tarifs.
 * lizenz: MIT
 * metadaten:
 *   ressort: Steuerrecht
 *   stand: KraftStG 2002 i.d.g.F.
 * ---
 * ## Einleitung
 *
 * Beliebiger Markdown-Fließtext als Vorwort …
 * ```
 *
 * Feld-Zuordnung: `name` (oder `titel`) → Deckblatt-Überschrift;
 * `untertitel`/`autor`/`beschreibung`/`lizenz` → Deckblatt-Metablock;
 * `metadaten:` (eingerückte Map) → zusätzliche Schlüssel/Wert-Zeilen;
 * unbekannte Top-Level-Schlüssel landen ebenfalls als Metadaten
 * („und andere Informationen"). Der Rumpf nach dem zweiten `---` ist
 * die Einleitung (Markdown).
 *
 * Fehlt die Datei (oder `--kopf`), werden **Titel und Untertitel aus
 * dem ersten Modul abgeleitet** (erste Markdown-Überschrift bzw. erster
 * Absatz des führenden Datei-Doc-Blocks). Reines, testbares Datenmodell;
 * die Renderer (md/html/pdf) konsumieren denselben `DocKopf`.
 */

import * as fs from 'node:fs/promises';
import type { DocModel } from './model.js';
import { linkifyQuelleProsa } from './quelle.js';

export interface DocKopf {
    /** Deckblatt-Überschrift (Front-Matter `name`/`titel` oder abgeleitet). */
    readonly titel: string;
    readonly autor?: string;
    readonly untertitel?: string;
    readonly beschreibung?: string;
    readonly lizenz?: string;
    /** Geordnete Schlüssel/Wert-Metadaten (nested `metadaten:` + sonstige). */
    readonly metadaten: ReadonlyArray<readonly [string, string]>;
    /** Markdown-Rumpf nach dem Front-Matter (Vorwort), falls vorhanden. */
    readonly einleitung?: string;
}

/** Front-Matter-Schlüssel, die auf eigene `DocKopf`-Felder abbilden. */
const SKALAR_FELDER = new Set([
    'name', 'titel', 'autor', 'untertitel', 'beschreibung', 'lizenz',
]);

/** Entfernt genau ein Paar umschließender `"`/`'`-Anführungszeichen. */
function entquote(s: string): string {
    const t = s.trim();
    if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t[t.length - 1] === t[0]) {
        return t.slice(1, -1);
    }
    return t;
}

/**
 * Parst eine Kopf-Markdown-Datei in einen `DocKopf`. Ohne
 * `---`-Front-Matter gilt der ganze Inhalt als Einleitung.
 *
 * Front-Matter-Grammatik (bewusst minimal, dependency-frei):
 *   - `schlüssel: wert`            — Skalar (Anführungszeichen optional)
 *   - `metadaten:` + eingerückte   — geordnete Schlüssel/Wert-Map
 *     `  unter: wert`-Zeilen
 *   - unbekannte Top-Level-Skalare → ebenfalls Metadaten
 */
export function parseKopf(raw: string): DocKopf {
    const text = raw.replace(/^\uFEFF/, '');
    const fm = text.match(/^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/);

    let titel: string | undefined;
    let autor: string | undefined;
    let untertitel: string | undefined;
    let beschreibung: string | undefined;
    let lizenz: string | undefined;
    const metadaten: Array<readonly [string, string]> = [];
    let einleitung: string;

    if (!fm) {
        einleitung = text.trim();
        return { titel: '', metadaten, ...(einleitung ? { einleitung } : {}) };
    }

    const [, frontRaw, body] = fm;
    einleitung = body.trim();
    const lines = frontRaw.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim() || /^\s*#/.test(line)) continue;          // leer / Kommentar
        const m = line.match(/^([A-Za-zÄÖÜäöüß_][\w-]*)\s*:\s*(.*)$/);
        if (!m) continue;
        const key = m[1].toLowerCase();
        const val = entquote(m[2]);

        if (key === 'metadaten' || key === 'metadata') {
            // Eingerückter Block: nachfolgende `  unter: wert`-Zeilen.
            while (i + 1 < lines.length && /^[ \t]+\S/.test(lines[i + 1])) {
                const sub = lines[++i].match(/^[ \t]+([A-Za-zÄÖÜäöüß_][\w-]*)\s*:\s*(.*)$/);
                if (sub) metadaten.push([sub[1], entquote(sub[2])]);
            }
            if (val) metadaten.push(['metadaten', val]);
            continue;
        }
        if (!SKALAR_FELDER.has(key)) {
            // „und andere Informationen" — unbekannte Schlüssel sichtbar
            // als Metadaten führen (statt zu verwerfen).
            if (val) metadaten.push([m[1], val]);
            continue;
        }
        if (key === 'name' || key === 'titel') {
            // `titel` hat Vorrang vor `name`, wenn beide vorkommen.
            if (key === 'titel' || titel === undefined) titel = val;
        } else if (key === 'autor') autor = val;
        else if (key === 'untertitel') untertitel = val;
        else if (key === 'beschreibung') beschreibung = val;
        else if (key === 'lizenz') lizenz = val;
    }

    return {
        titel: titel ?? '',
        ...(autor ? { autor } : {}),
        ...(untertitel ? { untertitel } : {}),
        ...(beschreibung ? { beschreibung } : {}),
        ...(lizenz ? { lizenz } : {}),
        metadaten,
        ...(einleitung ? { einleitung } : {}),
    };
}

/**
 * Lädt und parst die Kopf-Datei. Liefert `undefined`, wenn kein Pfad
 * angegeben ist oder die Datei nicht existiert/lesbar ist — der Aufrufer
 * leitet dann aus dem Modell ab (`aufloesenKopf`).
 */
export async function ladeKopf(pfad: string | undefined): Promise<DocKopf | undefined> {
    if (!pfad) return undefined;
    try {
        const raw = await fs.readFile(pfad, 'utf-8');
        return parseKopf(raw);
    } catch {
        return undefined;
    }
}

/**
 * Entfernt Inline-Markdown-Markup für eine **klartextige** Titel-/
 * Untertitel-Zeile: `[label](url)` → `label`, Bilder raus, Backticks
 * und Hervorhebungs-Sternchen weg (das Modul-Doc ist bereits
 * §-verlinkt — im PDF-Deckblatt würde `[..](..)` sonst wörtlich
 * erscheinen).
 */
function entmarkdown(s: string): string {
    return s
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`+/g, '')
        .replace(/\*\*?/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Erste Markdown-ATX-Überschrift (bevorzugt H1) eines Textes. */
function ersteUeberschrift(md: string): string | undefined {
    const h1 = md.match(/^#[ \t]+(.+?)[ \t]*#*\s*$/m);
    if (h1) return entmarkdown(h1[1]);
    const any = md.match(/^#{2,6}[ \t]+(.+?)[ \t]*#*\s*$/m);
    return any ? entmarkdown(any[1]) : undefined;
}

/** Erster Fließtext-Absatz (keine Überschrift/Liste/Code) eines Textes. */
function ersterAbsatz(md: string): string | undefined {
    const lines = md.split(/\r?\n/);
    let started = false;
    const buf: string[] = [];
    for (const ln of lines) {
        const t = ln.trim();
        if (!started) {
            if (!t || /^#{1,6}\s/.test(t) || /^[-*+]\s/.test(t)
                || /^\d+\.\s/.test(t) || t.startsWith('```') || t.startsWith('|')) {
                continue;
            }
            started = true;
            buf.push(t);
        } else {
            if (!t || /^#{1,6}\s/.test(t) || t.startsWith('```')) break;
            buf.push(t);
        }
    }
    if (buf.length === 0) return undefined;
    const para = entmarkdown(buf.join(' '));
    // Auf den ersten Satz kürzen (für eine knappe Untertitel-Zeile).
    const satz = para.match(/^(.+?[.!?])(\s|$)/);
    const s = (satz ? satz[1] : para).trim();
    return s.length > 200 ? s.slice(0, 197).trimEnd() + '…' : s;
}

/**
 * Leitet Titel/Untertitel aus dem **ersten Modul** ab (erste
 * Überschrift bzw. erster Absatz seines führenden Datei-Doc-Blocks);
 * Fallback ist der Modulname bzw. `FinDSL-Dokumentation`.
 */
export function kopfAusModell(model: DocModel): DocKopf {
    const m0 = model.modules[0];
    const titel = (m0 && (ersteUeberschrift(m0.doc) || m0.name)) || 'FinDSL-Dokumentation';
    const untertitel = m0 ? ersterAbsatz(m0.doc) : undefined;
    return { titel, ...(untertitel ? { untertitel } : {}), metadaten: [] };
}

/**
 * Effektiver Dokumentkopf: explizite Kopf-Datei hat Vorrang, fehlende
 * Felder (insbesondere Titel/Untertitel) werden aus dem Modell
 * abgeleitet. Garantiert einen nicht-leeren `titel`.
 */
export function aufloesenKopf(
    explizit: DocKopf | undefined,
    model: DocModel,
): DocKopf {
    const abgeleitet = kopfAusModell(model);
    if (!explizit) return abgeleitet;
    return {
        ...explizit,
        titel: explizit.titel || abgeleitet.titel,
        ...(explizit.untertitel || abgeleitet.untertitel
            ? { untertitel: explizit.untertitel ?? abgeleitet.untertitel }
            : {}),
        metadaten: explizit.metadaten ?? [],
        // §-Verweise in der Einleitungs-Prosa zu gesetze-im-internet-
        // Links machen — dieselbe Quelle/Logik wie Modul-/Decl-Doc
        // (`linkifyQuelleProsa`, idempotent, Code-Spans geschützt).
        // Die Einleitung wird in MD/HTML/PDF als Markdown gerendert,
        // dort tragen die Links korrekt. Titel/Untertitel/Metadaten
        // bleiben unverlinkt: sie erscheinen im PDF-Deckblatt als
        // reiner Text (Markdown-Linksyntax würde dort wörtlich stehen).
        ...(explizit.einleitung
            ? { einleitung: linkifyQuelleProsa(explizit.einleitung) }
            : {}),
    };
}
