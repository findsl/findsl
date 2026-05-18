- java codegen
- Untersuche "verwende" (import) von Aufzählungen. aktuell müssen einzele werte importiert werden. ist das ok?
- ~~grundsätzlich diskussion: builtins + stdlib~~ → ENTSCHIEDEN 2026-05-18:
  § 11 auf Empfänger-Methoden, kontextgetrieben (SPEC § 11.1/§ 11.5;
  Changelog 2026-05-18). Freie Rundungsfunktionen entfernt.
- wildcard-imports sinnvoll?
- ~~Text.einrückungEntfernen() funktioniert nicht~~ → implementiert
  (§ 11.5, 2026-05-18).
- ~~.alsText Built-in: brauchen wir das? Reicht nicht das Casting "als
  Text"?~~ → `.alsText` als Property implementiert (Identität/Default-
  Format); `.alsText(format = …)` bewusst v1.0-offen (SPEC § 11.5).
- formatter überarbeiten / erweitern
- code complition
- @formatter:off / @formatter:on

- matrizen einführen??
```
var tarife = matrix(jahr: Jahr, k: Ganzzahl, satz: Dezimal, betrag: Euro) {
    2025    |  1   |  10  |  2303,
    2025    |  1   |  10  |  2303,
    2025    |  1   |  10  |  2303,
    2025    |  1   |  10  |  2303,
    2025    |  1   |  10  |  2303,
    2025    |  1   |  10  |  2303,
    2025    |  1   |  10  |  2303,
    2025    |  1   |  10  |  2303,
}


für jede zeile aus tarife {
    foobar(zeile.jahr, zeile.betrag)
}        



```
