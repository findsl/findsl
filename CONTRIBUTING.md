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

## Ablauf

1. Issue/Vorhaben kurz abstimmen (vermeidet Doppelarbeit).
2. Branch erstellen, Änderung mit Tests (TDD bevorzugt).
3. `npm test` grün, Beispiele unverändert (`parse`/`test` reproduzierbar).
4. Pull Request mit Beschreibung; CLA-Status angeben.

Fragen zu Lizenz/Kooperation/kommerzieller Nutzung: **contact@devtank42.de**.
