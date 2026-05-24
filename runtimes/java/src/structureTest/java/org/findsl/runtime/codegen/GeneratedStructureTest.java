// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime.codegen;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.StaticJavaParser;
import com.github.javaparser.ast.AccessSpecifier;
import com.github.javaparser.ast.CompilationUnit;
import com.github.javaparser.ast.body.ClassOrInterfaceDeclaration;
import com.github.javaparser.ast.body.RecordDeclaration;
import com.github.javaparser.ast.body.TypeDeclaration;
import com.github.javaparser.ast.expr.ObjectCreationExpr;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;

import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Struktur-Invarianten des GENERIERTEN Java (reiner Form-Check via
 * JavaParser — KEINE Wert-Semantik; die Bit-Genauigkeit prüft separat
 * das generierte {@code prüfe}→JUnit). Liest die Verzeichnisse aus den
 * System-Properties {@code findsl.gen.main}/{@code findsl.gen.test}
 * (vom Gradle-{@code structureTest}-Task gesetzt).
 */
class GeneratedStructureTest {

    /** Erlaubte Skalar-/Container-Typen an öffentlichen Grenzen. */
    private static final Set<String> SPEAKING = Set.of(
            "Euro", "EuroCent", "Cent", "Prozent", "Ganzzahl", "Dezimal",
            "FinDslNumber", "FinDslListe",
            // First-class Lambda-Typen (#44 L5): `var f: (T) -> R` lowert zu
            // FinDslLambda1<T, R>; 2-arg Lambdas (Fold-Argument) zu
            // FinDslLambda2<A, B, R>. Beide sind erlaubte API-Typen.
            "FinDslLambda1", "FinDslLambda2",
            "Tarifart", "Steuerklasse",
            "boolean", "String", "void");
    /** In öffentlichen Signaturen verbotene rohe Java-Numerik. */
    private static final Set<String> FORBIDDEN = Set.of(
            "BigDecimal", "double", "long", "float", "int", "Integer", "Double");

    private static Path mainDir;
    private static Path testDir;
    private static final List<Unit> MAIN = new ArrayList<>();
    private static final List<Unit> TEST = new ArrayList<>();

    private record Unit(Path path, CompilationUnit cu) {}

    @BeforeAll
    static void parseAll() throws IOException {
        StaticJavaParser.getParserConfiguration()
                .setLanguageLevel(ParserConfiguration.LanguageLevel.JAVA_21);
        mainDir = Path.of(System.getProperty("findsl.gen.main"));
        testDir = Path.of(System.getProperty("findsl.gen.test"));
        collect(mainDir, MAIN);
        collect(testDir, TEST);
        assertFalse(MAIN.isEmpty(), "kein generierter Java-Code in " + mainDir);
    }

    private static void collect(Path dir, List<Unit> into) throws IOException {
        if (!Files.isDirectory(dir)) {
            return;
        }
        try (Stream<Path> s = Files.walk(dir)) {
            for (Path p : (Iterable<Path>) s.filter(f -> f.toString().endsWith(".java"))::iterator) {
                into.add(new Unit(p, StaticJavaParser.parse(p)));
            }
        }
    }

    private static boolean isImpl(Unit u) {
        return u.path.getFileName().toString().endsWith("Impl.java");
    }

    /** `<Pkg>Factory.java` — die Komposition-Wurzel (Issue #141). */
    private static boolean isFactory(Unit u) {
        return u.path.getFileName().toString().endsWith("Factory.java");
    }

    private static String baseName(Unit u) {
        String n = u.path.getFileName().toString();
        return n.substring(0, n.length() - ".java".length());
    }

    private static String primaryTypeName(Unit u) {
        return u.cu.getPrimaryType().map(t -> t.getNameAsString())
                .orElseGet(() -> u.cu.getType(0).getNameAsString());
    }

