#!/usr/bin/env node

// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * FinDSL CLI — Kommandozeilen-Werkzeug.
 *
 * Subkommandos:
 *   parse       — Datei parsen, Diagnose ausgeben
 *   test        — Akzeptanztests aus prüfe-Blöcken ausführen
 *   codegen     — Zielsprachencode erzeugen (--lang; Basisverz. rekursiv)
 *   docgen      — Dokumentation generieren
 *   papgen      — Programmablaufpläne erzeugen (Mermaid-Markdown oder HTML)
 */

import { Command } from 'commander';
import { NodeFileSystem } from 'langium/node';
import { URI } from 'langium';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createFindslServices } from '@findsl/core/language/findsl-module.js';
import { runPruefe } from '@findsl/core/interpret/pruefe.js';
import { loadModuleGraph, type ParseFile } from '@findsl/core/interpret/module-loader.js';
import { asImportResolver, buildHeaderRegistry } from '@findsl/core/language/findsl-scope.js';
import { typeCheckProgram } from '@findsl/core/language/findsl-types.js';
import { type Program, isProgram } from '@findsl/core/language/generated/ast.js';
import { AstUtils } from 'langium';

const program = new Command();

program
    .name('findsl')
    .description('FinDSL — Werkzeug für die deutsche steuerliche Finanzverwaltung')
    .version('1.0.1');

interface LineDiag {
    readonly line: number;
    readonly col: number;
    readonly severity: 'error' | 'warning' | 'info' | 'hint';
    readonly message: string;
}

// ---------------------------------------------------------------------------
// Ziel-Auflösung — Datei | Verzeichnis | Glob-Muster
// ---------------------------------------------------------------------------
//
// `parse`/`test`/`docgen` nehmen beliebig viele Ziele. Übliche Shell-Globs
// (`examples/**/*.findsl`) expandiert bereits die Shell → mehrere Argumente.
// In Anführungszeichen übergebene oder nicht expandierte Muster werden
// zusätzlich in-process via `fs.glob` aufgelöst. Jeder konkrete Pfad wird
// einheitlich behandelt: Verzeichnis → rekursiv `*.findsl`; Datei →
// aufnehmen, wenn `.findsl`. Ergebnis: absolute, deduplizierte, sortierte
// Liste (deterministisch).

/** Glob-Sonderzeichen, an denen ein Ziel als Muster erkannt wird. */
const GLOB_MAGIC = /[*?[\]{}]/;

/**
 * `fs.glob` ist Node-≥22-Core (Runtime hier: Node 24). Der gepinnte
 * `@types/node` deklariert es noch nicht — daher typsicher gekapselt
 * statt eines Dependency-Bumps.
 */
const fsGlob = (fs as unknown as {
    glob(pattern: string): AsyncIterable<string>;
}).glob;

/** Sammelt rekursiv alle `.findsl` unter einem konkreten Pfad. */
async function collectFindsl(absPath: string, into: Set<string>): Promise<void> {
    let st;
    try {
        st = await fs.stat(absPath);
    } catch {
        return;                                // verschwundener Glob-Treffer
    }
    if (st.isFile()) {
        if (absPath.endsWith('.findsl')) into.add(absPath);
        return;
    }
    if (st.isDirectory()) {
        for (const e of await fs.readdir(absPath, { withFileTypes: true })) {
            await collectFindsl(path.join(absPath, e.name), into);
        }
    }
}

/**
 * Löst Ziel-Argumente zu einer sortierten Liste absoluter `.findsl`-Pfade
 * auf. `missing` listet nicht-existente Nicht-Glob-Ziele bzw. treffer-
 * lose Glob-Muster für eine hilfreiche Fehlermeldung.
 */
async function resolveTargets(
    targets: ReadonlyArray<string>,
): Promise<{ files: string[]; missing: string[] }> {
    const set = new Set<string>();
    const missing: string[] = [];
    for (const t of targets) {
        if (GLOB_MAGIC.test(t)) {
            let any = false;
            for await (const m of fsGlob(t)) {
                any = true;
                await collectFindsl(path.resolve(String(m)), set);
            }
            if (!any) missing.push(t);
        } else {
            const abs = path.resolve(t);
            try {
                await fs.stat(abs);
            } catch {
                missing.push(t);
                continue;
            }
            await collectFindsl(abs, set);
        }
    }
    return { files: [...set].sort(), missing };
}

/** Anzeigename eines Pfads: relativ zum CWD, sonst absolut. */
function disp(absFile: string): string {
    const rel = path.relative(process.cwd(), absFile);
    return rel && !rel.startsWith('..') ? rel : absFile;
}

