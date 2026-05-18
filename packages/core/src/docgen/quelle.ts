/**
 * Gemeinsame `@Quelle("…")`-Analyse: zerlegt einen Quelle-String in
 * einzelne Paragraf-Referenzen und liefert je Referenz den stabilen
 * Tiefenlink auf gesetze-im-internet.de.
 *
 * Genutzt vom DocumentLink-Provider (Editor) UND vom Doc-Generator —
 * eine Quelle, identische Links überall (DRY).
 *
 * Regel: Eine `@Quelle` kann MEHRERE `§`-Referenzen mit einem
 * gemeinsamen Gesetz am Ende führen (`§ 9a, § 10c, § 20 … EStG`);
 * Kommata in „Absatz 1, 2" sind KEINE Trenner zwischen Referenzen.
 * Darum werden §-Stellen und Gesetze unabhängig gesucht und per
 * Position einander zugeordnet — jedes Gesetz „regiert" die §-Stellen
 * zwischen dem vorigen Gesetz und sich selbst.
 */

/**
 * Abkürzung → exaktes Pfadsegment auf gesetze-im-internet.de
 * (verwaltete Quelle für alle Steuerarten — genutzt von DocumentLink
 * UND dem Doku-Generator).
 *
 * **Wichtig:** das Slug ist NICHT immer `kleinbuchstaben(Abk)`. Der
 * Pfad wird aus der juris-Abkürzung gebildet und trägt bei einigen
 * Gesetzen ein Jahr-Suffix (z. B. `kstg_1977`, `ao_1977`). Jeder
 * Eintrag ist gegen die echte URL geprüft (Stand 2026-05-17); neue
 * Gesetze NUR nach Verifikation aufnehmen — ein falsches Slug erzeugt
 * einen toten Link (schlechter als gar kein Link). Verifiziert per
 * `https://www.gesetze-im-internet.de/<slug>/__<para>.html`.
 */
export const GESETZ_PFAD: Readonly<Record<string, string>> = {
    EStG: 'estg', EStDV: 'estdv', KStG: 'kstg_1977', GewStG: 'gewstg',
    KraftStG: 'kraftstg',
    UStG: 'ustg', UStDV: 'ustdv', AO: 'ao', SolzG: 'solzg',
    LStDV: 'lstdv', BewG: 'bewg', ErbStG: 'erbstg', GrEStG: 'grestg',
    AStG: 'astg', InvStG: 'invstg', FGO: 'fgo', GrStG: 'grstg',
};

const SECTION_RE = /§\s*(\d+[a-z]?)/gu;
const LAW_RE = /\b([A-Za-zÄÖÜ]+G|AO|FGO)\b/gu;
/**
 * Plural-Aufzählung `§§ 7, 23, 24 Gesetz`: ein `§§`, dann direkt mit
 * `,`/`;`/`/`/`und`/`u.`/`sowie` verkettete BLANKE Nummern (kein erneutes
 * `§`). Nur direkt verkettete Nummern zählen — `§§ 9 Abs. 1, 16 …`
 * bricht nach `9`, weil „Abs." kein Trenner ist (Absatz-Nummern sind
 * KEINE eigenen §§). Die erste Nummer fängt bereits `SECTION_RE`; hier
 * werden nur die FOLGENDEN blanken Nummern als zusätzliche §-Stellen
 * ergänzt, damit jede ihren eigenen Link erhält.
 */
const SECTION_ENUM_RE =
    /§§\s*\d+[a-z]?(?:(?:\s*[,;/]\s*|\s+(?:und|u\.|sowie)\s+)\d+[a-z]?)+/gu;
const NUM_RE = /\d+[a-z]?/gu;

/** Eine aufgelöste Paragraf-Referenz innerhalb eines Quelle-Strings. */
export interface QuelleRef {
    /** Paragrafnummer, z. B. `32a`. */
    readonly num: string;
    /** Gesetzes-Abkürzung, z. B. `EStG`. */
    readonly abk: string;
    /** Tiefenlink auf gesetze-im-internet.de. */
    readonly url: string;
    /** Offset (in `raw`) des Referenz-Beginns (`§`). */
    readonly start: number;
    /** Offset (in `raw`) des Referenz-Endes (exklusiv). */
    readonly end: number;
}

/**
 * Zerlegt den ROHEN Quelle-String (inkl. umschließender Anführungs-
 * zeichen, wie `arg.$cstNode.text`) in Paragraf-Referenzen. Offsets
 * sind relativ zu `raw`. Kein bekanntes Gesetz / kein `§` → leeres Array.
 */