    @Test
    @DisplayName("Jede generierte Datei trägt @Generated auf dem Top-Typ")
    void generatedAnnotation() {
        for (Unit u : concat()) {
            for (TypeDeclaration<?> t : u.cu.getTypes()) {
                assertTrue(t.getAnnotationByName("Generated").isPresent(),
                        "@Generated fehlt: " + u.path + " (" + t.getNameAsString() + ")");
            }
        }
    }

    @Test
    @DisplayName("package == Verzeichnis unter generated/")
    void packageMatchesDirectory() {
        for (Unit u : concat()) {
            Path root = u.path.startsWith(mainDir) ? mainDir : testDir;
            Path rel = root.relativize(u.path).getParent();
            String expected = rel == null ? null
                    : rel.toString().replace(java.io.File.separatorChar, '.');
            String actual = u.cu.getPackageDeclaration()
                    .map(pd -> pd.getNameAsString()).orElse(null);
            if (expected == null) {
                assertTrue(actual == null, "unbenanntes Package erwartet: " + u.path);
            } else {
                assertTrue(expected.equals(actual),
                        u.path + ": package=" + actual + ", erwartet " + expected);
            }
        }
    }

    @Test
    @DisplayName("Interface: KEIN newInstance() mehr (Erzeugung lebt in der Factory, #141)")
    void interfaceHasNoNewInstance() {
        for (Unit u : MAIN) {
            if (isImpl(u) || isFactory(u)) {
                continue;
            }
            var t = u.cu.getType(0);
            assertTrue(t instanceof ClassOrInterfaceDeclaration ci && ci.isInterface(),
                    u.path + ": Top-Typ ist kein interface");
            var iface = (ClassOrInterfaceDeclaration) t;
            assertTrue(iface.getMethodsByName("newInstance").isEmpty(),
                    u.path + ": newInstance() darf NICHT mehr im Interface stehen (#141)");
        }
    }

    @Test
    @DisplayName("Factory: public final <Pkg>Factory, privater Ctor, create…() = new …Impl()")
    void packageFactoryShape() {
        var factories = MAIN.stream().filter(GeneratedStructureTest::isFactory).toList();
        assertFalse(factories.isEmpty(), "keine <Pkg>Factory generiert (#141)");
        for (Unit u : factories) {
            var t = u.cu.getType(0);
            assertTrue(t instanceof ClassOrInterfaceDeclaration ci && !ci.isInterface()
                            && ci.isPublic() && ci.isFinal(),
                    u.path + ": erwartet `public final class`");
            var cls = (ClassOrInterfaceDeclaration) t;
            assertTrue(cls.getConstructors().stream()
                            .anyMatch(c -> c.isPrivate() && c.getParameters().isEmpty()),
                    u.path + ": privater (parameterloser) Konstruktor fehlt");
            var creators = cls.getMethods().stream()
                    .filter(m -> m.getNameAsString().startsWith("create"))
                    .toList();
            assertFalse(creators.isEmpty(), u.path + ": keine create…()-Methode");
            creators.forEach(m -> assertTrue(m.isStatic() && m.isPublic(),
                    u.path + ": " + m.getNameAsString() + " nicht public static"));
            // Geteilte Singletons (#141 „geteilte Instanzen"): jede …Impl wird
            // GENAU EINMAL konstruiert — kein Re-Newing (`new BImpl(new AImpl())`),
            // sonst wären die Instanzen nicht geteilt.
            long implNews = cls.findAll(ObjectCreationExpr.class).stream()
                    .filter(o -> o.getType().getNameAsString().endsWith("Impl"))
                    .count();
            assertTrue(implNews > 0, u.path + ": Factory konstruiert keine …Impl");
            assertTrue(implNews == creators.size(),
                    u.path + ": " + implNews + " `new …Impl()` bei " + creators.size()
                    + " create…() — jede Impl genau einmal (geteilte Singletons)");
        }
    }

