# Beiträge zu FinDSL

Danke für dein Interesse an FinDSL. Bitte lies diesen Abschnitt **vor**
deinem ersten Beitrag — insbesondere den Teil zum Contributor License
Agreement (CLA), da FinDSL dual-lizenziert ist.

## Lizenz & CLA (wichtig)

FinDSL wird unter einem **Dual-Lizenz-Modell** bereitgestellt: EUPL-1.2
(siehe `LICENSE`) **und** eine separate kommerzielle Lizenz (siehe
`LICENSE-COMMERCIAL.md`). Damit die devtank42 GmbH als alleinige
Rechteinhaberin den gesamten Code — inklusive externer Beiträge — auch
weiterhin kommerziell lizenzieren kann, ist für **jeden** Beitrag ein
unterzeichnetes **Contributor License Agreement (CLA)** erforderlich.

- Das CLA-Template liegt in `CLA.md` (Individual + Entity).
- Ohne gültiges CLA können Beiträge **nicht** angenommen werden.
- Das CLA überträgt **kein** Eigentum an deinem sonstigen Werk; es räumt
  der devtank42 GmbH die nötigen Rechte an **deinem Beitrag** ein, damit
  das Dual-Modell tragfähig bleibt. Du behältst die Rechte an deinem
  Beitrag und darfst ihn auch anderweitig verwenden.

Mit dem Einreichen eines Beitrags bestätigst du zugleich, dass du zur
Rechteeinräumung berechtigt bist (z. B. keine Arbeitgeber-Rechte
entgegenstehen — § 69b UrhG bei Angestellten beachten).

## Code-Konventionen

Maßgeblich ist `CLAUDE.md` (Projektkontext) und `SPEC.md`
(Sprachreferenz). Kurzfassung:

- **TypeScript strict**, 4 Leerzeichen Einrückung, ESM (`.js`-Endung in
  Importen trotz `.ts`-Quellen).
- Deutsche Bezeichner, wo sinnvoll (Konsistenz mit der DSL); englische
  nur bei Langium-Standard-Schnittstellen.
- Doc-Kommentare an allen exportierten Symbolen.
- **Grammatik-Duo-Sync bei Sprachänderungen:** `SPEC.md` (inkl.
  Anhang-A-EBNF) und `packages/core/src/language/findsl.langium` müssen
  synchron bleiben (maschinell geprüft via
  `packages/core/test/grammar-spec-coupling.test.ts`).
- Vor jeder Sprach-/Provider-Änderung:
  `npm run langium:generate && npm run build && npm run bundle &&
  npm test` (alle Tests grün, Bundle-Smoke 4/4, keine Regression).

## Quelltext-Header

Neue Quelldateien tragen den Lizenz-Header gemäß `CLA.md` →
Abschnitt "Datei-Header-Konvention". Kurzform (Sprache: TS/JS):

```ts
// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2
```

Bei Dateien mit Shebang (`#!/usr/bin/env node`) steht der Header **nach**
der Shebang-Zeile.

## Beispielmodul aus einem Gesetz beitragen

Das **Wie** der Sprache (Architektur, alle Fallstricke, Tests — und der
Pfad „aus Alltagssprache") lebt im ausgelieferten Skill
[`skills/findsl-author/`](skills/findsl-author/SKILL.md) — **zuerst lesen**
(`SKILL.md` + `references/workflow-gesetz.md`). Er ersetzt die frühere
`GESETZ-ZU-FINDSL.md`. Dieser Abschnitt ergänzt nur die **Repo-Konventionen**
für ein Beispielmodul im `examples/`-Baum.

- **Goldene Regel:** absolut richtige Berechnung im modellierten Umfang.
  Bemessungsbasis/Einstufungen/Verfahren gehen als **geprüfte Eingabe** ein
  und werden im Datei-Doc-Block als nicht modelliert benannt. Niemals raten.
- **Niemals ändern:** Grammatik-Duo (`SPEC.md`, `findsl.langium`),
  Interpreter, Validator — reine Beispielarbeit. Kann die Sprache etwas
  nicht, wird der Umfang dokumentiert eingeschränkt, nicht die Sprache
  erweitert.
- **Eingabe (Gesetzesquelle):** `gesetze/<ABK>/<ABK>.xml` (+ `.pdf`) oder im
  Beispielordner `examples/<slug>/<abk>.xml`. XML ist primär (strukturiert,
  paragraphenweise). Übersicht/Klartext extrahieren:

  ```bash
  grep -o '<enbez>[^<]*</enbez>' <abk>.xml          # Paragraphen-Übersicht
  python3 -c "
  import re, html
  xml = open('<abk>.xml', encoding='utf-8').read()
  for n in re.findall(r'<norm[^>]*>.*?</norm>', xml, re.S):
      eb = re.search(r'<enbez>(.*?)</enbez>', n, re.S)
      tx = re.search(r'<textdaten>(.*?)</textdaten>', n, re.S)
      if not eb: continue
      def strip(t): return re.sub(r'\s+',' ', html.unescape(re.sub(r'<[^>]+>',' ',t))).strip()
      print('====', html.unescape(eb.group(1)).strip(), '===='); print(strip(tx.group(1)) if tx else '')
  "
  ```

- **Ausgabe/Ablage:** `examples/<slug>/<slug>.findsl` (Orchestrator) +
  `examples/<slug>/<slug>.test.findsl`. Bei Größe/mehreren Rechtsbereichen
  auf mehrere kohäsive Dateien mit Gesetz-Präfix aufteilen (Vorbild
  `examples/kraftst/`: `kraftstg-typen ← kraftstg-tarif-* ← kraftst`). Die
  `.test.findsl` importiert `aus "./<slug>"` (relativ, ohne `.findsl`).
- **`@Quelle`-Slug:** bei neuer Gesetzes-Abkürzung `GESETZ_PFAD` in
  `packages/core/src/docgen/quelle.ts` prüfen/ergänzen — das Slug muss auf
  gesetze-im-internet.de existieren (nicht immer `kleinbuchstaben(Abk)`,
  z. B. `kstg_1977`). Falsches Slug = toter Link.
- **Verifizieren (vom Repo-Root):**

  ```bash
  node packages/cli/out/main.js parse examples/<slug>                 # 0 Diagnosen (auch keine hints)
  node packages/cli/out/main.js test  examples/<slug>/<slug>.test.findsl   # N/N
  node packages/cli/out/main.js test  'examples/**/*.test.findsl'     # keine Regression
  npm test                                                           # volle Suite grün
  ```

  Die benigne Meldung `Ambiguous Alternatives Detected … <Program>` ist
  **kein** Fehler.
- **Doku (nur auf ausdrückliche Anweisung):**
  `node packages/cli/out/main.js docgen examples/<slug> -f all -o examples/<slug>/<abk>-doku`.
- **Buchführung:** neues Modul in der `CLAUDE.md`-Beispielliste und in
  `docs/changelog.md` eintragen.
- **Referenz-Module:** `examples/kst/` (klein, bester Start) · `kraftst/`
  (groß, mehrdateilich) · `gewst/` (Verrechnungslogik) · `est/` (mehr-
  entitätig, Listen-Konstrukte).

## Ablauf

1. Issue/Vorhaben kurz abstimmen (vermeidet Doppelarbeit).
2. Branch erstellen, Änderung mit Tests (TDD bevorzugt).
3. `npm test` grün, Beispiele unverändert (`parse`/`test` reproduzierbar).
4. Pull Request mit Beschreibung; CLA-Status angeben.

Fragen zu Lizenz/Kooperation/kommerzieller Nutzung: **contact@devtank42.de**.
