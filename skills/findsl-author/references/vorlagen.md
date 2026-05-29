# FinDSL — Vorlagen (kommentierte Skelette)

Kopiere diese Muster, statt frei zu erfinden. Platzhalter in `<…>`.
Die Syntax-Regeln dahinter stehen in `sprache-referenz.md`.

## Datei-Kopf (Pflicht in jeder `.findsl`)

```
--
# <Titel> — <Kurzbeschreibung> (§§ … <ABK>)

<Was wird abgebildet, welche Fassung/Reihenfolge.>

**Bewusst nicht modelliert (dokumentiert):**
- <Bemessungsbasis aus anderem Recht> geht als geprüfte Eingabe ein.
- <Verfahren §§ …>.
--
```

## Konstante

```
--
<Doc-Block: was, welche Fundstelle, welcher Wert.>
--
@Quelle("§ 23 Absatz 1 Nummer 1 KStG")
konst KST_SATZ_BIS_2027: Prozent = 15%
```

Kumulative Staffelwerte **ableiten**, nicht handsummieren:

```
konst NR3_KUM_3000: EuroCent = NR3_KUM_2000 + NR3_2000_3000 * 5
```

## Aufzählung

```
--
<Wofür diese Klassifizierung steht.>

@param Keiner   <Bedeutung des Werts.>
@param Nr1Kap   <Bedeutung des Werts.>
--
@Quelle("§ 24 Satz 2 KStG")
aufzählung Ausschlussgrund { Keiner, Nr1Kap, Nr2Verein, Nr3Fonds }
```

## Eingabe- und Ergebnis-Datensatz

```
--
Eingaben des <Steuer>-Falls.

@param einkommen   Zu versteuerndes Einkommen (geprüfte Eingabe).
@param ausschluss  Ausschlussgrund für den Freibetrag.
--
datensatz KörperschaftsteuerFall(
    einkommen: Euro,                       // geprüfte Eingabe (§ 8 Abs. 1 KStG)
    ausschluss: Ausschlussgrund = Keiner,  // Default: kein Ausschluss
    jahr: Ganzzahl = 2027,                 // Veranlagungszeitraum
)

--
Ergebnis mit jeder Zwischengröße der gesetzlichen Reihenfolge.

@param freibetrag    Angewandter Freibetrag (§ 24 KStG).
@param bemessung     Bemessungsgrundlage nach Freibetrag (§ 7 Abs. 2).
@param steuer        Festgesetzte Steuer, gerundet (§ 31 Satz 2).
--
datensatz KörperschaftsteuerErgebnis(
    freibetrag: Euro,    // Schritt 1
    bemessung: Euro,     // Schritt 2
    steuer: Euro,        // Schritt 3 (Endbetrag)
)
```

## Stufen-Funktion

```
--
<Welche Norm-/Logikstufe. @param/@rückgabe.>

@param einkommen   <…>
@rückgabe          <…>
--
@Quelle("§ 24 Satz 1 KStG")
fn FreibetragNach24(einkommen: Euro, ausschluss: Ausschlussgrund): Euro =
    wähle (ausschluss) {
        falls Keiner -> FREIBETRAG_24.höchstens(einkommen)
        sonst        -> 0
    }
```

> **Namensregel (harte Regel, SPEC § 2.5):** Funktionen, Datensätze,
> Aufzählungstypen und Aufzählungswerte beginnen mit **Großbuchstaben**
> (UpperCamelCase, führendes `_` erlaubt). Nur `var`/Parameter/Felder sind
> lowerCamelCase; `konst` ist UPPER_SNAKE. `fn freibetrag(…)` wäre ein
> **Fehler** — `fn Freibetrag(…)`.

## Modul-interner Helfer (kein `@Quelle`, führendes `_`)

```
-- Floor bei 0: nie ein negativer Betrag. --
fn _NichtNegativ(betrag: EuroCent): EuroCent = betrag.mindestens(0,00)
```

## Orchestrator (Block-Body)

Drei Regeln, die hier zusammenkommen:

1. **Block-Ergebnis nie mit `(` beginnen**, wenn die Vorzeile mit `)` endet
   (Statement-Grenze `)(`). Zwischengrößen an `var` binden, am Ende den
   `Name(...)`-Konstruktor zurückgeben.
2. **Runden an einer typgebundenen `var`** (`var steuer: Euro = (…).abrunden()`)
   — die `Euro`-Annotation liefert das Rundungsziel zuverlässig. **Verlasse
   dich NICHT** darauf, dass der fn-Rückgabetyp die Rundung durch einen
   `wähle`/`wenn`-Arm hindurch erzwingt (tut er nicht zuverlässig).
3. Jede `var` muss benutzt werden; jede Zwischengröße wird ein Ergebnis-Feld.

