# Release-Prozess

> **Lockstep-Modell:** ein Git-Tag löst die Veröffentlichung **aller** fünf
> Artefakte mit derselben Version aus.
>
> 👉 **Du willst nur wissen, welche Schritte du tippen musst?** Der
> action-orientierte Schritt-für-Schritt-Leitfaden steht in
> [docs/release-ablauf.md](docs/release-ablauf.md). Dieses Dokument hier ist
> die ausführliche Referenz (Artefakte, Secret-Quellen, Embedding-Interna).

## Veröffentlichte Artefakte

| Artefakt | Kanal | Koordinate |
|---|---|---|
| `@findsl/core` | npm | `npm install @findsl/core` |
| `@findsl/cli` | npm | `npm install -g @findsl/cli` |
| `@findsl/lsp` | npm | `npm install @findsl/lsp` |
| `@findsl/web` | npm | `npm install @findsl/web` (Browser-Bundle: LSP-Worker + check/generate) |
| `@findsl/editor` | npm | `npm install @findsl/editor` (einbettbarer Monaco-Editor) |
| `@findsl/editor-react` | npm | `npm install @findsl/editor-react` (React-Komponente um `@findsl/editor`) |
| VS Code Extension | VS Marketplace + Open VSX | Publisher `findsl`, Extension `findsl` |
| Native Binaries | GitHub Releases | `findsl-<v>-{darwin,linux,windows}-{x64,arm64}.{tar.gz,zip}` |

> **Hinweis Java-Runtime:** Die Java-Runtime ist **kein** separates Maven-
> Central-Artefakt mehr. Das CLI bündelt die Runtime-Quellen intern und
> emittiert sie bei jedem `findsl codegen --lang java` ins Ausgabeverzeichnis
> (`<out>/org/findsl/runtime/*.java`). Generat-Nutzer bekommen damit ein
> autonomes Java-Projekt ohne externe Dependency. Lockstep zwischen CLI-
> Version und ausgelieferter Runtime ist automatisch.

## Vorbereitung — einmalig pro Konto/Secret

Die folgenden GitHub-Repo-Secrets müssen unter
`Settings → Secrets and variables → Actions` hinterlegt sein:

| Secret | Quelle |
|---|---|
| `NPM_TOKEN` | `npmjs.com/settings/<user>/tokens` → „Automation"-Token, Scope `@findsl` |
| `VSCE_PAT` | Azure DevOps → User Settings → PAT, Scope `Marketplace (Manage)` |
| `OVSX_PAT` | `open-vsx.org/user-settings/tokens` |
| `GPG_PRIVATE_KEY` | `gpg --armor --export-secret-keys <key-id>` (vollständiger ASCII-Block) |
| `GPG_PASSPHRASE` | Passphrase des GPG-Keys |

### Einmalige Konto-Aufgaben

1. **GPG-Key** erzeugen (für Linux-Tarball + SHA256SUMS-Signatur):
   ```bash
   gpg --full-generate-key   # RSA 4096, ohne Ablauf für CI
   gpg --send-keys --keyserver keys.openpgp.org <key-id>
   ```
2. **npm-Org `findsl`** anlegen, 2FA aktivieren, Automation-Token erstellen.
3. **VS Marketplace Publisher `findsl`** unter `marketplace.visualstudio.com/manage`
   anlegen (braucht Azure-DevOps-Account).
4. **Open VSX Account** auf `open-vsx.org` registrieren (GitHub-OAuth).

## Routine — Release veröffentlichen

### 1. Version setzen

```bash
# Patch-Release
node scripts/sync-version.mjs --set 0.1.1

# Minor-Release
node scripts/sync-version.mjs --set 0.2.0

# Pre-Release (kennzeichnet GH-Release als „prerelease")
node scripts/sync-version.mjs --set 1.0.0-rc.1
```

Das Skript schreibt die Version in `VERSION` und propagiert sie in alle
`package.json`. `runtimes/java/build.gradle.kts` liest dieselbe Datei
direkt — keine zweite Quelle.

**Pre-Releases** (Version mit Bindestrich, z. B. `1.0.0-rc.1`) werden vom
`prepare`-Job automatisch erkannt und abweichend verteilt:

- **npm:** dist-tag `next` statt `latest` (`npm install @findsl/cli@next`).
- **vsix:** VS Marketplace + Open VSX werden **übersprungen** — beide
  akzeptieren keine SemVer-Pre-Releases. Das `.vsix` hängt aber am
  GitHub-Release und ist manuell installierbar.
- **GitHub-Release:** als „prerelease" markiert (nicht „latest").
- **Binaries:** unverändert.

### 2. Verifizieren

```bash
npm run version:check      # alle Versionen synchron?
npm run all                # langium:generate + build (inkl. embed-runtime) + bundle + test
( cd runtimes/java && ./gradlew check )   # Codegen-Gate + Runtime-Tests
```

### 3. Committen + Taggen + Pushen

```bash
git add VERSION packages/ apps/
git commit -m "release: v0.1.1"
git tag v0.1.1
git push origin main
git push origin v0.1.1
```

Der Tag-Push triggert `.github/workflows/release.yml`. Der `prepare`-Job
verweigert den Lauf, wenn Tag-Version ≠ `VERSION`-Datei — dann erst die
beiden Stände in Sync bringen, neuen Tag setzen.

### 4. Beobachten

`Actions → Release → <commit>` — alle fünf Job-Spuren müssen grün sein
(`prepare`, `npm`, `vsix`, `binaries`, `release`).

Bei Fehlern in einer einzelnen Spur (z. B. npm OK, vsix scheitert):
- Spur einzeln nachfahren ist nicht vorgesehen (Lockstep-Annahme).
- Den Release-Tag löschen (`git push origin :v0.1.1`, GH-Release manuell
  entfernen), Ursache fixen, **neue Patch-Version** taggen.

## Dry-Run — Build-Pipeline ohne Veröffentlichung testen

```
Actions → Release → Run workflow → dry_run: true
```

Baut alle Artefakte, lädt sie als Workflow-Artefakte hoch, **veröffentlicht
aber nichts**. Nutzt **keine** Secrets — geeignet, um die Pipeline ohne
Konten zu validieren.

## Java-Runtime-Embedding — wie es funktioniert

Statt eines Maven-Central-Artefakts wird die Runtime ins CLI eingebettet:

1. **Build-Zeit:** `scripts/embed-runtime-java.mjs` liest
   `runtimes/java/src/main/java/org/findsl/runtime/*.java` und schreibt sie
   als String-Konstanten in
   `packages/core/src/codegen/emit-java/runtime-files.generated.ts`.
2. **Bundle-Zeit:** esbuild zieht die Konstanten ins CLI-Bundle
   (`packages/cli/dist/findsl.cjs`) und damit ins Native-Binary.
3. **Lauf-Zeit:** Bei `findsl codegen --lang java -o <dir>` werden die
   Dateien nach `<dir>/org/findsl/runtime/*.java` ausgeschrieben. Idempotent:
   wiederholter Lauf überschreibt.

**Eigenschaften:**
- Lockstep gratis — CLI-Version und Runtime-Version sind per Definition gleich.
- Air-gapped tauglich — Endnutzer brauchen weder Maven Central noch Internet.
- Auditierbar — Steuerberater\:innen können den Runtime-Code mitprüfen, er liegt
  neben dem Generat im selben Projekt.

**Bekannte Einschränkungen:**
- Package-Name `org.findsl.runtime` ist fest verdrahtet (keine Umbenennung).
- Bei mehreren FinDSL-Generaten ins selbe Projekt wird die Runtime mehrfach
  geschrieben — durch das identische Verzeichnis aber dedupliziert (kein
  Compile-Konflikt).

## Bekannte Einschränkungen (allgemein)

- **macOS- und Windows-Binaries sind unsigniert.** Endnutzer sehen
  Gatekeeper- (macOS) bzw. SmartScreen-Warnungen (Windows). Workaround in
  [docs/install.md](docs/install.md) dokumentiert.
- **Node SEA kann nicht cross-kompilieren.** Jedes Binary entsteht auf
  seinem nativen CI-Runner. Linux-ARM64 ist noch nicht abgedeckt.
