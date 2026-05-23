/**
 * FinDSL-Validator — semantische Prüfungen jenseits der reinen Grammatik.
 *
 * Aktuelle Checks (vgl. {@link registerValidationChecks} für die
 * gesamte Liste der angemeldeten Validatoren):
 *   - Namens-Konventionen: `KONST_UPPER_SNAKE`, `Datensatz`/`Aufzählung`/
 *     `Funktion` in Großschreibung (`check…NameGross`).
 *   - Bidirektionale Typinferenz inkl. Geld-Arithmetik-Regeln,
 *     `wähle (subject)`-Vollständigkeit auf Aufzählungs- bzw. nullable
 *     Subjekten und Smart-Cast-Verfeinerung für nullable Typen
 *     (`checkTypes` → `typeCheckProgram`, siehe `findsl-types.ts`).
 *   - Import-/Modul-Diagnosen: Pfad-Form (`checkImportPfad`), lokale
 *     `verwende`-Konflikte (`checkImports`), Cross-Modul-Existenz
 *     importierter Symbole (`checkImportTargetsExist`) und Intern-Sperre
 *     für `_…`-Symbole (`checkInternalImports`).
 *   - Duplikat-Top-Level-Namen (`checkDuplicateDecls`).
 *   - `abbruch`-Begründungsempfehlung (`checkAbbruchBegruendung`).
 *   - `@Quelle`-Empfehlung: `konst` ohne `@Quelle("...")` → Warnung
 *     (konventionelle Pflicht für gesetzlich verankerte Werte).
 *   - `@Quelle`-Argument-Form: genau ein Text-Literal als Argument
 *     (`checkQuelleAnnotationArgs`).
 *   - Unused-Hints für nicht referenzierte Top-Level-Decls
 *     (`checkUnused`).
 *
 * Offene Punkte (Tracking-Issue #69):
 *   - Modul-Pfad-Konsistenz mit Projekt-Wurzel: die volle Pfad-Folge
 *     (`a.b.c`) muss mit der relativen Datei-Position unterhalb der
 *     Projekt-Wurzel übereinstimmen, nicht nur die letzte Komponente
 *     mit dem Datei-Basename. Aktuell wird kein Modul-Header gegen den
 *     Dateipfad geprüft.
 */

import { AstUtils, GrammarUtils } from 'langium';
import type { AstNode, ValidationAcceptor, ValidationChecks } from 'langium';
import { DiagnosticTag } from 'vscode-languageserver';
import {
    isAufzaehlungDecl,
    isCallChain,
    isDatensatzDecl,
    isFieldAccess,
    isFunktionDecl,
    isKonstDecl,
    isLetStmt,
    isNamedType,
    isParam,
    isPruefeDecl,
    isSafeFieldAccess,
    isStringLiteral,
    type AbbruchExpr,
    type Annotation,
    type AufzaehlungDecl,
    type DatensatzDecl,
    type FindslAstType,
    type FunktionDecl,
    type KonstDecl,
    type Program,
    type TopDecl,
} from './generated/ast.js';
import type { FindslServices } from './findsl-module.js';
import type { LangiumDocuments } from 'langium';
import * as fs from 'node:fs';
import { typeCheckProgram } from './findsl-types.js';
import { analyzeImports, buildModuleHeader, reportImportIssues } from './findsl-scope.js';
import { findModuleInWorkspace } from './findsl-definition.js';
import { parseStringLiteral, parseSlotPath } from '../interpret/values.js';
import { isBuiltinName } from './findsl-stdlib.js';
import {
    checkImportPathLiteral,
    isInternalName,
    mayImportInternal,
    programFilePath,
} from './import-path.js';

export class FindslValidator {

    private documents?: LangiumDocuments;

    /**
     * Bekommt die Services injiziert (siehe findsl-module.ts), damit
     * Cross-Modul-Validierung den Workspace-Index nach dem Quell-Modul
     * eines Imports durchsuchen kann. Ohne Services (z. B. Alt-Tests, die
     * `new FindslValidator()` rufen) bleibt der Cross-Modul-Check inaktiv.
     */
    constructor(services?: FindslServices) {
        this.documents = services?.shared.workspace.LangiumDocuments;
    }

