---
name: Kraftfahrzeugsteuer — vollständiger Jahressteuer-Tarif
untertitel: Festsetzung der Jahressteuer nach §§ 8, 9 KraftStG (i.V.m. §§ 3a, 3d)
autor: FinDSL
beschreibung: Audit-fähige, ausführbare Abbildung des gesamten Kraftfahrzeugsteuer-Tarifs aus FinDSL-Quelltext.
metadaten:
  Gesetz: Kraftfahrzeugsteuergesetz (KraftStG 2002)
  Stand: in der geltenden Fassung (i.d.g.F.)
  Normbereich: §§ 3a, 3d, 8, 9, 9a KraftStG
  Quelle: gesetze-im-internet.de/kraftstg
  Erzeugung: findsl doku (aus FinDSL-Quelltext)
---

## Zweck dieser Dokumentation

Diese Dokumentation ist eine **Audit-Vorlage**: Sie wird vollständig
und deterministisch aus dem FinDSL-Quelltext des Kraftfahrzeugsteuer-
Moduls erzeugt. Tarifsätze, progressive Stufen, Höchstbeträge,
Ermäßigungen und Testfälle stammen unverändert aus der ausführbaren
Quelle. Lesbarkeit für Sachbearbeiter:innen ohne
Programmierhintergrund hat dabei oberste Priorität.

## Modul-Aufbau

Die Umsetzung ist aus Gründen der Wartbarkeit und Transparenz auf
mehrere kohäsive Dateien aufgeteilt; jede Datei erscheint als eigenes
Kapitel:

- **kraftstg-typen** — gemeinsame Aufzählungen (Fahrzeugart,
  Antrieb, Schadstoff-/Geräusch-/Erstzulassungsklasse, Behinderung),
  Eingabe-/Ergebnis-Datensätze und allgemeine Helfer.
- **kraftstg-tarif-leicht** — § 9 Abs. 1 Nr. 1/2/2a/2b: Krafträder,
  Personenkraftwagen (Erstzulassung a/b/c), Wohnmobile, dreirädrige/
  leichte vierrädrige Kfz.
- **kraftstg-tarif-nutzfahrzeug** — § 9 Abs. 1 Nr. 3/4/5: andere
  Kfz ≤ 3.500 kg, Kfz > 3.500 kg (progressive 200-kg-Stufen mit
  Höchstbetrag), Anhänger.
- **kraftstg-steuer** — öffentliche Einstiegsdatei: Tarifauswahl
  nach Fahrzeugart, § 9 Abs. 2 (Elektro-Ermäßigung), § 3a/§ 3d
  (Vergünstigung/Befreiung), Gesamtberechnung, § 9 Abs. 4-Konstanten.

## Abgebildeter Normbereich

- **§ 8 KraftStG** — Bemessungsgrundlage je Fahrzeugart
  (Hubraum / CO₂ / zulässiges Gesamtgewicht) → Tarifauswahl.
- **§ 9 Abs. 1 KraftStG** — Steuersatz, alle Nummern 1–5 inkl. der
  progressiven Gewichts- und CO₂-Bänder und Höchstbeträge. Kumulierte
  Stufenbeträge sind als auditierbare Konstanten aus den Stufensätzen
  abgeleitet (keine handsummierten Werte). „Je angefangene Einheit"
  ist als Aufrundung umgesetzt.
- **§ 9 Abs. 2 KraftStG** — 50 % Ermäßigung für Elektrofahrzeuge
  (nur Beträge nach Abs. 1 Nr. 3 oder Nr. 4 Buchst. a).
- **§ 9 Abs. 4 KraftStG** — Jahressteuer für rote / Oldtimer-
  Kennzeichen.
- **§ 3a KraftStG** — Schwerbehinderten-Vergünstigung (Abs. 1 volle
  Befreiung, Abs. 2 50 % Ermäßigung).
- **§ 3d KraftStG** — Steuerbefreiung für Elektrofahrzeuge.
- **§ 9a KraftStG** — Diesel-Zuschlag: ausgelaufen (galt nur
  1.4.2007–31.3.2011); dokumentiert, nicht mehr angewandt.

## Bewusst nicht modelliert

Außerhalb der reinen Steuerbetragsberechnung und daher dokumentiert
ausgeschlossen bzw. als **geprüfte Eingabe** geführt:

- Verfahren §§ 11/12 (Entrichtung, Festsetzung), Mindestdauer/
  anteilige Berechnung § 5, Ausnahmekatalog § 3, widerrechtliche
  Benutzung, § 9 Abs. 3 (Tagessteuer ausländischer Fahrzeuge).
- Die Zuordnung der **Schadstoff-/Geräusch-/Erstzulassungsklasse**
  trifft nach § 2 Abs. 2 Nr. 2 KraftStG verbindlich die
  Zulassungsbehörde — sie geht als geprüfte Eingabe ein (nicht aus
  EU-Richtlinien hergeleitet).

## So liest sich dieses Dokument

- **§-Verweise** in Prosa und `@Quelle`-Hinweisen sind klickbare
  Tiefenlinks auf *gesetze-im-internet.de*.
- Einträge unter **Testfall** sind ausführbare Akzeptanztests; alle
  Sollwerte wurden unabhängig aus dem Gesetzeswortlaut gerechnet
  (progressive Tarife stufenweise summiert, Höchstbeträge gedeckelt).
- Datensatz-Felder sind einzeln dokumentiert; nicht jedes Feld ist
  für jede Fahrzeugart relevant — maßgeblich ist die Fahrzeugart
  (§ 8 KraftStG).

## Prüf- und Audit-Hinweis

Jede normgebundene Konstante und Funktion trägt eine
`@Quelle`-Annotation auf die exakte Fundstelle (bis hinab zu
Buchstabe/Doppelbuchstabe). Geldbeträge werden präzise geführt;
„je angefangene Einheit" ist explizit als Aufrundung modelliert.
Die Berechnung bildet die vom Gesetz vorgeschriebene Arithmetik
vollständig und exakt ab — Abweichungen sind gegen den zitierten
Paragraphen zu prüfen, nicht gegen diese Darstellung.
