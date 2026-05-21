# Installation

FinDSL wird in mehreren Varianten ausgeliefert. Wähle die für deinen
Anwendungsfall passende.

## Übersicht

| Variante | Zielgruppe | Bezugsquelle |
|---|---|---|
| **VS Code Extension** | Steuerberater\:innen, Anwender\:innen | [VS Marketplace](https://marketplace.visualstudio.com/items?itemName=findsl.findsl) / [Open VSX](https://open-vsx.org/extension/findsl/findsl) |
| **Natives CLI-Binary** | Kommandozeilen-Nutzung, CI-Skripte | [GitHub Releases](https://github.com/findsl/findsl/releases) |
| **npm-Pakete** | Entwickler\:innen, eigene Tooling-Pipelines | `npm install @findsl/cli` |

> **Hinweis zur Java-Runtime:** Es gibt **kein** separates Maven-Central-
> Artefakt. Das CLI emittiert die Runtime-Quellen
> (`org/findsl/runtime/*.java`) bei jedem `findsl codegen --lang java`
> direkt ins Ausgabeverzeichnis — der Output ist damit ein vollständig
> autonomes Java-Projekt ohne externe Dependency. Siehe Abschnitt
> [Java-Codegen-Output](#java-codegen-output).

---

## VS Code Extension

**Empfohlener Weg für die meisten Nutzer.**

1. VS Code öffnen → Extensions (`Ctrl+Shift+X` / `Cmd+Shift+X`)
2. Suche: `FinDSL` (Publisher: `findsl`)
3. „Install"

Alternativ über Open VSX (z. B. in VSCodium, Cursor):
`code --install-extension findsl.findsl`

Die Extension bringt den FinDSL-Sprachserver mit — kein separates CLI nötig.

---

## Natives CLI-Binary

Vorgefertigte Binaries für macOS, Linux und Windows liegen auf
[GitHub Releases](https://github.com/findsl/findsl/releases).

### Linux

```bash
# Beispiel: x64
curl -L -o findsl.tar.gz \
  https://github.com/findsl/findsl/releases/latest/download/findsl-<version>-linux-x64.tar.gz
tar -xzf findsl.tar.gz
sudo mv findsl-*/findsl /usr/local/bin/
findsl --help
```

**Signatur prüfen (empfohlen):** das Tarball ist mit dem FinDSL-Maintainer-
GPG-Key signiert.

```bash
gpg --recv-keys --keyserver keys.openpgp.org <KEY_ID>
curl -L -o findsl.tar.gz.asc \
  https://github.com/findsl/findsl/releases/latest/download/findsl-<version>-linux-x64.tar.gz.asc
gpg --verify findsl.tar.gz.asc findsl.tar.gz
```

### macOS — unsigniert, manueller Erstausführung-Schritt

> ⚠️ Die macOS-Binaries sind **nicht** von Apple notarisiert. Beim ersten
> Ausführen erscheint die Warnung **„… kann nicht geöffnet werden, da Apple
> es nicht auf Schadsoftware überprüfen kann."** Das ist erwartet — der
> Workaround ist einmalig pro Binary nötig.

1. Tarball entpacken:
   ```bash
   curl -L -o findsl.tar.gz \
     https://github.com/findsl/findsl/releases/latest/download/findsl-<version>-darwin-arm64.tar.gz
   tar -xzf findsl.tar.gz
   sudo mv findsl-*/findsl /usr/local/bin/
   ```
2. Beim **ersten Aufruf** Quarantäne-Attribut entfernen:
   ```bash
   xattr -d com.apple.quarantine /usr/local/bin/findsl
   ```
   _Alternative ohne Terminal:_ im Finder mit Rechtsklick → „Öffnen" →
   im Dialog erneut „Öffnen" wählen. macOS merkt sich die Freigabe.

3. Verifizieren:
   ```bash
   findsl --help
   ```

**Warum unsigniert?** Apple verlangt für Notarisierung eine kostenpflichtige
Developer-ID-Mitgliedschaft. FinDSL ist ein freies Projekt — wir verzichten
bewusst auf diese laufende Gebühr. Wer einer signierten Variante mehr traut,
kann die [`@findsl/cli`-npm-Variante](#npm-paket) wählen (npm signiert mit
Sigstore-Provenance).

### Windows — unsigniert, SmartScreen-Hinweis

> ⚠️ Die Windows-`.exe` ist **nicht** Authenticode-signiert. SmartScreen
> warnt **„Der Computer wurde durch Windows geschützt"** — die Datei
> ist trotzdem ausführbar.

1. `findsl-<version>-windows-x64.zip` herunterladen, entpacken.
2. `findsl.exe` ausführen → SmartScreen-Dialog erscheint.
3. **„Weitere Informationen"** anklicken → **„Trotzdem ausführen"**.
4. Optional: `findsl.exe` in einen Pfad-Ordner kopieren (z. B.
   `%USERPROFILE%\bin`).

**Warum unsigniert?** Authenticode-Zertifikate kosten 200-400 €/Jahr. Wer
eine Bestätigung der Integrität möchte, prüft die `SHA256SUMS`-Datei aus
dem GitHub Release:

```powershell
Get-FileHash findsl-<version>-windows-x64.zip -Algorithm SHA256
# Hash mit Eintrag in SHA256SUMS vergleichen
```

`SHA256SUMS.asc` ist GPG-signiert — die Authentizität der Hashes lässt
sich damit unabhängig prüfen.

---

## npm-Paket

Für Entwickler\:innen mit Node-Toolchain.

```bash
# Global als CLI
npm install -g @findsl/cli
findsl --help

# Als Projekt-Abhängigkeit
npm install @findsl/cli
npx findsl --help
```

Die npm-Pakete sind mit **Sigstore-Provenance** signiert
(SLSA Level 3) — npm verifiziert die Herkunft (GitHub-Repo + Commit-SHA)
automatisch beim Install.

Sigstore-Provenance manuell prüfen:
```bash
npm view @findsl/cli --json | jq '.dist.attestations'
```

---

## Java-Codegen-Output

Für JVM-Projekte, die aus FinDSL generierten Java-Code einbinden.

```bash
findsl codegen examples/kst -l java -o src/main/java
```

Das CLI schreibt **zwei Arten** von Dateien:

1. **Generat-Module** — pro `*.findsl` ein Interface + Impl-Klasse,
   Package-Pfad spiegelt das Verzeichnis (`examples/kst/grundtarif.findsl`
   → `src/main/java/kst/Grundtarif.java` + `GrundtarifImpl.java`).
2. **Runtime-Quellen** — `src/main/java/org/findsl/runtime/*.java`
   (15 Dateien, JDK-only, keine externen Dependencies).

Der Output ist ein **autonomes Java-Projekt** — kein `findsl-runtime`-JAR
aus Maven Central nötig. Einfach mit `javac` oder Gradle/Maven kompilieren:

```bash
# Reines javac
javac -d build $(find src/main/java -name '*.java')

# Gradle: kein zusätzlicher dependency-Eintrag nötig
./gradlew compileJava
```

**Eigenschaften:**

- **Air-gapped** — kein Netzwerk beim Build des Generats nötig.
- **Lockstep** — CLI-Version und mit-emittierte Runtime sind per Definition
  gleich. Mismatch unmöglich.
- **Auditierbar** — die Runtime liegt sichtbar im Projekt, kann mit-geprüft
  werden (relevant für Finanzverwaltung/Steuer-Audits).
- **Idempotent** — wiederholtes `findsl codegen` überschreibt die Runtime-
  Dateien, kein Drift.

**Bekannte Einschränkung:** der Package-Name `org.findsl.runtime` ist fest
verdrahtet (keine `--runtime-package`-Option). Bei mehreren FinDSL-Generaten
ins selbe Projekt landet die Runtime im identischen Verzeichnis und wird
beim zweiten Lauf überschrieben — kein Compile-Konflikt.

---

## Versionierung

Alle Artefakte werden im **Lockstep** veröffentlicht — eine
FinDSL-Version `X.Y.Z` bedeutet, dass `@findsl/core@X.Y.Z`,
`@findsl/cli@X.Y.Z`, das `.vsix`, das Native-Binary und
`org.findsl:findsl-runtime:X.Y.Z` zueinander passen. Mischen ist nicht
unterstützt.

Für Details zum Release-Prozess siehe [RELEASING.md](../RELEASING.md).
