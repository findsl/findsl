- java codegen
- Untersuche "verwende" (import) von Aufzählungen. aktuell müssen einzele werte importiert werden. ist das ok?
- grundsätzlich diskussion: builtins + stdlib
- wildcard-imports sinnvoll?
- Text.einrückungEntfernen() funktioniert nicht
- .alsText Built-in: brauchen wir das? Reicht nicht das Casting "als Text"?
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
