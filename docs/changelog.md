## Changelog — Chronologie der Arbeitsstände

> Teil des FinDSL-Projektkontexts — aus CLAUDE.md aufgeteilt. Gesamtindex: [../CLAUDE.md](../CLAUDE.md)

*Letzte Aktualisierung: 2026-06-02 — **IntelliJ: Lazy-Download der nativen
Binaries vom Release (#277).** Setzt ADR #243 §4 Stufe 3/4 um (Folge zu #275):
`FinDslNativeBinary` löst jetzt vollständig auf — Override → Settings → gebündelt
(Dev) → **Lazy-Download** → Fehler. Neuer `FinDslBinaryDownloader` lädt das zur
Plattform passende Asset (`findsl-lsp-<os>-<arch>`, reine Mapping-Logik in
`BinaryAssets`) **einmalig** vom versions-gepinnten GitHub-Release, verifiziert
es **SHA-256 gegen das eingebettete `checksums.json`** (#244) und cached es
versioniert unter `<SystemDir>/findsl-binaries/<version>/` (0700/0600); ein
Cache-Treffer mit passendem Hash wird ohne Netz wiederverwendet, ein
manipuliertes Asset abgelehnt. Download via IntelliJ `HttpRequests`
(Proxy-bewusst), **synchron** im LSP-Start-Thread mit Fortschritt +
Balloon-Notification (Group „FinDSL"). Kein eingebettetes Manifest (Dev-Build)
⇒ Download übersprungen; nicht unterstützte Plattform (z. B. `linux-arm64`) ⇒
klare Meldung → Einstellungen → FinDSL. Unit-Tests: Plattform→Asset-Mapping +
SHA-256-Vektor. In Produktion greift Stufe 4, sobald ein Release die Assets +
`checksums.json` bereitstellt.*

*Letzte Aktualisierung: 2026-06-02 — **IntelliJ: Binary-Pfade in den
Einstellungen konfigurierbar — Air-Gap-Fallback (#275).** Setzt ADR #243 §5 um:
neue Settings-Seite **Einstellungen → FinDSL** (`FinDslConfigurable`,
Kotlin-UI-DSL) mit Pfad-Feldern für LSP-Server- und CLI-Binary, persistiert über
`FinDslSettings` (`PersistentStateComponent`, application-level). In
abgeschotteten Netzen ohne GitHub-Zugriff trägt der Administrator die lokal
bereitgestellten Binaries dort ein. `FinDslNativeBinary.resolveOrExtract`
konsultiert den Pfad als **Stufe 2** (Reihenfolge: `FINDSL_*_PATH`/
`findsl.*.path`-Override → **Settings-Pfad** → gebündeltes Binary); die
„nicht gefunden"-Meldung verweist jetzt auf die Einstellungen. Die reine
Auswahl-Logik liegt IntelliJ-frei in `BinaryPathResolver` (+ JUnit-Test der
Priorität). **Lazy-Download (ADR §4 Stufe 3/4) bleibt separater Folgeschritt.**
Apps/intellij: 2 neue Quell- + 1 Testdatei + 4 Edits; Doku (`apps/intellij/
README.md`, `binary-distribution.md`).*

*Letzte Aktualisierung: 2026-06-01 — **Doku: zweiter Editor (IntelliJ/JetBrains)
im Projektkontext (#246).** `docs/02-repository-struktur.md` um `apps/intellij/`,
das native LSP-Binary-Artefakt (`packages/lsp/dist/findsl-lsp`) und eine
**Editor-Matrix** (VS Code = `.cjs`-Bundle / JetBrains = natives SEA-Binary via
LSP4IJ + Lazy-Download, #243) erweitert; `README.md` um `apps/intellij/` in der
Struktur, einen Status-Satz und einen neuen Abschnitt **„Editoren &
Installation"** (VS Code + JetBrains aus dem Quellcode — Marketplace in
Vorbereitung); `CLAUDE.md`-Index um den „Zwei Editoren, ein Sprachkern"-Hinweis;
`NOTICE` um **LSP4IJ (Red Hat, EPL-2.0)** als Plugin-Abhängigkeit (über den
JetBrains-Marketplace aufgelöst, nicht als Quelltext mitverteilt). Reine
Dokumentation, kein Produktivcode.*

*Letzte Aktualisierung: 2026-06-01 — **`Prozent`-Arithmetik bei `*`/`/`
→ `Dezimal` + Umwandlungs-Methoden `.alsProzent()`/`.alsDezimal()` (§ 11.7).**
Nutzer-Befund: `(ganzzahl * prozent) * dezimal` schlug mit „Prozent * Dezimal
ist nicht definiert" fehl, weil `Zahl × Prozent` als `Prozent` getaggt wurde —
da `Prozent` intern eine Bruchzahl ist (`42%` = `0,42`), ergab `42% * 100`
intern `42`/Prozent → angezeigt `4200 %`. **Fix:** bei `*`/`/` ist `Prozent`
ein dimensionsloser Bruch-Skalar → jede Nicht-Geld-Kombination ergibt
**`Dezimal`** (`100 * 10% == 10`, `9,3% / 2 == 0,0465`); `Geld × Prozent →
EuroCent` und `Prozent ± Prozent → Prozent` bleiben. Umgesetzt konsistent über
Typinferenz (`findsl-inference`), Interpreter (`combineMul`/`combineDiv`),
Java- **und** TS-Runtime. **Neu (§ 11.7):** `.alsProzent()` (Zahl → `Prozent`,
Stellenwert als Prozentangabe) und `.alsDezimal()` (`Prozent` → Bruchwert) als
Methoden-Form des `als`-Casts — receiver-präziser Dispatch in `getMethodDefs`
(`.alsProzent()` nur auf Ganzzahl/Dezimal, `.alsDezimal()` nur auf Prozent),
IR-seitig der bestehende `cast`-Knoten (kein neuer Runtime-Code). **Keine
Grammatikänderung** (`*`/`.methode()` längst geparst) → Grammatik-Duo
unberührt. SPEC § 2.7.4 (Selbstwiderspruch „Bruchteil" behoben), § 3.4
(Arithmetik-Tabelle), neue § 11.7. **Korpus +8 testfall** (§ 3.4 inkl.
Nutzer-Snippet `ProzentKette`; § 11.7), ts-gate-Floor 128 → 136; Cross-Gate
Interpreter ⇄ Java ⇄ TS ⇄ JS bit-genau grün; 1537 Tests grün.*

*Letzte Aktualisierung: 2026-05-29 — **Formatter: fn-Parameter als
4-Spalten-Tabelle (Folge zu #202).** Mehrzeilige `fn`-Signaturen
fluchten jetzt analog zu mehrzeiligen Datensätzen — Name · Typ · `=
default` · Inline-`//`-Kommentar. Bislang ließ der fn-Handler die
Parameterliste bewusst unangetastet (Oszillations-Sorge bei Trailing-
Komma); seit diesem PR wird sie wie ein Datensatz-Block behandelt
(`f.interior` indent, `,`-noSpace, `)`-newLine), und die bestehende
isParam/isField-Spalten-Logik greift dank `fnParamsIstMehrzeilig`-Gate
auch für fn-Params. `inlineCommentEdits` extrahiert die Spalten-
Berechnung in einen geteilten Helper `alignInlineComments`, der über
`fields` oder `params` läuft. **+6 Tests**; idempotent; 1330 Tests
grün.*

*Letzte Aktualisierung: 2026-05-29 — **Formatter: `datensatz`-Felder
als 4-Spalten-Tabelle.** Issue #202. Felder mehrzeiliger Datensätze
fluchten jetzt durchgängig in vier Spalten — Feldname, Typ, `= default`,
Inline-`//`-Kommentar — bisher driftete Spalte 2/3/4 mit der Typ-Länge.
**Implementation:** im `isField`-Handler wird zusätzlich zur bestehenden
Namens-Spalte (`:`-Padding) auch ein `=`-Padding (`maxTypeLen − typeLen +
1` Spaces) emittiert; Felder ohne Default lassen `,` direkt am Typ
kleben (sonst „schwebt" das Komma). **Spalte 4** (Inline-Kommentar)
über einen neuen Post-Pass `inlineCommentEdits` analog `docTagEdits`:
pro Datensatz wird `commentCol = max(rowTail über Felder mit `//`) + 1`
berechnet und der Whitespace zwischen `,` und `//` per `TextEdit` auf
die Ziel-Lücke gesetzt. Felder ohne Inline-Kommentar erzeugen keinen
Edit ⇒ keine Trailing-Spaces. **+6 Tests**; idempotent; bestehende
1324 Tests grün. `kraftstg-typen.findsl` als visueller Smoke-Check:
alle vier Spalten fluchten.*

*Letzte Aktualisierung: 2026-05-30 — **LSP: Cmd+Click + Hover für
importierte Elemente im `verwende`-Block.** Issue #196. Die einzelnen
Namen in `verwende { Foo, Bar als Baz, … } aus "./modul"` waren bislang
**nicht navigierbar** und zeigten **keine Hover-Doc**; im restlichen Code
funktionieren beide Features schon, nur in den Import-Direktiven selbst
nicht — weil `findsl-definition.ts` und `findsl-hover.ts` den AST-Knoten
`ImportItem` nicht dispatchten (bei Alias-Form gewann unfreiwillig nichts,
beim Common Case zufällig die Code-Referenz-Logik). **Neu:** je ein
expliziter `isImportItem`-Case in `resolveTargetForIdToken` und
`resolveIdToken`; beide reichen das Binding über `analyzeImports` (AST-
Knoten-Identität, nicht Name-Match) zur Quell-Decl auf. **Source-Name und
Alias** zeigen jeweils auf dieselbe Source-Decl — `Foo als Bar` ist auf
beiden Tokens navigierbar. Hover-Karte ist identisch zur Code-Referenz
(Signatur, Doc, `*Importiert aus Datei: ./modul*`). **+7 neue Tests** (4
definition, 3 hover). Verifikation: `npm run build && npm run bundle &&
npm test` — 1303 Tests grün.*

*Letzte Aktualisierung: 2026-05-29 — **LSP: Editor-Unterstützung für
Builtin-Methoden (SPEC § 11) Tier 1.** Issue #193. Die Stdlib-Methoden
sind jetzt im Editor vollständig sichtbar — vorher zeigten Hover,
Signature-Help und Inlay-Hints **nichts** für Methoden wie `.höchstens`,
`.abrunden`, `.länge`, `.summe`, `.beginntMit`. **Neu:** zentraler
Dispatch-Helper `getMethodDefs(recv)` / `findMethodDef(recv, name)` /
`paramNamesFromSignature(sig)` in `findsl-method-defs.ts` (von Completion,
Hover, SignatureHelp, Inlay-Hints geteilt — vorher dreifach dupliziert).
**Hover** für Builtin-Methoden (alle § 11.1/.2/.5/.6 inkl. Properties)
mit Signatur + Doc + SPEC-§-Quelle; für primitive Typen (`Euro`, `Cent`,
`EuroCent`, `Ganzzahl`, `Dezimal`, `Prozent`, `Text`, `Liste`, `Bereich`,
…) in Annotationen via `BUILTIN_PRIMITIVE_DOCS`. **Signature-Help** für
Methoden-Aufrufe (`betrag.höchstens(│)` → Parameter-Hint mit Doc und
SPEC-§). **Inlay-Hints** für positionale Methoden-Argumente
(`.höchstens(40)` → Inlay `grenze:` vor `40`). Behandelt sowohl
`CallChain` (`a.b(…)`) als auch `ParenChain` (`(a + b).c(…)`); auch
`SafeFieldAccess` (`a?.b(…)`). `BuiltinMethodDef.quelle` neu — DEF-
Listen werden via `withQuelle(…, 'SPEC § X.Y')` einheitlich annotiert.
`sigFromText` und `BUILTIN_CALLABLES` jetzt klammer-aware (parsen
`f: (A, T) -> A` als einen Parameter, nicht als drei). **+34 neue Tests
(method-defs.test, hover, signature-help, inlay-hints).** Bewusst Tier
2/3 offen: Completion-Snippets mit Parameter-Tabstops, SPEC-Tiefenlinks,
Document-Link/Go-to-Definition für Builtins, Code-Actions (`wähle`-min →
`.höchstens`). Verifikation: `npm run build && npm run bundle && npm test`
— 1296 Tests grün.*

*Letzte Aktualisierung: 2026-05-28 — **§ 11.6-Methoden in alle Codegen-
Targets + Beispielmodule umgestellt** (Folgeschritt zum Sprachkern vom
2026-05-27). Die vier Grenzwert-/Stufen-Methoden laufen jetzt auch durch
**Java-, TypeScript- und JavaScript-Codegen**: neue IR-Knoten `scalarLimit`
/`scalarRoundTo` (`ir/nodes.ts`), Lower-Dispatch (`lower/lower.ts`, ASCII-
Transliteration `höchstens`→`hoechstens` wie `größtes`→`groesstes`),
Emission in `emit-java`/`emit-ts` (emit-js strippt das TS-Generat), Runtime-
Methoden `hoechstens`/`mindestens`/`abrundenAuf`/`aufrundenAuf` in
`runtimes/java/FinDslNumber.java` + `runtimes/ts/findsl-number.ts` (Tag-
erhaltend, Euro-kanonisch, `vielfaches > 0`). **Beispiele entschlackt:**
triviale Wrapper **komplett entfernt** — `_NichtNegativ`/`_Hoechstens`/
`_Groesseres`/`AbrundenAuf100` (gewst), `_BegrenzterFreibetrag24` (kst),
`Begrenze` (kraftst, inkl. cross-modul-Imports) — und an allen Call-Sites
direkt durch die § 11.6-Methoden ersetzt (z. B. `einkommen.mindestens(0)
.höchstens(FREIBETRAG_24)` als Clamp-Verkettung, `(gewichteteSumme -
HINZURECHNUNG).mindestens(0,00)` ohne Wrapper). −89 Zeilen netto.
`ABRUNDUNG_11` (gewst) nun `EuroCent`. `korpus-stdlib(.test).findsl`
um § 11.6 erweitert
(Codegen-Gate-Abdeckung, ts-gate-Floor 116→126). **Verifikation:** 1253
Tests grün (inkl. ts-gate gewst/kraftst durch ts+js mit ausgeführten
Generaten), `javac` über das Java-Generat + neue `FinDslNumberTest`-Suite
grün (JDK 21). Java-Tests laufen in CI (Gradle). `schritt` ist Keyword
(Bereich-Konstruktor) → Parametername `vielfaches`.*

*Letzte Aktualisierung: 2026-05-27 — **Stdlib: vier neue Skalar-Methoden
(SPEC § 11.6) — Grenzwert & Rundung auf Vielfache.** `.höchstens(grenze)`
(Minimum, „höchstens jedoch …"), `.mindestens(grenze)` (Maximum,
„mindestens jedoch …" / Nicht-Negativ-Kappung mit `.mindestens(0,00)`),
`.abrundenAuf(vielfaches)` / `.aufrundenAuf(vielfaches)` (Rundung auf ein
Vielfaches, z. B. § 11 GewStG „volle 100 €"). Motivation: jedes Fachmodul
(gewst, kst, kraftst) baute diese Muster bislang als lokale Helfer nach
(`_Hoechstens`/`_Groesseres`/`_NichtNegativ`/`Begrenze`/`AbrundenAuf100`) —
die Politik „Builtins ergänzen, sobald reale Beispiele sie nachfragen" ist
erfüllt. **Semantik:** alle vier **typ-erhaltend** und **kontextfrei**
(kein `expected`-Walk wie § 11.1 — keine Einheit gewechselt); Argument
trägt den Empfängertyp (nacktes Literal promotet bidirektional); clamp =
`.mindestens(u).höchstens(o)`; `vielfaches > 0` (sonst Laufzeitfehler);
nicht-numerischer Empfänger → Fehler. **Implementierung (Sprachkern):**
Single-Dispatch wie die bestehenden Methoden — `scalarArgMethod` +
`SCALAR_ARG_METHODS` (`findsl-method-inference.ts`), Ketten-Walker-Zweig
(`findsl-inference.ts`, vor dem Text-Zweig für präzise Empfänger-Diagnose),
`SCALAR_METHOD_DEFS` (`findsl-stdlib.ts`, Completion/Hover), Interpreter
`scalarLimitValue`/`scalarRoundToMultipleValue` (`interpreter.ts`,
Euro-kanonisch, Tag bleibt). SPEC § 11.6 ergänzt. **Keine Grammatikänderung**
(Methodenaufruf-Syntax bestand) → Trias unberührt. TDD: 21 neue Tests in
`test/{language,interpret}/scalar-text-methods.test.ts`. **Bewusst offen:**
Codegen (`emit-java`/`emit-ts`/`emit-js` + Runtimes) und Umstellung der
Beispielmodule auf die neuen Methoden — getrennter Folgeschritt; `korpus-
stdlib.findsl` (Codegen-Gate) bleibt vorerst unberührt.*

*Letzte Aktualisierung: 2026-05-22 — **PAP-Generator: neues CLI-Subkommando
`papgen` (Programmablaufpläne aus FinDSL, DIN-66001-nah). PR #106 / Issue
#102.** FinDSL-Funktionen → Flussdiagramme; eine `fn` = ein Diagramm.
Architektur `packages/core/src/papgen/{model,mermaid,html}.ts` (Modell →
Emitter getrennt, wie docgen): `model.ts` läuft den AST ab und baut einen
emitter-neutralen `FlowGraph` (Knotenarten start/ende/abbruch/operation/
decision/case/subprogram/ausgabe/eingabe); `mermaid.ts` und `html.ts`
emittieren. **Zwei Ausgabeformate:** `-f mermaid` (Markdown, überall
renderbar) und `-f html` (**self-contained** — mermaid via esbuild
re-gebündelt und inline eingebettet, `scripts/gen-mermaid-asset.mjs` →
gitignored `mermaid-asset.generated.ts`; neue devDependency `mermaid`).
Die HTML rendert offline und liefert, was rohes Mermaid nicht kann:
klickbare Gesetzes-§-Links (`securityLevel:'loose'`, Tiefenlinks via
`docgen/quelle.ts`), **eigene Hover-Tooltips mit serverseitig gerendertem
KaTeX** (`docgen/math.ts`; Doc-Prosa + `@param` aus dem Doc-Kommentar),
Zoom (Buttons + ⌘·Strg+Mausrad, `useMaxWidth:false`), hervorgehobene
Titel, hell/dunkel-Tooltips (`prefers-color-scheme`). **Optionen:**
`--detail struktur|voll` (voll schreibt Aufruf-Argumente aus),
`--params symbole|inline` (Default symbole = DIN-Ein-/Ausgabe-Parallelo-
gramme → Start), `--theme default|neutral|dark|forest`, `--no-farben`,
`--ohne-intern` (nur öffentliche fn). Reine `prüfe`-Testdateien (0 fn)
erzeugen kein leeres Modul. **Design:** Monospace 13px, dezente
entsättigte Palette, geschwungene Kanten (`curve:basis`), zarte 1px-Ränder.
Im Headless-Browser (Playwright) verifiziert: Diagramme rendern, Tooltips/
Links/Zoom aktiv, kein Text-Clipping (Top-Level-`fontFamily` für korrekte
Breitenmessung). Vitest grün inkl. papgen-Suite (`test/papgen/{model,
mermaid,html}.test.ts`).*



*Letzte Aktualisierung: 2026-05-20 — **`examples/simple/` → `examples/korpus/`
umbenannt + Korpus auf SPEC-Vollabdeckung erweitert (Issue #43,
Folge zu Issue #44).** Verzeichnis `examples/simple/` →
`examples/korpus/`, alle Dateien `simple-X.findsl` → `korpus-X.findsl`
(11 Dateien). `simple.findsl` (Stub) gelöscht — seine § 11.1-Rundungs-
Demos sind in `korpus-stdlib.findsl` integriert (alle 6 Permutationen:
EuroCent → Euro/Cent, Dezimal → Ganzzahl, Prozent → Prozent). Neue
Cluster: `korpus-stdlib.findsl` (§ 11.1 Rundung + § 11.2 alle 12
Listen-Methoden + § 11.5 Text-`+`-Konkatenation), `korpus-schleifen.findsl`
(§ 5.3 `für jeden`/`für jede` über Liste + Bereich + geschachtelt +
Block-Lambda-Body, § 5.4 `ausgabe`-Anweisung). Integrationstest
`simple-corpus.test.ts` → `korpus.test.ts` (mindestens 10 Korpus-
Dateien, ≥10 Java-Generate, alle Imports auf `./korpus-*` aktualisiert).
Drei begleitende Codegen-Side-Fixes: (a) Text-`+`-Konkatenation im
Validator (`findsl-types.ts` `arithResult`) + Interpreter
(`interpreter.ts`) — der Codegen kannte sie schon (#54), Validator
und Interpreter nicht; (b) `Prozent.abrunden()`/`.aufrunden()` im
Java-Codegen-Lower (`lower.ts`): bisher fiel der Target ohne Geld-
Kontext auf `Ganzzahl` zurück, jetzt empfänger-typ-getrieben auf
`Prozent` (SPEC § 11.1: volle Prozent, Einheit bleibt). Verifikation:
112/112 prüfe-Items im Korpus grün, Vitest 1841/1841 (+3 zu vorher),
Gradle `check` BUILD SUCCESSFUL (10 Java-Module + 5 JUnit-
Testklassen bit-genau, structureTest grün), Formatter-Idempotenz
grün.*



*Letzte Aktualisierung: 2026-05-20 — **`examples/simple/`-Korpus auf
SPEC-Vollabdeckung reaktiviert (Issue #43, nach Abschluss Issue #44).**
Nach dem Schließen aller 14 Codegen-Lücken aus Issue #44 (17 PRs:
L1-L15 ausser implicitly-fixed L7+L13, plus Folge-Lücken Text-`+`,
`für jeden`, Block-Lambda, Aufzählungs-Bereich) wurden alle
TODO(#44)-Marker im simple-Korpus aufgelöst — der Korpus zeigt jetzt
die komplette SPEC § 2-§ 11-Breite (76 prüfe-Items grün via
Interpreter, 8 Java-Module + 3 JUnit-Testklassen bit-genau generiert,
Gradle `check` grün). Reaktiviert: `nichts`/Nullable-Defaults,
Boolean-/Elvis-`oder`, `?.`/`!!`, `als`-Cast, `wenn`, Lambda in HOF +
als var-Wert + Funktions-Typ als Rückgabe, `Range`-Literale, Text-
`konst`/Interpolation/Vergleich/Konkat, Default-Parameter,
Cross-Modul-Enum-Werte in Tests, alle 12 §-11.2-Listen-Methoden,
`für jeden`-Schleife, Aufzählungs-Bereich. Nebenbei: `Bereich<T>`-
Typ-Annotation auf `FinDslListe<T>` gemappt (`apiJavaType`/
`javaType`); `FinDslLambda1`/`FinDslLambda2` zur Runtime-Import-
Whitelist im Emitter; `GeneratedStructureTest.SPEAKING`-Set um
`FinDslLambda1`/`FinDslLambda2` erweitert.*



*Letzte Aktualisierung: 2026-05-20 — **Test-Abdeckungs-Korpus
`examples/simple/` Foundation (Issue #43, PR 1).** Drei thematische
Cluster (`simple-typen`, `simple-ausdruecke`, `simple-funktionen`)
mit 1:1-Begleit-`prüfe`-Tests decken die codegen-tauglichen SPEC-
Konstrukte (§ 2.7 numerische Literale, § 3 numerische Typen +
Aufzählung + Datensatz, § 4.2/4.3/4.4 Arithmetik/Vergleich/`und`-`nicht`,
§ 4.10 `wähle`-Guards, § 4.11 Funktionsaufruf, § 4.13–4.15 Feld/Datensatz/
Liste, § 4.17 Block, § 4.19 `abbruch`, § 6.1 `konst`, § 6.2 alle
`fn`-Formen, § 7.1 `@Quelle`, § 8.3 `verwende` Cross-Modul, § 10
`prüfe`/`testfall`/`erwartet abbruch`). Vitest-Integrationstest
(`packages/core/test/integration/simple-corpus.test.ts`) iteriert
dynamisch über `simple-*.findsl`, prüft Parse/Validation, Cross-Modul-
Topologie und Codegen-Determinismus. Beim Aufbau wurden 13 Codegen-
Lücken/-Bugs sichtbar (`Range`, `nichts`, `oder`, Lambda, `wenn`,
`!!`, `als` in Ketten, `.enthält`, Text-`konst`, Text-Vergleich,
String-Interpolation, Default-Param-Expansion, Cross-Modul-Enum-Werte
in Tests) — gesammelt in [Issue #44](https://github.com/findsl/findsl/issues/44);
PR 2 erweitert den Korpus auf SPEC-Vollständigkeit, sobald #44
geschlossen ist. Gradle-`check` und `npm test` bleiben grün.*

*2026-05-18 — **§ 11-Stdlib auf Empfänger-
Methoden umgestellt (Grundsatzentscheidung § 8c, kontextgetrieben).**
Freie Rundungsfunktionen `abrundenEuro/aufrundenEuro/abrundenCent/
aufrundenCent/abrunden/aufrunden` ersetzt durch Methoden `.abrunden()`/
`.aufrunden()` (SPEC § 11.1): nur auf `EuroCent` (Ziel `Euro`/`Cent`
aus dem Kontext — Annotation/`als`-Cast/fn-Rückgabetyp; kein Kontext →
statischer Fehler) oder `Dezimal` (→ `Ganzzahl`). § 11.5-Text-Methoden
(`.länge`/`.leer`/`.alsText`/`.einrückungEntfernen()`/`.alsGroß-/
Kleinbuchstaben()`/`.beginntMit/endetMit/enthält()`/`.geteiltAn()`)
implementiert (`.alsText(format=…)` bleibt v1.0-offen). **Grammatik-
Trias erweitert:** Postfix-Kette auf geklammertem Ausdruck
(`paren_expr ::= "(" expr ")" chain_op*`, neuer `ParenChain`-Knoten;
transparent ohne Kette) — `(satz * basis).abrunden()` ist jetzt
ausdrückbar (Kern-Tarifmuster); gemeinsamer Ketten-Walker für
`CallChain`+`ParenChain` in Type-Checker (`walkChain`) und Interpreter
(`evalChainOps`). Kontextgetriebene Zielauflösung: Type-Checker via
bidirektionalem `expected` (inkl. `als`-Cast als Kontextquelle 2);
Interpreter type-checker-unabhängig via lokalem AST-Kontext-Walk
(`governingMoneyTarget`), **tag-agnostisch** = wertgleich zur früheren
freien Form (Laufzeit-Tag ≠ statischer Typ z. B. leere `.summe()` → D1
`Ganzzahl` kippt nicht). Freie Funktionen **hart entfernt** (kein
Doppel-Mechanismus). Alle 17 `.findsl`-Quellstellen + Fixtures/Prosa
(README/GESETZ/`.test`-Kommentare) migriert. **Nachtrag (Nutzer):
`.abrunden()`/`.aufrunden()` zusätzlich auf `Prozent` zulässig → volle
`Prozent`, Einheit bleibt, kontextfrei (analog `EuroCent→Euro`;
`42,7%.abrunden()` → `42 %`); zulässige Empfänger nun EuroCent/Dezimal/
Prozent.** **836 vitest grün, 56 Dateien, Aggregat 122/122 (kst 23 ·
kraftst 34 · gewst 43 · est 22), Bundle-Smoke 7/7, tsc/`langium:generate`
sauber, Beispiele parsen clean.** Davor (ebenfalls 2026-05-18):
**Mathematische Notation in
Doku-Kommentaren (Issue #6)**. `$…$`/`$$…$$` in `--…--`-Doc-Prosa,
`@param`/`@rückgabe`, §-4.15-Feldtexten (SPEC § 9.5, normativ). Eine
gemeinsame Schicht `docgen/math.ts`: KaTeX server-seitig für HTML
(CSS+woff2-Fonts via `scripts/gen-katex-css.mjs` →
`docgen/katex-assets.ts` ins THEME inlined → self-contained), MathJax
tex→SVG (liteAdaptor, lazy, `fontCache:'none'` + stabile IDs) für
PDF-**Block**-Mathe als `{svg}`-Vektorknoten; PDF-**Inline** als
TeX-Code-Fallback (pdfmake platziert kein SVG im Textfluss — bewusste
Werkzeug-Grenze). Markdown unverändert kanonisch. Schutz vor
§-Linkify via `quelle.ts PROTECT_RE`; `model.ts parseDocTags`
behandelt mehrzeilige `$$` wie Fences. **Keine Grammatik-/Trias-
Änderung** (`DOC_COMMENT` opak; `$`≠`${…}`). Back-Compat verifiziert:
`kst/kraftst/gewst` MD byte-identisch, PDF inhaltsgleich, HTML-Content
unverändert (nur KaTeX-`<style>` ergänzt). `est` trägt jetzt eine
Demo-Formel. Teststand **793 grün** (55 Dateien, +15 Math), Bundle-
Smoke 4/4 (esbuild bündelt katex+mathjax-full). Hinweis: Sandbox-Node
18 kann das Projekt nicht ausführen — lokal mit Node 22 verifiziert
(CI nutzt ohnehin Node 22). Davor: **`est` mit den neuen Listen-
Konstrukten erweitert: § 32 Abs. 6 / § 33 / § 10b mehr-entitätig**.
Nach dem Interpreter-Ausbau überprüft, welche `est`-Skalar-Eingaben nur
*Tooling-Kompromiss* waren (vs. echtes „anderes Recht/Verfahren").
Echt modelliert (estg.xml-verbatim, VZ 2026): **§ 32 Abs. 6**
Kinderfreibetrag (3.414) + BEA (1.464) je `Liste<Kind>` via
`zuordnen`/`summe` (Faktor Satz 2/3, Zwölftel Satz 5, Auslandsfaktor
Satz 4); **§ 33 Abs. 1/3** außergewöhnliche Belastungen mit
**staffelweiser** zumutbarer Belastung (Stufen 15.340/51.130 × vier
Personengruppen-Sätze, `_Spanne`-Helfer); **§ 10b** Spenden ≤
max(20 % GdE; 4 ‰ Umsätze+Löhne). Bleibt Eingabe (anderes Recht/
Verfahren, NICHT Tooling): Einkunftsarten-Ermittlung, § 24a/§ 24b/
§ 13 Abs. 3, Vorsorge-SA, § 10d (mehrperiodig), § 2-Abs.-6-Komponenten,
Sachverhalte je Kind. **Statut-stille Rundung dokumentiert:**
Kategorie-Abzüge `abrundenEuro` (konsistent § 32a Satz 1,
fiskuskonservativ). Sollwerte handgerechnet aus dem Wortlaut
(Python-Referenz), Interpreter = Arbiter. Datei-Doc trennt jetzt
ehrlich „modelliert (auch mehr-entitätig)" ⇄ „Eingabe weil anderes
Recht". Pitfall verifiziert: `bis` ist Range-Keyword → kein
Parametername (`obereGrenze`); `EuroCent`-Zwischenwerte vor
`Euro`-Helfern via `abrundenEuro` (gleicher Sollwert: floor positiv =
floor; negativ → 0). est.test.findsl Fall K/S/L/0 (Listen statt
Skalare; „0" = leere Listen ≙ alte Kaskade = Regressionsanker).
**778 Tests grün** (unverändert; est weiterhin 22, `pruefe.test.ts`
nicht betroffen), Aggregat 122/122, Bundle 4/4, GESETZ §8 + Datei-Doc
nachgezogen; keine Grammatik-/Interpreter-/Type-Checker-Änderung
(reine Beispielarbeit auf dem neuen Sprachstand). Davor:
**Interpreter-Skelett-Ausbau:
Listen/Bereich/`für jeden`/parametrische Lambdas+Closures/§-11.2-
Methoden ausführbar (Sprachkern, 5 Phasen, TDD)**. Hintergrund:
Frage „warum ist die vollständige ESt nicht abbildbar?" — Befund: die
Konstrukte waren in SPEC/Grammatik/AST vollständig spezifiziert, nur
Interpreter+Type-Checker+Stdlib waren bewusste Skelett-Lücken. Behoben:
**P1** `ListValue` (values.ts; `FunctionValue` deckt Closures, Bereich
materialisiert → keine neue Klasse). **P2** Interpreter-Eval:
parametrisches Lambda→Closure (lexikalischer Capture, `FunctionValue.lambda`),
`ListLiteral`, numerischer `Range` (materialisiert; `bis`/`bis unter`/
`schritt`; Schritt≤0 wirft), `für jeden` (eager L→R, ≡ `.zuordnen`,
verschachtelt → `Liste<Liste>`), Index `[i]`; `runBlock`-Helfer.
**P3** Type-Checker: `Bereich<T>`≙`ListType`, Inferenz für ListLiteral
(joinBranches-LUB)/Range/`für jeden`/param-Lambda, bidirektionale
Lambda-Param-Bindung gegen `(T…)->R`, `inferCallChain` Index +
Listen-Methoden-**Spezialfall-Substitution** (kein General-Generics).
**P4** Stdlib: alle 12 §-11.2-Methoden ausführbar (Property direkt;
Aufruf-Methoden als `BuiltinValue` über bestehenden `applyCall`-Pfad;
`callClosure`/`applyValueFn` — Lambdas UND benannte Fn als Argument).
**Entscheidungen:** D1 leere `.summe()`→0 / leere `.kopf`/`.größtes`/
`.kleinstes`→`InterpretError`; D2 Index/leer-Fehler = Bug-Klasse (kein
`abbruch`); D3 Bereich materialisiert; D4 `für jeden` eager L→R.
**Bewusst offen:** Aufzählungs-Bereiche `I bis VI` (klare Fehlermeldung).
**P5 Capability-Nachweis:** mehr-entitätiges Modul (`Liste<Kind>` →
`.zuordnen`/`.summe`/`für jeden`/`.filtern`) Type-Checker-clean **und**
`pruefe`-grün über vitest **und** echte `findsl test`-CLI (2/2).
**GESETZ-ZU-FINDSL.md §3.3-Regel umgekehrt** („keine Listen/Schleifen"
→ Mehr-Entitäten SIND zu modellieren); CLAUDE §5/Roadmap nachgezogen.
**Keine Grammatik-/SPEC-/EBNF-Änderung** (Trias war synchron → kein
`langium:generate`, kein Drei-Artefakt-Sync). **775 Tests grün**
(Baseline 707 → +68 TDD: values/listen-iteration/listen-typen/
listen-capability), Bundle-Smoke 4/4, alle `pruefe`-Beispiele
(kst/kraftst/gewst/est) unverändert grün, 0 Regression. Davor:
**Neues Beispielmodul `est` —
Einkommensteuer: Veranlagungskaskade § 2 EStG + Tarif § 32a (VZ 2026)**:
via `GESETZ-ZU-FINDSL.md` aus `examples/est/estg.xml` (juris-Stand
2026-05-06, konsolidiert) generiert. Stufen-Funktionen
`SummeDerEinkuenfte` (§ 2 Abs. 1–3) → `GesamtbetragDerEinkuenfte`
(Abs. 3) → `Einkommen` (Abs. 4) → `ZuVersteuerndesEinkommen` (Abs. 5)
→ `TariflicheEinkommensteuer` (§ 32a: 5-Zonen-`wähle`-Grundtarif +
Splitting Abs. 5) → `FestzusetzendeEinkommensteuer` (§ 2 Abs. 6 =
tariflich − Anrechnungen/Ermäßigungen + Hinzurechnungen);
`BerechneEinkommensteuer`-Orchestrator füllt `EinkommensteuerErgebnis`
(jede Zwischengröße). `EinkommensteuerFall` (17 Felder) — alle
Detailermittlungen (7 Einkunftsarten, § 24a/§ 24b/§ 13 Abs. 3, SA
§§ 10–10c, agB §§ 33–33b, § 32 Abs. 6, § 2-Abs.-6-Komponenten)
**konsequent als geprüfte Eingaben** (Leitfaden §1.3); **eingebaute**
`Tarifart` (SPEC § 8.5, kein Import — eigene `aufzählung` verworfen);
`_NichtNegativ`-Helfer ⇒ negatives zvE → 0 (kein `abbruch` im
Orchestrator; § 10d-Verlustabzug = Verfahren, nicht modelliert), die
skalaren Tarifkern-`fn` (`EstGrundtarif`/`EstSplitting`) behalten ihren
strikten `abbruch`. Sollwerte (Tarif **und** Kaskade) **handgerechnet
aus dem Wortlaut** (Decimal, Floor = § 32a Satz 6), nicht aus dem
gelöschten `tarif2025`. **Fassungs-Befund (Leitfaden §1.3 „Fassung
wählen"):** estg.xml trägt § 32a nur in der VZ-2026-Fassung
(GFB 12.348), **keine** VZ-2025-Werte (auch § 52 nicht) → bewusst
VZ 2026; Datei-Doc benennt Fassung/Quelle/Stand und grenzt sämtliche
nicht modellierten §§ explizit ab. `est.test.findsl` 22/22
(Tarif-Knotenpunkte je Zone ±1, Splitting, `erwartet abbruch`,
Kaskade Fall A/B/C/D inkl. Verlust→0 + zvE=GFB). `pruefe.test.ts`
EXAMPLE_SUITES (est 22), GESETZ §8, CLAUDE §5/Strukturbaum/Fußzeile
nachgezogen. **707 Tests grün**, Bundle 4/4, Aggregat
`test 'examples/**/*.test.findsl'` **122/122** (kst 23 · kraftst 34 ·
gewst 43 · est 22); parse 0 Diagnosen. Keine Sprachänderung
(Drei-Artefakt-Sync unberührt). Davor:
**Formatter: Aufruf mit
benannten Argumenten → Zwei-Spalten** (analog datensatz; Nutzer-Fall
`GewerbesteuerErgebnis(…)`): mehrzeiliger `Call` bekommt das idempotente
datensatz-Multiline-Block-Rezept (`interior`+`properties('args')`
indent, Komma `noSpace`, `)` eigene Zeile) plus `=`-Spalten-Ausrichtung
je `CallArg` — Polsterung `spaces(maxNameLen − nameLen + 1)` vor
`keyword('=', 0)` (Index 0 = Arg-Separator; ein `=` in einem
verschachtelten benannten Aufruf gehört zu DESSEN CallArg und bleibt
unberührt — per Test verifiziert). Einzeilige/positionale Aufrufe
unangetastet (wie fn-Params — Trailing-Komma-Oszillation vermeiden);
einzeilig benannt → kanonisch `name = wert`. `pad` aus AST-Namens-
längen ⇒ idempotent; alle 17 Beispiele idempotent/tab-frei/valide
(KStG/GewStG/KraftStG-Ergebnis-Konstruktoren). Neue Helfer
`callIstMehrzeilig`; `isCall`/`isCallArg`. TDD `formatter.test.ts`
+4 (Nutzer-Fall, einzeilig kompakt, positional, verschachtelt-
inneres-`=`-unberührt). **704 Tests grün** (51 Dateien), tsc/Bundle
4/4. Beispieldateien auf Platte unverändert. Davor: **Formatter:
`wähle`-Arm-RHS-
Ketten brechen jetzt auch bei > 120** (Nutzer-Fall
`VerlustVerrechnungsobergrenze10a`): vorher nur `fn`/`konst`/`var`-
Rumpf, Arm-RHS war ausgeklammert (Quell-Spalte oszillierte). Fix:
Arm-RHS-Startspalte DETERMINISTISCH `indentDepth(arm)·4 + maxArmLinke
+ 4` (= exakt die `->`-Ausrichtungs-Geometrie; neuer `indentDepth`
zählt umschließende `wähle`/`BlockExpr`/`Lambda`/`prüfe`-Scopes —
struktur-, nicht quell-abgeleitet) in `declPrefixWidth`. Damit
idempotent (gewerbesteuer.findsl, das vorher oszillierte, jetzt stabil
+ `sonst`-Kette korrekt umgebrochen). Reststand: nur noch 2 Zeilen
> 120 = unzerlegbare String-Literale `abbruch("§ … Begründung")`
(ein Token, Wert unveränderbar — kein Formatter bricht Strings). Alle
17 Beispiele idempotent/tab-frei/valide; `->`-Ausrichtung +
4-Hang-Umbruch koexistieren. Pitfall (b3) erweitert. TDD
`formatter.test.ts` +2 (Nutzer-Fall + kurze Arm-Kette einzeilig).
**700 Tests grün** (51 Dateien), tsc/Bundle 4/4. Beispieldateien auf
Platte unverändert. Davor: **Formatter: Operator-Ketten-
Umbruch + 120-Spalten**: `BinaryOp`-Lücke nicht mehr hart `oneSpace`
(zerstörte hand-mehrzeilige `+`-Ketten) — stattdessen: bei `fn`/`konst`/
`var`-Rumpfkette, deren **strukturell** (aus Namen/Typen, alignment-
frei) berechnete Prefix-Breite + flache Kettenbreite > 120, Umbruch
**vor jedem Operator** mit 4-Hang (`Formatting.indent()`); sonst
`fit(oneSpace, indent())` — bewahrt vom Autor gesetzte Umbrüche
idempotent (gleiche Mechanik wie der Program-Leerzeilen-Separator),
kollabiert nie. Erst war die Breite spalten-basiert (`cst.range.start.
character`) → `gewerbesteuer.findsl` oszillierte (Pfeil-Polsterung
eines `sonst`-Arms verschob pass2 die Spalte); Fix: nur fn/konst/var-
Kontext + strukturelle Prefix-Breite (`declPrefixWidth`/`typeStr`,
keine Quell-Spalte), Arm-RHS/verschachtelt nur `fit` (kein Auto-Break)
→ alle 17 Beispiele idempotent/tab-frei/valide. Rest >120 (3 Zeilen):
2× nicht umbrechbare String-Literale `abbruch("…")`, 1× `sonst`-Arm-
`+`-Kette (bewusst nicht auto-umgebrochen — Idempotenz vor 120).
Pitfall (b3) ergänzt (Breiten-Maß muss formatierungs-invariant sein).
TDD `formatter.test.ts` +4 (>120-Umbruch, ≤120-Erhalt mehrzeilig,
≤120-einzeilig, langer `konst`). **698 Tests grün** (51 Dateien),
tsc/Bundle 4/4. Beispieldateien auf Platte unverändert. Davor:
**Formatter: `wähle` Zwei-Spalten-
Layout** (analog datensatz/`@param`): in `wähle`-Blöcken wird die Arm-
Linke (`falls …`/`sonst`) linksbündig gesetzt und alle `->` auf eine
Spalte gerückt (Breite = längste Arm-Linke + 1; längster Arm bekommt
genau ein Space). Umsetzung in `isFallArm`/`isSonstArm`:
`f.keyword('->', 0).prepend(Formatting.spaces(pad))` — Index 0 trifft
gezielt das **Separator-`->`** (ein `->` im Ergebnis-Lambda/
Funktionstyp bleibt unberührt); `arrowPad(arm)` = `max(armLinkeBreite)
− armLinkeBreite(arm) + 1` über `node.$container`-Geschwister;
`armLinkeBreite` = Arm-CST-Text bis zum ersten `->`, Whitespace zu
einem Space kollabiert (= kanonische Breite ⇒ idempotent). `sonst`-
`append`-Regel entfernt (benachbart zu `->` → Lücken-Konflikt; nur
`->`-prepend bedient sie). Empirisch auf allen 17 Beispielen
idempotent/tab-frei/valide (KraftStG/GewStG = viele mehrarmige
`wähle`). 3 bestehende Tests aufs neue Layout aktualisiert (alt:
1 Space vor `->`), TDD `formatter.test.ts` +3 (Nutzer-Fall, Mehrfach-
Pattern, Block-Arm-Sicherheit). CLAUDE Formatter-Zeile + Pitfall (b2)
ergänzt. **694 Tests grün** (51 Dateien), tsc/Bundle 4/4.
Beispieldateien auf Platte unverändert. Davor: **Formatter:
`@param`/`@rückgabe`
Zwei-Spalten-Layout** (analog datensatz): Doc-Kommentar-Tags werden
ausgerichtet — erste Spalte = längste Marke (`@param <name>` bzw.
`@rückgabe`) + 1 Space, Beschreibungen fluchten, eingerückte
Fortsetzungszeilen hängen unter der Beschreibungsspalte. Umsetzung:
**Doc-Kommentare sind ein `DOC_COMMENT`-Terminal** → Langiums
`Formatting`-API kann Token-INHALT NICHT umformen; daher reine Funktion
`alignDocTags(text)` (exportiert, testbar) + Erweiterung des
`doDocumentFormat`-Override: nach den Gap-Edits zusätzliche Replace-
Edits für die Doc-Token-Range jedes `DeclPrefix`/`fileDoc`
(`GrammarUtils.findNodeForProperty(prefix.$cstNode,'doc')`), nur bei
Änderung, mit Range-Containment- + Overlap-Schutz (`rangesOverlap`/
`rangeContains`). Prosa/Überschriften/Leerzeilen/```-Codeblöcke/`--`-
Marker byte-genau; Fence-Parität mit `parseDocTags`. Spaltenbreite rein
aus Markennamen ⇒ idempotent; empirisch auf allen 17 Beispielen
(idempotent, tab-frei, formatiert sev1=0; inkl. `simple.findsl` mit
vielen `@param`/`@rückgabe` + Fortsetzungen). TDD `formatter.test.ts`
+5 (alignDocTags-Spalten, Fortsetzung/Idempotenz, Prosa/Fence-Schutz,
Kein-Tag-No-op, Formatter-Integration); veralteter Test-Datei-Kopf
(„§ 4.15 … NICHT angetastet") korrigiert. **691 Tests grün** (51
Dateien), tsc/Bundle 4/4. Beispieldateien auf Platte unverändert. Davor:
**Formatter: `datensatz` Zwei-
Spalten-Layout**: mehrzeilige Feldlisten werden ausgerichtet — Feldname
+ `:` linksbündig, alle Typen auf einer Spalte (Breite = längster
Feldname + 1 Space). Umsetzung in der `isField`-Regel:
`spaces(maxNameLen − nameLen + 1)` nach `:` (Geschwister via
`node.$container` = `DatensatzDecl`, nur mehrzeilig); Funktionsparameter
& einzeilige `datensatz` unverändert (ein Space). **Ehem. § 4.15-Schutz
aufgehoben**: auch Feldlisten MIT Trailing-`//` werden jetzt
ausgerichtet — der `,`→`//`-Abstand bleibt unangetastet (Hidden-Token,
keine Regel), nur die Name/Typ-Spalte normalisiert. AST-abgeleitete
Polsterung ⇒ idempotent; empirisch auf allen 17 Beispielen verifiziert
(idempotent, tab-frei, formatiert sev1=0). SPEC/CLAUDE § 4.15 +
Pitfall (d) + Formatter-Zeile angepasst. TDD `formatter.test.ts` +5
(Spalten-Layout, Trailing-//-Idempotenz, Einzeiler kompakt, Parameter
nicht ausgerichtet; bestehender Invarianten-Test auf neues Layout
aktualisiert). **686 Tests grün** (51 Dateien), tsc/Bundle 4/4.
Beispieldateien auf Platte unverändert (nur In-Memory verifiziert) →
pruefe unberührt. Davor: **Formatter: 4-Blank-Zwang +
`verwende`-Block**: (1) Override `doDocumentFormat` (Single-Chokepoint
aller Entry-Points Document/Range/OnType) erzwingt `insertSpaces:true,
tabSize:4` unabhängig von Client-`FormattingOptions` → Tabs werden
projektweit zu 4 Blanks (alle strukturellen Einrückungen neu
emittiert). (2) Neue `ImportDecl`-Regel: `verwende`-Block IMMER
mehrzeilig — jeder Import auf eigener, um 4 eingerückter Zeile, `}` auf
eigener Zeile, dann ` aus "…"`; Rezept exakt wie datensatz-Multiline
(`interior`+`properties('items')` indent, Komma klebt am Item ohne
Append → keine Trenn-/Trailing-Komma-Oszillation). `ImportItem`:
`als`-Spacing. Idempotenz empirisch auf allen 17 Beispielen verifiziert
(auch bei Client-Wunsch Tabs/Größe 2 → Ausgabe tab-frei, 4 Blanks).
Beispieldateien auf Platte unverändert (nur In-Memory geprüft) →
pruefe unberührt. TDD `formatter.test.ts` +6 (verwende ·4, Einzel-
Import, Idempotenz, Validität, Tab→Blank-Zwang, vorhandene Tabs
konvertiert). **682 Tests grün** (51 Dateien), tsc/Bundle 4/4. Davor:
**`_`-Interne visuell markiert
(Editor + Outline)**: SemanticTokens-Provider bekommt Custom-Modifier
`internal` (Override `get tokenModifiers()` → `{…AllSemanticToken
Modifiers, internal: 1<<10}`; Langium baut Legende+Encoding aus dieser
Map → konsistent), gesetzt an Deklaration UND Referenzen modul-interner
`_`-Top-Level-Decls (`konst`/`fn`/`datensatz`/`aufzählung`, via
`withIntern` + `isInternalName`; klassifiziert in `classifyName`/
`classifyType`). Default-Stil **kursiv** via `package.json
contributes.configurationDefaults` (`editor.semanticTokenColor
Customizations` → `*.internal`, out-of-the-box sichtbar, themen-/
benutzerüberschreibbar; bewusst KEIN `deprecated`-Tag — Durchstreichung
wäre im Audit-Kontext irreführend). DocumentSymbol setzt `🔒 intern · `
als **Präfix** ins `detail` (VS Code rendert detail direkt hinter dem
Namen — Suffix wäre am Ende langer Signaturen abgeschnitten/unsichtbar;
Korrektur nach Nutzer-Rückmeldung „in Outline keine Markierung";
Outline/Breadcrumbs/Sticky-Scroll, zuverlässig themenunabhängig;
`internPrefix`). Reine LSP-Darstellung — Sprachverhalten unberührt
(pruefe 126/126, parse sauber). TDD
`test/language/intern-visual.test.ts` (5). **676 Tests grün** (51
Dateien), Bundle 4/4. Davor: **Beispiele: 20 echte Helfer als
`_`-intern markiert**: konservatives Kriterium (generische/arithmetische
Zerlegungs-Helfer, NICHT cross-file konsumiert, NICHT im `.test`-
`verwende`, KEIN Domänenmodell/§-Konstanten/materielle Gesetzes-
Rechenschritte). Markiert: GewStG `_NichtNegativ/_Hoechstens/
_Groesseres` (3); KStG `_BegrenzterFreibetrag24` (1); kraftstg-tarif-
leicht `_Co2AufschlagNr2c/_PkwHubraumSockel/_SteuerPkwC/_SteuerPkwB/
_SteuerPkwA/_SatzPkwA/_SteuerWohnmobilSonst/_WomoZweiStufen/
_SatzDreiLeichtvier` (9); kraftstg-tarif-nutzfahrzeug `_Nr4a/_Nr4d/
_Nr4b/_Nr4c` (4); kraftstg-steuer `_Anwende9Abs2/_AnwendeVerguenstigung`
(2); berechnung2025 `_MindestensPauschbetrag` (1). Per-Datei whole-word
Rename (in-file-Aufrufe mitgezogen, keine `.test`/Cross-Datei-
Anpassung nötig — Import-Graph vorab erhoben). BEWUSST öffentlich
belassen: alle `datensatz`/`aufzählung`, §-`konst`, der §2-EStG-
Rechenkette (`SummeDerEinkünfte`/`GesamtbetragDerEinkünfte`/
`Einkommen`/`ZuVersteuerndesEinkommen`/`FestzusetzendeEinkommensteuer`),
`EstSplitting`, alle `Berechne…`-Orchestratoren, getestete §-Schritte,
`Einheiten`/`Begrenze` (cross-file konsumiert); `simple.findsl`
unangetastet (didaktisch). Verhalten unverändert (reines Rename:
**pruefe 126/126**, parse 9/9 sauber); Doku-Decl-Zähler exakt −20
(KStG 23→22, KraftStG 207→192, GewStG 54→51, ESt 60→59), Interne aus
MD/HTML/PDF verschwunden, Orchestratoren drin. **671 Tests grün** (50
Dateien), Bundle 4/4; alle 5 Dokus nach `out/` neu. Davor:
**`_`-intern-Sichtbarkeit
(SPEC § 8.4, verschärft P7)**: Top-Level-Decl (`fn`/`konst`/`datensatz`/
`aufzählung`) mit führendem `_` ist modul-intern — **nicht cross-file
`verwende`-importierbar** (Fehler `findsl.import-intern`,
`checkInternalImports` vor `checkImportTargetsExist`), **nicht in der
Doku** (`model.ts` filtert `isInternalName`; abbruch-Anhang bleibt =
Audit). Ausnahme: `<basis>.test.findsl` darf Interna ihrer zugehörigen
`<basis>.findsl` importieren (Test→fremd bleibt gesperrt). Eine Quelle
`import-path.ts` (`isInternalName`/`mayImportInternal`/
`associatedSourcePath`), geteilt von Validator + Import-Completion;
Doc-Gen filtert hart. Geltungsbereich = ALLE Top-Level-Decls,
Test-Ausnahme = ja, Doku = komplett weglassen (Nutzer-Entscheidungen).
Grammatik-Trias-Kommentare + SPEC § 8.4/P7 + § 4.16 synchron; rein
namensbasiert (kein Token). Bestehende Beispiele nutzen kein
`_`-Top-Level → **nicht-breaking**. TDD `test/language/
intern-sichtbarkeit.test.ts` (7). **671 Tests grün** (50 Dateien),
Bundle-Smoke 4/4, parse 9/9 sauber, pruefe 126/126. Davor:
**Doku-Ausgabe-Konvention
`out/`**: generierte Dokumentation liegt je Gesetz im
`examples/<Gesetz>/out/`-Unterverzeichnis (`out/<slug>-doku.{md,html,
pdf}`); die kuratierte `<slug>-doku.kopf.md` (Input) bleibt außerhalb
`out/`. CLI legt das Zielverzeichnis selbst an
(`fs.mkdir(path.dirname(base),{recursive:true})` in `cli/main.ts` —
`-o <dir>/out/<name>` ohne Vor-`mkdir`). Alte, direkt im Gesetz-
Verzeichnis liegende `*-doku.{md,html,pdf}` entfernt; alle 5 Dokus
(KStG/KraftStG/GewStG/ESt/Lohnsteuer) nach `out/` neu mit `--kopf`.
CLAUDE.md § 5 Doc-Generator-Zeile dokumentiert die Konvention. Davor:
**Kanonische Dateiendung
`.findsl` (statt `.fin`)**: harter Wechsel, kein `.fin`-Alias.
`langium-config.json fileExtensions` + `package.json
contributes.languages.extensions` → `.findsl`; `langium:generate`
regeneriert `generated/module.ts` + TextMate. Auflöser/Scanner auf
`.findsl` (`import-path.ts resolveImportPath`/`isTestFile`/`displayId`,
`docs/model.ts findFinFiles`, Modul-Loader, DocumentLink,
WorkspaceSymbols, Extension-Glob, CLI). Alle 17 Beispiel-Dateien
physisch umbenannt (`*.fin`→`*.findsl`, inkl. `<basis>.test.findsl`-
Konvention § 4.9); `verwende … aus "./x"`-Strings unverändert (ohne
Endung — nur der angehängte Suffix im Resolver). Grammatik-Trias-
Kommentare (findsl.langium/findsl.ebnf/SPEC) + Test-Fixtures (URIs/
Literale) + Doc-Generator + `.kopf.md`-Prosa migriert; alle Dokus
neu. **664 Tests grün** (49 Dateien), Bundle-Smoke 4/4, parse 9/9
sauber, pruefe 126/126 (simple 2 · KraftStG 34 · GewStG 43 · KStG 23
· freibetraege 6 · tarif 9 · berechnung 9). Davor: **Harte
Großschreibungs-Regel
(SPEC § 2.5)**: Funktionen/Datensätze/Aufzählungen/Enum-Werte MÜSSEN
mit Großbuchstaben beginnen (`^_*\p{Lu}`; Builtins ausgenommen;
`var`/Param/Feld bleiben lowerCamel) — Validator-Fehler
`findsl.name-grossschreibung` (Vorbild `checkKonstNameUppercase`,
kein Lexer-Eingriff). ALLE `fn` in Beispielen (80, inkl. GewStG) +
Test-Fixtures auf UpperCamel migriert; 2 Kollisionen distinkt gelöst
(`tabellenFreibetraege`→`BerechneTabellenFreibetraege`,
`womoSonst`→`SteuerWohnmobilSonst`); Datensatz/Enum waren bereits groß.
SPEC § 2.5 + Grammatik-Trias-Kommentare + CLAUDE.md § 11. **661 Tests
grün** (49 Dateien, +9 Großschreibungs-Tests), Bundle-Smoke 4/4,
pruefe tarif 9/9 · freibetraege 6/6 · berechnung 9/9 · simple 2/2 ·
KStG 23/23 · KraftStG 34/34 · GewStG 43/43; Dokus neu. Davor:
**Konfigurierbare Doku-Titelseite/
Einleitung**: neues `src/docs/kopf.ts` (Front-Matter-Datei via CLI
`doku … --kopf <datei>`: `name/titel/untertitel/autor/beschreibung/
lizenz/metadaten` + Markdown-Einleitung; unbekannte Schlüssel →
Metadaten). Fehlt `--kopf`, werden **Titel/Untertitel aus dem ersten
Modul abgeleitet** (erste Überschrift/erster Satz des Datei-Doc-Blocks,
markdown-bereinigt) — der hartkodierte „FinDSL-Dokumentation" +
Sprach-Untertitel greift nur noch im Kein-Kopf-Direktaufruf
(byte-identisch, Rückwärtskompatibilität). MD/HTML/PDF teilen einen
`DocKopf`; CLI reicht ihn an alle drei Renderer durch. +12 Tests,
**661 Tests grün** (49 Dateien), keine Regression. Davor
**KraftStG-Modul aufgeteilt + einheitliches `kraftstg-`-Präfix**: die
1191-Zeilen-Datei (vormals
`kraftfahrzeugsteuer.findsl`) in 4 kohäsive Dateien zerlegt und alle
generierten Dateien auf das Präfix `kraftstg-` vereinheitlicht:
`kraftstg-typen.findsl` (Aufzählungen/Datensätze/Helfer) ·
`kraftstg-tarif-leicht.findsl` (§ 9 Abs. 1 Nr. 1/2/2a/2b Konst.+Fn.) ·
`kraftstg-tarif-nutzfahrzeug.findsl` (Nr. 3/4/5) · `kraftstg-steuer.findsl`
(öffentl. Orchestrator + § 9 Abs. 4) · `kraftstg-steuer.test.findsl` ·
`kraftstg-doku.{md,html,pdf}` (nur die Law-Quelle `KraftStG_2002.xml`
bleibt unpräfixiert); azyklischer Modul-Graph (typen ← tarif-* ←
orchestrator), Konstanten beim zugehörigen Tarif (minimale
`verwende`-Importe, keine Wildcards/Re-Exports). Beispiel für
Modul-Dekomposition. `.test.findsl` quelldatei-gruppiert; 34/34
unverändert, 639 Tests grün, alle 5 KraftStG-Dateien diagnosefrei.
Davor **GewStG-Modul** (`examples/gewst/`,
Gewerbesteuer §§ 7–11/16: § 8-Hinzurechnungen inkl. ¼-über-200.000-€-
Formel mit a–f-Gewichtung, § 9-Kürzungen inkl. Spenden-Höchstbetrag
max(20 %; 4 ‰), § 10a-Mindestbesteuerung 1 Mio. + 60 %, § 11-Abrundung/
Freibetrag/Messzahl, § 16-Mindesthebesatz; EZ-<2025-`abbruch`; 43/43
`pruefe`, Datei + separate `.test.findsl`) samt neuer KI-Agenten-Anleitung
**`GESETZ-ZU-FINDSL.md`** (seit 2026-05-29 im Skill `skills/findsl-author/`
+ `CONTRIBUTING.md` aufgegangen; vollständiger,
schrittweiser Leitfaden Gesetz-XML/PDF → `.findsl` + Tests; in § 2 und § 10
referenziert). **639 Tests grün**, Bundle-Smoke 4/4; `pruefe`-Stand:
ESt 9/9/6/2, KStG 23/23, KraftStG 34/34, GewStG 43/43. Davor
**§-Prosa-Verlinkung**: `quelle.ts`
`linkifyQuelleProsa` verlinkt §-Refs in ALLER Doc-Prosa automatisch
(Doku-Generator MD/HTML/PDF + Editor-DocumentLink), gleiche Quelle wie
@Quelle; **`GESETZ_PFAD`-Slug-Fix** (`KStG → kstg_1977`, `KraftStG`
ergänzt, live verifiziert). Davor **KraftStG-2002-Modul** (voller
§ 9-Tarif: Nr. 1–5 inkl. progressiver Gewichts-/CO₂-Bänder & Caps,
§ 9 Abs. 2/3/4, § 3a, § 3d; `examples/kraftst/`, 34/34 Tests)
samt **Stdlib-Erweiterung** `aufrunden`/`abrunden(Dezimal): Ganzzahl`
(builtins.json + Interpreter + SPEC § 11; § 8c-Teilentscheidung); davor
**KStG-Modul** (§§ 7/23/24, 23/23). 639 Tests grün, Bundle-Smoke 4/4.
Zuvor: **Langium 3.3 → 4.2.4 migriert**
(chevrotain 12, TypeScript 5.9; nur `findsl-hover.ts` angepasst —
`getHoverContent` async, `getAstNodeHoverContent` → string).
Außerdem **Geldmodell-Fix**: Typannotationen
setzen die Geld-Einheit (`var y: Cent = 20` → 20 ct; § 7), Euro/Cent-
Ganzzahligkeit auch bei berechneten Werten erzwungen; alle vier
Rundungs-Builtins (`ab/aufrundenEuro/Cent`) im Interpreter implementiert.
Davor: Sprache (`abbruch`/`never`/
`ausgabe`), **deutsche Zahl-Notation**, Type-Checker, Interpreter
(Euro-kanonisches Geldmodell), CLI `pruefe`, vollständige LSP-Provider-
Suite, VS-Code Test-Controller, Bundle-Smoke-Gate, **Doc-Generator
Phase 1** (CLI `doku` → MD/HTML/PDF). **639 Tests grün**,
Bundle-Smoke 4/4; `pruefe` der Beispiele: einkommensteuer 9/6/9/2,
KStG 23/23, KraftStG 34/34.
Offen: Codegen (Java/TS/JS) und optionaler Starlight-Export (s. § 8).*