export function parseQuelleRefs(raw: string): QuelleRef[] {
    const sections = [...raw.matchAll(SECTION_RE)].map((mm) => ({
        num: mm[1], sStart: mm.index ?? 0, sEnd: (mm.index ?? 0) + mm[0].length,
    }));
    if (sections.length === 0) return [];

    // Plural-Aufzählung `§§ a, b, c Gesetz`: die FOLGENDEN blanken
    // Nummern (b, c, …) als eigene §-Stellen ergänzen. Die erste Nummer
    // (a) deckt bereits SECTION_RE ab → in jedem Enum-Cluster die erste
    // Zahl überspringen. Danach nach sStart sortieren (Pairing erwartet
    // Dokumentreihenfolge).
    for (const em of raw.matchAll(SECTION_ENUM_RE)) {
        const base = em.index ?? 0;
        let first = true;
        for (const nm of em[0].matchAll(NUM_RE)) {
            if (first) { first = false; continue; }
            const s = base + (nm.index ?? 0);
            sections.push({ num: nm[0], sStart: s, sEnd: s + nm[0].length });
        }
    }
    sections.sort((a, b) => a.sStart - b.sStart);
    const laws = [...raw.matchAll(LAW_RE)]
        .map((mm) => ({
            abk: mm[1], lStart: mm.index ?? 0, lEnd: (mm.index ?? 0) + mm[0].length,
        }))
        .filter((L) => GESETZ_PFAD[L.abk]);

    const refs: QuelleRef[] = [];
    let prevEnd = 0;
    let si = 0;
    for (const L of laws) {
        const run: typeof sections = [];
        while (si < sections.length && sections[si].sStart < L.lStart) {
            if (sections[si].sStart >= prevEnd) run.push(sections[si]);
            si++;
        }
        run.forEach((sec, k) => {
            const isLast = k === run.length - 1;
            refs.push({
                num: sec.num,
                abk: L.abk,
                url: `https://www.gesetze-im-internet.de/${GESETZ_PFAD[L.abk]}/__${sec.num.toLowerCase()}.html`,
                start: sec.sStart,
                end:   isLast ? L.lEnd : sec.sEnd,
            });
        });
        prevEnd = L.lEnd;
    }
    return refs;
}

/**
 * Geschützte Markdown-Regionen, in denen NICHT verlinkt wird:
 * gefencter Code (```…```), Block-Mathe (`$$…$$`), Inline-Code (`…`),
 * Inline-Mathe (`$…$`, normative Regel SPEC § 4.x) und bereits
 * bestehende Links (`[…](…)`). Die Link-Alternative sorgt zugleich
 * für Idempotenz: ein bereits erzeugter `[§ …](url)` wird beim
 * erneuten Lauf als geschützt erkannt und nicht doppelt umschlossen;
 * Mathe-Regionen werden — wie Code-Spans — unverändert durchgereicht,
 * §-Refs innerhalb von Formeln also bewusst nicht verlinkt.
 * Reihenfolge: Fence → Block-Mathe → Inline-Code → Inline-Mathe → Link.
 */
const PROTECT_RE =
    /```[\s\S]*?```|\$\$[\s\S]*?\$\$|`[^`]*`|(?<!\\)\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)|\[[^\]]*\]\([^)]*\)/g;

/** Verlinkt erkannte §-Referenzen in einem reinen Text-Abschnitt. */
function linkifyPlain(s: string): string {
    const refs = parseQuelleRefs(s);
    if (refs.length === 0) return s;
    const sorted = [...refs].sort((a, b) => a.start - b.start);
    let res = '';
    let pos = 0;
    for (const r of sorted) {
        if (r.start < pos) continue;                 // Überlappung überspringen
        const label = s.slice(r.start, r.end);
        // Echte Absatzgrenze im Label → nicht verlinken (würde den
        // Markdown-Link zerreißen). Weiche Zeilenumbrüche (Justier-
        // Umbruch „§ 24\nSatz 2 KStG") sind erlaubt und werden im
        // Link-Text zu einem Leerzeichen geglättet — der umgebende
        // Text behält seine Umbrüche.
        if (/\n\s*\n/.test(label)) continue;
        res += s.slice(pos, r.start);
        res += `[${label.replace(/\s+/g, ' ')}](${r.url})`;
        pos = r.end;
    }
    return res + s.slice(pos);
}

/**
 * Wandelt §-Gesetzes-Referenzen in **Prosa-Markdown** (Datei-/Decl-
 * Doc-Kommentare, `@param`-Beschreibungen, Feld-Doku) in klickbare
 * gesetze-im-internet-Links um — dieselbe Quelle/Logik wie der
 * `@Quelle`-Aside (`parseQuelleRefs` + `GESETZ_PFAD`). Code-Spans und
 * vorhandene Links bleiben unangetastet; idempotent. Unbekannte
 * Gesetze → kein Link (wie gehabt).
 */
export function linkifyQuelleProsa(text: string): string {
    if (!text) return text;
    let out = '';
    let last = 0;
    for (const m of text.matchAll(PROTECT_RE)) {
        const i = m.index ?? 0;
        out += linkifyPlain(text.slice(last, i));
        out += m[0];                                 // geschützt: unverändert
        last = i + m[0].length;
    }
    return out + linkifyPlain(text.slice(last));
}
