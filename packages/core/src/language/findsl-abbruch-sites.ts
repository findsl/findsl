/**
 * Audit-Collector für `abbruch`-Stellen (SPEC § 4.19, P4/P7).
 *
 * Sammelt projektweit alle `abbruch`-Ausdrücke mit umschließender Funktion,
 * Begründung und gesetzlicher Quelle. Versorgt künftig den Doku-Anhang
 * „Explizit ausgeschlossene Konstellationen" und ist als Datenquelle für
 * eine spätere CodeLens nutzbar. Hier bewusst nur die reine Sammel-Logik
 * — keine HTML/PDF-Ausgabe.
 */

import { AstUtils } from 'langium';
import {
    isAbbruchExpr,
    isFunktionDecl,
    isKonstDecl,
    isStringLiteral,
    type Program,
} from './generated/ast.js';
import { parseStringLiteral } from '../interpret/values.js';

export interface AbbruchSite {
    /** Name der umschließenden `fn`/`konst`, falls ermittelbar. */
    readonly enthaltenIn?: string;
    /**
     * Statischer Teil der Begründung (Quotes entfernt). Bei dynamischer
     * Begründung (Interpolation, Variable, Verkettung) bleiben die
     * `${…}`-Slots als Platzhalter erhalten; `dynamisch` ist dann `true`.
     */
    readonly begruendung?: string;
    /** Begründung enthält Laufzeit-Anteile (Interpolations-Slots o. Ä.). */
    readonly dynamisch: boolean;
    /** `@Quelle("…")` der umschließenden Deklaration, falls vorhanden. */
    readonly quelle?: string;
    /** 1-basierte Zeilennummer der `abbruch`-Stelle. */
    readonly zeile: number;
}

export function collectAbbruchSites(program: Program): AbbruchSite[] {
    const sites: AbbruchSite[] = [];

    for (const node of AstUtils.streamAllContents(program)) {
        if (!isAbbruchExpr(node)) continue;

        const grund = node.grund;
        let begruendung: string | undefined;
        let dynamisch = true;
        if (grund && isStringLiteral(grund)) {
            const { parts, slots } = parseStringLiteral(grund.value);
            dynamisch = slots.length > 0;
            begruendung = dynamisch
                ? interleave(parts, slots.map((s) => `\${${s}}`))
                : parts.join('');
        }

        sites.push({
            enthaltenIn: enclosingDeclName(node),
            begruendung,
            dynamisch,
            quelle: enclosingQuelle(node),
            zeile: (node.$cstNode?.range.start.line ?? 0) + 1,
        });
    }
    return sites;
}

/** Webt Text-Teile und Slot-Platzhalter wieder zusammen (parts.length === slots.length + 1). */
function interleave(parts: ReadonlyArray<string>, slots: ReadonlyArray<string>): string {
    let out = parts[0] ?? '';
    for (let i = 0; i < slots.length; i++) {
        out += slots[i] + (parts[i + 1] ?? '');
    }
    return out;
}

function enclosingDeclName(node: object): string | undefined {
    const fn = AstUtils.getContainerOfType(node as never, isFunktionDecl);
    if (fn?.name) return fn.name;
    const k = AstUtils.getContainerOfType(node as never, isKonstDecl);
    return k?.name;
}

function enclosingQuelle(node: object): string | undefined {
    const fn = AstUtils.getContainerOfType(node as never, isFunktionDecl);
    const k = fn ? undefined : AstUtils.getContainerOfType(node as never, isKonstDecl);
    const annotations = fn?.docPrefix?.annotations ?? k?.docPrefix?.annotations ?? [];
    for (const a of annotations) {
        if (a.name !== 'Quelle') continue;
        const arg = a.args[0];
        if (arg && isStringLiteral(arg)) {
            const { parts } = parseStringLiteral(arg.value);
            return parts.join('');
        }
    }
    return undefined;
}
