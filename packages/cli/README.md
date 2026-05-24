# @findsl/cli

Kommandozeilen-Werkzeug für **FinDSL** — der DSL für ausführbare, prüfbare
Modelle des deutschen Steuerrechts.

## Installation

```bash
npm install -g @findsl/cli      # global → Befehl `findsl`
# oder ohne Installation:
npx @findsl/cli <befehl>
```

## Befehle

| Befehl | Zweck |
|---|---|
| `findsl parse <ziele…>` | `.findsl`-Dateien parsen + validieren |
| `findsl test <ziele…>` | `prüfe`-Blöcke ausführen (Akzeptanztests, bit-genau) |
| `findsl docgen <ziele…> -f pdf\|html\|md` | Aggregierte Dokumentation erzeugen |
| `findsl codegen <ziele…> --lang java\|ts\|js` | Zielsprachencode generieren |
| `findsl papgen <ziele…>` | Programmablaufpläne (DIN 66001) erzeugen |

`<ziele…>` sind Dateien, Verzeichnisse oder Globs. `findsl <befehl> --help`
zeigt die Optionen je Befehl. Der generierte Java-Code ist autonom (Runtime
wird mit ausgeliefert, keine externe Dependency).

## Lizenz

EUPL-1.2 — Teil des [findsl/findsl](https://github.com/findsl/findsl)-Monorepos.
