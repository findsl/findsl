# Release-Ablauf — Schritt für Schritt

> **Ziel dieses Dokuments:** die konkreten Handgriffe, mit denen *du* ein
> Release auslöst. Die Referenz (Artefakt-Tabelle, Secret-Quellen,
> Embedding-Interna) steht in [../RELEASING.md](../RELEASING.md); die
> Installations-Sicht der Endnutzer in [install.md](install.md).

---

## Das Prinzip in einem Satz

**Ein Git-Tag `vX.Y.Z` ist der einzige Auslöser.** Pushst du den Tag,
baut und veröffentlicht GitHub Actions automatisch alle fünf Artefakte in
genau dieser Version (Lockstep). Du tippst keine Publish-Befehle von Hand.

```
  Version setzen  →  committen  →  Tag pushen  →  ☕ CI macht den Rest
```

---

## Kurzfassung (Routine-Release)

Wenn das Einmal-Setup steht und `main` grün ist, ist ein Release **vier
Befehle**:

```bash
node scripts/sync-version.mjs --set 0.1.1   # 1. Version festlegen
npm run version:check && npm run all        # 2. lokal verifizieren
git add -A && git commit -m "release: v0.1.1" && git push   # 3. committen
git tag v0.1.1 && git push origin v0.1.1    # 4. Tag → CI startet
```

Danach nur noch `Actions → Release` beobachten. Die Details und das
Einmal-Setup stehen unten.

---

## Voraussetzung: Einmal-Setup (nur vor dem allerersten Release)

Beim **ersten** Mal müssen Konten existieren und ihre Tokens als
GitHub-Repo-Secrets hinterlegt sein. Danach nie wieder.

### Checkliste Konten

- [ ] **GPG-Key** erzeugt + auf `keys.openpgp.org` publiziert
- [ ] **npm-Org `findsl`** angelegt, 2FA aktiv, Automation-Token erstellt
- [ ] **VS-Marketplace-Publisher `devtank42`** angelegt (über Azure DevOps)
- [ ] **Open-VSX-Account** registriert

### Checkliste Secrets

Unter `Settings → Secrets and variables → Actions` im Repo `findsl/findsl`:

- [ ] `NPM_TOKEN`
- [ ] `VSCE_PAT`
- [ ] `OVSX_PAT`
- [ ] `GPG_PRIVATE_KEY`
- [ ] `GPG_PASSPHRASE`

> Woher jedes Token kommt, steht in [../RELEASING.md](../RELEASING.md)
> (Abschnitt „Vorbereitung — einmalig pro Konto/Secret"). Fehlt ein Secret,
> scheitert nur die betroffene Spur — die anderen laufen trotzdem.

### Empfehlung: erst ein Dry-Run

Bevor du das erste echte Release machst, prüfe die Pipeline **ohne**
Veröffentlichung und **ohne** Secrets:

```
GitHub → Actions → Release → „Run workflow"
   dry_run: true
   version: 0.1.0
```

Das baut alle Artefakte und lädt sie als Workflow-Artefakte hoch, aber
veröffentlicht nichts. Grün = die Pipeline funktioniert.

---

## Der Ablauf im Detail

### Schritt 0 — Vorbedingungen

- `main` ist grün (CI bestanden).
- Dein Arbeitsbaum ist sauber (`git status` zeigt nichts Ungewolltes).
- Du bist auf dem aktuellen Stand: `git switch main && git pull`.

### Schritt 1 — Version festlegen (SemVer)

Welche Stelle erhöhst du?

| Änderung | Beispiel | Befehl |
|---|---|---|
| **Patch** — Bugfix, keine API-Änderung | `0.1.0 → 0.1.1` | `--set 0.1.1` |
| **Minor** — neue, abwärtskompatible Funktion | `0.1.1 → 0.2.0` | `--set 0.2.0` |
| **Major** — Breaking Change | `0.2.0 → 1.0.0` | `--set 1.0.0` |
| **Pre-Release** — Vorab-Test, wird als „prerelease" markiert | — | `--set 1.0.0-rc.1` |

#### Pre-Releases (`X.Y.Z-rc.N`) — Sonderverhalten

Ein Tag mit Bindestrich (z. B. `v1.0.0-rc.1`) wird automatisch erkannt und
**anders verteilt**, weil nicht jeder Kanal SemVer-Pre-Releases akzeptiert:

| Spur | Verhalten bei Pre-Release |
|---|---|
| `npm` | Veröffentlicht unter dist-tag **`next`** statt `latest`. `npm install @findsl/cli` zieht weiter die stabile Version; Tester nutzen `npm install @findsl/cli@next`. |
| `vsix` | **Marketplace + Open VSX werden übersprungen** (akzeptieren nur `major.minor.patch`). Das `.vsix` hängt aber am GitHub-Release → manuell installierbar. |
| `binaries` | Unverändert — Binaries entstehen normal. |
| `release` | GitHub-Release wird als **„prerelease"** markiert (nicht „latest"). |

Du musst nichts Zusätzliches tun — die Erkennung (`Bindestrich in der
Version`) passiert im `prepare`-Job automatisch.

### Schritt 2 — Version setzen

```bash
node scripts/sync-version.mjs --set 0.1.1
```