    @Test
    @DisplayName("Factory: genau eine pro Package; jedes Interface-Package hat eine")
    void oneFactoryPerPackage() {
        var byPkg = new java.util.HashMap<String, Integer>();
        for (Unit u : MAIN) {
            if (!isFactory(u)) {
                continue;
            }
            String pkg = u.cu.getPackageDeclaration().map(pd -> pd.getNameAsString()).orElse("");
            byPkg.merge(pkg, 1, Integer::sum);
        }
        byPkg.forEach((pkg, count) -> assertTrue(count == 1,
                "Package \"" + pkg + "\": " + count + " Factories (erwartet genau 1)"));
        for (Unit u : MAIN) {
            if (isImpl(u) || isFactory(u)) {
                continue;
            }
            String pkg = u.cu.getPackageDeclaration().map(pd -> pd.getNameAsString()).orElse("");
            assertTrue(byPkg.getOrDefault(pkg, 0) >= 1,
                    u.path + ": Package \"" + pkg + "\" ohne <Pkg>Factory");
        }
    }

    @Test
    @DisplayName("Impl: paket-private `class <Name>Impl implements <Name>`")
    void implIsPackagePrivateAndImplements() {
        for (Unit u : MAIN) {
            if (!isImpl(u)) {
                continue;
            }
            var t = u.cu.getType(0);
            assertTrue(t instanceof ClassOrInterfaceDeclaration ci && !ci.isInterface(),
                    u.path + ": Top-Typ ist keine Klasse");
            var cls = (ClassOrInterfaceDeclaration) t;
            assertTrue(cls.getAccessSpecifier() == AccessSpecifier.NONE,
                    u.path + ": Impl muss paket-privat sein (kein public/protected/private)");
            String iface = baseName(u).substring(0, baseName(u).length() - "Impl".length());
            assertTrue(cls.getImplementedTypes().stream()
                            .anyMatch(it -> it.getNameAsString().equals(iface)),
                    u.path + ": implements " + iface + " fehlt");
        }
    }

    @Test
    @DisplayName("Impl: keine Interna-Leckage (.zahl()/_kern)")
    void noInternalLeakage() {
        for (Unit u : MAIN) {
            if (!isImpl(u)) {
                continue;
            }
            String src = u.cu.toString();
            assertFalse(src.contains(".zahl()"),
                    u.path + ": `.zahl()` (Unboxing) darf nicht auftreten (IS-A)");
            assertFalse(src.contains("_kern"),
                    u.path + ": `_kern`-Doppelmethode darf nicht auftreten");
        }
    }

    @Test
    @DisplayName("Öffentliche Interface-Signaturen: nur sprechende Typen, keine rohe Numerik")
    void interfaceSignaturesAreSpeaking() {
        for (Unit u : MAIN) {
            if (isImpl(u) || isFactory(u)) {
                continue;
            }
            var iface = (ClassOrInterfaceDeclaration) u.cu.getType(0);
            // Nested-Typen (enum/record) dieses Moduls sind erlaubt.
            Set<String> local = new java.util.HashSet<>(SPEAKING);
            iface.getMembers().forEach(member -> {
                if (member instanceof TypeDeclaration<?> td) {
                    local.add(td.getNameAsString());
                }
            });
            iface.getMethods().forEach(method -> {
                checkType(u, method.getType().asString(), local);
                method.getParameters().forEach(p -> checkType(u, p.getType().asString(), local));
            });
            iface.findAll(RecordDeclaration.class).forEach(rec ->
                    rec.getParameters().forEach(p -> checkType(u, p.getType().asString(), local)));
        }
    }

    private void checkType(Unit u, String type, Set<String> local) {
        // Generics/Qualifizierung abschneiden: `FinDslListe<Euro>` →
        // `FinDslListe`; `KraftstgTypen.Fahrzeug` → letzter Bezeichner +
        // Owner-qualifiziert ist ok (Cross-Modul nested).
        String head = type.replaceAll("<.*>", "").trim();
        String simple = head.contains(".") ? head.substring(head.lastIndexOf('.') + 1) : head;
        assertFalse(FORBIDDEN.contains(simple),
                u.path + ": rohe Java-Numerik in Signatur: " + type);
        boolean ok = local.contains(simple) || head.contains(".") /* Owner.Typ */;
        assertTrue(ok, u.path + ": untypisierte/unerwartete Signatur: " + type);
    }

