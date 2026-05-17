> Teil des FinDSL-Projektkontexts — aus CLAUDE.md aufgeteilt. Gesamtindex: [../CLAUDE.md](../CLAUDE.md)

## 9. Designprinzipien (für Konsistenz bei künftigen Entscheidungen)

Aus SPEC § 1.3:

**P1 — Lesbarkeit vor Knappheit.** Sachbearbeiter:innen ohne
Programmierhintergrund müssen FinDSL-Regeln lesen können.

**P2 — Reine Funktionen, kein globaler Zustand.** Eingaben als Parameter,
Ausgaben als Rückgabewerte.

**P3 — Einheiten und Präzision im Typsystem.** Geld/Prozent/Dezimal sind
unterschiedliche Typen. Rundung ist explizit.

**P4 — Gesetzliche Quelle als Pflicht-Annotation.**
`@Quelle("§ ...")`-Konvention.

**P5 — Veranlagungsjahr im Datei-/Pfadnamen.** Nicht implizit, sondern
explizit als Datei-/Verzeichnis-Komponente.

**P6 — Markdown-Doc-Kommentare als Pflicht.** Generierbar zu
PDF/HTML, maschinell parsbar für KI-Agenten.

**P7 — Transparenz vor Privatheit.** Deklarationen öffentlich — außer
führendes `_` = modul-intern (nicht cross-file importierbar, nicht in
der Doku; § 4.16). Sonst sind alle Deklarationen öffentlich.

---

