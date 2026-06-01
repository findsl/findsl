# ADR-002 — Code-Signierung der nativen Binaries

> **Status:** Entschieden (2026-06-01). Umsetzt #245. Ergänzt
> [ADR-001 (Binary-Distribution)](binary-distribution.md).
>
> **Entscheidung:** Die nativen Binaries werden **bewusst NICHT** kostenpflichtig
> signiert/notarisiert. Für den IntelliJ-**Lazy-Download** ist das auch nicht
> nötig — Integrität sichert das SHA-256-Pinning (#244), Ausführbarkeit das
> bestehende Ad-hoc-Signing.

---

## Kontext

Node-SEA-Binaries (`findsl-lsp`, `findsl`) werden unsigniert von macOS-Gatekeeper
geblockt und von Windows-SmartScreen gewarnt (#245). Eine „echte" Signierung
kostet laufend: Apple Developer Program (~$99/Jahr, für Notarisierung) +
Windows-Authenticode-Zertifikat (~200–400 €/Jahr).

Bestehende Projekt-Haltung (CLI, `docs/install.md` + `release.yml`): **bewusst
unsigniert**; Integrität über GPG-signierte `SHA256SUMS` + npm-Sigstore-Provenance.

## Status quo (geklärt, Aufgabe 1 von #245)

| Plattform | Signing heute | Quelle |
|---|---|---|
| macOS | **nur Ad-hoc** (`codesign --sign -`) — auf Apple Silicon Ausführbarkeits-Pflicht, **keine** Developer-ID/Notarisierung | `scripts/build-binary.mjs` |
| Windows | **unsigniert** | — |
| Linux | kein Signing nötig | — |

## Entscheidung & Begründung

**Keine kostenpflichtige Signierung** — konsistent mit der bestehenden CLI-Haltung.
Für den **IntelliJ-Pfad** ist die Notarisierung sogar **entbehrlich**:

- **macOS:** Das Plugin lädt das Binary **programmatisch** (Kotlin/`HttpClient`)
  in ein per-User-Cacheverzeichnis. Programmatische Downloads setzen **kein**
  `com.apple.quarantine`-Attribut (das vergeben nur quarantäne-bewusste GUI-Apps
  wie Browser). Ohne Quarantäne-Flag prüft Gatekeeper nicht — das Ad-hoc-Signing
  genügt zur Ausführung. (Anders als der CLI-Browser-Download, siehe
  `docs/install.md`.)
- **Windows:** SmartScreen-Reputationsprüfung greift beim **interaktiven**
  Ausführen heruntergeladener Dateien, nicht beim Start eines per Plugin
  entpackten Binaries durch einen Child-Prozess der IDE.

**Integrität** sichert nicht die Code-Signatur, sondern das **SHA-256-Pinning**:
Der Download-Client verifiziert jedes Binary gegen das ins Plugin eingebettete
`checksums.json` (#244, ADR-001) — stärker als eine Signatur, weil
**versions-gepinnt** und unabhängig von externen CAs.

## Konsequenzen / Umsetzung

- **Download-Client (Folge-Issue):** nach dem Download
  1. SHA-256 gegen `checksums.json` prüfen (Pflicht — Abbruch bei Mismatch);
  2. `chmod 0700` (POSIX — SEA-Binary muss ausführbar sein);
  3. defensiv `xattr -d com.apple.quarantine` versuchen (no-op, falls nicht
     gesetzt — Sicherheitsnetz).
- **CLI-Endnutzer** (Browser-Download) treffen weiterhin Gatekeeper/SmartScreen;
  die Umgehung ist in `docs/install.md` Schritt für Schritt dokumentiert.
- **Linux:** kein Signing; `chmod +x` reicht.

## Option für später (falls Zertifikate doch beschafft werden)

Echte Signierung als **gated CI-Schritte** (analog zu `signPlugin`/`publishPlugin`
in #244), aktiv nur bei gesetzten Secrets:

- **macOS:** `codesign --options runtime --sign "Developer ID Application: …"`
  + `xcrun notarytool submit --wait` + `xcrun stapler staple` (im `binaries`-Job
  auf dem macOS-Runner). Secrets: `MACOS_CERT_P12`, `MACOS_CERT_PASSWORD`,
  `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD`.
- **Windows:** `signtool sign /fd sha256 …` bzw. Azure Trusted Signing. Secret:
  `WINDOWS_CERT_*`.

> Hinweis: Die **Plugin**-Signierung (`signPlugin`, Marketplace ZIP Signer) ist
> davon getrennt und bereits in #244 (`build.gradle.kts` + `release.yml`, gated)
> vorbereitet — sie betrifft das `.zip`, nicht die nativen Binaries.
