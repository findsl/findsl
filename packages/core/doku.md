# FinDSL-Dokumentation

## Inhalt

- [Modul einkommensteuer/simple](#modul-einkommensteuer-simple)
  - Konstanten
    - [konst X](#konst-x)
    - [konst Y](#konst-y)
    - [konst Z](#konst-z)
    - [konst SUMME](#konst-summe)
    - [konst E](#konst-e)
    - [konst C_2D](#konst-c-2d)
    - [konst G](#konst-g)
    - [konst D](#konst-d)
    - [konst P](#konst-p)
    - [konst GEHALT](#konst-gehalt)
    - [konst UNSUED_A](#konst-unsued-a)
  - Datensätze
    - [datensatz EinkommensteuerBescheid](#datensatz-einkommensteuerbescheid)
  - Funktionen
    - [fn summeBedingt](#fn-summebedingt)
    - [fn liste](#fn-liste)
    - [fn bescheidText](#fn-bescheidtext)
    - [fn one](#fn-one)
    - [fn two](#fn-two)
    - [fn three](#fn-three)
    - [fn four](#fn-four)
    - [fn five](#fn-five)
    - [fn six](#fn-six)
    - [fn funktionMitLambda](#fn-funktionmitlambda)
    - [fn bescheidText1](#fn-bescheidtext1)
- [Modul einkommensteuer/simple.test](#modul-einkommensteuer-simple-test)
  - Prüfungen
    - [prüfe Einkommensteuer-Bescheid](#prüfe-einkommensteuer-bescheid)
- [Modul einkommensteuer/tarif/tarif2025](#modul-einkommensteuer-tarif-tarif2025)
  - Konstanten
    - [konst GFB](#konst-gfb)
    - [konst ZONE_2_OBERGRENZE](#konst-zone-2-obergrenze)
    - [konst ZONE_3_OBERGRENZE](#konst-zone-3-obergrenze)
    - [konst ZONE_4_OBERGRENZE](#konst-zone-4-obergrenze)
    - [konst ZONE_4_SATZ](#konst-zone-4-satz)
    - [konst ZONE_5_SATZ](#konst-zone-5-satz)
    - [konst ZONE_15_SATZ](#konst-zone-15-satz)
  - Funktionen
    - [fn estGrundtarif](#fn-estgrundtarif)
    - [fn estSplitting](#fn-estsplitting)
    - [fn estEinkommensteuer](#fn-esteinkommensteuer)
- [Modul einkommensteuer/tarif/tarif2025.test](#modul-einkommensteuer-tarif-tarif2025-test)
  - Prüfungen
    - [prüfe § 32a EStG 2025 — Knotenpunkte der fünf Tarifzonen (Grundtarif)](#prüfe-32a-estg-2025-knotenpunkte-der-fünf-tarifzonen-grundtarif)
    - [prüfe Splittingverfahren — § 32a Absatz 5 EStG](#prüfe-splittingverfahren-32a-absatz-5-estg)
- [Modul einkommensteuer/veranlagung/berechnung2025](#modul-einkommensteuer-veranlagung-berechnung2025)
  - Konstanten
    - [konst ARBEITNEHMER_PAUSCHBETRAG](#konst-arbeitnehmer-pauschbetrag)
    - [konst SONDERAUSGABEN_PAUSCHBETRAG](#konst-sonderausgaben-pauschbetrag)
    - [konst SPARER_PAUSCHBETRAG](#konst-sparer-pauschbetrag)
  - Datensätze
    - [datensatz Einkünfte](#datensatz-einkünfte)
    - [datensatz AbzügeGesamtbetrag](#datensatz-abzügegesamtbetrag)
    - [datensatz AbzügeEinkommen](#datensatz-abzügeeinkommen)
    - [datensatz KorrekturenFestzusetzend](#datensatz-korrekturenfestzusetzend)
    - [datensatz Steuerfall](#datensatz-steuerfall)
    - [datensatz EstBerechnung](#datensatz-estberechnung)
  - Funktionen
    - [fn mindestensPauschbetrag](#fn-mindestenspauschbetrag)
    - [fn einkünfteAusNichtselbständigerArbeit](#fn-einkünfteausnichtselbständigerarbeit)
    - [fn einkünfteAusKapitalvermögen](#fn-einkünfteauskapitalvermögen)
    - [fn summeDerEinkünfte](#fn-summedereinkünfte)
    - [fn gesamtbetragDerEinkünfte](#fn-gesamtbetragdereinkünfte)
    - [fn einkommen](#fn-einkommen)
    - [fn zuVersteuerndesEinkommen](#fn-zuversteuerndeseinkommen)
    - [fn festzusetzendeEinkommensteuer](#fn-festzusetzendeeinkommensteuer)
    - [fn berechneEinkommensteuer](#fn-berechneeinkommensteuer)
- [Modul einkommensteuer/veranlagung/berechnung2025.test](#modul-einkommensteuer-veranlagung-berechnung2025-test)
  - Funktionen
    - [fn fallSingleAngestellter50k](#fn-fallsingleangestellter50k)
    - [fn fallAlleinerziehende45k2Kinder](#fn-fallalleinerziehende45k2kinder)
    - [fn fallEhepaar100k](#fn-fallehepaar100k)
  - Prüfungen
    - [prüfe ESt 2025 — Stufen der Veranlagung (Single, 50.000 EUR Bruttolohn)](#prüfe-est-2025-stufen-der-veranlagung-single-50-000-eur-bruttolohn)
    - [prüfe ESt 2025 — Alleinerziehende mit 2 Kindern (zeigt nullable Felder)](#prüfe-est-2025-alleinerziehende-mit-2-kindern-zeigt-nullable-felder)
    - [prüfe ESt 2025 — Splittingvergleich (Ehepaar, 2 × 50k EUR Bruttolohn)](#prüfe-est-2025-splittingvergleich-ehepaar-2-50k-eur-bruttolohn)
- [Modul lohnsteuer/tabellen/freibetraege2025](#modul-lohnsteuer-tabellen-freibetraege2025)
  - Konstanten
    - [konst ANP_REGEL](#konst-anp-regel)
    - [konst SAP_REGEL](#konst-sap-regel)
    - [konst EFA_STKL_II](#konst-efa-stkl-ii)
    - [konst KFB_SATZ_III](#konst-kfb-satz-iii)
    - [konst KFB_SATZ_IV_VI](#konst-kfb-satz-iv-vi)
  - Datensätze
    - [datensatz TabellenFreibetraege](#datensatz-tabellenfreibetraege)
  - Funktionen
    - [fn tabellenFreibetraege](#fn-tabellenfreibetraege)
- [Modul lohnsteuer/tabellen/freibetraege2025.test](#modul-lohnsteuer-tabellen-freibetraege2025-test)
  - Prüfungen
    - [prüfe Tabellenfreibeträge — Knotenpunkte aller Steuerklassen](#prüfe-tabellenfreibeträge-knotenpunkte-aller-steuerklassen)

## Modul `einkommensteuer/simple`

Das ist eine FinDSL-Beispieldatei

### Konstanten

#### konst `X`

```findsl
konst X: Euro = 100.000
```

#### konst `Y`

```findsl
konst Y: Euro = 200.000
```

> Quelle: Einkommensteuer-Tarif 2025 Y

#### konst `Z`

```findsl
konst Z: Euro = 300.000
```

> Quelle: Einkommensteuer-Tarif 2025 Z

#### konst `SUMME`

```findsl
konst SUMME: Euro = X + Y + Z
```

> Quelle: Summweise: X + Y + Z

#### konst `E`

```findsl
konst E: EuroCent = 2,50
```

> Quelle: Ungültige Eingabe

#### konst `C_2D`

```findsl
konst C_2D: Cent = 250
```

> Quelle: Ungültige Eingabe

#### konst `G`

```findsl
konst G: Ganzzahl = 2
```

> Quelle: Ungültige Eingabe

#### konst `D`

```findsl
konst D: Dezimal = 2,5
```

> Quelle: Ungültige Eingabe

#### konst `P`

```findsl
konst P: Prozent = 99%
```

> Quelle: Ungültige Eingabe

#### konst `GEHALT`

```findsl
konst GEHALT: EuroCent = 5.000.000,12
```

> Quelle: Quelle angeben

#### konst `UNSUED_A`

```findsl
konst UNSUED_A: Euro = 2
```

> Quelle: Ungültige Eingabe

### Datensätze

#### datensatz `EinkommensteuerBescheid`

```findsl
datensatz EinkommensteuerBescheid(
  zve: Euro,
  est: Euro,
  name: Text
)
```

Das ist ein Datensazt

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `zve` | `Euro` | zu versteuerndes Einkommen |
| `est` | `Euro` | festgesetzte Einkommensteuer |
| `name` | `Text` | Name der steuerpflichtigen Person |

### Funktionen

#### fn `summeBedingt`

```findsl
fn summeBedingt(a: Euro, b: Euro, c: Euro): Euro
```

Bedingte Summenbildung — wählt je nach Verhältnis der Eingaben zu den
Schwellwerten `X`, `Y` und `Z` eine andere Berechnung. Didaktisches
Beispiel für `wähle` mit `abbruch` im Sonst-Zweig.

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `a` | Erster Betrag; wird mit Schwelle `X` verglichen. |
| `b` | Zweiter Betrag; wird mit Schwelle `Y` verglichen. |
| `c` | Dritter Betrag; wird mit Schwelle `Z` verglichen. |

**Rückgabe** — Der nach den Bedingungen ausgewählte Betrag; `abbruch`, wenn keine Bedingung zutrifft.

#### fn `liste`

```findsl
fn liste(a: Euro, b: Euro, c: Euro): Liste<Euro>
```

Baut eine kleine Liste aus den drei Eingaben (didaktisches Listen-
Beispiel).

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `a` | Erster Wert (Listenelement 1). |
| `b` | Zweiter Wert; geht in die Elemente 2 und 3 ein. |
| `c` | Dritter Wert; geht in die Elemente 2 und 3 ein. |

**Rückgabe** — Liste `[a, b + c, c - b]`.

#### fn `bescheidText`

```findsl
fn bescheidText(zve: Euro, est: Euro, name: Text): Text
```

Formuliert den Bescheid-Text für eine steuerpflichtige Person als
mehrzeiligen, interpolierten Text.

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `zve` | Zu versteuerndes Einkommen (für die Anzeige im Text). |
| `est` | Festgesetzte Einkommensteuer (für die Anzeige im Text). |
| `name` | Name der angeschriebenen Person. |

**Rückgabe** — Fertiger Bescheid-Text mit Anrede und Werten.

#### fn `one`

```findsl
fn one(): Text
```

Gibt einen festen Begrüßungstext zurück und schreibt eine Trace-Zeile
über `ausgabe`. Kopf der Delegationskette `one → two → … → five`.

**Rückgabe** — Der Text „Hallo Welt".

#### fn `two`

```findsl
fn two(): Text
```

Delegiert unverändert an `one()` (didaktische Aufrufkette).

**Rückgabe** — Das Ergebnis von `one()`.

#### fn `three`

```findsl
fn three(): Text
```

Delegiert unverändert an `two()` (didaktische Aufrufkette).

**Rückgabe** — Das Ergebnis von `two()`.

#### fn `four`

```findsl
fn four(): Text
```

Delegiert unverändert an `three()` (didaktische Aufrufkette).

**Rückgabe** — Das Ergebnis von `three()`.

#### fn `five`

```findsl
fn five(): Text
```

Delegiert unverändert an `four()` (didaktische Aufrufkette).

**Rückgabe** — Das Ergebnis von `four()`.

#### fn `six`

```findsl
fn six(): Text
```

Demonstriert Geldtyp-Umwandlungen (`Cent`/`EuroCent`/`Euro` via `als`)
und gibt das Gehalt als Text in Cent zurück.

**Rückgabe** — Text mit dem Gehalt in Cent.

#### fn `funktionMitLambda`

```findsl
fn funktionMitLambda(lambda: (Euro) -> Euro): Euro
```

Wendet eine als Parameter übergebene Funktion auf den festen Wert
100.000 an (didaktisches Beispiel für Funktionstyp-Parameter).

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `lambda` | Funktion vom Typ `(Euro) -> Euro`, die angewandt wird. |

**Rückgabe** — Ergebnis von `lambda(100.000)`.

#### fn `bescheidText1`

```findsl
fn bescheidText1(ds: EinkommensteuerBescheid, lambda: (Euro) -> Euro): Text
```

Formuliert den Bescheid-Text aus einem `EinkommensteuerBescheid`-
Datensatz.

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `ds` | Bescheid-Datensatz mit `name`, `zve` und `est`. |
| `lambda` | (Aktuell ungenutzt) Funktionstyp-Parameter — bewusstes didaktisches Beispiel für die „Parameter wird nicht verwendet"-Diagnose. |

**Rückgabe** — Fertiger Bescheid-Text mit Anrede und Werten.

### Explizit ausgeschlossene Konstellationen

| In | Stelle | Begründung |
| --- | --- | --- |
| `summeBedingt` | Z. 65 | Ungültige Eingabe |

## Modul `einkommensteuer/simple.test`

#### Akzeptanztests — simple

`prüfe`-Blöcke zur didaktischen Datei `simple`. Die geprüften
Symbole stammen aus `simple`; diese Datei enthält ausschließlich
die `prüfe`-Blöcke.

### Prüfungen

#### prüfe `Einkommensteuer-Bescheid`

```findsl
prüfe "Einkommensteuer-Bescheid"
```

verwende {
    einkünfteAusNichtselbständigerArbeit,
    berechneEinkommensteuer,
} aus "../einkommensteuer/veranlagung/berechnung2025"

verwende {
    foo,
    bar,
} aus "../foobar.test"

verwende {
    foo als xfoo,
    bar als yfoo,
} aus "./path/to/some/folder/foobar.test"

**Testfall — Bescheid für Max Mustermann**

```findsl
one() == "Hallo Welt"
```

## Modul `einkommensteuer/tarif/tarif2025`

#### Tarifliche Einkommensteuer 2025 (§ 32a EStG)

Berechnet die tarifliche Einkommensteuer aus dem zu versteuernden Einkommen
nach § 32a EStG, Veranlagungszeitraum 2025. Die fünf Tarifzonen werden als
`wähle`-Block modelliert; das spiegelt die DIN-66001-Verzweigungskette des
PAP UPTAB25 bis auf die Reihenfolge 1:1.

Splittingverfahren (§ 32a Abs. 5 EStG) ist als eigene Funktion ergänzt.

### Konstanten

#### konst `GFB`

```findsl
konst GFB: Euro = 12.096
```

Grundfreibetrag — Höhe des steuerfreien Existenzminimums. Erhöht von
11.604 EUR (2024) auf 12.096 EUR (2025) durch das Steuerfortentwicklungsgesetz.

> Quelle: § 32a Absatz 1 Nr. 1 EStG — [§ 32a EStG](https://www.gesetze-im-internet.de/estg/__32a.html)

#### konst `ZONE_2_OBERGRENZE`

```findsl
konst ZONE_2_OBERGRENZE: Euro = 17.443
```

Obergrenze der Eingangs-Progressionszone (Zone 2).

> Quelle: § 32a Absatz 1 EStG — [§ 32a EStG](https://www.gesetze-im-internet.de/estg/__32a.html)

#### konst `ZONE_3_OBERGRENZE`

```findsl
konst ZONE_3_OBERGRENZE: Euro = 68.480
```

Obergrenze der Hauptprogressionszone (Zone 3) — Spitzensteuersatz beginnt darüber.

> Quelle: § 32a Absatz 1 EStG — [§ 32a EStG](https://www.gesetze-im-internet.de/estg/__32a.html)

#### konst `ZONE_4_OBERGRENZE`

```findsl
konst ZONE_4_OBERGRENZE: Euro = 277.825
```

Obergrenze der Proportionalzone (Zone 4) — Reichensteuersatz beginnt darüber.

> Quelle: § 32a Absatz 1 EStG — [§ 32a EStG](https://www.gesetze-im-internet.de/estg/__32a.html)

#### konst `ZONE_4_SATZ`

```findsl
konst ZONE_4_SATZ: Prozent = 42%
```

Spitzensteuersatz (Zone 4) — Proportionalzone ab 68.481 EUR.

> Quelle: § 32a Absatz 1 Nr. 4 EStG — [§ 32a EStG](https://www.gesetze-im-internet.de/estg/__32a.html)

#### konst `ZONE_5_SATZ`

```findsl
konst ZONE_5_SATZ: Prozent = 45%
```

Reichensteuersatz (Zone 5) — Proportionalzone ab 277.826 EUR.

> Quelle: § 32a Absatz 1 Nr. 5 EStG — [§ 32a EStG](https://www.gesetze-im-internet.de/estg/__32a.html)

#### konst `ZONE_15_SATZ`

```findsl
konst ZONE_15_SATZ: Prozent = 45%
```

> Quelle: § 32a Absatz 1 Nr. 5 EStG — [§ 32a EStG](https://www.gesetze-im-internet.de/estg/__32a.html)

### Funktionen

#### fn `estGrundtarif`

```findsl
fn estGrundtarif(zve: Euro): Euro
```

Berechnet die tarifliche Einkommensteuer im Grundtarif (für Einzelveranlagte
und alle, die nicht das Splittingverfahren wählen).

##### Tarifformel

Fünf Zonen gemäß § 32a Absatz 1 EStG:

| Zone | Bereich (zvE)       | Formel                                                        |
|------|---------------------|---------------------------------------------------------------|
| 1    | 0 – 12.096          | 0 EUR (Existenzminimum)                                       |
| 2    | 12.097 – 17.443     | (932,30 · y + 1.400) · y, mit y = (zvE − 12.096)/10.000       |
| 3    | 17.444 – 68.480     | (176,64 · z + 2.397) · z + 1.015,13, mit z = (zvE − 17.443)/10.000 |
| 4    | 68.481 – 277.825    | 42 % · zvE − 10.911,92                                        |
| 5    | ≥ 277.826           | 45 % · zvE − 19.246,67                                        |

##### Beispiel

```findsl
estGrundtarif(12.096)  ==      0     // Zone 1, Existenzminimum
estGrundtarif(15.000)  ==    485     // Zone 2
estGrundtarif(50.000)  == 10.691     // Zone 3
estGrundtarif(100.000) == 31.088     // Zone 4
estGrundtarif(300.000) == 115.753    // Zone 5
```

##### Verweise

- PAP 2025 Subroutine `UPTAB25` (BMF, Stand 22.1.2025)
- § 32a Absatz 1 EStG (Tarifformel)
- § 32a Absatz 5 EStG (Splittingverfahren — siehe `estSplitting`)

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `zve` | Zu versteuerndes Einkommen in vollen Euro. |

**Rückgabe** — Tarifliche Einkommensteuer in vollen Euro, abgerundet.

> Quelle: § 32a Absatz 1 EStG, PAP 2025 Subroutine UPTAB25 — [§ 32a EStG](https://www.gesetze-im-internet.de/estg/__32a.html)

#### fn `estSplitting`

```findsl
fn estSplitting(zve: Euro): Euro
```

Berechnet die tarifliche Einkommensteuer im Splittingverfahren — Tarif
auf die Hälfte des zvE anwenden, dann verdoppeln. Begünstigt zusammen-
veranlagte Ehepaare und eingetragene Lebenspartnerschaften.

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `zve` | Gemeinsam zu versteuerndes Einkommen beider Partner. |

**Rückgabe** — Tarifliche Einkommensteuer im Splittingverfahren.

> Quelle: § 32a Absatz 5 EStG — [§ 32a EStG](https://www.gesetze-im-internet.de/estg/__32a.html)

#### fn `estEinkommensteuer`

```findsl
fn estEinkommensteuer(zve: Euro, art: Tarifart): Euro
```

Wählt zwischen Grundtarif und Splittingverfahren basierend auf der
Tarifart. Hauptberechnungsregel des Tarif-Moduls.

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `zve` | Zu versteuerndes Einkommen. |
| `art` | `Grundtarif` oder `Splitting`. |

**Rückgabe** — Tarifliche Einkommensteuer in vollen Euro.

> Quelle: § 32a EStG — [§ 32a EStG](https://www.gesetze-im-internet.de/estg/__32a.html)

### Explizit ausgeschlossene Konstellationen

| In | Stelle | Begründung |
| --- | --- | --- |
| `estGrundtarif` | Z. 93 | § 32a EStG: zu versteuerndes Einkommen darf nicht negativ sein (zvE=${zve}) · Quelle: § 32a Absatz 1 EStG, PAP 2025 Subroutine UPTAB25 |

## Modul `einkommensteuer/tarif/tarif2025.test`

#### Akzeptanztests — Tarif 2025 (§ 32a EStG)

Knotenpunkte der fünf Tarifzonen und des Splittingverfahrens. Die
geprüften Funktionen stammen aus `tarif2025`;
diese Datei enthält ausschließlich die `prüfe`-Blöcke.

### Prüfungen

#### prüfe `§ 32a EStG 2025 — Knotenpunkte der fünf Tarifzonen (Grundtarif)`

```findsl
prüfe "§ 32a EStG 2025 — Knotenpunkte der fünf Tarifzonen (Grundtarif)"
```

**Testfall — Zone 1: zvE = Grundfreibetrag**

```findsl
var ex: Euro = 23002
        ausgabe("""
            Herzlichen Glückwunsch, Sie haben das Existenzminimum erreicht!
            Ihre tarifliche Einkommensteuer beträgt ${ex} EUR.
            """)
        estGrundtarif(12.096) == 0
```

**Testfall — Zone 1: 1 EUR über GFB ist trotzdem 0 (PAP < GFB+1)**

```findsl
estGrundtarif(12.096) == 0
```

**Testfall — Zone 2: 15.000 EUR zvE**

```findsl
// y = 0.2904; (932.30*0.2904 + 1400)*0.2904 = 485.18 → 485
        estGrundtarif(15.000) == 485
```

**Testfall — Zone 3: 50.000 EUR zvE**

```findsl
// z = 3.2557; (176.64*3.2557 + 2397)*3.2557 + 1015.13 = 10691.35 → 10691
        estGrundtarif(50.000) == 10.691
```

**Testfall — Zone 4: 100.000 EUR zvE**

```findsl
// 0.42*100000 - 10911.92 = 31088.08 → 31088
        estGrundtarif(100.000) == 31.088
```

**Testfall — Zone 5: 300.000 EUR zvE**

```findsl
// 0.45*300000 - 19246.67 = 115753.33 → 115753
        estGrundtarif(300.000) == 115.753
```

**Testfall — Negatives zvE wird nach § 32a EStG abgelehnt** _(erwartet abbruch)_

```findsl
estGrundtarif(-1 als Euro)
```

#### prüfe `Splittingverfahren — § 32a Absatz 5 EStG`

```findsl
prüfe "Splittingverfahren — § 32a Absatz 5 EStG"
```

**Testfall — Zusammenveranlagung 60.000 EUR zvE**

```findsl
estEinkommensteuer(60.000, Splitting) == 2 * estGrundtarif(30.000)
```

**Testfall — Splittingvorteil ist >= 0**

```findsl
estEinkommensteuer(100.000, Splitting) <= estEinkommensteuer(100.000, Grundtarif)
```

## Modul `einkommensteuer/veranlagung/berechnung2025`

#### ESt-Veranlagung 2025 (§ 2 EStG)

Berechnungsschema der Jahres-Einkommensteuer gemäß § 2 EStG. Modelliert die
Stufenermittlung von „Summe der Einkünfte" bis „festzusetzender Einkommensteuer"
und ruft den Tarif aus `einkommensteuer.tarif.tarif2025` auf.

Anders als der Lohnsteuer-PAP (unterjährige Vorauszahlung im Steuerabzugs-
verfahren) bildet dieses Modul die *Veranlagung* am Jahresende ab — die
Stufen § 2 Abs. 1 → 3 → 4 → 5 → 6 EStG.

##### Verweise

- § 2 EStG (Umfang der Besteuerung, Begriffsbestimmungen)
- `einkommensteuer.tarif.tarif2025` (Tarifformel § 32a EStG)
- `lohnsteuer.tabellen.freibetraege2025` (Lohnsteuer-Tabellenfreibeträge)

### Konstanten

#### konst `ARBEITNEHMER_PAUSCHBETRAG`

```findsl
konst ARBEITNEHMER_PAUSCHBETRAG: Euro = 1.230
```

Pauschbetrag für Werbungskosten bei Einkünften aus nichtselbständiger Arbeit.
Erhöht von 1.200 EUR auf 1.230 EUR durch das Wachstumschancengesetz mit
Wirkung ab Veranlagungszeitraum 2023.

> Quelle: § 9a Satz 1 Nr. 1 Buchst. a EStG — [§ 9a EStG](https://www.gesetze-im-internet.de/estg/__9a.html)

#### konst `SONDERAUSGABEN_PAUSCHBETRAG`

```findsl
konst SONDERAUSGABEN_PAUSCHBETRAG: Euro = 36
```

Sonderausgaben-Pauschbetrag bei der Einkommensteuer-Veranlagung.

> Quelle: § 10c Satz 1 EStG — [§ 10c EStG](https://www.gesetze-im-internet.de/estg/__10c.html)

#### konst `SPARER_PAUSCHBETRAG`

```findsl
konst SPARER_PAUSCHBETRAG: Euro = 1.000
```

Sparer-Pauschbetrag bei Einzelveranlagung. Wird verdoppelt bei
Zusammenveranlagung (2.000 EUR). Achtung: für Kapitalerträge gilt
i. d. R. § 32d (Abgeltungssteuer 25 %), nicht der reguläre Tarif.

> Quelle: § 20 Absatz 9 Satz 1 EStG — [§ 20 EStG](https://www.gesetze-im-internet.de/estg/__20.html)

### Datensätze

#### datensatz `Einkünfte`

```findsl
datensatz Einkünfte(
    landUndForstwirtschaft:    Euro = 0,    // Nr. 1 — §§ 13–14a EStG
    gewerbebetrieb:            Euro = 0,    // Nr. 2 — §§ 15–17 EStG
    selbständigeArbeit:        Euro = 0,    // Nr. 3 — § 18 EStG
    nichtselbständigeArbeit:   Euro = 0,    // Nr. 4 — § 19 EStG (Arbeitslohn)
    kapitalvermögen:           Euro = 0,    // Nr. 5 — § 20 EStG
    vermietungVerpachtung:     Euro = 0,    // Nr. 6 — § 21 EStG
    sonstigeEinkünfte:         Euro = 0,    // Nr. 7 — § 22 EStG
)
```

Die sieben Einkunftsarten gemäß § 2 Absatz 1 EStG. Der Steuerpflichtige
kann Einkünfte aus mehreren Arten gleichzeitig haben; die Felder sind
unabhängig voneinander.

Die Einkünfte aus den Gewinneinkunftsarten (Nr. 1–3) werden als Gewinn
ermittelt (§§ 4–7k), die übrigen als Überschuss der Einnahmen über die
Werbungskosten (§§ 8–9a). FinDSL nimmt den jeweils ermittelten Wert
als Eingang.

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `landUndForstwirtschaft` | `Euro` | 1. Einkunftsart (§§ 13–14a EStG): bereits ermittelter Gewinn aus Land- und Forstwirtschaft. 0, wenn nicht zutreffend. |
| `gewerbebetrieb` | `Euro` | 2. Einkunftsart (§§ 15–17 EStG): Gewinn aus Gewerbebetrieb. |
| `selbständigeArbeit` | `Euro` | 3. Einkunftsart (§ 18 EStG): Gewinn aus freiberuflicher/selbständiger Tätigkeit. |
| `nichtselbständigeArbeit` | `Euro` | 4. Einkunftsart (§ 19 EStG): Arbeitslohn nach Abzug der Werbungskosten — siehe `einkünfteAusNichtselbständigerArbeit`. |
| `kapitalvermögen` | `Euro` | 5. Einkunftsart (§ 20 EStG): Kapitalerträge bei Veranlagung (nicht Abgeltungssteuer). |
| `vermietungVerpachtung` | `Euro` | 6. Einkunftsart (§ 21 EStG): Überschuss aus Vermietung und Verpachtung. |
| `sonstigeEinkünfte` | `Euro` | 7. Einkunftsart (§ 22 EStG): sonstige Einkünfte, z. B. Leibrenten. |

> Quelle: § 2 Absatz 1 EStG (sieben Einkunftsarten) — [§ 2 EStG](https://www.gesetze-im-internet.de/estg/__2.html)

#### datensatz `AbzügeGesamtbetrag`

```findsl
datensatz AbzügeGesamtbetrag(
    altersentlastungsbetrag:    Euro? = nichts,   // § 24a EStG (Alter > 64)
    entlastungsbetragAlleinerz: Euro? = nichts,   // § 24b EStG (StKl II)
    freibetragLandForst:        Euro? = nichts,   // § 13 Absatz 3 EStG
)
```

Drei zusätzliche Abzüge auf der Stufe vom „Summe der Einkünfte" zum
„Gesamtbetrag der Einkünfte" gemäß § 2 Absatz 3 EStG. Alle drei sind
nullable, da sie nur in spezifischen Lebenssituationen anwendbar sind.

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `altersentlastungsbetrag` | `Euro?` | Altersentlastungsbetrag nach § 24a EStG; greift, wenn die Person vor Beginn des Veranlagungsjahres das 64. Lebensjahr vollendet hat. `nichts`, wenn nicht einschlägig. |
| `entlastungsbetragAlleinerz` | `Euro?` | Entlastungsbetrag für Alleinerziehende nach § 24b EStG (Steuerklasse II). |
| `freibetragLandForst` | `Euro?` | Freibetrag für Land- und Forstwirte nach § 13 Absatz 3 EStG. |

> Quelle: § 2 Absatz 3 EStG — [§ 2 EStG](https://www.gesetze-im-internet.de/estg/__2.html)

#### datensatz `AbzügeEinkommen`

```findsl
datensatz AbzügeEinkommen(
    sonderausgaben:              Euro? = nichts,  // §§ 10–10c EStG (Pauschbetrag greift!)
    außergewöhnlicheBelastungen: Euro? = nichts,  // §§ 33–33b EStG
)
```

Zwei Abzüge auf der Stufe vom „Gesamtbetrag der Einkünfte" zum „Einkommen"
gemäß § 2 Absatz 4 EStG. Sonderausgaben werden mit dem Pauschbetrag
verglichen — siehe `mindestensPauschbetrag` und `einkommen()`.

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `sonderausgaben` | `Euro?` | Tatsächlich geltend gemachte Sonder- ausgaben (§§ 10–10c EStG). Liegt der Wert unter dem Pauschbetrag, greift automatisch der Pauschbetrag. |
| `außergewöhnlicheBelastungen` | `Euro?` | Außergewöhnliche Belastungen nach §§ 33–33b EStG (z. B. Krankheits- kosten), bereits um die zumutbare Belastung gekürzt. |

> Quelle: § 2 Absatz 4 EStG — [§ 2 EStG](https://www.gesetze-im-internet.de/estg/__2.html)

#### datensatz `KorrekturenFestzusetzend`

```findsl
datensatz KorrekturenFestzusetzend(
    entlastungsbetrag32c:       Euro? = nichts,   // § 32c EStG
    anzurechnendeAuslandsteuer: Euro? = nichts,   // § 34c EStG
    steuerermäßigungen:         Euro? = nichts,   // §§ 35, 35a, 35b EStG
    nachsteuer10Abs5:           Euro? = nichts,   // § 10 Absatz 5 EStG
    zuschlagForstschäden:       Euro? = nichts,   // § 3 Abs. 4 Satz 2 ForstSchAusglG
)
```

Korrekturen auf der Stufe von der „tariflichen ESt" zur „festzusetzenden
ESt" gemäß § 2 Absatz 6 EStG. Alle Felder sind nullable, weil jede
Korrektur nur unter spezifischen Voraussetzungen anfällt (z. B. Auslands-
einkünfte, gewerbliche Sondertarife, Steuerermäßigungen für haushaltsnahe
Dienstleistungen).

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `entlastungsbetrag32c` | `Euro?` | Tarifentlastung für gewerbliche Einkünfte nach § 32c EStG (mindert die Steuer). |
| `anzurechnendeAuslandsteuer` | `Euro?` | Im Ausland gezahlte, anrechenbare Steuer nach § 34c EStG (mindert die Steuer). |
| `steuerermäßigungen` | `Euro?` | Steuerermäßigungen nach §§ 35, 35a, 35b EStG, z. B. für haushaltsnahe Dienstleistungen (mindert die Steuer). |
| `nachsteuer10Abs5` | `Euro?` | Nachzuversteuernder Betrag nach § 10 Absatz 5 EStG (erhöht die Steuer). |
| `zuschlagForstschäden` | `Euro?` | Zuschlag für Forstschäden nach § 3 Abs. 4 Satz 2 ForstSchAusglG (erhöht die Steuer). |

> Quelle: § 2 Absatz 6 EStG — [§ 2 EStG](https://www.gesetze-im-internet.de/estg/__2.html)

#### datensatz `Steuerfall`

```findsl
datensatz Steuerfall(
    einkünfte:        Einkünfte,
    abzügeGesamt:     AbzügeGesamtbetrag       = AbzügeGesamtbetrag(),
    abzügeEinkommen:  AbzügeEinkommen          = AbzügeEinkommen(),
    kinderfreibetrag: Euro?                    = nichts,                         // § 32 Abs. 6 EStG
    korrekturen:      KorrekturenFestzusetzend = KorrekturenFestzusetzend(),
    tarifart:         Tarifart,                                                  // bewusst Pflicht
)
```

Vollständiger Eingangs-Datensatz für die Veranlagung eines Steuerfalls.
Mit den Defaults reduziert sich die Konstruktion auf die Felder, die vom
Normalfall abweichen — siehe Beispielfälle weiter unten.

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `einkünfte` | `Einkünfte` | Die sieben Einkunftsarten (§ 2 Absatz 1 EStG). |
| `abzügeGesamt` | `AbzügeGesamtbetrag` | Abzüge zum Gesamtbetrag der Einkünfte (§ 2 Absatz 3 EStG); Default = keine Abzüge. |
| `abzügeEinkommen` | `AbzügeEinkommen` | Abzüge zum Einkommen (§ 2 Absatz 4 EStG); Default = keine Abzüge (Sonderausgaben- Pauschbetrag greift). |
| `kinderfreibetrag` | `Euro?` | Summe der Kinderfreibeträge nach § 32 Absatz 6 EStG, oder `nichts`. |
| `korrekturen` | `KorrekturenFestzusetzend` | Korrekturen zur festzusetzenden ESt (§ 2 Absatz 6 EStG); Default = keine Korrekturen. |
| `tarifart` | `Tarifart` | `Grundtarif` oder `Splitting` — bewusst Pflicht- feld, damit die Veranlagungsart nie implizit ist. |

#### datensatz `EstBerechnung`

```findsl
datensatz EstBerechnung(
    summeEinkünfte:                Euro,    // Stufe 1: § 2 Abs. 1, 2 EStG
    gesamtbetragEinkünfte:         Euro,    // Stufe 2: § 2 Abs. 3 EStG
    einkommen:                     Euro,    // Stufe 3: § 2 Abs. 4 EStG
    zuVersteuerndesEinkommen:      Euro,    // Stufe 4: § 2 Abs. 5 EStG
    tariflicheEinkommensteuer:     Euro,    // Stufe 5: § 32a EStG
    festzusetzendeEinkommensteuer: Euro,    // Stufe 6: § 2 Abs. 6 EStG
)
```

Vollständige Berechnungsdokumentation eines Steuerfalls — alle sechs
Stufen gemäß § 2 EStG nebeneinander. Erlaubt punktgenaue Tests, wo eine
Berechnung von der Erwartung abweicht.

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `summeEinkünfte` | `Euro` | Stufe 1 (§ 2 Abs. 1, 2 EStG): Summe aller sieben Einkunftsarten. |
| `gesamtbetragEinkünfte` | `Euro` | Stufe 2 (§ 2 Abs. 3 EStG): nach Altersentlastung u. Ä. |
| `einkommen` | `Euro` | Stufe 3 (§ 2 Abs. 4 EStG): nach Sonderausgaben und a. B. |
| `zuVersteuerndesEinkommen` | `Euro` | Stufe 4 (§ 2 Abs. 5 EStG): nach Kinderfreibetrag — Bemessungs- grundlage für den Tarif. |
| `tariflicheEinkommensteuer` | `Euro` | Stufe 5 (§ 32a EStG): tariflich berechnete Einkommensteuer. |
| `festzusetzendeEinkommensteuer` | `Euro` | Stufe 6 (§ 2 Abs. 6 EStG): nach Korrekturen festzusetzende Steuer. |

### Funktionen

#### fn `mindestensPauschbetrag`

```findsl
fn mindestensPauschbetrag(geleistet: Euro?, pauschbetrag: Euro): Euro
```

Generischer Pauschbetrags-Vergleich: gibt das Maximum aus tatsächlich
geleistetem Betrag und dem gesetzlichen Pauschbetrag zurück. Wenn der
geleistete Betrag fehlt (`nichts`), wird er als 0 behandelt — der
Pauschbetrag greift dann automatisch.

Wird im EStG an mehreren Stellen verwendet:
- § 9a (Werbungskosten-Pauschbetrag bei Arbeitslohn)
- § 10c (Sonderausgaben-Pauschbetrag)
- § 20 Absatz 9 (Sparer-Pauschbetrag)

##### Beispiel

```findsl
mindestensPauschbetrag(2.500, ARBEITNEHMER_PAUSCHBETRAG) == 2.500   // Tatsächlich höher
mindestensPauschbetrag(800,   ARBEITNEHMER_PAUSCHBETRAG) == 1.230   // Pauschbetrag greift
mindestensPauschbetrag(nichts, ARBEITNEHMER_PAUSCHBETRAG) == 1.230  // Nichts angegeben
```

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `geleistet` | Tatsächlich geltend gemachter Betrag, oder `nichts`. |
| `pauschbetrag` | Gesetzlich festgelegter Mindestbetrag. |

**Rückgabe** — Der höhere der beiden Werte.

> Quelle: § 9a, § 10c, § 20 Abs. 9 EStG (Pauschbetragsmuster) — [§ 9a EStG](https://www.gesetze-im-internet.de/estg/__9a.html), [§ 10c EStG](https://www.gesetze-im-internet.de/estg/__10c.html), [§ 20 EStG](https://www.gesetze-im-internet.de/estg/__20.html)

#### fn `einkünfteAusNichtselbständigerArbeit`

```findsl
fn einkünfteAusNichtselbständigerArbeit(
    bruttoArbeitslohn:           Euro,
    tatsächlicheWerbungskosten:  Euro? = nichts,
): Euro
```

Berechnet die Einkünfte aus nichtselbständiger Arbeit (§ 19 EStG):
Bruttoarbeitslohn abzüglich Werbungskosten (mindestens als Pauschbetrag).

##### Beispiel

```findsl
einkünfteAusNichtselbständigerArbeit(50.000)        == 48.770   // Pauschbetrag (1,230)
einkünfteAusNichtselbständigerArbeit(50.000, 2.500) == 47.500   // Tatsächlich (2,500)
```

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `bruttoArbeitslohn` | Jahresbruttolohn nach Lohnsteuerbescheinigung. |
| `tatsächlicheWerbungskosten` | Tatsächliche Werbungskosten oder `nichts`, wenn nur der Pauschbetrag greifen soll. |

**Rückgabe** — Einkünfte aus n.s. Arbeit nach § 2 Abs. 2 Nr. 2 EStG.

> Quelle: § 19 Absatz 1 i.V.m. § 9a Satz 1 Nr. 1 Buchst. a EStG — [§ 19 EStG](https://www.gesetze-im-internet.de/estg/__19.html), [§ 9a EStG](https://www.gesetze-im-internet.de/estg/__9a.html)

#### fn `einkünfteAusKapitalvermögen`

```findsl
fn einkünfteAusKapitalvermögen(
    bruttoKapitalerträge: Euro,
): Euro
```

Berechnet die Einkünfte aus Kapitalvermögen (§ 20 EStG) bei
*Veranlagung* — nicht bei Abgeltungssteuer-Anwendung (§ 32d).
Sparer-Pauschbetrag wird stets in voller Höhe abgezogen.

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `bruttoKapitalerträge` | Summe der Brutto-Kapitalerträge im Jahr. |

**Rückgabe** — Einkünfte aus Kapitalvermögen nach § 2 Abs. 2 Nr. 2 EStG.

> Quelle: § 20 i.V.m. § 20 Absatz 9 EStG (Sparer-Pauschbetrag, ohne § 32d) — [§ 20 EStG](https://www.gesetze-im-internet.de/estg/__20.html), [§ 20 EStG](https://www.gesetze-im-internet.de/estg/__20.html)

#### fn `summeDerEinkünfte`

```findsl
fn summeDerEinkünfte(e: Einkünfte): Euro
```

Stufe 1 nach § 2 Abs. 1, 2 EStG: addiert die Einkünfte aller sieben
Einkunftsarten zur „Summe der Einkünfte".

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `e` | Datensatz mit den sieben Einkunftsarten. |

**Rückgabe** — Summe aller Einkünfte vor Abzügen.

> Quelle: § 2 Absatz 1, 2 EStG — [§ 2 EStG](https://www.gesetze-im-internet.de/estg/__2.html)

#### fn `gesamtbetragDerEinkünfte`

```findsl
fn gesamtbetragDerEinkünfte(summe: Euro, abz: AbzügeGesamtbetrag): Euro
```

Stufe 2 nach § 2 Abs. 3 EStG: zieht von der Summe der Einkünfte den
Altersentlastungsbetrag, den Entlastungsbetrag für Alleinerziehende und
den Freibetrag für Land- und Forstwirtschaft ab.

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `summe` | Summe der Einkünfte (Ergebnis Stufe 1). |
| `abz` | Datensatz mit den drei optionalen Abzügen. |

**Rückgabe** — Gesamtbetrag der Einkünfte.

> Quelle: § 2 Absatz 3 EStG — [§ 2 EStG](https://www.gesetze-im-internet.de/estg/__2.html)

#### fn `einkommen`

```findsl
fn einkommen(gesamtbetrag: Euro, abz: AbzügeEinkommen): Euro
```

Stufe 3 nach § 2 Abs. 4 EStG: zieht vom Gesamtbetrag der Einkünfte
Sonderausgaben (mindestens als Pauschbetrag) und außergewöhnliche
Belastungen ab.

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `gesamtbetrag` | Gesamtbetrag der Einkünfte (Ergebnis Stufe 2). |
| `abz` | Datensatz mit Sonderausgaben und a. B. |

**Rückgabe** — Einkommen.

> Quelle: § 2 Absatz 4 EStG (Sonderausgaben mindestens als Pauschbetrag) — [§ 2 EStG](https://www.gesetze-im-internet.de/estg/__2.html)

#### fn `zuVersteuerndesEinkommen`

```findsl
fn zuVersteuerndesEinkommen(eink: Euro, kinderfreibetrag: Euro?): Euro
```

Stufe 4 nach § 2 Abs. 5 EStG: zieht vom Einkommen den Kinderfreibetrag
ab und liefert das zu versteuernde Einkommen (zvE) — die Bemessungs-
grundlage für den Tarif.

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `eink` | Einkommen (Ergebnis Stufe 3). |
| `kinderfreibetrag` | Summe der Kinderfreibeträge oder `nichts`. |

**Rückgabe** — Zu versteuerndes Einkommen.

> Quelle: § 2 Absatz 5 EStG — [§ 2 EStG](https://www.gesetze-im-internet.de/estg/__2.html)

#### fn `festzusetzendeEinkommensteuer`

```findsl
fn festzusetzendeEinkommensteuer(
    tariflich: Euro,
    k:         KorrekturenFestzusetzend,
): Euro
```

Stufe 6 nach § 2 Abs. 6 EStG: passt die tarifliche ESt um die in
Abs. 6 aufgezählten Korrekturen an. Negative Korrekturen werden
abgezogen, positive (Nachsteuer, Zuschlag) hinzugezählt.

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `tariflich` | Tarifliche ESt aus § 32a EStG (Stufe 5). |
| `k` | Datensatz mit allen optionalen Korrekturen. |

**Rückgabe** — Festzusetzende Einkommensteuer.

> Quelle: § 2 Absatz 6 EStG — [§ 2 EStG](https://www.gesetze-im-internet.de/estg/__2.html)

#### fn `berechneEinkommensteuer`

```findsl
fn berechneEinkommensteuer(fall: Steuerfall): EstBerechnung
```

Hauptberechnungsregel — führt einen Steuerfall durch alle sechs Stufen
des § 2 EStG und gibt einen `EstBerechnung`-Datensatz zurück, in dem
jede Zwischengröße sichtbar bleibt. Das erleichtert Tests, Prüfungen
durch das Finanzamt und Rechtsbehelfsverfahren.

##### Beispiel

```findsl
val ergebnis = berechneEinkommensteuer(fallSingleAngestellter50k())
ergebnis.summeEinkünfte                == 48.770
ergebnis.einkommen                     == 48.734
ergebnis.zuVersteuerndesEinkommen      == 48.734
ergebnis.tariflicheEinkommensteuer     == 10.245
ergebnis.festzusetzendeEinkommensteuer == 10.245
```

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `fall` | Vollständiger Steuerfall (Einkünfte, Abzüge, Tarifart …). |

**Rückgabe** — `EstBerechnung` mit allen sechs Zwischenergebnissen.

> Quelle: § 2 EStG (Hauptberechnungsschema, Veranlagung) — [§ 2 EStG](https://www.gesetze-im-internet.de/estg/__2.html)

## Modul `einkommensteuer/veranlagung/berechnung2025.test`

#### Akzeptanztests — ESt-Veranlagung 2025 (§ 2 EStG)

Stufenweise Veranlagung, nullable Felder und Splittingvergleich. Die
geprüften Funktionen und Beispielfälle stammen aus
`einkommensteuer.veranlagung.berechnung2025`; diese Datei enthält
ausschließlich die `prüfe`-Blöcke.

### Funktionen

#### fn `fallSingleAngestellter50k`

```findsl
fn fallSingleAngestellter50k(): Steuerfall
```

Beispielfall: alleinstehender Angestellter mit 50.000 EUR Bruttojahreslohn,
keine Werbungskosten geltend gemacht (Pauschbetrag greift), Sonderausgaben
nur als Pauschbetrag (36 EUR), keine Kinder, keine Korrekturen.

**Rückgabe** — Fertig konstruierter `Steuerfall` für die Veranlagung im Grundtarif.

#### fn `fallAlleinerziehende45k2Kinder`

```findsl
fn fallAlleinerziehende45k2Kinder(): Steuerfall
```

Beispielfall: alleinerziehende Mutter mit 2 Kindern und 45.000 EUR
Bruttolohn — zeigt die Verwendung von nullable Feldern mit echten Werten
(Entlastungsbetrag und Kinderfreibetrag ungleich `nichts`).

**Rückgabe** — `Steuerfall` mit gesetztem Entlastungsbetrag für Allein- erziehende und Kinderfreibetrag (2 Kinder), Grundtarif.

#### fn `fallEhepaar100k`

```findsl
fn fallEhepaar100k(art: Tarifart): Steuerfall
```

Beispielfall: Ehepaar mit 2 × 50.000 EUR Bruttolohn — parametrisiert
über die Tarifart, damit Splitting und Grundtarif direkt verglichen
werden können.

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `art` | Tarifart, mit der gerechnet wird (`Grundtarif` oder `Splitting`). |

**Rückgabe** — `Steuerfall` des Ehepaars (2 × 50.000 EUR Bruttolohn) mit der übergebenen Tarifart.

### Prüfungen

#### prüfe `ESt 2025 — Stufen der Veranlagung (Single, 50.000 EUR Bruttolohn)`

```findsl
prüfe "ESt 2025 — Stufen der Veranlagung (Single, 50.000 EUR Bruttolohn)"
```

**Testfall — Stufe 1 — Einkünfte aus n.s. Arbeit nach Werbungskosten-Pauschbetrag**

```findsl
berechneEinkommensteuer(fallSingleAngestellter50k()).summeEinkünfte == 48.770
```

**Testfall — Stufe 2 — Gesamtbetrag der Einkünfte (keine Zusatzabzüge)**

```findsl
berechneEinkommensteuer(fallSingleAngestellter50k()).gesamtbetragEinkünfte == 48.770
```

**Testfall — Stufe 3 — Einkommen (nach Sonderausgaben-Pauschbetrag 36 EUR)**

```findsl
berechneEinkommensteuer(fallSingleAngestellter50k()).einkommen == 48.734
```

**Testfall — Stufe 4 — zu versteuerndes Einkommen (kein Kinderfreibetrag)**

```findsl
berechneEinkommensteuer(fallSingleAngestellter50k()).zuVersteuerndesEinkommen == 48.734
```

**Testfall — Stufe 5 — Tarifliche Einkommensteuer nach § 32a EStG**

```findsl
// Zone 3: z = (48734 - 17443) / 10000 = 3.1291
        // ESt = (176.64 · z + 2397) · z + 1015.13 = 10245.11 → 10245
        berechneEinkommensteuer(fallSingleAngestellter50k()).tariflicheEinkommensteuer == 10.245
```

**Testfall — Stufe 6 — Festzusetzende ESt (keine Korrekturen)**

```findsl
berechneEinkommensteuer(fallSingleAngestellter50k()).festzusetzendeEinkommensteuer == 10.245
```

#### prüfe `ESt 2025 — Alleinerziehende mit 2 Kindern (zeigt nullable Felder)`

```findsl
prüfe "ESt 2025 — Alleinerziehende mit 2 Kindern (zeigt nullable Felder)"
```

**Testfall — Entlastungsbetrag wirkt — Gesamtbetrag < Summe**

```findsl
berechneEinkommensteuer(fallAlleinerziehende45k2Kinder()).gesamtbetragEinkünfte
            < berechneEinkommensteuer(fallAlleinerziehende45k2Kinder()).summeEinkünfte
```

**Testfall — Kinderfreibetrag wirkt — zvE < Einkommen**

```findsl
berechneEinkommensteuer(fallAlleinerziehende45k2Kinder()).zuVersteuerndesEinkommen
            < berechneEinkommensteuer(fallAlleinerziehende45k2Kinder()).einkommen
```

#### prüfe `ESt 2025 — Splittingvergleich (Ehepaar, 2 × 50k EUR Bruttolohn)`

```findsl
prüfe "ESt 2025 — Splittingvergleich (Ehepaar, 2 × 50k EUR Bruttolohn)"
```

**Testfall — Splittingvorteil > 0 — geringere Steuer als bei Grundtarif**

```findsl
berechneEinkommensteuer(fallEhepaar100k(Splitting)).festzusetzendeEinkommensteuer
            < berechneEinkommensteuer(fallEhepaar100k(Grundtarif)).festzusetzendeEinkommensteuer
```

## Modul `lohnsteuer/tabellen/freibetraege2025`

#### Tabellenfreibeträge 2025

Berechnet die festen Tabellenfreibeträge ohne Vorsorgepauschale gemäß
PAP 2025 (BMF, Stand 22.1.2025): Arbeitnehmer-Pauschbetrag, Sonderausgaben-
Pauschbetrag, Entlastungsbetrag für Alleinerziehende und Kinderfreibetrag.

In FinDSL als reine Funktion mit datensatz-Rückgabe statt globalem Zustand —
kein Mutieren interner PAP-Felder mehr.

### Konstanten

#### konst `ANP_REGEL`

```findsl
konst ANP_REGEL: Euro = 1.230
```

Pauschbetrag für Werbungskosten bei Einkünften aus nichtselbständiger Arbeit.
Erhöht von 1.200 EUR auf 1.230 EUR durch das Wachstumschancengesetz mit
Wirkung ab Veranlagungszeitraum 2023.

> Quelle: § 9a Satz 1 Nr. 1 Buchst. a EStG — [§ 9a EStG](https://www.gesetze-im-internet.de/estg/__9a.html)

#### konst `SAP_REGEL`

```findsl
konst SAP_REGEL: Euro = 36
```

Sonderausgaben-Pauschbetrag — gilt seit 1996 unverändert.

> Quelle: § 10c Satz 1 EStG — [§ 10c EStG](https://www.gesetze-im-internet.de/estg/__10c.html)

#### konst `EFA_STKL_II`

```findsl
konst EFA_STKL_II: Euro = 4.260
```

Entlastungsbetrag für Alleinerziehende — Grundbetrag für das erste Kind.
Pro weiterem Kind erhöht sich der Betrag um 240 EUR (§ 24b Abs. 2 Satz 3 EStG);
das ist hier nicht abgebildet, sondern muss vom Aufrufer addiert werden.

> Quelle: § 24b Absatz 2 Satz 1 EStG — [§ 24b EStG](https://www.gesetze-im-internet.de/estg/__24b.html)

#### konst `KFB_SATZ_III`

```findsl
konst KFB_SATZ_III: Euro = 4.800
```

Halber Kinderfreibetrag — gilt für Steuerklasse III (Splittingverfahren).

> Quelle: § 32 Absatz 6 Satz 1 EStG i.d.F. StFEntwG 2024 — [§ 32 EStG](https://www.gesetze-im-internet.de/estg/__32.html)

#### konst `KFB_SATZ_IV_VI`

```findsl
konst KFB_SATZ_IV_VI: Euro = 9.600
```

Voller Kinderfreibetrag — gilt für Steuerklassen IV, V und VI.

> Quelle: § 32 Absatz 6 Satz 1 EStG i.d.F. StFEntwG 2024 — [§ 32 EStG](https://www.gesetze-im-internet.de/estg/__32.html)

### Datensätze

#### datensatz `TabellenFreibetraege`

```findsl
datensatz TabellenFreibetraege(
    anp:    Euro,     // Arbeitnehmer-Pauschbetrag (§ 9a EStG)
    sap:    Euro,     // Sonderausgaben-Pauschbetrag (§ 10c EStG)
    efa:    Euro,     // Entlastungsbetrag für Alleinerziehende (§ 24b EStG)
    kfb:    Euro,     // Summe der Freibeträge für Kinder (§ 32 Abs. 6 EStG)
    kztab:  Tarifart, // Kennzahl: Grundtarif | Splitting
    ztabfb: Euro,     // Summe ANP + SAP + EFA (PAP-Feld ZTABFB)
)
```

Festwerte für die Lohnsteuer-Tabellenkalkulation eines einzelnen Arbeitnehmers
für einen Lohnzahlungszeitraum. Spiegelt die internen Felder der PAP-Subroutine
`MZTABFB` (BMF, PAP 2025).

| Feld | Typ | Bedeutung |
| --- | --- | --- |
| `anp` | `Euro` | Arbeitnehmer-Pauschbetrag nach § 9a EStG (Werbungskosten- Pauschbetrag); 0 in Steuerklasse I. |
| `sap` | `Euro` | Sonderausgaben-Pauschbetrag nach § 10c EStG; 0 in Steuerklasse I. |
| `efa` | `Euro` | Entlastungsbetrag für Alleinerziehende nach § 24b EStG; ungleich 0 nur in Steuerklasse II. |
| `kfb` | `Euro` | Summe der Freibeträge für Kinder nach § 32 Absatz 6 EStG, abhängig von Steuerklasse und Kinderzahl. |
| `kztab` | `Tarifart` | Tarif-Kennzahl: `Splitting` in Steuerklasse III, sonst `Grundtarif` (entspricht dem PAP-Feld KZTAB). |
| `ztabfb` | `Euro` | Summe der festen Tabellenfreibeträge ANP + SAP + EFA (PAP-Feld ZTABFB). |

### Funktionen

#### fn `tabellenFreibetraege`

```findsl
fn tabellenFreibetraege(stkl: Steuerklasse, zkf: Dezimal): TabellenFreibetraege
```

Berechnet die festen Tabellenfreibeträge für eine gegebene Steuerklasse
und Kinderzahl.

##### Anmerkungen

In Steuerklasse I gibt es weder Arbeitnehmer- noch Sonderausgaben-Pauschbetrag
(PAP-Konvention für die reine Tabellenstufung; in der Veranlagung gelten die
Pauschbeträge selbstverständlich auch für StKl I).

##### Beispiel

```findsl
tabellenFreibetraege(III, 2).kfb    == 9.600
tabellenFreibetraege(III, 2).kztab  == Splitting
tabellenFreibetraege(II,  0).efa    == 4.260
```

##### Verweise

- PAP 2025 Subroutine `MZTABFB` (BMF, Stand 22.1.2025)
- § 9a EStG (Werbungskosten-Pauschbetrag)
- § 10c EStG (Sonderausgaben-Pauschbetrag)
- § 24b EStG (Entlastungsbetrag für Alleinerziehende)
- § 32 Absatz 6 EStG (Kinderfreibetrag)

**Parameter**

| Name | Beschreibung |
| --- | --- |
| `stkl` | Steuerklasse des Arbeitnehmers (I bis VI). Steuerklasse III aktiviert das Splittingverfahren über `kztab = Splitting`. |
| `zkf` | Anzahl der Kinderfreibeträge. Dezimalstellen erlaubt (z. B. 0,5 für hälftige Berücksichtigung bei getrennt lebenden Eltern). |

**Rückgabe** — Datensatz `TabellenFreibetraege` mit den fünf Pauschbetrags- Komponenten und der Tarif-Kennzahl `KZTAB`.

> Quelle: PAP 2025 — Subroutine MZTABFB

## Modul `lohnsteuer/tabellen/freibetraege2025.test`

#### Akzeptanztests — Tabellenfreibeträge 2025

Knotenpunkte aller Steuerklassen, entsprechen den BMF-Prüftabellen.
Die geprüfte Funktion stammt aus `freibetraege2025`;
diese Datei enthält ausschließlich die `prüfe`-Blöcke.

### Prüfungen

#### prüfe `Tabellenfreibeträge — Knotenpunkte aller Steuerklassen`

```findsl
prüfe "Tabellenfreibeträge — Knotenpunkte aller Steuerklassen"
```

**Testfall — STKL I, keine Kinder**

```findsl
tabellenFreibetraege(I, 0).ztabfb == 0
```

**Testfall — STKL II, keine Kinder (Alleinerziehende EFA aktiv)**

```findsl
tabellenFreibetraege(II, 0).ztabfb == 5.526
```

**Testfall — STKL III, KZTAB ist Splitting**

```findsl
tabellenFreibetraege(III, 0).kztab == Splitting
```

**Testfall — STKL III, 2 Kinder, KFB nach § 32 Abs. 6 EStG**

```findsl
tabellenFreibetraege(III, 2).kfb == 9.600
```

**Testfall — STKL IV, 2 Kinder, KFB nach § 32 Abs. 6 EStG (voller Satz)**

```findsl
ausgabe("")
        var x : Euro = 2
        var y : Cent = 20
        var z : Cent = x + y
        ausgabe("x: ${x}, y: ${y}, z: ${z}")
        tabellenFreibetraege(IV, 2).kfb == 19.200
```

**Testfall — STKL VI, halbes Kind (halber KFB-Satz IV–VI)**

```findsl
tabellenFreibetraege(VI, 0,5).kfb == 4.800
```
