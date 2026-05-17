> Teil des FinDSL-Projektkontexts — aus CLAUDE.md aufgeteilt. Gesamtindex: [../CLAUDE.md](../CLAUDE.md)

## 7. Wichtige Pitfalls und Lessons Learned

**Langium ist ESM-only.** `package.json` MUSS `"type": "module"`
haben. Imports verwenden `.js`-Extension trotz `.ts`-Sources.

**Langium 4 Migration (2026-05-16, 3.3 → 4.2.4).** Reibungsarm:
`langium`/`langium-cli` `~4.2.0`, `chevrotain` `~12.0.0`, `typescript`
`~5.9.0` (Langium-4-Pflicht ≥ 5.8); `vscode-languageserver/-client`
bleiben `~9.0.1` (Langium 4.2 nutzt dieselbe). Einzige Code-Brüche
(`findsl-hover.ts`): `AstNodeHoverProvider.getHoverContent` ist jetzt
`Promise<…>` statt `MaybePromise<…>` (→ `async`); abstraktes
`getAstNodeHoverContent` liefert jetzt **`string`** (Markdown) statt
`Hover` (Basisklasse wickelt selbst). Generierte `ast.ts`-Struktur
änderte sich (`<typeName>` → `<typeName>.$type`), aber unser Code nutzt
nur die `isX`-Guards + String-`$type`-Vergleiche → unberührt. CLI/LSP/
Bundle/604 Tests/Smoke nach Migration grün; `langium-config.json`
schema-kompatibel; der DeclPrefix-„consumes no input"-Hinweis bleibt
(benigne, § 4.9).

**Langium Service-Typen — Import-Pfade (unverändert in 3.x/4.x):**

| Was du importierst                              | Aus welchem Pfad         |
| ----------------------------------------------- | ------------------------ |
| `Module`, `inject`, `URI`, AST-Reflection       | `'langium'`              |
| `LangiumServices`, `LangiumSharedServices`      | `'langium/lsp'`          |
| `createDefaultModule`, `createDefaultSharedModule` | `'langium/lsp'`       |
| `DefaultSharedModuleContext`, `PartialLangiumServices` | `'langium/lsp'`   |
| `startLanguageServer`                           | `'langium/lsp'`          |
| `NodeFileSystem`                                | `'langium/node'`         |
| `ValidationAcceptor`, `ValidationChecks`        | `'langium'`              |

**Doc-Comment-Marker `--` müssen Whitespace-umgeben sein.** Sonst
verwechselt der Lexer sie mit Markdown-Horizontal-Rules (`------`)
oder Tabellen-Separatoren (`|----|`).

**Property-Zuweisungen vor Alternativen sind in Langium spröde.** Wir
hatten ursprünglich `TopDecl: docPrefix=DeclPrefix? (KonstDecl | ...)`,
das den `docPrefix` nicht zuverlässig an die gewählte Sub-Deklaration
anheftete. Lösung: jede Deklaration hat ihre eigene `docPrefix?`-Property.

**`fall` ist KEIN Schlüsselwort mehr.** Wurde zu `testfall` umbenannt,
weil `fall` als deutscher Identifier (Steuerfall, Sachfall, ...) blockiert
wurde. **Wenn du irgendwo Beispiele aus älterem Material siehst, die
`fall "..."` verwenden — bitte aktualisieren.**

**`countNodes` und ähnliche AST-Walker müssen Langium-interne Properties
(Präfix `$`, z. B. `$container`, `$cstNode`) überspringen** — sonst
Stack-Overflow durch Parent-Rückwärtszeiger.

**TextMate-Grammatik (`syntaxes/findsl.tmLanguage.json`) wird automatisch
von Langium generiert.** Manuelle Änderungen werden überschrieben — wenn
du Highlighting anpassen willst, geht das über Konfiguration in
`langium-config.json` oder eine Custom-Generator-Schritte.

**Teil-Parse-Robustheit ist Pflicht (häufigste Bug-Quelle).** Beim
Tippen im Editor liefert der fehlertolerante Parser unvollständige ASTs:
grammatikalisch *verpflichtende* Properties (`type`, `body`, `name`,
`atom`, `expr`, `result`) sind dann `undefined`. JEDER Provider/Checker
muss das tolerieren (Guard → `unknown`/`'?'`/skip), sonst stirbt der
ganze Validierungslauf oder ein LSP-Request crasht. Konkret aufgetreten:
`resolveTypeAnnotation(t.atom)`, `checkFunctionBody(body.expr)`, jede
lokale `typeToString`-Kopie, und **DocumentSymbol mit leerem `name`**
(LSP verbietet das → „name must not be falsy"; Lösung: pro Builder +
rekursives `sanitize()`). Regeln: (1) CLI/Tests parsen vollständige
Dateien und decken das NICHT ab — immer über den **vollen DocumentBuilder-
+-Validation-Pfad** testen (siehe `test/language/partial-parse.test.ts`);
(2) Härtung zentral *und* in jeder Provider-Kopie.