```
--
Berechnet die Körperschaftsteuer in gesetzlicher Reihenfolge.

@param fall   Eingaben des Steuerfalls.
@rückgabe     Ergebnis mit allen Zwischengrößen.
--
@Quelle("§ 7 Absatz 2 KStG")
fn BerechneKörperschaftsteuer(fall: KörperschaftsteuerFall): KörperschaftsteuerErgebnis = {
    var freibetrag: Euro = FreibetragNach24(fall.einkommen, fall.ausschluss)
    var bemessung: Euro = (fall.einkommen - freibetrag).mindestens(0)
    var satz: Prozent = SatzFürJahr(fall.jahr)
    var steuer: Euro = (bemessung * satz).abrunden()   // Runden an typgebundener var
    KörperschaftsteuerErgebnis(
        freibetrag = freibetrag,
        bemessung = bemessung,
        steuer = steuer,
    )
}
```

## Testdatei `<slug>.test.findsl`

```
--
# Tests <Steuer>

Sollwerte von Hand aus dem Wortlaut gerechnet (Quelle je testfall im Label).
--
verwende {
    KörperschaftsteuerFall,
    KörperschaftsteuerErgebnis,
    BerechneKörperschaftsteuer,
} aus "./kst"

prüfe "§ 24 Freibetrag" {
    testfall "Einkommen über Freibetrag: 5.000 € abgezogen" {
        var e: KörperschaftsteuerErgebnis =
            BerechneKörperschaftsteuer(KörperschaftsteuerFall(einkommen = 100.000))
        e.freibetrag == 5.000
            und e.bemessung == 95.000
            und e.steuer == 14.250          // 95.000 * 15 %
    }
    testfall "Ausschluss: kein Freibetrag" {
        var e: KörperschaftsteuerErgebnis = BerechneKörperschaftsteuer(
            KörperschaftsteuerFall(einkommen = 100.000, ausschluss = Nr1Kap))
        e.freibetrag == 0 und e.steuer == 15.000
    }
}

prüfe "unzulässiges Jahr" {
    testfall "Jahr vor Modellstand bricht ab" erwartet abbruch {
        BerechneKörperschaftsteuer(KörperschaftsteuerFall(einkommen = 100.000, jahr = 1990))
    }
}
```

---

## Vollständiges Mini-Beispiel (Pfad A, ohne Gesetz)

Regel: *„Die Abgabe beträgt 2 % vom Umsatz. Unter 10.000 € Umsatz fällt
keine Abgabe an. Auf volle Euro abrunden."*

`abgabe.findsl`:

```
--
# Umsatzabgabe — 2 % über einer Freigrenze

Einfache Abgabe: 2 % vom Umsatz, aber nur ab 10.000 € Umsatz; Ergebnis auf
volle Euro abgerundet.

**Bewusst nicht modelliert / angenommen:**
- Der Umsatz geht als geprüfte Eingabe (volle Euro) ein.
- „Abrunden" wurde als kaufmännisches Abrunden auf volle Euro angenommen.
--

-- Abgabesatz: 2 % des Umsatzes. --
konst SATZ: Prozent = 2%

-- Freigrenze: unterhalb dieses Umsatzes fällt keine Abgabe an. --
konst FREIGRENZE: Euro = 10.000

-- Eingaben des Abgabefalls. @param umsatz Jahresumsatz (volle Euro). --
datensatz AbgabeFall(umsatz: Euro)

--
Abgabe nach Freigrenze und Satz, auf volle Euro abgerundet.
@param fall  Abgabefall.
@rückgabe    Abgabe in vollen Euro.
--
fn Abgabe(fall: AbgabeFall): Euro = {
    var roh: EuroCent = wähle {
        falls fall.umsatz < FREIGRENZE -> 0,00
        sonst                          -> fall.umsatz * SATZ
    }
    var betrag: Euro = roh.abrunden()   // Rundung an typgebundener var
    betrag
}
```

(`fn Abgabe`, nicht `abgabe` — Großbuchstabe Pflicht. `wähle` liefert
`EuroCent`, gerundet wird an der typgebundenen `var betrag: Euro` — nicht
über den `wähle`-Arm. Letztes Block-Element ist der blanke Identifier
`betrag`, kein `(…)` → keine `)(`-Statement-Grenze.)

`abgabe.test.findsl`:

```
--
# Tests Umsatzabgabe (Sollwerte von Hand gerechnet).
--
verwende { AbgabeFall, Abgabe } aus "./abgabe"

prüfe "Umsatzabgabe" {
    testfall "knapp unter Freigrenze: keine Abgabe" {
        Abgabe(AbgabeFall(umsatz = 9.999)) == 0
    }
    testfall "an der Freigrenze: 2 % von 10.000 = 200" {
        Abgabe(AbgabeFall(umsatz = 10.000)) == 200
    }
    testfall "Abrundung: 2 % von 50.001 = 1.000,02 -> 1.000" {
        Abgabe(AbgabeFall(umsatz = 50.001)) == 1.000
    }
}
```

> Dieses Beispiel ist mit `parse` (0 Fehler) + `test` (3/3) **verifiziert**.
> Vor dem Ausliefern **immer** `parse` + `test` laufen lassen (siehe
> `SKILL.md` → Verifizieren). Die `@Quelle`-Warnung für gesetzlose
> Konstanten ist erwartbar (kein Fehler). Bei realer Generierung jeden
> Sollwert selbst nachrechnen.