    /**
     * Prüft jedes `verwende … aus "…"`-Pfad-Literal:
     *   - kein mehrzeiliges `"""…"""`
     *   - keine `${…}`-Interpolation
     *   - nicht leer
     *   - relativ mit `./` oder `../`
     * Fehler hängt an der `source`-Property (der Pfad-String).
     */
    checkImportPfad(program: Program, accept: ValidationAcceptor): void {
        for (const imp of program.imports ?? []) {
            const converted = imp?.source;
            if (converted == null) continue;             // Teil-Parse: noch kein Pfad
            const cst = imp.$cstNode
                ? GrammarUtils.findNodeForProperty(imp.$cstNode, 'source')
                : undefined;
            const raw = cst?.text ?? `"${converted}"`;
            const problem = checkImportPathLiteral(raw, converted);
            if (problem) {
                accept('error', problem.message, {
                    node: imp,
                    property: 'source',
                    code: `findsl.import-pfad-${problem.code}`,
                });
            }
        }
    }

    /**
     * Warnt bei Konstanten ohne @Quelle-Annotation. Hilfsfunktionen ohne
     * direkte gesetzliche Verankerung dürfen die Annotation weglassen — die
     * Warnung ist ein Hinweis, kein harter Fehler.
     */
    checkKonstHatQuelle(konst: KonstDecl, accept: ValidationAcceptor): void {
        const annotations = konst.docPrefix?.annotations ?? [];
        const hasQuelle = annotations.some((a) => a.name === 'Quelle');
        if (!hasQuelle) {
            accept(
                'warning',
                `Konstante "${konst.name}" hat keine @Quelle-Annotation. `
                + `Gesetzlich verankerte Konstanten sollten ihre Norm zitieren.`,
                { node: konst, property: 'name', code: 'findsl.fehlende-quelle' },
            );
        }
    }

