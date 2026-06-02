# ADR-001 — Auslieferung der nativen Binaries (JetBrains-Marketplace)

> **Status:** Entschieden (2026-06-01). Umsetzt #243. Richtungsweisend für
> [#240](https://github.com/findsl/findsl/issues/240) (Binary-Auflösung) und
> [#244](https://github.com/findsl/findsl/issues/244) (CI/Publishing).
>
> **Entscheidung:** **(b) Schlankes Plugin + Lazy-Download vom GitHub-Release,
> mit Offline-Fallback über einen manuellen Binary-Pfad.**

---

## Kontext

Das Plugin ist eine dünne Präsentationsschicht; die Sprachintelligenz liefert
der native, Node-freie LSP-Server `findsl-lsp` (#239), der Test-Runner zusätzlich
das CLI `findsl` (#256). Beides sind **Node-SEA-Binaries**:

| Binary | Größe (ca.) |
|---|---|
| `findsl-lsp` | ~118 MB pro OS/Arch |
| `findsl` (CLI) | ~131 MB pro OS/Arch |

Der **JetBrains-Marketplace kennt keine plattformspezifischen Plugin-Varianten**
(anders als VS Codes `target`-VSIX). Ein Plugin muss also für **alle** Zielplatt-
formen funktionieren: macOS-arm64, macOS-x64, Linux-x64, Windows-x64.

Zielgruppe ist u. a. die **deutsche Finanzverwaltung** — dort sind restriktive
Netze / Air-Gap (kein GitHub-Zugriff) realistisch.

## Optionen

| | Beschreibung | Plugin-Größe | Offline | Aufwand |
|---|---|---|---|---|
| **(a)** | Alle Binaries gebündelt | **~1 GB** (4 Plattformen × ~250 MB) | ✅ out-of-the-box | gering |
| **(b)** | Lazy-Download des passenden Binaries vom Release | **~5 MB** | ⚠️ nur mit Fallback | mittel |
| (c) | Gebündeltes `.cjs` + System-Node | klein | ✅ | — (in Konzeptphase verworfen: JetBrains-Zielgruppe hat selten Node) |

## Entscheidung & Begründung

**(b)** ist die einzige marktplatztaugliche Option. **(a)** scheidet aus: Jede
Installation trüge alle vier Plattformen mit (~1 GB Download/Update je IDE-Start-
Aktualisierung), realistisch über Marketplace-Größengrenzen und unzumutbar.

Den Air-Gap-Nachteil von (b) entschärft ein **manueller Binary-Pfad** in den
Plugin-Einstellungen (bzw. `FINDSL_LSP_PATH`/`FINDSL_CLI_PATH`): In abgeschotteten
Netzen lädt der Administrator die Binaries einmal manuell und trägt den Pfad ein —
kein Netzzugriff nötig.

## Spezifikation des Mechanismus

### 1. Release-Assets (von #244/CI bereitzustellen)

Pro Lockstep-Version (Tag `v<VERSION>`, z. B. `v1.2.0`) je Plattform:

```
findsl-lsp-darwin-arm64     findsl-darwin-arm64
findsl-lsp-darwin-x64       findsl-darwin-x64
findsl-lsp-linux-x64        findsl-linux-x64
findsl-lsp-win-x64.exe      findsl-win-x64.exe
```

URL-Schema:
`https://github.com/findsl/findsl/releases/download/v<VERSION>/<asset>`

> Node-SEA kann **nicht** cross-kompilieren — CI muss jedes Binary auf einem
> Runner der jeweiligen Plattform bauen (#244).

### 2. Integritätssicherung (SHA-256-Pinning)

CI generiert nach dem Bau aller Binaries ein **Manifest** `checksums.json`
(Asset-Name → SHA-256 + Version) und **bettet es zur Plugin-Build-Zeit** in die
Plugin-Ressourcen ein (`/binaries/checksums.json`). Das Plugin lädt also gegen
**eingebettete, mitversionierte** Hashes — ein manipuliertes Release-Asset wird
abgelehnt. (Reihenfolge in CI: Binaries bauen → `checksums.json` → Plugin bauen.)

```json
{
  "version": "1.2.0",
  "binaries": {
    "findsl-lsp-darwin-arm64": "sha256-…",
    "findsl-darwin-arm64": "sha256-…",
    "…": "…"
  }
}
```

### 3. Cache

Heruntergeladene Binaries liegen versioniert im per-User-IDE-Systemverzeichnis:

```
<PathManager.getSystemDir()>/findsl-binaries/<version>/<binary>
```

Verzeichnis `0700`, Datei `0600` (wie heute in `FinDslNativeBinary`, kein welt-
schreibbares `tmp`). Versionierung ⇒ ein Plugin-Update lädt frisch; ein Treffer
mit passendem SHA-256 wird wiederverwendet (kein erneuter Download).

### 4. Auflösungsreihenfolge (`FinDslNativeBinary` erweitern)

1. **Override** `findsl.lsp.path`/`findsl.cli.path` (System-Property) bzw.
   `FINDSL_LSP_PATH`/`FINDSL_CLI_PATH` (Umgebung) — Entwicklung.
2. **Plugin-Settings:** manuell gesetzter Binary-Pfad — **Air-Gap/Behörde**.
3. **Cache:** vorhandenes Binary mit passendem SHA-256.
4. **Download** vom versions-gepinnten Release, SHA-256 gegen das eingebettete
   Manifest verifiziert, dann in den Cache. Läuft als `Task.Backgroundable` mit
   Fortschrittsbalken (~118 MB) beim ersten Server-Start.
5. **Fehlschlag** (kein Netz, kein Pfad) → klare Notification mit Verweis auf den
   manuellen Pfad in den Einstellungen.

### 5. Offline-/Air-Gap-Fallback

- Eigene **Plugin-Settings-Seite** (`Configurable`): Felder „LSP-Server-Binary"
  und „CLI-Binary" (Pfad). Gesetzt ⇒ Stufe 2 greift, kein Netz nötig.
  **Umgesetzt (#275):** `FinDslSettings` (`PersistentStateComponent`) +
  `FinDslConfigurable` (Settings → FinDSL); `FinDslNativeBinary.resolveOrExtract`
  konsultiert den Pfad als Stufe 2 (Reihenfolge Override → Settings → gebündelt).
- Dokumentierter manueller Bezug: Binaries von der GitHub-Release-Seite laden,
  Pfad eintragen.

## Konsequenzen

- Das aktuelle Einbetten (`embedLspServer`/`embedCliBinary`) bleibt als **Dev-/
  `buildPlugin`-Komfort** bestehen, ist aber **nicht** der Release-Weg; das
  Release-Plugin enthält keine Binaries (nur `checksums.json`).
- **#244** richtet die Multi-Plattform-Binary-Builds + `checksums.json` + den
  Release-Upload ein.
- Die **Settings-/Air-Gap-Implementierung** in `FinDslNativeBinary` ist mit
  #275 erfolgt (Stufe 2). Die **Download-Implementierung** (Stufe 3/4) bleibt
  Folgeschritt (sobald Release-Assets + Manifest existieren).