    @Test
    @DisplayName("Jedes Interface hat eine zugehörige <Name>Impl")
    void everyInterfaceHasImpl() {
        for (Unit u : MAIN) {
            if (isImpl(u) || isFactory(u)) {
                continue;
            }
            String impl = baseName(u) + "Impl";
            boolean found = MAIN.stream().anyMatch(x ->
                    isImpl(x) && baseName(x).equals(impl)
                    && x.path.getParent().equals(u.path.getParent()));
            assertTrue(found, u.path + ": fehlende " + impl + ".java");
        }
    }

    @Test
    @DisplayName("Impl: kein `new …Impl()` und kein newInstance() — Erzeugung nur in der Factory")
    void implDoesNotConstructImpls() {
        for (Unit u : MAIN) {
            if (!isImpl(u)) {
                continue;
            }
            u.cu.findAll(ObjectCreationExpr.class).forEach(o -> {
                String tn = o.getType().getNameAsString();
                if (tn.endsWith("Impl")) {
                    fail(u.path + ": `new " + tn + "()` in der Impl — `new …Impl()` "
                            + "lebt ausschließlich in der <Pkg>Factory (#141)");
                }
            });
            assertFalse(u.cu.toString().contains("newInstance"),
                    u.path + ": newInstance() darf nicht mehr vorkommen (#141)");
        }
    }

    @Test
    @DisplayName("Impl mit Abhängigkeiten: final-Felder via Konstruktor injiziert (#141)")
    void implConstructorInjection() {
        for (Unit u : MAIN) {
            if (!isImpl(u)) {
                continue;
            }
            var cls = (ClassOrInterfaceDeclaration) u.cu.getType(0);
            var instanceFields = cls.getFields().stream()
                    .filter(f -> !f.isStatic())
                    .toList();
            if (instanceFields.isEmpty()) {
                continue;       // Modul ohne Abhängigkeit → kein Konstruktor nötig
            }
            instanceFields.forEach(f -> assertTrue(f.isFinal(),
                    u.path + ": Abhängigkeits-Feld nicht final"));
            var ctors = cls.getConstructors();
            assertTrue(ctors.size() == 1,
                    u.path + ": erwartet genau einen Konstruktor (Injektion)");
            assertTrue(ctors.get(0).getAccessSpecifier() == AccessSpecifier.NONE,
                    u.path + ": injizierender Konstruktor muss paket-privat sein");
            long fieldCount = instanceFields.stream()
                    .mapToLong(f -> f.getVariables().size()).sum();
            assertTrue(ctors.get(0).getParameters().size() == fieldCount,
                    u.path + ": Konstruktor-Parameter ≠ Anzahl Abhängigkeits-Felder");
        }
    }

    @Test
    @DisplayName("Generierte Tests: final class <Name>Test, nur JUnit-Jupiter-Importe")
    void generatedJUnitShape() {
        if (TEST.isEmpty()) {
            return;     // kein *.test.findsl im Korpus → nichts zu prüfen
        }
        for (Unit u : TEST) {
            var t = u.cu.getType(0);
            assertTrue(t instanceof ClassOrInterfaceDeclaration ci && !ci.isInterface()
                            && ci.isFinal(),
                    u.path + ": erwartet `final class`");
            u.cu.getImports().forEach(imp -> {
                String n = imp.getNameAsString();
                boolean ok = n.startsWith("org.junit.jupiter.")
                        || n.startsWith("org.findsl.runtime")
                        || n.startsWith("javax.annotation.processing.")
                        || n.startsWith("java.");
                assertTrue(ok, u.path + ": unerwarteter Import " + n);
            });
        }
    }

    private static List<Unit> concat() {
        List<Unit> all = new ArrayList<>(MAIN);
        all.addAll(TEST);
        return all;
    }
}