    /**
     * Harte Regel (SPEC § 2.5): Konstanten-Namen müssen durchgängig
     * GROSS geschrieben sein — ASCII `^[A-Z][A-Z0-9_]*$`
     * (UPPER_SNAKE_CASE). Andere Deklarations-Arten sind nicht betroffen.
     * Teil-Parse beim Tippen (`name` noch leer) wird toleriert.
     */
    checkKonstNameUppercase(konst: KonstDecl, accept: ValidationAcceptor): void {
        const name = konst.name;
        if (!name) return;                       // Teil-Parse: noch kein Name
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
            accept(
                'error',
                `Konstanten-Name "${name}" muss durchgängig GROSS `
                + `geschrieben sein (UPPER_SNAKE_CASE: nur A–Z, 0–9, _; `
                + `SPEC § 2.5).`,
                { node: konst, property: 'name', code: 'findsl.konst-uppercase' },
            );
        }
    }

    /**
     * Harte Regel (SPEC § 2.5): Namen von **Funktionen, Datensätzen,
     * Aufzählungen und Aufzählungs-Werten** müssen mit einem
     * Großbuchstaben beginnen (optional führende Unterstriche für die
     * `_Intern`-Konvention erlaubt). Verstoß = Fehler. Builtins
     * (`abrundenEuro`, `aufrunden`, …) sind nicht betroffen (eigener
     * fester Stdlib-Namensraum). `var`/Parameter/Felder behalten
     * lowerCamelCase, `konst` UPPER_SNAKE (eigene Regel). Teil-Parse
     * (`name` leer) wird toleriert.
     */
    private pruefeGrossStart(
        name: string | undefined,
        art: string,
        accept: ValidationAcceptor,
        loc: Parameters<ValidationAcceptor>[2],
    ): void {
        if (!name) return;                       // Teil-Parse: noch kein Name
        if (!/^_*\p{Lu}/u.test(name)) {
            accept(
                'error',
                `${art}-Name "${name}" muss mit einem Großbuchstaben `
                + `beginnen (führende „_" erlaubt; SPEC § 2.5).`,
                loc,
            );
        }
    }

    checkFunktionNameGross(decl: FunktionDecl, accept: ValidationAcceptor): void {
        this.pruefeGrossStart(decl.name, 'Funktions', accept, {
            node: decl, property: 'name', code: 'findsl.name-grossschreibung',
        });
    }

    checkDatensatzNameGross(decl: DatensatzDecl, accept: ValidationAcceptor): void {
        this.pruefeGrossStart(decl.name, 'Datensatz', accept, {
            node: decl, property: 'name', code: 'findsl.name-grossschreibung',
        });
    }

    checkAufzaehlungNameGross(decl: AufzaehlungDecl, accept: ValidationAcceptor): void {
        this.pruefeGrossStart(decl.name, 'Aufzählungs', accept, {
            node: decl, property: 'name', code: 'findsl.name-grossschreibung',
        });
        // Jeder Aufzählungs-Wert separat — Diagnose am jeweiligen
        // values-CST-Knoten (gleiche Reihenfolge wie decl.values).
        const valueNodes = decl.$cstNode
            ? GrammarUtils.findNodesForProperty(decl.$cstNode, 'values')
            : [];
        decl.values.forEach((v, i) => {
            if (/^_*\p{Lu}/u.test(v)) return;
            const vn = valueNodes[i];
            accept(
                'error',
                `Aufzählungs-Wert "${v}" muss mit einem Großbuchstaben `
                + `beginnen (SPEC § 2.5).`,
                vn
                    ? { node: decl, range: vn.range, code: 'findsl.name-grossschreibung' }
                    : { node: decl, property: 'values', index: i, code: 'findsl.name-grossschreibung' },
            );
        });
    }

    /**
     * Prüft die Argumentform von `@Quelle(...)`: genau ein Argument, das ein
     * Text-Literal sein muss. Andere Annotationen werden hier nicht
     * berücksichtigt — für die kommt ggf. ein eigenes Schema.
     *
     * Beispiele:
     *   `@Quelle("§ 32a EStG")`            ✓ korrekt
     *   `@Quelle()`                         ✗ fehlendes Argument
     *   `@Quelle("a", "b")`                 ✗ zu viele Argumente
     *   `@Quelle(42)` / `@Quelle(foo())`    ✗ Argument ist kein Text-Literal
     */
    /**
     * Führt den bidirektionalen Type-Checker (`findsl-types.ts`) auf dem
     * gesamten Programm aus. Diagnosen werden als Errors im Validator-Layer
     * gemeldet — der Type-Checker selbst arbeitet tolerant (Inferenz-Fehler
     * werden auf `unknown` zurückgesetzt), damit eine einzelne Stelle nicht
     * eine Diagnose-Lawine auslöst.
     */
    checkTypes(program: Program, accept: ValidationAcceptor): void {
        typeCheckProgram(program, (node, message) => {
            accept('error', message, { node });
        });
    }

    /**
     * Erkennt Konflikte und nicht-unterstützte Formen unter den
     * `verwende`-Direktiven. Diese Diagnose-Schicht arbeitet rein lokal
     * (innerhalb einer Datei) — Cross-Module-Diagnosen (Symbol existiert
     * nicht im Quell-Modul) werden vom CLI mit aufgebauter Header-Registry
     * geliefert.
     */
    checkImports(program: Program, accept: ValidationAcceptor): void {
        reportImportIssues(program, (node, message, code, data) => {
            accept('error', message, { node, code, data });
        });
    }

    /**
     * Cross-Modul-Check: prüft, ob ein importiertes Symbol im Quell-Modul
     * tatsächlich existiert. Greift nur, wenn das Quell-Modul bereits im
     * Workspace-Index liegt (kein eager load — sonst tolerant, analog
     * Hover/Definition). Builtins werden übersprungen, die meldet bereits
     * `checkImports` separat.
     *
     * Damit erscheint `verwende {Foobar} aus a.b` jetzt auch im Editor als
     * Fehler — vorher kam diese Diagnose nur im CLI-Cross-Modul-Pass.
     */
    checkImportTargetsExist(program: Program, accept: ValidationAcceptor): void {
        if (!this.documents) return;
        const importingUri = AstUtils.getDocument(program).uri;
        // Dateisystem-Existenzprüfung nur, wenn die importierende Datei
        // selbst real auf der Platte liegt — virtuelle Test-/Editor-
        // Dokumente (kein `file:`-Pfad auf Platte) bleiben tolerant.
        const onDisk = importingUri.scheme === 'file'
            && fs.existsSync(importingUri.fsPath);
        const { bindings } = analyzeImports(program);
        for (const b of bindings) {
            if (isBuiltinName(b.sourceName)) continue;       // checkImports zuständig
            const sourceProgram = findModuleInWorkspace(this.documents, b.resolvedPath);
            if (!sourceProgram) {
                if (onDisk && b.resolvedPath && !fs.existsSync(b.resolvedPath)) {
                    accept('error',
                        `Importdatei "${b.rawSource}" nicht gefunden `
                        + `(erwartet: "${b.resolvedPath}").`,
                        {
                            node: b.node,
                            code: 'findsl.import-datei-fehlt',
                            data: { rawSource: b.rawSource },
                        });
                }
                continue;                                     // Datei (noch) nicht indexiert
            }
            const header = buildModuleHeader(sourceProgram);
            if (!header.exports.has(b.sourceName)) {
                accept('error',
                    `Symbol "${b.sourceName}" wird von der Datei `
                    + `"${b.rawSource}" nicht exportiert.`,
                    {
                        node: b.node,
                        code: 'findsl.symbol-nicht-exportiert',
                        data: { sourceName: b.sourceName },
                    });
            }
        }
    }

    /**
     * Intern-Sperre (SPEC § 4.16, verschärft): ein importiertes Symbol
     * mit führendem `_` ist modul-intern und darf NICHT cross-file mit
     * `verwende` importiert werden. Einzige Ausnahme: eine
     * `<basis>.test.findsl` darf die Interna ihrer zugehörigen
     * Quelldatei `<basis>.findsl` importieren (direkte Unit-Tests).
     * Rein pfad-/namensbasiert — unabhängig davon, ob die Zieldatei
     * bereits indexiert ist; deshalb ein eigener, freundlicher Code
     * statt der generischen „nicht exportiert"-Meldung.
     */
    checkInternalImports(program: Program, accept: ValidationAcceptor): void {
        const importingAbs = programFilePath(program);
        for (const b of analyzeImports(program).bindings) {
            if (!isInternalName(b.sourceName)) continue;
            if (mayImportInternal(importingAbs, b.resolvedPath)) continue;
            accept('error',
                `"${b.sourceName}" ist modul-intern (führendes "_") und kann `
                + 'nicht mit "verwende" importiert werden. Ausnahme: die '
                + 'zugehörige "<basis>.test.findsl" darf Interna ihrer '
                + 'Quelldatei "<basis>.findsl" importieren.',
                {
                    node: b.node,
                    code: 'findsl.import-intern',
                    data: { sourceName: b.sourceName },
                });
        }
    }

    /**
     * Erkennt doppelte Top-Level-Namen — zwei Konstanten, Funktionen,
     * Datensätze oder Aufzählungen mit identischem Namen sind in FinDSL
     * grundsätzlich verboten (kein Overloading). Auch die Kollision
     * zwischen einer lokalen Decl und einem importierten Symbol wird hier
     * gemeldet.
     *
     * Die Diagnose hängt am ZWEITEN Vorkommen — die erste Decl bleibt
     * sichtbar, sodass der Nutzer den Duplikat-Eintrag entfernt, nicht den
     * Original-Eintrag.
     */
    checkDuplicateDecls(program: Program, accept: ValidationAcceptor): void {
        const seen = new Map<string, TopDecl>();
        for (const decl of program.decls) {
            // prüfe-Blöcke haben Labels statt Identifier-Namen, die dürfen
            // sich wiederholen.
            if (!isNamedTopDecl(decl)) continue;
            const first = seen.get(decl.name);
            if (first) {
                accept('error',
                    `Doppelte Deklaration "${decl.name}" — bereits als `
                    + `${declKind(first)} im selben Modul definiert.`,
                    { node: decl, property: 'name' });
            } else {
                seen.set(decl.name, decl);
            }
        }

        // Konflikt zwischen Import-Binding und lokaler Decl
        const { bindings } = analyzeImports(program);
        for (const b of bindings) {
            if (seen.has(b.localName)) {
                accept('error',
                    `Import "${b.localName}" kollidiert mit lokaler `
                    + `${declKind(seen.get(b.localName)!)}-Deklaration im selben Modul.`,
                    { node: b.node });
            }
        }
    }

    /**
     * Warnt, wenn die `abbruch`-Begründung ein leeres bzw. nur aus
     * Whitespace bestehendes Text-Literal ist. Die Pflicht-Begründung soll
     * im Audit erklären, *warum* diese Konstellation unzulässig ist — ein
     * leerer String erfüllt das nicht. Der Typ-Check (Text-Pflicht) liegt
     * im Type-Checker; hier geht es rein um den inhaltlichen Hinweis.
     * Dynamische Begründungen (Interpolation, Variablen, Verkettung) werden
     * nicht beanstandet — ihr Inhalt steht erst zur Laufzeit fest.
     */
    checkAbbruchBegruendung(expr: AbbruchExpr, accept: ValidationAcceptor): void {
        const grund = expr.grund;
        if (!grund || !isStringLiteral(grund)) return;
        if (stringLiteralContent(grund.value).trim() !== '') return;
        accept(
            'warning',
            `Leere abbruch-Begründung. Gib an, warum diese Konstellation `
            + `unzulässig ist (z. B. "§ 32a EStG: negatives zvE unzulässig") `
            + `— die Begründung erscheint im Audit-Anhang.`,
            { node: grund, code: 'findsl.abbruch-ohne-begruendung' },
        );
    }

    /**
     * Markiert Ungenutztes als ausgegraute `Unnecessary`-Hint:
     *   - `verwende`-Importe, deren lokaler Name im Modul nirgends
     *     referenziert wird
     *   - Funktions-Parameter und `var`-Bindungen, die in ihrer Funktion
     *     nie gelesen werden
     *   - Top-Level-`konst`/`fn`/`datensatz`/`aufzählung`, deren Name in
     *     KEINEM Modul des Workspace referenziert wird (P7: Decls sind
     *     öffentlich — modul-lokale Prüfung allein wäre falsch-positiv für
     *     API-Konstanten, die andere Module konsumieren). Aufzählungen
     *     gelten auch dann als genutzt, wenn nur ihre Werte verwendet
     *     werden.
     *
     * Severity „hint" + Tag `Unnecessary` → der Editor blendet die Stelle
     * blass ein, ohne Fehler-/Warn-Schlängelung.
     */
    checkUnused(program: Program, accept: ValidationAcceptor): void {
        const faded = (node: AstNode, property: string | undefined, message: string): void => {
            accept('hint', message, {
                node,
                ...(property ? { property } : {}),
                tags: [DiagnosticTag.Unnecessary],
                code: 'findsl.ungenutzt',
            });
        };

        // Modul-lokale Referenzen (nur Decl-Bodies, NICHT der Import-Block —
        // sonst zählte ein Import sich durch seine eigene Deklaration).
        const localRefs = new Set<string>();
        for (const decl of program.decls) collectRefs(decl, localRefs);

        // Ungenutzte Importe.
        for (const b of analyzeImports(program).bindings) {
            if (!localRefs.has(b.localName)) {
                faded(b.node, undefined,
                    `Import "${b.localName}" wird in diesem Modul nicht verwendet.`);
            }
        }

        // Ungenutzte Parameter / var-Bindungen je Funktion.
        for (const decl of program.decls) {
            if (!isFunktionDecl(decl)) continue;
            const usedInFn = new Set<string>();
            collectRefs(decl, usedInFn);
            for (const p of decl.params) {
                if (p.name && !usedInFn.has(p.name)) {
                    faded(p, 'name',
                        `Parameter "${p.name}" wird nicht verwendet.`);
                }
            }
            for (const n of AstUtils.streamAllContents(decl)) {
                if (isLetStmt(n) && n.name && !usedInFn.has(n.name)) {
                    faded(n, 'name', `Bindung "${n.name}" wird nicht verwendet.`);
                }
            }
        }

        // Top-Level-Decls nur bewerten, wenn ein echter Workspace-Kontext
        // vorliegt (≥ 2 indizierte Module). Bei isoliertem Single-File-
        // Parse (CLI, früh im Editor vor Workspace-Indizierung) lässt sich
        // „im gesamten Projekt nicht referenziert" NICHT beurteilen —
        // sonst würde jede öffentliche API-Konstante falsch geflaggt
        // (P7: Decls sind öffentlich, Nutzung oft in anderen Modulen).
        const programs: Program[] = [];
        for (const doc of this.documents?.all ?? []) {
            const p = doc.parseResult?.value as Program | undefined;
            if (p) programs.push(p);
        }
        if (programs.length < 2) return;

        const globalRefs = new Set<string>();
        collectRefs(program, globalRefs);                 // aktuelles Modul immer
        for (const p of programs) collectRefs(p, globalRefs);

        for (const decl of program.decls) {
            if (isPruefeDecl(decl) || !decl.name) continue;
            let used = globalRefs.has(decl.name);
            if (!used && isAufzaehlungDecl(decl)) {
                used = decl.values.some((v) => globalRefs.has(v));
            }
            if (!used) {
                faded(decl, 'name',
                    `${declKind(decl)} "${decl.name}" wird im gesamten `
                    + `Projekt nicht referenziert.`);
            }
        }
    }

    checkQuelleAnnotationArgs(annotation: Annotation, accept: ValidationAcceptor): void {
        if (annotation.name !== 'Quelle') {
            return;
        }

        const args = annotation.args;
        if (args.length !== 1) {
            accept(
                'error',
                `@Quelle erwartet genau ein Argument (Text-Literal mit der `
                + `Norm-Zitation), erhalten: ${args.length}.`,
                { node: annotation, property: 'args' },
            );
            return;
        }

        const arg = args[0];
        if (!isStringLiteral(arg)) {
            accept(
                'error',
                `@Quelle-Argument muss ein Text-Literal sein `
                + `(z. B. "§ 32a EStG").`,
                { node: arg },
            );
        }
    }
}

