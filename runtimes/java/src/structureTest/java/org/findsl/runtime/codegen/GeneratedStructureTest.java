// Copyright (C) 2026 devtank42 GmbH
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime.codegen;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import com.github.javaparser.ParserConfiguration;
import com.github.javaparser.StaticJavaParser;
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
    @DisplayName("Interface: static <Name> newInstance() { new <Name>Impl(); }")
    void interfaceNewInstanceFactory() {
        for (Unit u : MAIN) {
            if (isImpl(u)) {
                continue;
            }
            var t = u.cu.getType(0);
            assertTrue(t instanceof ClassOrInterfaceDeclaration ci && ci.isInterface(),
                    u.path + ": Top-Typ ist kein interface");
            var iface = (ClassOrInterfaceDeclaration) t;
            var ni = iface.getMethodsByName("newInstance");
            assertFalse(ni.isEmpty(), u.path + ": newInstance() fehlt");
            var m = ni.get(0);
            assertTrue(m.isStatic(), u.path + ": newInstance() nicht static");
            assertTrue(m.getType().asString().equals(iface.getNameAsString()),
                    u.path + ": newInstance()-Rückgabetyp ≠ " + iface.getNameAsString());
            assertTrue(m.findAll(ObjectCreationExpr.class).stream()
                            .anyMatch(o -> o.getType().getNameAsString()
                                    .equals(iface.getNameAsString() + "Impl")),
                    u.path + ": newInstance() konstruiert kein " + iface.getNameAsString() + "Impl");
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
            assertFalse(cls.isPublic(), u.path + ": Impl darf NICHT public sein");
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
            if (isImpl(u)) {
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
                if (method.getNameAsString().equals("newInstance")) {
                    return;
                }
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
            if (isImpl(u)) {
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
    @DisplayName("Cross-Modul-Komposition via newInstance(), nie `new …Impl()` außerhalb der Factory")
    void compositionViaNewInstance() {
        for (Unit u : MAIN) {
            if (!isImpl(u)) {
                continue;
            }
            String ownImpl = baseName(u);
            u.cu.findAll(ObjectCreationExpr.class).forEach(o -> {
                String tn = o.getType().getNameAsString();
                if (tn.endsWith("Impl") && !tn.equals(ownImpl)) {
                    fail(u.path + ": `new " + tn + "()` — Cross-Modul muss über "
                            + "<Iface>.newInstance() laufen");
                }
            });
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
