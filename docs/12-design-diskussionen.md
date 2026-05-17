> Teil des FinDSL-Projektkontexts — aus CLAUDE.md aufgeteilt. Gesamtindex: [../CLAUDE.md](../CLAUDE.md)

## 12. Design-Diskussionen — beide entschieden

> § 12.1 (`->` statt `:`) **abgelehnt** → § 4.2.
> § 12.2 (`ausgabe`) **angenommen, Variante C, implementiert**
> (2026-05-16) → § 4.18. Keine offene Design-Diskussion mehr.

### 12.1 Funktions-Rückgabe `->` statt `:` — ✅ ENTSCHIEDEN: abgelehnt

**2026-05-15 bewertet und endgültig abgelehnt — `:` bleibt.**
Volle Begründung jetzt in **§ 4.2** (Re-evaluiert und bestätigt):
Konsistenz (`:` = projektweit genau „hat Typ"), Unleserlichkeit
funktionstypwertiger Rückgaben (`… -> (Euro) -> Euro`), kein
funktionaler Gewinn vs. breite Breaking-Migration; Pro „Vertrautheit"
schwach (TS/Kotlin/Scala nutzen ebenfalls `:`). Nicht erneut aufrollen
ohne fundamental neues Argument.

### 12.2 Neues Sprachkonstrukt `ausgabe("...")` — ✅ ENTSCHIEDEN: Variante C

**2026-05-15 bewertet — Variante C (voller Seiteneffekt) gewählt**,
entgegen der Empfehlung (D, nicht aufnehmen); **2026-05-16 vollständig
implementiert** als Resolution A (Anweisung, kein Wert). Volle
Begründung, Tragweite und die explizite, bewusste P2-Aufweichung in
**§ 4.18**. Umsetzung: Grammatik-Trias, Type-Check (`Text`-Pflicht),
Interpreter mit injizierbarer `AusgabeSink`, `prüfe`/CLI/Test-
Controller-Output, LSP (Hover/SemanticTokens/Completion); 506 Tests
grün.

---