/**
 * Liefert den Inhalt eines String-Literal-Tokens ohne die umgebenden
 * Anführungszeichen — Multi-Line `"""…"""` wie Einzeilen `"…"`.
 */
function stringLiteralContent(raw: string): string {
    if (raw.startsWith('"""') && raw.endsWith('"""')) return raw.slice(3, -3);
    if (raw.startsWith('"')   && raw.endsWith('"'))   return raw.slice(1, -1);
    return raw;
}

/**
 * Sammelt alle Namens-Referenzen (Verwendungen, KEINE Deklarations-
 * Stellen) im Teilbaum von `root`: CallChain-Wurzeln, Typ-Namen,
 * Feldzugriffe und Import-Item-Namen (= Cross-Modul-Bezug auf das
 * Quell-Symbol). `streamAllContents` liefert nur Nachfahren, nie `root`
 * selbst — Decl-Namen (String-Properties) sind hier nie enthalten.
 */
export function collectRefs(root: AstNode, into: Set<string>): void {
    for (const n of AstUtils.streamAllContents(root)) {
        if (isCallChain(n)) {
            if (n.name) into.add(n.name);
        } else if (isNamedType(n)) {
            if (n.name) into.add(n.name);
        } else if (isFieldAccess(n) || isSafeFieldAccess(n)) {
            if (n.name) into.add(n.name);
        } else if (n.$type === 'ImportItem') {
            const nm = (n as { name?: string }).name;
            if (nm) into.add(nm);
        } else if (n.$type === 'NamedOrModuleImport') {
            const imp = n as { fromKeyword?: boolean; head?: string };
            if (imp.fromKeyword && imp.head) into.add(imp.head);
        } else if (isStringLiteral(n) && n.value) {
            // String-Interpolation `${name}` / `${ds.feld}` ist KEIN
            // CallChain-AST-Knoten — die Wurzel-Bezeichner der Slots
            // müssen trotzdem als Verwendung zählen.
            collectSlotRoots(n.value, into);
        }
    }
}

