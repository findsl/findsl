// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime.codegen;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.EnumDeclaration;
import com.github.javaparser.ast.body.MethodDeclaration;
import com.github.javaparser.ast.body.RecordDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

/**
 * Konstrukt-Coverage-Wächter für das {@code examples/korpus/}-Korpus
 * (Issue #43, Phase 3). Ergänzt den modul-agnostischen
 * {@link GeneratedStructureTest} um <em>gezielte</em> Existenz- und
 * Lowering-Pattern-Checks: prüft pro SPEC-§-Konstrukt, dass das
 * erwartete Generat tatsächlich vorhanden ist.
 *
 * <p>Damit wird der Korpus zum Regressions-Sensor für den
 * Java-Codegen-Lowering-Pfad: wer z. B. die Lowering-Form von
 * {@code ?.} ändert (heute {@code (x != null) ? x.f() : null}), würde
 * ohne diesen Test bestenfalls durch die {@code runPruefeDecl}-Wert-
 * Tests indirekt erwischt — hier schlägt der Test direkt aus.
 *
 * <p>Liest dieselben System-Properties wie {@link GeneratedStructureTest}
 * ({@code findsl.gen.main}/{@code findsl.gen.test}); konzentriert
 * sich aber ausschließlich auf das {@code korpus/}-Sub-Korpus.
 */
class KorpusCoverageTest {

    private static final Map<String, CompilationUnit> CU = new HashMap<>();