program
    .command('parse')
    .description('Parst .findsl-Dateien (mehrere/Verzeichnis/Glob) und '
        + 'gibt Syntax-Diagnostics aus.')
    .argument('<ziele...>',
        'beliebig viele Ziele: einzelne Dateien, Verzeichnisse (rekursiv '
        + 'nach *.findsl durchsucht) oder Glob-Muster wie '
        + '"examples/**/*.findsl" — Muster in Anführungszeichen setzen, '
        + 'sonst expandiert die Shell sie selbst')
    .option('-v, --verbose', 'Zusätzliche Ausgabe mit AST-Übersicht')
    .addHelpText('after', `
Beispiele:
  $ findsl parse examples/kst/kst.findsl       eine Datei
  $ findsl parse examples/kst                  Verzeichnis (rekursiv)
  $ findsl parse 'examples/**/*.findsl'        Glob-Muster (quoten!)
  $ findsl parse examples/kst examples/gewst   mehrere Ziele`)
    .action(async (ziele: string[], options: { verbose?: boolean }) => {
        const services = createFindslServices(NodeFileSystem).Findsl;
        const { files, missing } = await resolveTargets(ziele);
        for (const m of missing) {
            console.error(`✗ Kein Treffer / keine Datei: ${m}`);
        }
        if (files.length === 0) {
            console.error('✗ Keine .findsl-Dateien gefunden.');
            process.exit(1);
        }

        let errorFiles = 0;
        for (const fullPath of files) {
            const content = await fs.readFile(fullPath, 'utf-8');
            const document = services.shared.workspace.LangiumDocumentFactory.fromString(
                content,
                URI.file(fullPath),
            );
            await services.shared.workspace.DocumentBuilder.build(
                [document], { validation: true },
            );

            const singleDiags: LineDiag[] = (document.diagnostics ?? []).map((d) => ({
                line:     d.range.start.line + 1,
                col:      d.range.start.character + 1,
                severity: severityName(d.severity) as LineDiag['severity'],
                message:  d.message,
            }));

            // Cross-Module-Pass: nur wenn das Eingangs-Modul parsefähig war.
            // `isProgram` narrowt zugleich `value` (AstNode | undefined) auf
            // Program — kein rohes Cast, das undefined durchreichen könnte.
            const entry = document.parseResult.value;
            const crossDiags = (document.parseResult.lexerErrors.length === 0
                && document.parseResult.parserErrors.length === 0
                && isProgram(entry))
                ? await crossModuleDiagnostics(fullPath, entry, services)
                : [];

            const all = mergeDiagnostics(singleDiags, crossDiags);
            const errors   = all.filter((d) => d.severity === 'error');
            const warnings = all.filter((d) => d.severity === 'warning');
            const infos    = all.filter((d) => d.severity === 'info' || d.severity === 'hint');

            if (all.length === 0) {
                console.log(`✓ ${disp(fullPath)} erfolgreich geparst, keine Diagnosen.`);
                if (options.verbose) {
                    console.log(`  AST-Knoten: ${countNodes(document.parseResult.value)}`);
                }
                continue;
            }

            const summary = [
                errors.length   ? `${errors.length} Fehler`     : null,
                warnings.length ? `${warnings.length} Warnung${warnings.length === 1 ? '' : 'en'}` : null,
                infos.length    ? `${infos.length} Hinweis${infos.length === 1 ? '' : 'e'}`        : null,
            ].filter(Boolean).join(', ');

            const stream = errors.length > 0 ? console.error : console.warn;
            stream(`${errors.length > 0 ? '✗' : '⚠'} ${disp(fullPath)}: ${summary}`);
            for (const d of all) {
                stream(`  ${d.line}:${d.col}  ${d.severity.padEnd(7)}  ${d.message}`);
            }
            if (errors.length > 0) errorFiles++;
        }

        if (files.length > 1) {
            console.log(`— ${files.length} Dateien geprüft, `
                + `${errorFiles} mit Fehlern —`);
        }
        process.exit(errorFiles > 0 || missing.length > 0 ? 1 : 0);
    });

/**
 * Cross-Module-Type-Check: lädt den Modul-Graph, baut die Header-Registry
 * und ruft `typeCheckProgram` mit einem `ImportResolver` auf dem Hauptmodul.
 * Liefert nur die Diagnosen, die ohne Cross-Module-Wissen nicht erkennbar
 * waren (typ. „Symbol X nicht in Modul Y exportiert" oder Mismatches bei
 * Verwendung importierter Symbole).
 *
 * Fehler beim Laden des Graphs (fehlende Datei, Zyklus) werden als
 * synthetische Diagnose-Zeile gemeldet, damit das Tool nicht in einen
 * unbehandelten Reject läuft.
 */
async function crossModuleDiagnostics(
    entryAbs: string,
    entryProgram: Program,
    services: ReturnType<typeof createFindslServices>['Findsl'],
): Promise<LineDiag[]> {
    if (entryProgram.imports.length === 0) return [];

    const parsedFiles = new Map<string, Program>();
    parsedFiles.set(entryAbs, entryProgram);
    const parse: ParseFile = async (absPath) => {
        const hit = parsedFiles.get(absPath);
        if (hit) return hit;
        const content = await fs.readFile(absPath, 'utf-8');
        const document = services.shared.workspace.LangiumDocumentFactory.fromString(
            content,
            URI.file(absPath),
        );
        await services.shared.workspace.DocumentBuilder.build([document], { validation: false });
        const program = document.parseResult.value;
        if (!isProgram(program)) {
            throw new Error(
                `Modul ${absPath} konnte nicht als FinDSL-Programm geparst werden.`);
        }
        parsedFiles.set(absPath, program);
        return program;
    };

    let modules;
    try {
        // Path-Traversal-Schutz (Issue #73): `verwende … aus "…"` darf
        // nur Dateien im Verzeichnisbaum der Einstiegsdatei laden — kein
        // `../../../etc/passwd.findsl`-Eskapaden.
        modules = await loadModuleGraph(entryAbs, parse, {
            allowedRoot: path.dirname(entryAbs),
        });
    } catch (err) {
        return [{
            line: 1, col: 1, severity: 'error',
            message: `Modul-Graph konnte nicht geladen werden: ${(err as Error).message}`,
        }];
    }

    const registry = buildHeaderRegistry(modules);
    const resolver = asImportResolver(registry);

    const out: LineDiag[] = [];
    typeCheckProgram(entryProgram, (node, message) => {
        const doc = AstUtils.getDocument(node);
        // Nur Diagnosen aus dem Eingangsdokument sammeln — Diagnosen aus
        // importierten Modulen erscheinen, wenn der Nutzer diese Module
        // selbst per `parse` öffnet.
        if (doc.uri.fsPath !== entryAbs) return;
        const range = node.$cstNode?.range;
        out.push({
            line:     (range?.start.line ?? 0) + 1,
            col:      (range?.start.character ?? 0) + 1,
            severity: 'error',
            message,
        });
    }, { importResolver: resolver });
    return out;
}

/**
 * Vereinigt Single- und Cross-Module-Diagnosen und dedupliziert nach
 * (line, col, message). Sortierung nach Position.
 */