**PascalCase-Symbol-Fallback ist NICHT mehr still bei Aufrufen.**
`inferCallChain` (findsl-types.ts) behandelt unbekannte PascalCase-
Namen tolerant als Aufzählungs-Wert-Fallback (viele Beispiele nutzen
das). Ausnahme seit 2026-05-16: ist der Name das **Aufrufziel**
(`cc.chain[0]` ist `Call`) und weder lokal/Import/Builtin noch ein
bekannter Enum-Wert, wird ein **Fehler** gemeldet (spiegelt den
Laufzeitfehler „Aufrufziel ist nicht aufrufbar"). Enum-Werte werden
nie aufgerufen → kein Fehlalarm; bare Referenzen bleiben tolerant.
Folge: Test-Dateien, die Datensatz-Konstruktoren der Quelldatei
nutzen, müssen diese (und deren Default-Konstruktor-Abhängigkeiten)
explizit `verwende { … } aus "./<quelle>"` importieren — der Editor
unterstreicht fehlende Importe rot.

**Drei-Runtime-Divergenz + Bundle-Smoke-Gate.** Code läuft in drei
Umgebungen: vitest (src, ESM), `node out/.../main.js` (tsc-ESM-Output),
und das esbuild-**CJS-Bundle** (`out/language/main.cjs`, der echte LSP-
Serverprozess). Bugs, die nur im CJS-Bundle auftraten (z. B.
`createRequire(import.meta.url)` → undefined), waren in vitest/CLI
unsichtbar. Gegenmittel: `test/bundle-smoke.test.ts` als CI-Gate baut
die Bundles via esbuild und lädt sie. **Nach jeder Sprach-/Provider-
Änderung: `npm run langium:generate && npm run build && npm run bundle`**,
sonst läuft im Editor ein veralteter Server (häufigste „geht im Editor
nicht"-Ursache → `Developer: Reload Window` / F5).

**CJS-Libs aus ESM: `createRequire`, nicht `import()`.** `pdfmake`
(0.3, reines CJS, Node-Entry `pdfmake/js/*.js`) zeigte exakt die
Drei-Runtime-Divergenz: dynamisches `import('pdfmake/js/Printer.js')`
lieferte unter vitest/vite `.default` = die Klasse, unter dem
echten Node-CLI dagegen `.default` = `module.exports` (`{default: …}`)
→ „is not a constructor". Robust = `createRequire(import.meta.url)` +
`require('…').default` (deterministische CJS-Semantik in allen
Runtimes). `src/docs/pdf.ts` so gelöst; `pdfmake/js/virtual-fs.js`
exportiert zudem eine Singleton-Instanz (nicht die Klasse → kein
`new`). Standard-14-Fonts (Helvetica/Courier) brauchen keine Font-
Dateien (pdfkit-Builtin) → voll offline/deterministisch.

**Geld ist Euro-kanonisch; der Interpreter ist sonst untypisiert.**
Zur Laufzeit speichert jeder Geldwert (`Euro`/`EuroCent`/`Cent`) seine
Zahl IMMER in Euro (`1 Cent` → intern `0.01`, `250 Cent` → `2.5`).
Dadurch sind Vergleich/`+`/`-` rein wertbasiert automatisch
einheitenkorrekt (`1 € ≠ 1 ct`, `42 EuroCent == 42 Euro`) und die
SPEC-§3.2-Invariante „`Euro` = ganzzahlig" hält, weil
bruchproduzierende Operationen `EuroCent`/`Dezimal` taggen (Ergebnis-
Tags nach SPEC § 3.2.3/§ 3.4 in `combineAddSub/Mul/Div`). Skalierung
passiert EINMALIG im `als`-Cast (`als Cent` einer nackten Zahl → ÷100;
Geld→Geld = reiner Tag-Wechsel), nicht an den Verbrauchsstellen.

**Typannotationen SETZEN zur Laufzeit die Geld-Einheit (2026-05-16,
Breaking — kehrt die frühere „Annotation = No-Op"-Regel um, Nutzer-
Entscheidung).** `var/konst/Parameter: Euro|Cent|EuroCent` wirkt wie ein
`als <Typ>`-Cast: Tag + Euro-kanonische Skalierung. `var x: Euro = 2;
var y: Cent = 20; var z: Cent = x + y` → `z` = 220 ct (vorher fälschlich
`22`, da beide `Ganzzahl` blieben). Implementiert über
`applyMoneyAnnotation(value, type, was)` (interpreter.ts, neben
`castNumeric`), aufgerufen an JEDER Bindungsstelle: `konst`-Decl, alle
drei `LetStmt`-Zweige (Lambda-/fn-Body-/`testfall`-Block) und
`bindParams` (Parameter tragen jetzt `typeAnnotation` durch
`FunctionParam`). Zusätzlich erzwingt `applyMoneyAnnotation` die
**Ganzzahligkeit von `Euro`/`Cent` auch bei berechneten Werten** (SPEC
§ 3.2.2 — Rückrichtung verlangt explizite Rundung): fraktionaler
Euro/Cent an einer Annotation → `InterpretError` (`abrunden*`/`aufrunden*`
nötig). `EuroCent` (präzise Mitte) bleibt ungeprüft. Der statische
Type-Checker macht weiterhin die echte Typprüfung; der Literal-Check
(`Euro`/`Cent` kein `,`, `EuroCent` 2 NK) in `checkAgainstAnnotation`
bleibt. Tests: `test/interpret/geld-annotation.test.ts`.

**Deutsche Zahl-Notation (SPEC § 2.7).** Quelltext UND Ausgaben sind
durchgängig deutsch: `.` = Tausender-Trenner (Gruppen zu 3, optional),
`,` = Dezimaltrenner — kein `_`, kein `.`-Dezimalpunkt. Lexer-
Disambiguierung (NUMBER_TOKEN `[0-9]+(\.[0-9]{3})*(,[0-9]+)?%?`): `.`
gehört zur Zahl nur bei genau 3 Folgeziffern (sonst `obj.feld`); `,`
nur bei direkt folgender Ziffer (sonst Listen-/Argument-Trenner — daher
**Trenner-Komma stets mit Folge-Leerzeichen**, `f(a, b)`). Per-Typ-
Schreibweise wird vom Type-Checker erzwungen (`checkAgainstAnnotation`):
`Euro`/`Cent` ganzzahlig (kein `,`), `EuroCent` **genau zwei**
Nachkommastellen Pflicht (`0`/`oder 0`/`== 0` in EuroCent-Kontext →
Fehler, bewusst). `parseNumberLiteral` strippt `.`, ersetzt `,`→`.`;
`formatGerman` (values.ts) erzeugt die Ausgabe (Gruppierung immer,
`Cent` ×100, `EuroCent` 2 NK, **kein `EUR`-Suffix**). Drei-Artefakt-
Sync betroffen: NUMBER_TOKEN in findsl.langium · grammar/findsl.ebnf ·
SPEC Anhang A. Test-Fixtures: eingebettete `.findsl`-Literale migrieren,
**JS-Decimal-Assertion-Strings (`'12.5'`, `Decimal('1.5')`) bleiben mit
`.`** — nicht mit-migrieren.

**Server-Kommando-Handler dürfen `connection.window.show*Message`
NICHT awaiten.** `vscode-languageserver` sendet das als
`window/showMessageRequest` (eine *Anfrage*), die erst auflöst, wenn der
Nutzer die Notification schließt (Fehler-Toasts sind klebrig). Ein
`await` blockiert die `executeCommand`-Antwort → Client-Timeout.
Fire-and-forget (`void connection?.window.show…`).

**Inlay-Hints: Range-Pruning verursacht Scroll-Flackern.** Langiums
`AbstractInlayHintProvider.getInlayHints` streamt mit
`streamAst(root, { range: params.range })` — nur Knoten im VS-Code-
Sichtbereich. Beim Scrollen wechselt der Range; mehrzeilige Container
(`fn`/`datensatz`) werden teilweise abgeschnitten → Hints erscheinen/
verschwinden („mal da, mal nicht"). Symptom ist NICHT der Hint-Code,
sondern die Traversierung. Fix in `findsl-inlay-hints.ts`:
`getInlayHints` überschrieben, streamt den **ganzen AST** (range-
unabhängig; FinDSL-Dateien sind klein) + Pro-Knoten-`try/catch`
(Teil-Parse kippt nicht die ganze Antwort). Regressionstest:
schmaler Range muss dieselben Hints liefern wie Voll-Range
(`inlay-hints.test.ts` „range-stabil").

**Inlay-Geld-Erkennung ist type-checker-getrieben (nicht hand-
propagiert).** Frühere Hand-Propagierung der Geld-Erwartung im
Inlay-Provider verfehlte systematisch Fälle (Aufrufergebnisse,
`wenn`/`wähle`, `==`-Vergleiche im `testfall` ohne Annotation). Jetzt:
`findsl-types.ts` hat einen optionalen `recordType`-Observer in
`TypeContext`; `infer` und `checkAgainstAnnotation` sind dünn umwickelt
(`*Impl` + Wrapper) und melden den **effektiven** (kontextuellen) Typ
jedes Ausdrucks — `checkAgainstAnnotation` gewinnt gegen Standalone-
`infer`. `collectExpressionTypes(program)` führt dieselben Pässe wie
`typeCheckProgram` PLUS `testfall`-Inferenz mit **NOOP-Reporter** aus →
Map Knoten→Typ; der Validator bleibt unberührt (kein `recordType`,
keine testfall-Diagnosen → null Verhaltensänderung). Zusatz: `==`/
Vergleiche sind jetzt bidirektional (Geld-Seite → nacktes Literal-
Operand, SPEC § 3.13) — auch eine Type-Checker-Korrektheitsverbesserung.
Der Inlay-Provider ruft `collectExpressionTypes` **einmal pro Request**
(getInlayHints-Override), die Rekursion steuert nur noch die
PLATZIERUNG (Leaf/Elvis/Branch), die Geld-Frage beantwortet die Map.
Lehre: für „X an jeder typrelevanten Stelle"-Features die EINE
Typquelle (Type-Checker) anzapfen statt Logik zu duplizieren.

**Formatter: Idempotenz ist hart erkämpft.** `format∘format == format`
MUSS gelten — empirisch auf allen Beispieldateien prüfen. Fallen:
(a) Trailing-Komma `,)` unter einer `keywords(',')`-Regel oszilliert mit
`)`-prepend → Funktions-Parameter-Klammern bewusst NICHT formatiert;
(b) per-Member `fit(…, indent())` ohne gemeinsames `interior()`
kaskadiert die Einrückung → Blöcke mit dem `prüfe`/`wähle`-Rezept
(`interior(open,close).prepend(indent())` + `properties(x).prepend(
indent())` + `close.prepend(newLine())`); (b2) **Spalten-Ausrichtung
über variable `spaces(pad)`**: pad MUSS aus einer formatierungs-
unabhängigen Größe stammen, sonst nicht idempotent — datensatz/`@param`
nutzen AST-Namens-Längen, `wähle` die *whitespace-kollabierte* Arm-
Linke (= kanonische Breite nach Operator-Spacing; auf bereits
kanonischem Code in einem Pass korrekt, sonst Konvergenz in 2). Bei
benachbarten Keywords (`sonst`/`->`) NUR EINE Regel pro Lücke
(`sonst`.append entfernt, nur `->`.prepend) — zwei Regeln auf dieselbe
Lücke = Konflikt; (b3) **Breiten-Umbruch-Entscheidung darf NICHT die
Quell-Spalte nutzen**, wenn diese vom selben Format-Lauf verschoben
wird: ein `wähle`-Arm-RHS bekam pass1 die Pfeil-Polsterung, pass2 sah
die größere Spalte → andere Umbruch-Entscheidung → **Endlos-
Oszillation**. Lehre: Breiten-Maße ausschließlich aus
formatierungs-INVARIANTEN Größen. `fn`/`konst`/`var`-Prefix strukturell
aus Namen/Typen; **`wähle`-Arm-RHS-Prefix DETERMINISTISCH rekonstruiert**
(`indentDepth·4 + maxArmLinke + 4`, identisch zur `->`-Ausrichtungs-
Logik) statt Quell-Spalte ⇒ Arm-RHS-Ketten brechen jetzt idempotent.
Verbleibende Kontexte ohne stabilen Prefix (Call-Arg etc.) weiterhin
nur `fit`; (c) `property` (Singular)
trifft nur ein Vorkommen — für Wiederholungen `properties` (Plural);
(d) **datensatz Zwei-Spalten-Layout** (2026-05-17, ehem. § 4.15-Schutz
*aufgehoben*): mehrzeilige Feldlisten werden jetzt IMMER ausgerichtet
(auch MIT Trailing-`//`). Polsterung nach `:` =
`spaces(maxNameLen − nameLen + 1)` in der `isField`-Regel (Zugriff auf
Geschwister über `node.$container` = `DatensatzDecl`, nur wenn
mehrzeilig). Idempotent, weil die Polsterung AST-abgeleitet ist
(Feldnamen-Längen, formatierungsunabhängig); der `,`→`//`-Abstand wird
NICHT angefasst (Hidden-Token, keine Regel) → Kommentare bleiben byte-
stabil. Funktionsparameter & einzeilige `datensatz` weiterhin nur ein
Space (keine Spalten). Empirisch auf allen 17 Beispielen idempotent +
formatiert valide verifiziert.

---