Das Skript schreibt `0.1.1` in die Datei `VERSION` und propagiert sie in
**alle** `package.json` (inkl. der internen `@findsl/*`-Abhängigkeiten).
`runtimes/java/build.gradle.kts` liest dieselbe `VERSION`-Datei direkt.
Damit tragen am Ende alle Artefakte dieselbe Nummer — das ist der
Lockstep.

### Schritt 3 — Lokal verifizieren

```bash
npm run version:check                      # sind alle Versionen synchron?
npm run all                                # langium:generate + build + bundle + test
( cd runtimes/java && ./gradlew check )    # Codegen-Gate + Runtime-Tests
```

Erst weiter, wenn alle drei grün sind. `version:check` ist genau die
Prüfung, die später auch der CI-`prepare`-Job macht — bestehst du sie
lokal, scheitert der Tag-Lauf nicht daran.

### Schritt 4 — Committen, Taggen, Pushen

```bash
git add -A
git commit -m "release: v0.1.1"
git push                                   # Branch/main aktualisieren

git tag v0.1.1                             # Tag MUSS exakt v<VERSION> heißen
git push origin v0.1.1                     # ← dieser Push startet das Release
```

> **Wichtig:** Der Tag-Name muss `v` + Inhalt der `VERSION`-Datei sein
> (`VERSION` = `0.1.1` → Tag `v0.1.1`). Stimmt es nicht überein, bricht der
> `prepare`-Job mit Fehler ab und es wird nichts veröffentlicht.

### Schritt 5 — CI beobachten

`GitHub → Actions → Release → <dein Tag>`

Fünf Job-Spuren müssen grün werden:

| Spur | Was sie tut |
|---|---|
| `prepare` | prüft Tag-Version == `VERSION`-Datei |
| `npm` | veröffentlicht `@findsl/core`, `@findsl/cli`, `@findsl/lsp` (mit Sigstore-Provenance) |
| `vsix` | baut + veröffentlicht die VS-Code-Extension (Marketplace + Open VSX) |
| `binaries` | baut native Binaries für macOS (x64/arm64), Linux (x64), Windows (x64) |
| `release` | sammelt alles, erzeugt das GitHub Release + signierte `SHA256SUMS` |

### Schritt 6 — Ergebnis prüfen

- **GitHub Releases** — Tag `v0.1.1` mit allen Binaries + `SHA256SUMS` da?
- **npm** — `npm view @findsl/cli version` zeigt `0.1.1`?
  (Pre-Release: `npm view @findsl/cli@next version`)
- **VS Marketplace / Open VSX** — neue Version sichtbar?
  (bei Pre-Releases bewusst übersprungen — siehe Schritt 1)
- **Java-Generat** — Stichprobe, dass der Output autonom kompiliert:
  ```bash
  findsl codegen examples/kst -l java -o /tmp/test
  javac $(find /tmp/test -name '*.java')   # ohne externe Dependency
  ```

---

## Was der Tag automatisch auslöst

```
            git push origin v0.1.1
                      │
                      ▼
              ┌───────────────┐
              │   prepare     │   Tag-Version == VERSION-Datei?
              └───────┬───────┘
          ┌───────────┼───────────┐
          ▼           ▼           ▼
      ┌───────┐   ┌───────┐   ┌──────────┐
      │  npm  │   │ vsix  │   │ binaries │   (parallel)
      └───┬───┘   └───┬───┘   └────┬─────┘
          └───────────┼────────────┘
                      ▼
              ┌───────────────┐
              │   release     │   GitHub Release + SHA256SUMS (GPG)
              └───────────────┘
```

Die **Java-Runtime ist hier bewusst keine eigene Spur** — sie wird nicht
als Maven-Artefakt veröffentlicht, sondern liegt im CLI und wird bei
`findsl codegen --lang java` automatisch ins Generat geschrieben. Siehe
[install.md](install.md#java-codegen-output).

---

## Wenn etwas schiefgeht

Das Lockstep-Modell kennt **kein** „einzelne Spur nachfahren". Scheitert
z. B. `vsix`, obwohl `npm` schon veröffentlicht hat, dann:

1. Ursache fixen (auf `main`).
2. Den fehlgeschlagenen Tag + sein (Teil-)Release aufräumen:
   ```bash
   git push origin :v0.1.1          # Remote-Tag löschen
   git tag -d v0.1.1                # lokalen Tag löschen
   # GitHub-Release (falls erstellt) im Web-UI löschen
   ```
3. Eine **neue Patch-Version** schneiden (z. B. `0.1.2`) — nicht denselben
   Tag wiederverwenden. Bereits auf npm veröffentlichte Versionen lassen
   sich ohnehin nicht überschreiben.

> Genau deshalb empfiehlt sich der **Dry-Run vor dem ersten echten
> Release** (oben) — er fängt Pipeline-Fehler ab, bevor irgendetwas
> Öffentliches passiert.

---

## Spickzettel

```bash
# 1. Version
node scripts/sync-version.mjs --set X.Y.Z

# 2. Verifizieren
npm run version:check && npm run all && ( cd runtimes/java && ./gradlew check )

# 3. Veröffentlichen
git add -A && git commit -m "release: vX.Y.Z" && git push
git tag vX.Y.Z && git push origin vX.Y.Z

# 4. Beobachten:  GitHub → Actions → Release
```