function mergeDiagnostics(a: ReadonlyArray<LineDiag>, b: ReadonlyArray<LineDiag>): LineDiag[] {
    const seen = new Set<string>();
    const out: LineDiag[] = [];
    for (const d of [...a, ...b]) {
        const key = `${d.line}:${d.col}|${d.message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(d);
    }
    out.sort((x, y) => x.line - y.line || x.col - y.col);
    return out;
}

program
    .command('test')
    .description('Wertet prüfe-Blöcke aus (mehrere/Verzeichnis/Glob) und '
        + 'meldet Pass/Fail/Error. Dateien ohne prüfe-Blöcke werden '
        + 'übersprungen.')
    .argument('<ziele...>',
        'beliebig viele Ziele: einzelne .test.findsl-Dateien, Verzeichnisse '
        + '(rekursiv) oder Glob-Muster wie "examples/**/*.test.findsl" — '
        + 'Muster in Anführungszeichen setzen, sonst expandiert die Shell '
        + 'sie selbst')
    .option('-v, --verbose', 'Auch bestandene Testfälle auflisten')
    .addHelpText('after', `
Beispiele:
  $ findsl test examples/kst/kst.test.findsl   eine Test-Datei
  $ findsl test examples                       alle Tests rekursiv
  $ findsl test 'examples/**/*.test.findsl'    Glob-Muster (quoten!)`)
    .action(async (ziele: string[], options: { verbose?: boolean }) => {
        const services = createFindslServices(NodeFileSystem).Findsl;
        const { files, missing } = await resolveTargets(ziele);
        for (const m of missing) {
            console.error(`✗ Kein Treffer / keine Datei: ${m}`);
        }
        if (files.length === 0) {
            console.error('✗ Keine .findsl-Dateien gefunden.');
            process.exit(1);
        }

        let gTotal = 0, gPassed = 0, gFailed = 0, gErrored = 0;
        let fileFailures = 0;
        let ranAny = false;

        for (const fullPath of files) {
            const parsedFiles = new Map<string, Program>();
            const parseFile: ParseFile = async (absPath) => {
                const cached = parsedFiles.get(absPath);
                if (cached) return cached;

                const content = await fs.readFile(absPath, 'utf-8');
                const document = services.shared.workspace.LangiumDocumentFactory.fromString(
                    content,
                    URI.file(absPath),
                );
                await services.shared.workspace.DocumentBuilder.build(
                    [document],
                    { validation: true },
                );
                const parseErrors = (document.diagnostics ?? []).filter((d) => d.severity === 1);
                if (parseErrors.length > 0) {
                    console.error(`✗ ${disp(absPath)}: Parsing/Validierung schlug fehl (${parseErrors.length} Fehler) — prüfe abgebrochen.`);
                    for (const d of parseErrors) {
                        const line = d.range.start.line + 1;
                        const col = d.range.start.character + 1;
                        console.error(`  ${line}:${col}  error    ${d.message}`);
                    }
                    // Batch nicht abbrechen — diese Datei zählt als Fehler.
                    throw new Error('parse-error');
                }
                const program = document.parseResult.value;
                if (!isProgram(program)) {
                    console.error(`✗ ${disp(absPath)}: kein gültiges FinDSL-Programm — prüfe abgebrochen.`);
                    throw new Error('parse-error');
                }
                parsedFiles.set(absPath, program);
                return program;
            };

            let report;
            try {
                // Path-Traversal-Schutz (Issue #73): siehe `crossModuleDiagnostics`.
                const modules = await loadModuleGraph(fullPath, parseFile, {
                    allowedRoot: path.dirname(fullPath),
                });
                report = runPruefe(modules);
            } catch (err) {
                if ((err as Error).message !== 'parse-error') {
                    console.error(`✗ ${disp(fullPath)}: ${(err as Error).message}`);
                }
                fileFailures++;
                continue;
            }

            // Quell-/Nicht-Test-Dateien (keine prüfe-Blöcke) überspringen
            // — relevant bei Verzeichnis-/Glob-Zielen.
            if (report.total === 0) {
                if (files.length === 1 || options.verbose) {
                    console.log(`— ${disp(fullPath)}: keine prüfe-Blöcke —`);
                }
                continue;
            }
            ranAny = true;

            for (const r of report.results) {
                if (r.status === 'pass' && !options.verbose) continue;
                const icon = r.status === 'pass' ? '✓' : (r.status === 'fail' ? '✗' : '!');
                const where = r.pruefeName
                    ? `[${r.pruefeName}] ${r.testfallLabel}`
                    : r.testfallLabel;
                console.log(`  ${icon} ${where} — ${r.detail}`);
            }

            if (report.ausgaben.length > 0) {
                console.log('  — ausgabe —');
                for (const line of report.ausgaben) console.log(`  ${line}`);
            }

            const summary = `${report.passed}/${report.total} bestanden`
                + (report.failed   ? `, ${report.failed} fehlgeschlagen` : '')
                + (report.errored  ? `, ${report.errored} Fehler`        : '');
            const ok = report.failed === 0 && report.errored === 0;
            console.log(`${ok ? '✓' : '✗'} ${disp(fullPath)}: ${summary}`);

            gTotal += report.total; gPassed += report.passed;
            gFailed += report.failed; gErrored += report.errored;
            if (!ok) fileFailures++;
        }

        if (files.length > 1 && ranAny) {
            const ok = gFailed === 0 && gErrored === 0 && fileFailures === 0;
            console.log(`${ok ? '✓' : '✗'} Gesamt: ${gPassed}/${gTotal} bestanden`
                + (gFailed  ? `, ${gFailed} fehlgeschlagen` : '')
                + (gErrored ? `, ${gErrored} Fehler`        : ''));
        }
        const allOk = fileFailures === 0 && gFailed === 0
            && gErrored === 0 && missing.length === 0;
        process.exit(allOk ? 0 : 1);
    });

program
    .command('docgen')
    .description('Generiert aggregierte Doku (MD/HTML/PDF) über alle '
        + '.findsl der Ziele (mehrere/Verzeichnis/Glob).')
    .argument('<pfade...>',
        'beliebig viele Ziele: einzelne Dateien, Verzeichnisse (rekursiv) '
        + 'oder Glob-Muster wie "examples/**/*.findsl" — Muster in '
        + 'Anführungszeichen setzen, sonst expandiert die Shell sie selbst')
    .option('-f, --format <fmt>', 'md | html | pdf | all', 'all')
    .option('-o, --out <ziel>', 'Ausgabe-Basisname (ohne Endung)', 'doc')
    .option('-k, --kopf <datei>', 'Markdown-Datei mit Front-Matter für '
        + 'Titelseite/Einleitung (fehlt sie, werden Titel/Untertitel '
        + 'aus dem ersten Modul abgeleitet)')
    .addHelpText('after', `
Beispiele:
  $ findsl docgen examples/kst -o examples/kst/out/kstg-doc -k examples/kst/kstg-doc.kopf.md
  $ findsl docgen examples -f pdf -o /tmp/findsl-gesamt
  $ findsl docgen 'examples/**/*.findsl' -f html -o /tmp/findsl-doc`)
    .action(async (
        pfade: string[],
        options: { format: string; out: string; kopf?: string },
    ) => {
        const { buildDocModel } = await import('@findsl/core/docgen/model.js');
        const { renderMarkdown } = await import('@findsl/core/docgen/markdown.js');
        const { ladeKopf, aufloesenKopf } = await import('@findsl/core/docgen/kopf.js');
        const { files, missing } = await resolveTargets(pfade);
        for (const m of missing) {
            console.error(`✗ Kein Treffer / keine Datei: ${m}`);
        }
        if (files.length === 0) {
            console.error(`✗ Keine .findsl-Dateien gefunden (${pfade.join(', ')}).`);
            process.exit(1);
        }
        const model = await buildDocModel(files);
        // Explizite Kopf-Datei hat Vorrang; fehlt sie, Titel/Untertitel
        // aus dem ersten Modul ableiten.
        const kopf = aufloesenKopf(
            await ladeKopf(options.kopf
                ? path.resolve(options.kopf) : undefined),
            model,
        );
        const stand = new Date().toISOString().slice(0, 10);
        const fmt = options.format.toLowerCase();
        const want = (f: string): boolean => fmt === 'all' || fmt === f;
        const base = path.resolve(options.out);
        // Zielverzeichnis anlegen, damit `-o <dir>/out/<name>` ohne
        // vorher existierendes Verzeichnis funktioniert (Konvention:
        // generierte Doku liegt im `out/`-Unterverzeichnis).
        await fs.mkdir(path.dirname(base), { recursive: true });
        const written: string[] = [];

        if (want('md')) {
            await fs.writeFile(`${base}.md`, renderMarkdown(model, { kopf }), 'utf-8');
            written.push(`${base}.md`);
        }
        if (want('html')) {
            const { renderHtml } = await import('@findsl/core/docgen/html.js');
            await fs.writeFile(`${base}.html`, renderHtml(model, { stand, kopf }), 'utf-8');
            written.push(`${base}.html`);
        }
        if (want('pdf')) {
            const { renderPdf } = await import('@findsl/core/docgen/pdf.js');
            await fs.writeFile(`${base}.pdf`, await renderPdf(model, { stand, kopf }));
            written.push(`${base}.pdf`);
        }
        if (written.length === 0) {
            console.error(`✗ Unbekanntes Format "${options.format}" (md|html|pdf|all).`);
            process.exit(1);
        }
        const decls = model.modules.reduce((n, m) => n + m.decls.length, 0);
        console.log(`✓ ${model.modules.length} Module, ${decls} Deklarationen → `
            + written.map((w) => path.basename(w)).join(', '));
        process.exit(0);
    });

program
    .command('codegen')
    .description('Erzeugt Zielsprachencode aus .findsl (Issue #7). '
        + 'Erwartet EIN Basisverzeichnis, ermittelt rekursiv alle '
        + '*.findsl; das Java-Package ist der relative Verzeichnispfad '
        + '(Verzeichnisse = Package-Struktur). Orakel: der Interpreter '
        + '(bit-genau).')
    .argument('<basisverzeichnis>',
        'Wurzelverzeichnis; rekursiv nach *.findsl durchsucht. Eine '
        + 'Datei direkt darin → unbenanntes (Default-)Package; '
        + 'Unterverzeichnisse → Package-Segmente. Kein -p/--package.')
    .option('-l, --lang <sprache>', 'Zielsprache (java|ts|js)', 'java')
    .option('-o, --out <verzeichnis>', 'Ausgabeverzeichnis (Hauptklassen)', 'out/java')
    .option('-t, --test-out <verzeichnis>',
        'Ausgabeverzeichnis für generierte JUnit-Tests aus prüfe-Blöcken '
        + '(Standard: --out — wie src/test/java vs. src/main/java)')
    .addHelpText('after', `
Beispiele:
  $ findsl codegen examples/kst -l java -o /tmp/findsl-java
  $ findsl codegen examples -o src/main/java -t src/test/java
  $ findsl codegen examples --lang java`)
    .action(async (
        basisverzeichnis: string,
        options: { lang: string; out: string; testOut?: string },
    ) => {
        const {
            istUnterstuetzteSprache, GEPLANTE_SPRACHEN,
            lowerProgram, lowerTestProgram, emitJavaModuleFiles, emitJavaTestModule,
            emitJavaPackageFactory, findCompositionCycle,
            emitTsModule, emitTsTestModule, emitJsModule, emitJsTestModule, stripRuntimeToJs,
            derivePackage, deriveClassName, isTestFile,
            JAVA_RUNTIME_FILES, TS_RUNTIME_FILES,
        } = await import('@findsl/core/codegen/index.js');

        const lang = options.lang.toLowerCase();
        if (!istUnterstuetzteSprache(lang)) {
            const geplant = (GEPLANTE_SPRACHEN as ReadonlyArray<string>).includes(lang)
                ? ` "${lang}" ist als Folge-Ticket geplant, aber noch nicht implementiert.`
                : '';
            console.error(`✗ Zielsprache "${options.lang}" nicht unterstützt `
                + `(verfügbar: java, ts, js).${geplant}`);
            process.exit(1);
        }

        const baseDir = path.resolve(basisverzeichnis);
        let baseStat;
        try {
            baseStat = await fs.stat(baseDir);
        } catch {
            console.error(`✗ Basisverzeichnis nicht gefunden: ${disp(baseDir)}`);
            process.exit(1);
        }
        if (!baseStat.isDirectory()) {
            console.error(`✗ ${disp(baseDir)} ist eine Datei — `
                + 'codegen erwartet ein Basisverzeichnis (rekursiv).');
            process.exit(1);
        }

        const { collectImportBindings } = await import(
            '@findsl/core/language/import-path.js');

        const services = createFindslServices(NodeFileSystem).Findsl;
        const { files } = await resolveTargets([baseDir]);
        if (files.length === 0) {
            console.error(`✗ Keine .findsl-Dateien unter ${disp(baseDir)} gefunden.`);
            process.exit(1);
        }

        const outDir = path.resolve(options.out);
        // Tests landen wie src/test/java vs. src/main/java separat;
        // ohne --test-out fällt es aufs Hauptverzeichnis zurück.
        const testOutDir = options.testOut
            ? path.resolve(options.testOut)
            : outDir;
        await fs.mkdir(outDir, { recursive: true });
        let failures = 0;

        interface Mod {
            readonly absFile: string;
            readonly program: Program;
            readonly className: string;
            readonly javaPackage: string | undefined;
        }
        // Eine `verwende`-Quelle, nach Zieldatei gruppiert (Durchgang 2
        // = Module, Durchgang 2b = Testmodule — identischer Shape).
        interface ImportEntry {
            program: Program;
            className: string;
            javaPackage: string | undefined;
            bindings: { localName: string; sourceName: string }[];
        }

        // Durchgang 1: ALLE Dateien parsen (Cross-Modul-Importe brauchen
        // das Ziel-Programm zur Symbol-Klassifikation). Schlüssel =
        // absoluter Pfad (= `resolveImportPath`-Schlüssel, Orakel).
        // Module → main-out; `*.test.findsl` → JUnit nach test-out.
        const modules = new Map<string, Mod>();
        const testModules = new Map<string, Mod>();
        for (const absFile of files) {
            const content = await fs.readFile(absFile, 'utf-8');
            const document = services.shared.workspace.LangiumDocumentFactory.fromString(
                content, URI.file(absFile),
            );
            await services.shared.workspace.DocumentBuilder.build(
                [document], { validation: false },
            );
            const parseErrors = (document.diagnostics ?? []).filter((d) => d.severity === 1);
            if (parseErrors.length > 0) {
                console.error(`✗ ${disp(absFile)}: Parse-/Validierungsfehler `
                    + `(${parseErrors.length}) — Codegen übersprungen.`);
                failures++;
                continue;
            }
            const program = document.parseResult.value;
            if (!isProgram(program)) {
                console.error(`✗ ${disp(absFile)}: kein gültiges FinDSL-Programm `
                    + `— Codegen übersprungen.`);
                failures++;
                continue;
            }
            // ADR8: Package = sanierter relativer Verzeichnispfad zur
            // Basis; Klassenname = PascalCase des Datei-Basenamens
            // (`kst.test` → `KstTest`). Wurzeldatei → unbenanntes Package.
            const relDir = path.relative(baseDir, path.dirname(absFile));
            const rec: Mod = {
                absFile,
                program,
                className: deriveClassName(path.basename(absFile, '.findsl')),
                javaPackage: derivePackage(relDir, path.sep),
            };
            (isTestFile(path.basename(absFile)) ? testModules : modules).set(absFile, rec);
        }

        // Durchgang 2: lowern + emittieren (mit aufgelösten Cross-Modul-
        // Importen). Iterationsreihenfolge = `files` (sortiert) → determ.
        const written: string[] = [];
        // Voll-qualifizierter Name (Package + Klasse) → Quelldatei:
        // schützt vor stillem Überschreiben bei Kollision.
        const seen = new Map<string, string>();
        // Java (#141): erfolgreich gelowerte Module je Package (Key = Package
        // oder '' für Default) → nach der Schleife eine <Pkg>Factory je Paket.
        const javaModulesByPkg = new Map<string, ReturnType<typeof lowerProgram>[]>();
        for (const mod of modules.values()) {
            const fqcn = (mod.javaPackage ?? '') + '.' + mod.className;
            const kollision = seen.get(fqcn);
            if (kollision !== undefined) {
                console.error(`✗ ${disp(mod.absFile)}: Namens-Kollision `
                    + `"${fqcn.replace(/^\./, '')}" (bereits aus `
                    + `${disp(kollision)}) — übersprungen.`);
                failures++;
                continue;
            }
            seen.set(fqcn, mod.absFile);

            // `verwende`-Bindungen je Zieldatei gruppieren (Erst-
            // Auftritts-Reihenfolge = `verwende`-Reihenfolge → determ.
            // Kompositions-Feld-Ordnung).
            const byPath = new Map<string, ImportEntry>();
            let importError = false;
            for (const b of collectImportBindings(mod.program)) {
                if (!b.resolvedPath) {
                    console.error(`✗ ${disp(mod.absFile)}: Import `
                        + `"${b.rawSource}" nicht auflösbar.`);
                    importError = true;
                    break;
                }
                const target = modules.get(b.resolvedPath);
                if (target === undefined) {
                    console.error(`✗ ${disp(mod.absFile)}: Import-Ziel `
                        + `${disp(b.resolvedPath)} liegt nicht unter dem `
                        + 'Basisverzeichnis oder ist fehlerhaft.');
                    importError = true;
                    break;
                }
                let entry = byPath.get(b.resolvedPath);
                if (entry === undefined) {
                    entry = {
                        program: target.program,
                        className: target.className,
                        javaPackage: target.javaPackage,
                        bindings: [],
                    };
                    byPath.set(b.resolvedPath, entry);
                }
                entry.bindings.push({ localName: b.localName, sourceName: b.sourceName });
            }
            if (importError) {
                failures++;
                continue;
            }

            // Lowering/Emission pro Modul kapseln: ein noch nicht
            // unterstütztes Konstrukt (Phase-4-Scope) darf NUR diese
            // Datei überspringen, nicht den ganzen Batch abbrechen
            // (analog zur Parse-Fehler-Behandlung).
            // Lowering/Emission pro Modul kapseln: ein noch nicht
            // unterstütztes Konstrukt (Phase-4-Scope) darf NUR diese
            // Datei überspringen, nicht den ganzen Batch abbrechen
            // (analog zur Parse-Fehler-Behandlung). Java: ZWEI Dateien
            // (`<Name>.java` Interface + `<Name>Impl.java`); TS: EINE
            // Datei (`<Name>.ts`, Top-Level-Deklarationen).
            let outFiles: ReadonlyArray<{ name: string; content: string }>;
            try {
                const ir = lowerProgram(mod.program, {
                    javaPackage: mod.javaPackage,
                    className: mod.className,
                    imports: [...byPath.values()],
                });
                if (lang === 'ts' || lang === 'js') {
                    const f = lang === 'js' ? emitJsModule(ir) : emitTsModule(ir);
                    outFiles = [{ name: f.fileName, content: f.code }];
                } else {
                    const f = emitJavaModuleFiles(ir);
                    outFiles = [
                        { name: `${f.interfaceName}.java`, content: f.interfaceCode },
                        { name: `${f.implName}.java`, content: f.implCode },
                    ];
                    // Für die <Pkg>Factory sammeln (nur erfolgreich gelowert).
                    const key = mod.javaPackage ?? '';
                    const bucket = javaModulesByPkg.get(key);
                    if (bucket === undefined) javaModulesByPkg.set(key, [ir]);
                    else bucket.push(ir);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`✗ ${disp(mod.absFile)}: ${msg}`);
                failures++;
                continue;
            }
            // Ausgabeverzeichnis spiegelt die Package-Struktur (javac/JVM-
            // bzw. ESM-konform); Wurzeldatei → direkt ins Ausgabeverzeichnis.
            const targetDir = mod.javaPackage === undefined
                ? outDir
                : path.join(outDir, ...mod.javaPackage.split('.'));
            await fs.mkdir(targetDir, { recursive: true });
            for (const of of outFiles) {
                const target = path.join(targetDir, of.name);
                await fs.writeFile(target, of.content, 'utf-8');
                written.push(target);
            }
        }

        // Durchgang 2c (nur Java, #141): pro Package eine <Pkg>Factory
        // (Komposition-Wurzel). Erst NACH dem Lowering aller Module, weil
        // die Factory die composedModules (Konstruktor-Args) jedes Moduls
        // des Pakets braucht. Default-Package → Wurzelverzeichnis.
        if (lang === 'java') {
            // Cross-Package-Zyklen sieht der per-Paket-Topo-Sort nicht; ein
            // eager `static final`-Singleton bekäme sonst still `null`
            // injiziert. Global (paket-qualifiziert) prüfen → klare Meldung
            // statt stillem Laufzeit-`null`.
            const allJavaMods = [...javaModulesByPkg.values()].flat();
            const cycle = findCompositionCycle(allJavaMods);
            if (cycle !== undefined) {
                console.error('✗ Zyklische Modul-Komposition (verwende): '
                    + `${cycle.join(' → ')} — die <Pkg>Factory kann keine `
                    + 'azyklische Singleton-Initialisierung erzeugen; '
                    + 'keine Factory geschrieben.');
                failures++;
            } else {
                for (const [pkgKey, mods] of javaModulesByPkg) {
                    const pkg = pkgKey === '' ? undefined : pkgKey;
                    // Emit/Schreiben kapseln: ein Factory-Fehler (z. B.
                    // Feldnamen-Kollision) meldet sauber, statt den Lauf
                    // mit Stacktrace abzubrechen.
                    try {
                        const f = emitJavaPackageFactory(pkg, mods);
                        const targetDir = pkg === undefined
                            ? outDir
                            : path.join(outDir, ...pkg.split('.'));
                        await fs.mkdir(targetDir, { recursive: true });
                        const target = path.join(targetDir, `${f.factoryName}.java`);
                        await fs.writeFile(target, f.code, 'utf-8');
                        written.push(target);
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        console.error(`✗ Factory für Package "${pkg ?? '(default)'}": ${msg}`);
                        failures++;
                    }
                }
            }
        }

        // Durchgang 2b: `*.test.findsl` → JUnit5-Testklassen. Das SUT
        // wird per `verwende` importiert und per Komposition eingebunden
        // (gleiche Maschinerie wie Cross-Modul, Inkrement 2); selbes
        // Java-Package wie das SUT → `protected` `_`-Methoden erreichbar.
        const writtenTests: string[] = [];
        const seenTest = new Map<string, string>();
        for (const tm of testModules.values()) {
            const fqcn = (tm.javaPackage ?? '') + '.' + tm.className;
            const kollision = seenTest.get(fqcn);
            if (kollision !== undefined) {
                console.error(`✗ ${disp(tm.absFile)}: Testklassen-Kollision `
                    + `"${fqcn.replace(/^\./, '')}" (bereits aus `
                    + `${disp(kollision)}) — übersprungen.`);
                failures++;
                continue;
            }
            seenTest.set(fqcn, tm.absFile);

            const byPath = new Map<string, ImportEntry>();
            let importError = false;
            for (const b of collectImportBindings(tm.program)) {
                if (!b.resolvedPath) {
                    console.error(`✗ ${disp(tm.absFile)}: Import `
                        + `"${b.rawSource}" nicht auflösbar.`);
                    importError = true;
                    break;
                }
                const target = modules.get(b.resolvedPath);
                if (target === undefined) {
                    console.error(`✗ ${disp(tm.absFile)}: SUT-Import-Ziel `
                        + `${disp(b.resolvedPath)} liegt nicht unter dem `
                        + 'Basisverzeichnis oder ist keine Nicht-Test-Datei.');
                    importError = true;
                    break;
                }
                let entry = byPath.get(b.resolvedPath);
                if (entry === undefined) {
                    entry = {
                        program: target.program,
                        className: target.className,
                        javaPackage: target.javaPackage,
                        bindings: [],
                    };
                    byPath.set(b.resolvedPath, entry);
                }
                entry.bindings.push({ localName: b.localName, sourceName: b.sourceName });
            }
            if (importError) {
                failures++;
                continue;
            }

            // (#44 / Lücke 15) Transitive Schließung — Spiegel der
            // Interpreter-Sicht: Aufzählungs-Werte sind in einem Modul
            // bereits dann sichtbar, wenn der Aufzählungs-TYP aus einem
            // Re-Export importiert wurde, auch ohne expliziten
            // Wert-Import. Damit der Test-Codegen Enum-Werte korrekt zu
            // `OwnerClass.Enum.Wert` qualifiziert, brauchen wir ALLE
            // transitiv erreichbaren Sach-Module im `imports`-Array
            // (das `buildRegistry`-Lowering registriert die Werte beim
            // Durchlaufen jedes importierten Programms — auch ohne
            // explizite Bindings für die Werte).
            const worklist = [...byPath.keys()];
            while (worklist.length > 0) {
                const currentPath = worklist.shift()!;
                const currentMod = modules.get(currentPath);
                if (currentMod === undefined) continue;
                for (const b of collectImportBindings(currentMod.program)) {
                    if (!b.resolvedPath || byPath.has(b.resolvedPath)) continue;
                    const target = modules.get(b.resolvedPath);
                    if (target === undefined) continue;
                    byPath.set(b.resolvedPath, {
                        program: target.program,
                        className: target.className,
                        javaPackage: target.javaPackage,
                        bindings: [],            // implizit (transitiv)
                    });
                    worklist.push(b.resolvedPath);
                }
            }

            let testFileName: string;
            let testCode: string;
            try {
                const ir = lowerTestProgram(tm.program, {
                    javaPackage: tm.javaPackage,
                    className: tm.className,
                    imports: [...byPath.values()],
                });
                if (lang === 'ts' || lang === 'js') {
                    const f = lang === 'js' ? emitJsTestModule(ir) : emitTsTestModule(ir);
                    testFileName = f.fileName;
                    testCode = f.code;
                } else {
                    testFileName = `${tm.className}.java`;
                    testCode = emitJavaTestModule(ir);
                }
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`✗ ${disp(tm.absFile)}: ${msg}`);
                failures++;
                continue;
            }
            const targetDir = tm.javaPackage === undefined
                ? testOutDir
                : path.join(testOutDir, ...tm.javaPackage.split('.'));
            await fs.mkdir(targetDir, { recursive: true });
            const target = path.join(targetDir, testFileName);
            await fs.writeFile(target, testCode, 'utf-8');
            writtenTests.push(target);
        }

        // Runtime-Quellen mit-emittieren: Generat-Output ist damit ein
        // vollständig autonomes Java-Projekt — keine externe Maven-
        // Dependency auf `org.findsl:findsl-runtime` nötig (ADR-Refit).
        // Idempotent: bei wiederholtem Lauf werden die Dateien überschrieben,
        // Lockstep zwischen CLI-Version und ausgelieferter Runtime ist
        // automatisch (beides aus demselben CLI-Bundle).
        const writtenRuntime: string[] = [];
        if (written.length > 0) {
            const runtimeFiles = lang === 'ts' ? TS_RUNTIME_FILES
                : lang === 'js' ? stripRuntimeToJs(TS_RUNTIME_FILES)
                : JAVA_RUNTIME_FILES;
            try {
                for (const rf of runtimeFiles) {
                    const target = path.join(outDir, ...rf.relPath.split('/'));
                    await fs.mkdir(path.dirname(target), { recursive: true });
                    await fs.writeFile(target, rf.content, 'utf-8');
                    writtenRuntime.push(target);
                }
                // JS-Output: `package.json` mit `type: module` macht das
                // Generat zu echtem Node-ESM (`.js` = ESM); decimal.js als
                // einzige Laufzeit-Abhängigkeit deklariert.
                if (lang === 'js') {
                    const pkgJson = path.join(outDir, 'package.json');
                    await fs.writeFile(pkgJson, JSON.stringify({
                        type: 'module',
                        dependencies: { 'decimal.js': '^10.4.3' },
                    }, null, 2) + '\n', 'utf-8');
                    writtenRuntime.push(pkgJson);
                }
            } catch (err) {
                // fs-Fehler nach erfolgreichem Codegen darf nicht still als
                // Erfolg (Exit 0) durchgehen — als Fehlschlag werten.
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`✗ Runtime-Auslieferung nach ${disp(outDir)} `
                    + `fehlgeschlagen: ${msg}`);
                failures++;
            }
        }

        if (written.length > 0) {
            console.log(`✓ ${written.length} Modul(e) → ${lang} `
                + `(${disp(outDir)}/) — bit-genau (Interpreter-Orakel).`);
        }
        if (writtenRuntime.length > 0) {
            const runtimeDir = lang === 'java'
                ? path.join(outDir, 'org', 'findsl', 'runtime')
                : path.join(outDir, 'runtime');
            const dep = lang === 'java'
                ? 'keine externe Dependency'
                : 'einzige Dependency: decimal.js';
            console.log(`✓ ${writtenRuntime.length} Runtime-Datei(en) → `
                + `${disp(runtimeDir)}/ — autonomer ${lang.toUpperCase()}-Output, ${dep}.`);
        }
        if (writtenTests.length > 0) {
            const testKind = lang === 'java' ? 'JUnit5-Testklasse(n)' : 'Vitest-Spec(s)';
            console.log(`✓ ${writtenTests.length} ${testKind} → `
                + `(${disp(testOutDir)}/) — prüfe-Spiegel (runPruefeDecl).`);
        }
        if (written.length === 0 && writtenTests.length === 0 && failures === 0) {
            console.error('✗ Nichts erzeugt (keine passenden .findsl-Dateien).');
        }
        process.exit(failures > 0 ? 1 : 0);
    });

program
    .command('papgen')
    .description('Erzeugt Programmablaufpläne (DIN-66001-nah) als Mermaid-'
        + 'Markdown oder self-contained HTML über alle .findsl der Ziele. '
        + 'Eine fn = ein Diagramm.')
    .argument('<pfade...>',
        'beliebig viele Ziele: einzelne Dateien, Verzeichnisse (rekursiv) '
        + 'oder Glob-Muster wie "examples/**/*.findsl" — Muster in '
        + 'Anführungszeichen setzen, sonst expandiert die Shell sie selbst')
    .option('-f, --format <fmt>', 'mermaid | html (self-contained, klickbare Links)', 'mermaid')
    .option('--detail <stufe>', 'struktur | voll', 'struktur')
    .option('--params <modus>', 'symbole (Parameter als Eingabe-Symbole, Default) | inline', 'symbole')
    .option('--theme <name>', 'default | neutral | dark | forest (nur -f mermaid; '
        + 'HTML folgt dem OS-Hell/Dunkel)', 'default')
    .option('--no-farben', 'semantische Knoten-Färbung abschalten')
    .option('--ohne-intern', 'interne (_-)Funktionen weglassen — nur öffentliche API')
    .option('-o, --out <ziel>', 'Ausgabe-Basisname (ohne Endung)', 'papgen')
    .addHelpText('after', `
Beispiele:
  $ findsl papgen examples/kst/kst.findsl -o examples/kst/out/kst-pap
  $ findsl papgen examples --detail voll --params symbole --theme neutral -o /tmp/findsl-pap`)
    .action(async (
        pfade: string[],
        options: {
            format: string; detail: string; params: string;
            theme: string; farben: boolean; ohneIntern?: boolean; out: string;
        },
    ) => {
        const fmt = options.format.toLowerCase();
        if (fmt !== 'mermaid' && fmt !== 'html') {
            console.error(`✗ Unbekanntes Format "${options.format}" (mermaid | html).`);
            process.exit(1);
        }
        const detail: 'struktur' | 'voll' = options.detail === 'voll' ? 'voll' : 'struktur';
        const params: 'inline' | 'symbole' = options.params === 'inline' ? 'inline' : 'symbole';
        const THEMES = ['default', 'neutral', 'dark', 'forest'] as const;
        type Theme = (typeof THEMES)[number];
        const theme: Theme = (THEMES as ReadonlyArray<string>).includes(options.theme)
            ? options.theme as Theme : 'default';
        const { buildPapModel } = await import('@findsl/core/papgen/model.js');
        const { files, missing } = await resolveTargets(pfade);
        for (const m of missing) {
            console.error(`✗ Kein Treffer / keine Datei: ${m}`);
        }
        if (files.length === 0) {
            console.error(`✗ Keine .findsl-Dateien gefunden (${pfade.join(', ')}).`);
            process.exit(1);
        }
        try {
            const model = await buildPapModel(files, {
                detail, params, publicOnly: !!options.ohneIntern,
            });
            const base = path.resolve(options.out);
            await fs.mkdir(path.dirname(base), { recursive: true });
            const mermaidOpts = { theme, farben: options.farben };
            let outPath: string;
            if (fmt === 'html') {
                // Self-contained HTML (mermaid inline) — klickbare Links, Hover.
                const { renderHtml } = await import('@findsl/core/papgen/html.js');
                outPath = `${base}.html`;
                await fs.writeFile(outPath, renderHtml(model, mermaidOpts), 'utf-8');
            } else {
                const { renderModuleMarkdown } = await import('@findsl/core/papgen/mermaid.js');
                outPath = `${base}.md`;
                await fs.writeFile(outPath,
                    model.map((m) => renderModuleMarkdown(m, mermaidOpts)).join('\n\n'), 'utf-8');
            }
            const graphs = model.reduce((n, m) => n + m.graphs.length, 0);
            // `--theme` wirkt nur auf Mermaid; bei HTML steuert das OS die
            // Helligkeit — daher dort nicht melden (sonst irreführend).
            const stil = fmt === 'html' ? detail : `${detail}, ${theme}`;
            console.log(`✓ ${model.length} Modul(e), ${graphs} Ablaufpläne (${stil}) → `
                + `${path.basename(outPath)}`);
        } catch (err) {
            console.error('✗ PAP-Erzeugung fehlgeschlagen: '
                + (err instanceof Error ? err.message : String(err)));
            process.exit(1);
        }
        // Exit-Code spiegelt fehlende Ziele (skript-tauglich, wie `check`).
        process.exit(missing.length > 0 ? 1 : 0);
    });

// Top-Level-Einstieg: Commander parst und führt die Action aus. Bewusst
// nicht awaitbar (Modul-Top-Level); Fehler behandeln die Actions selbst
// via process.exit.
void program.parseAsync(process.argv);

function severityName(sev: number | undefined): string {
    switch (sev) {
        case 1:  return 'error';
        case 2:  return 'warning';
        case 3:  return 'info';
        case 4:  return 'hint';
        default: return '?';
    }
}

/**
 * Zählt AST-Knoten rekursiv. Überspringt Langium-interne Properties
 * (Präfix `$` wie `$container`, `$cstNode`, `$type`), die Rückwärts-
 * zeiger und Metadaten enthalten — sonst läuft der Walker in Zyklen.
 */
function countNodes(node: unknown): number {
    if (node === null || typeof node !== 'object') return 0;
    let count = 1;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key.startsWith('$')) continue;          // Langium-Metadaten überspringen
        if (Array.isArray(value)) {
            for (const item of value) count += countNodes(item);
        } else if (value !== null && typeof value === 'object') {
            count += countNodes(value);
        }
    }
    return count;
}
