> Teil des FinDSL-Projektkontexts — aus CLAUDE.md aufgeteilt. Gesamtindex: [../CLAUDE.md](../CLAUDE.md)

## 11. Konventionen für Code-Stil

- TypeScript strict mode
- Doc-Kommentare an allen exportierten Symbolen
- Deutsche Variablen- und Funktionsnamen wo möglich (Konsistenz mit der
  DSL); englische Namen nur wo unvermeidlich (z. B. Langium-Standard-
  Schnittstellen)
- ESLint-Konfiguration: TODO (noch nicht aufgesetzt)
- 4 Leerzeichen Einrückung in TypeScript-Dateien
- `.findsl`-Dateien folgen den Konventionen aus SPEC § 9.2 (Markdown-Doc-Sektionen)
- **Harte Regel `konst`-Namen (SPEC § 2.5, 2026-05-16):** `konst`-Namen
  MÜSSEN `^[A-Z][A-Z0-9_]*$` erfüllen (ASCII UPPER_SNAKE_CASE) — Verstoß
  = **Fehler** (`findsl-validator.checkKonstNameUppercase`, Code
  `findsl.konst-uppercase`). Gilt NUR für Konstanten.
- **Harte Regel Großschreibung (SPEC § 2.5, 2026-05-17):** Namen von
  **Funktionen, Datensätzen, Aufzählungen und Aufzählungs-Werten**
  MÜSSEN mit einem Großbuchstaben beginnen (`^_*\p{Lu}`, Unicode,
  führende „_" erlaubt) — Verstoß = **Fehler**
  (`findsl-validator.checkFunktion/Datensatz/AufzaehlungNameGross`,
  Code `findsl.name-grossschreibung`). **Builtins ausgenommen**
  (`abrundenEuro`/`aufrunden`/… — eigener fester Stdlib-Namensraum,
  bleiben lowerCamel). `var`/Parameter/Datensatz-**Felder** bleiben
  lowerCamelCase (nicht erzwungen). Folge: ALLE `fn`-Namen in
  Beispielen/Test-Fixtures auf UpperCamel migriert (z. B.
  `estGrundtarif` → `EstGrundtarif`); Aufrufe/Importlisten
  mitgezogen; Datensatz/Aufzählung/Enum-Werte waren bereits groß.

---