/** Wurzel-Bezeichner aller `${...}`-Slots eines String-Literals. */
function collectSlotRoots(raw: string, into: Set<string>): void {
    let slots: string[];
    try {
        slots = parseStringLiteral(raw).slots;
    } catch {
        return;
    }
    for (const slot of slots) {
        try {
            const path = parseSlotPath(slot);
            if (path[0]) into.add(path[0]);
        } catch {
            const m = slot.match(/[\p{L}_][\p{L}\p{N}_]*/u);
            if (m) into.add(m[0]);
        }
    }
}

function isNamedTopDecl(decl: TopDecl): decl is KonstDecl | Exclude<TopDecl, KonstDecl> & { name: string } {
    return isKonstDecl(decl) || isFunktionDecl(decl) || isDatensatzDecl(decl) || isAufzaehlungDecl(decl);
}

function declKind(decl: TopDecl): string {
    if (isKonstDecl(decl))       return 'konst';
    if (isFunktionDecl(decl))    return 'fn';
    if (isDatensatzDecl(decl))   return 'datensatz';
    if (isAufzaehlungDecl(decl)) return 'aufzählung';
    return 'Deklaration';
}

export function registerValidationChecks(services: FindslServices): void {
    const registry = services.validation.ValidationRegistry;
    const validator = services.validation.FindslValidator;
    const checks: ValidationChecks<FindslAstType> = {
        KonstDecl:  [validator.checkKonstHatQuelle, validator.checkKonstNameUppercase],
        FunktionDecl:   validator.checkFunktionNameGross,
        DatensatzDecl:  validator.checkDatensatzNameGross,
        AufzaehlungDecl: validator.checkAufzaehlungNameGross,
        AbbruchExpr: validator.checkAbbruchBegruendung,
        Annotation: validator.checkQuelleAnnotationArgs,
        Program:    [
            validator.checkImportPfad,
            validator.checkDuplicateDecls,
            validator.checkImports,
            validator.checkInternalImports,
            validator.checkImportTargetsExist,
            validator.checkTypes,
            validator.checkUnused,
        ],
    };
    registry.register(checks, validator);
}