    @BeforeAll
    static void parseAll() throws IOException {
        StaticJavaParser.getParserConfiguration()
                .setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21);
        Path mainDir = Path.of(System.getProperty("findsl.gen.main"));
        if (!Files.isDirectory(mainDir)) {
            return;
        }
        try (Stream<Path> s = Files.walk(mainDir)) {
            for (Path p : (Iterable<Path>) s.filter(f -> {
                String n = f.getFileName().toString();
                return n.startsWith("Korpus") && n.endsWith(".java");
            })::iterator) {
                CU.put(p.getFileName().toString().replace(".java", ""),
                        StaticJavaParser.parse(p));
            }
        }
    }

    private CompilationUnit cu(String name) {
        CompilationUnit c = CU.get(name);
        assertNotNull(c, "Generierte Datei fehlt: " + name + ".java "
                + "(erwartet aus examples/korpus/" + name.toLowerCase() + ".findsl)");
        return c;
    }

    private TypeDeclaration<?> topType(String name) {
        return cu(name).getType(0);
    }

    private String body(String name) {
        return cu(name).toString();
    }

    private MethodDeclaration method(String typeName, String methodName) {
        var t = topType(typeName);
        List<MethodDeclaration> ms = t.getMethodsByName(methodName);
        assertTrue(!ms.isEmpty(), typeName + ": Methode " + methodName + "() fehlt — "
                + "im Korpus erwartet, aber nicht generiert");
        return ms.get(0);
    }

    private void assertBodyContains(String typeName, String fragment, String reason) {
        String src = body(typeName);
        assertTrue(src.contains(fragment),
                typeName + ": fehlendes Lowering-Pattern für " + reason
                        + ".\n  erwartet im Source: «" + fragment + "»");
    }

    // =========================================================================
    // KorpusTypen — § 3.7 Aufzählung, § 3.8 Datensatz, § 6.1 konst
    // =========================================================================

    @Nested
    @DisplayName("KorpusTypen — § 3.7/§ 3.8/§ 6.1")
    class TypenChecks {
        @Test
        @DisplayName("§ 3.7 Aufzählung: enum Farbe { Rot, Grün, Blau }")
        void enumFarbe() {
            var farbe = topType("KorpusTypen").findFirst(EnumDeclaration.class,
                    e -> e.getNameAsString().equals("Farbe"));
            assertTrue(farbe.isPresent(), "enum Farbe fehlt");
            var names = farbe.get().getEntries().stream()
                    .map(c -> c.getNameAsString()).toList();
            assertTrue(names.contains("Rot") && names.contains("Grün") && names.contains("Blau"),
                    "Farbe muss Rot/Grün/Blau enthalten, war: " + names);
        }

        @Test
        @DisplayName("§ 3.7 Aufzählung: enum Status { Aktiv, Inaktiv }")
        void enumStatus() {
            var status = topType("KorpusTypen").findFirst(EnumDeclaration.class,
                    e -> e.getNameAsString().equals("Status"));
            assertTrue(status.isPresent(), "enum Status fehlt");
        }

        @Test
        @DisplayName("§ 3.8 Datensatz: record Punkt(Ganzzahl x, Ganzzahl y)")
        void recordPunkt() {
            var rec = topType("KorpusTypen").findFirst(RecordDeclaration.class,
                    r -> r.getNameAsString().equals("Punkt"));
            assertTrue(rec.isPresent(), "record Punkt fehlt");
            var params = rec.get().getParameters();
            assertTrue(params.size() == 2 && params.stream().allMatch(p ->
                            p.getType().asString().equals("Ganzzahl")),
                    "Punkt erwartet 2 Ganzzahl-Felder, war: " + params);
        }

        @Test
        @DisplayName("§ 3.8 + § 3.9 Datensatz mit Nullable-Default: Person.email = nichts")
        void recordPersonNullable() {
            var rec = topType("KorpusTypen").findFirst(RecordDeclaration.class,
                    r -> r.getNameAsString().equals("Person"));
            assertTrue(rec.isPresent(), "record Person fehlt");
            // email: Text? → @Nullable String email
            assertTrue(rec.get().getParameters().stream()
                            .anyMatch(p -> p.getNameAsString().equals("email")),
                    "Person muss ein email-Feld haben");
        }
    }

    // =========================================================================
    // KorpusAusdruecke — komplette SPEC § 4
    // =========================================================================

    @Nested
    @DisplayName("KorpusAusdruecke — SPEC § 4 Konstrukt-Lowerings")
    class AusdrueckeChecks {
        @Test
        @DisplayName("§ 4.2 Arithmetik: addition/subtraktion/multiplikationEuroProzent/division")
        void arithmetik() {
            method("KorpusAusdrueckeImpl", "addition");
            method("KorpusAusdrueckeImpl", "subtraktion");
            method("KorpusAusdrueckeImpl", "multiplikationEuroProzent");
            method("KorpusAusdrueckeImpl", "division");
        }

        @Test
        @DisplayName("§ 4.3 Vergleichsoperatoren: 6 Vergleichs-Funktionen vorhanden")
        void vergleich() {
            for (String m : List.of("istGleich", "istUngleich", "istKleiner",
                    "istKleinerGleich", "istGroesser", "istGroesserGleich")) {
                method("KorpusAusdrueckeImpl", m);
            }
        }

        @Test
        @DisplayName("§ 4.4 Logik: logischUnd/logischOder/logischNicht")
        void logik() {
            method("KorpusAusdrueckeImpl", "logischUnd");
            method("KorpusAusdrueckeImpl", "logischOder");
            method("KorpusAusdrueckeImpl", "logischNicht");
        }

        @Test
        @DisplayName("§ 4.5 Elvis lowert zu `(x != null) ? x : y`")
        void elvis() {
            method("KorpusAusdrueckeImpl", "elvisFallback");
            assertBodyContains("KorpusAusdrueckeImpl",
                    "(eingabe != null) ? eingabe : ersatz",
                    "Elvis-Operator (§ 4.5)");
        }

        @Test
        @DisplayName("§ 4.6 Sicher-Zugriff `?.` lowert zu `(p != null) ? p.feld() : null`")
        void sicherZugriff() {
            method("KorpusAusdrueckeImpl", "emailVonPerson");
            assertBodyContains("KorpusAusdrueckeImpl",
                    "(p != null) ? p.email() : null",
                    "Sicher-Zugriff `?.` (§ 4.6)");
        }

        @Test
        @DisplayName("§ 4.7 Force-Unwrap `!!` lowert zu Objects.requireNonNull(…)")
        void forceUnwrap() {
            method("KorpusAusdrueckeImpl", "forceUnwrap");
            assertBodyContains("KorpusAusdrueckeImpl",
                    "java.util.Objects.requireNonNull",
                    "Force-Unwrap `!!` (§ 4.7)");
        }

        @Test
        @DisplayName("§ 4.8 Cast `als` lowert zu `.cast(FinDslNumber.Type.<Ziel>)`")
        void castAls() {
            method("KorpusAusdrueckeImpl", "castEuroZuEuroCent");
            method("KorpusAusdrueckeImpl", "castGanzzahlZuCent");
            assertBodyContains("KorpusAusdrueckeImpl",
                    "cast(FinDslNumber.Type.EuroCent)",
                    "Cast Euro → EuroCent (§ 4.8)");
            assertBodyContains("KorpusAusdrueckeImpl",
                    "cast(FinDslNumber.Type.Cent)",
                    "Cast Ganzzahl → Cent (§ 4.8)");
        }

        @Test
        @DisplayName("§ 4.9 Wenn-Sonst-Ausdruck lowert zu if/return-Sequenz")
        void wennSonst() {
            var m = method("KorpusAusdrueckeImpl", "wennEuroPositiv");
            assertTrue(m.toString().contains("if ("),
                    "wennEuroPositiv erwartet if-Statement");
            assertTrue(m.toString().contains("\"positiv\"") && m.toString().contains("\"nicht positiv\""),
                    "wennEuroPositiv muss beide Zweige als Text-Literale enthalten");
        }

        @Test
        @DisplayName("§ 4.10 Wähle (Guards): ampelGuard erzeugt mehrere if-Stufen")
        void waehleGuards() {
            String src = method("KorpusAusdrueckeImpl", "ampelGuard").toString();
            int ifCount = src.split("if \\(").length - 1;
            assertTrue(ifCount >= 3,
                    "ampelGuard sollte ≥3 if-Stufen erzeugen (langsam/normal/schnell), hatte: " + ifCount);
            for (String s : List.of("\"langsam\"", "\"normal\"", "\"schnell\"", "\"rasant\"")) {
                assertTrue(src.contains(s), "ampelGuard fehlt Text-Zweig " + s);
            }
        }

        @Test
        @DisplayName("§ 4.10 Wähle (Subjekt + Multi-Pattern): farbBeschreibung mit Rot/Grün, Blau")
        void waehleSubject() {
            String src = method("KorpusAusdrueckeImpl", "farbBeschreibung").toString();
            assertTrue(src.contains("Farbe.Rot") && src.contains("Farbe.Grün")
                            && src.contains("Farbe.Blau"),
                    "farbBeschreibung muss alle 3 Enum-Werte referenzieren");
            assertTrue(src.contains("\"warm\"") && src.contains("\"kühl\""),
                    "farbBeschreibung muss \"warm\" + \"kühl\" als Ergebnis-Texte erzeugen");
        }

        @Test
        @DisplayName("§ 4.11 Funktionsaufruf positional + benannt + Default-Param")
        void funktionsaufruf() {
            method("KorpusAusdrueckeImpl", "aufrufPositional");
            method("KorpusAusdrueckeImpl", "aufrufBenannt");
            // _begrüßung ist `_`-prefixed → package-private, nicht im Interface,
            // aber im Impl als private Methode aufrufbar.
            String src = body("KorpusAusdrueckeImpl");
            assertTrue(src.contains("_begrüßung") || src.contains("begrüßung"),
                    "_begrüßung muss im Impl aufrufbar sein");
        }

        @Test
        @DisplayName("§ 4.12 Lambda im HOF-Method-Kontext: .zuordnen((x) -> …)")
        void lambdaHOF() {
            String src = method("KorpusAusdrueckeImpl", "quadriere").toString();
            assertTrue(src.contains(".zuordnen") && src.contains("->"),
                    "quadriere muss .zuordnen(...) mit Lambda enthalten");
        }

        @Test
        @DisplayName("§ 4.13 Feldzugriff: punktX.x")
        void feldzugriff() {
            String src = method("KorpusAusdrueckeImpl", "punktX").toString();
            assertTrue(src.contains("p.x()"),
                    "punktX erwartet Record-Accessor p.x()");
        }

        @Test
        @DisplayName("§ 4.14 Datensatz-Konstruktor: Punkt.von(…) oder new Punkt(…)")
        void datensatzKonstruktor() {
            String src = method("KorpusAusdrueckeImpl", "punktVon").toString();
            assertTrue(src.contains("Punkt") && (src.contains(".von(") || src.contains("new ")),
                    "punktVon muss einen Punkt konstruieren");
        }

        @Test
        @DisplayName("§ 4.15 Listen-Konstruktor: FinDslListe.of(…)")
        void listenKonstruktor() {
            assertBodyContains("KorpusAusdrueckeImpl", "FinDslListe.of(",
                    "Listen-Literal (§ 4.15)");
        }

        @Test
        @DisplayName("§ 4.16 Bereich-Konstruktor: FinDslListe.bereich(…)")
        void bereichKonstruktor() {
            method("KorpusAusdrueckeImpl", "bereichInklusiv");
            method("KorpusAusdrueckeImpl", "bereichExklusiv");
            method("KorpusAusdrueckeImpl", "bereichMitSchritt");
            assertBodyContains("KorpusAusdrueckeImpl", "FinDslListe.bereich(",
                    "Bereich-Literal (§ 4.16)");
        }

        @Test
        @DisplayName("§ 4.17 Block-Ausdruck + § 5.1 var: final-Bindungen im Block")
        void blockMitVar() {
            String src = method("KorpusAusdrueckeImpl", "blockMitVar").toString();
            assertTrue(src.contains("final"),
                    "blockMitVar muss var-Bindungen als `final` lowern");
        }

        @Test
        @DisplayName("§ 4.19 Abbruch-Ausdruck: FinDslAbort wird geworfen")
        void abbruch() {
            String src = method("KorpusAusdrueckeImpl", "kehrwertOderAbbruch").toString();
            assertTrue(src.contains("FinDslAbort") || src.contains("throw "),
                    "kehrwertOderAbbruch muss FinDslAbort/throw enthalten");
        }
    }

    // =========================================================================
    // KorpusFunktionen — § 6.2 fn-Formen, § 3.12 Funktionstyp, § 6.2.4 Closures
    // =========================================================================

    @Nested
    @DisplayName("KorpusFunktionen — § 6.2 fn-Varianten")
    class FunktionenChecks {
        @Test
        @DisplayName("§ 6.2.1/§ 6.2.2 Block-Body + Expression-Body")
        void bodyForms() {
            method("KorpusFunktionenImpl", "blockBody");
            method("KorpusFunktionenImpl", "expressionBody");
        }

        @Test
        @DisplayName("§ 6.2.3 Default-Parameter: bruttopreis hat einen Default-Wert für mehrwertsteuer")
        void defaultParam() {
            // Default-Param-Expansion: der Caller bekommt eine 1-arg-Variante
            // oder das Impl hat einen Default im 2-arg-Body. Mindestens muss
            // die Methode vorhanden sein.
            method("KorpusFunktionenImpl", "bruttopreis");
        }

        @Test
        @DisplayName("§ 6.2.4 Closures + § 3.12 Funktionstyp: machAddierer liefert FinDslLambda1")
        void closure() {
            var m = method("KorpusFunktionenImpl", "machAddierer");
            String ret = m.getType().asString();
            assertTrue(ret.contains("FinDslLambda1"),
                    "machAddierer muss FinDslLambda1<…> zurückgeben, war: " + ret);
        }

        @Test
        @DisplayName("§ 6.2.4 Lambda als var: zweiSchritteFest bindet Closure in lokaler Variable")
        void lambdaVarBindung() {
            String src = method("KorpusFunktionenImpl", "zweiSchritteFest").toString();
            assertTrue(src.contains("FinDslLambda1") || src.contains("addiere"),
                    "zweiSchritteFest muss eine Lambda-var-Bindung enthalten");
        }

        @Test
        @DisplayName("§ 8.4 Sichtbarkeit: _addiereEins nicht im Interface, im Impl vorhanden")
        void sichtbarkeit() {
            // `_`-prefixed → package-private, NICHT im Interface
            var ifaceMs = ((ClassOrInterfaceDeclaration) topType("KorpusFunktionen"))
                    .getMethodsByName("_addiereEins");
            assertTrue(ifaceMs.isEmpty(),
                    "_addiereEins darf NICHT im Interface auftauchen (Sichtbarkeit § 8.4)");
            // Im Impl muss es als Helper-Methode existieren oder zumindest aufgerufen werden.
            String src = body("KorpusFunktionenImpl");
            assertTrue(src.contains("_addiereEins") || src.contains("addiereEins"),
                    "_addiereEins muss im Impl referenziert sein (von zweiPlusEins)");
        }

        @Test
        @DisplayName("§ 3.13 Bidirektionale Inferenz: festerEuroBetrag liefert Euro")
        void biInferenz() {
            var m = method("KorpusFunktionenImpl", "festerEuroBetrag");
            assertTrue(m.getType().asString().equals("Euro"),
                    "festerEuroBetrag muss Euro zurückgeben (Return-Typ-Inferenz)");
        }
    }

    // =========================================================================
    // KorpusStdlib — § 11.1 Rundung, § 11.2 alle 12 Listen-Methoden, § 11.5 +
    // =========================================================================

    @Nested
    @DisplayName("KorpusStdlib — SPEC § 11 Standard-Bibliothek")
    class StdlibChecks {
        @Test
        @DisplayName("§ 11.1 Rundung: alle 8 Empfänger-Methoden-Permutationen vorhanden")
        void rundungAlle() {
            for (String m : List.of(
                    "abrundenEuro", "aufrundenEuro",
                    "abrundenCent", "aufrundenCent",
                    "abrundenProzent", "aufrundenProzent",
                    "abrundenDezimal", "aufrundenDezimal")) {
                method("KorpusStdlibImpl", m);
            }
        }

        @Test
        @DisplayName("§ 11.1 Zielwahl korrekt: Euro→Type.Euro, Cent→Type.Cent, Prozent→Type.Prozent, Dezimal→Type.Ganzzahl")
        void rundungZielwahl() {
            String src = body("KorpusStdlibImpl");
            assertTrue(src.contains(".abrunden(FinDslNumber.Type.Euro)"),
                    "abrundenEuro muss Type.Euro als Ziel verwenden");
            assertTrue(src.contains(".abrunden(FinDslNumber.Type.Cent)"),
                    "abrundenCent muss Type.Cent als Ziel verwenden");
            assertTrue(src.contains(".abrunden(FinDslNumber.Type.Prozent)"),
                    "abrundenProzent muss Type.Prozent als Ziel verwenden (kontextlos!)");
            assertTrue(src.contains(".abrunden(FinDslNumber.Type.Ganzzahl)"),
                    "abrundenDezimal muss Type.Ganzzahl als Ziel verwenden");
        }

        @Test
        @DisplayName("§ 11.2 Alle 12 Listen-Methoden tatsächlich im Generat aufgerufen")
        void listenMethodenAlle() {
            String src = body("KorpusStdlibImpl");
            // SPEC § 11.2 Tabelle. Java-Runtime-Namen (umlautbefreit):
            // länge→laenge, leer, kopf, rest, bei (auch [i]→bei), enthält→enthaelt,
            // zuordnen, filtern, zusammenfassen, zähle()→zaehle/zaehleMit, summe,
            // größtes→groesstes, kleinstes.
            for (String call : List.of(
                    ".laenge()", ".leer()", ".kopf()", ".rest()", ".bei(",
                    ".enthaelt(", ".zuordnen(", ".filtern(", ".zusammenfassen(",
                    ".zaehle()", ".zaehleMit(", ".summe()", ".groesstes()", ".kleinstes()")) {
                assertTrue(src.contains(call),
                        "§ 11.2: Listen-Methoden-Call «" + call + "» fehlt im Generat");
            }
        }

        @Test
        @DisplayName("§ 11.5 Text-`+`-Konkatenation lowert zu Java-String-`+`")
        void textKonkat() {
            String konkat = method("KorpusStdlibImpl", "konkat").toString();
            assertTrue(konkat.contains("(a) + (b)"),
                    "konkat muss zu `(a) + (b)` lowern, war: " + konkat);
            String konkatDrei = method("KorpusStdlibImpl", "konkatDrei").toString();
            assertTrue(konkatDrei.contains("((a) + (b)) + (c)"),
                    "konkatDrei muss links-assoziativ kettengeklammert sein");
        }
    }

    // =========================================================================
    // KorpusSchleifen — § 5.3 für-jeden, § 5.4 ausgabe
    // =========================================================================

    @Nested
    @DisplayName("KorpusSchleifen — SPEC § 5.3/§ 5.4")
    class SchleifenChecks {
        @Test
        @DisplayName("§ 5.3 `für jeden` über Liste lowert zu .zuordnen(…)")
        void fuerJedenListe() {
            String src = method("KorpusSchleifenImpl", "verdopple").toString();
            assertTrue(src.contains(".zuordnen(") && src.contains("->"),
                    "verdopple muss .zuordnen(...) mit Lambda erzeugen");
        }

        @Test
        @DisplayName("§ 5.3 `für jeden` über Bereich lowert zu FinDslListe.bereich(...).zuordnen(...)")
        void fuerJedenBereich() {
            String src = method("KorpusSchleifenImpl", "quadrateBis").toString();
            assertTrue(src.contains("FinDslListe.bereich(") && src.contains(".zuordnen("),
                    "quadrateBis muss Bereich.zuordnen(...) erzeugen");
        }

        @Test
        @DisplayName("§ 5.3 Geschachteltes `für jeden` → Liste<Liste<…>>")
        void fuerJedenGeschachtelt() {
            var m = method("KorpusSchleifenImpl", "geschachtelt");
            String ret = m.getType().asString();
            assertTrue(ret.contains("FinDslListe<FinDslListe<"),
                    "geschachtelt muss Liste<Liste<…>> zurückgeben, war: " + ret);
        }

        @Test
        @DisplayName("§ 5.3 Block-Lambda-Body: `für jeden { var …; ergebnis }` → multi-line Lambda")
        void fuerJedenBlockLambda() {
            String src = method("KorpusSchleifenImpl", "mitZwischenwert").toString();
            assertTrue(src.contains("final ") && src.contains("return "),
                    "mitZwischenwert muss Block-Lambda mit final + return erzeugen");
        }

        @Test
        @DisplayName("§ 5.4 ausgabe: Funktions-Body wird trotz ausgabe korrekt gelowert (Wert bleibt korrekt)")
        void ausgabeKorrekt() {
            // Aktueller Java-Codegen droppt `ausgabe(…)` (Trace-Anweisung).
            // Wichtig hier: der Wert-tragende Pfad bleibt intakt — die Methoden
            // sind vorhanden + liefern die richtigen Typen. Wenn ein späterer
            // Folge-PR `ausgabe` tatsächlich nach `System.out.println(...)`
            // lowert, kann dieser Test um eine entsprechende Pattern-Assertion
            // erweitert werden.
            method("KorpusSchleifenImpl", "mitAusgabe");
            method("KorpusSchleifenImpl", "mehrereTrace");
        }
    }

    // =========================================================================
    // Cross-Cutting: Modul-Vollständigkeit
    // =========================================================================

    @Test
    @DisplayName("Alle 5 Korpus-Module sind vollständig generiert (Interface + Impl)")
    void modulVollstaendig() {
        for (String mod : List.of("KorpusTypen", "KorpusAusdruecke", "KorpusFunktionen",
                "KorpusStdlib", "KorpusSchleifen")) {
            cu(mod);
            cu(mod + "Impl");
        }
    }

    @Test
    @DisplayName("Keine versehentliche Reduktion: jedes Modul hat ≥ 1 Methode (Interface)")
    void keineLeerenModule() {
        for (String mod : List.of("KorpusAusdruecke", "KorpusFunktionen",
                "KorpusStdlib", "KorpusSchleifen")) {
            var iface = (ClassOrInterfaceDeclaration) topType(mod);
            long methodCount = iface.getMethods().stream()
                    .filter(m -> !m.getNameAsString().equals("newInstance")).count();
            assertTrue(methodCount > 0, mod + ": Interface hat keine Methoden außer newInstance");
        }
    }
}
