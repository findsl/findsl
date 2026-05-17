---
name: Gewerbesteuer — Messbetrag und Steuer
untertitel: Festsetzung der Gewerbesteuer nach §§ 7–11, 16 GewStG (Fassung ab EZ 2025)
autor: FinDSL
beschreibung: Audit-fähige, ausführbare Abbildung der Gewerbesteuer-Festsetzung aus FinDSL-Quelltext.
metadaten:
  Gesetz: Gewerbesteuergesetz (GewStG)
  Stand: Fassung ab Erhebungszeitraum 2025 (§ 36 Abs. 4b GewStG)
  Normbereich: §§ 6, 7, 8, 9, 10, 10a, 11, 16, 36 GewStG
  Quelle: gesetze-im-internet.de/gewstg
  Erzeugung: findsl doku (aus FinDSL-Quelltext)
---

## Zweck dieser Dokumentation

Diese Dokumentation ist eine **Audit-Vorlage**: Sie wird vollständig
und deterministisch aus dem FinDSL-Quelltext des Gewerbesteuer-Moduls
erzeugt. Hinzurechnungen, Kürzungen, die Mindestbesteuerung des
Verlustabzugs, Freibetrag/Steuermesszahl und der Hebesatz stammen
unverändert aus der ausführbaren Quelle. Ziel ist eine **absolut
richtige Berechnung** im modellierten Umfang, nachvollziehbar Schritt
für Schritt gegen das Gesetz.

## Abgebildeter Normbereich

Modelliert ist die Festsetzung in der gesetzlichen Reihenfolge:

- **§ 6 / § 7 Satz 1 / § 10 GewStG** — Gewerbeertrag = Gewinn aus
  Gewerbebetrieb, vermehrt um § 8, vermindert um § 9.
- **§ 8 GewStG** — Hinzurechnungen: Nr. 1 als ein Viertel der
  gewichteten Summe der Finanzierungsanteile a–f (a–c 100 %,
  d 1/5, e 1/2, f 1/4), soweit sie 200.000 € übersteigt, zuzüglich
  der Nummern 4, 5, 8, 9, 10, 12 (übrige Nummern weggefallen).
- **§ 9 GewStG** — Kürzungen: Nr. 1 (Grundsteuer für
  Betriebsgrundbesitz bzw. erweiterte Kürzung auf Antrag),
  Nr. 2/2a/2b/3/7/8 sowie Nr. 5 (Spenden bis zum höheren Betrag
  aus 20 % des Gewinns oder 4 ‰ der Summe aus Umsätzen und Löhnen).
- **§ 10a GewStG** — Verlustabzug mit Mindestbesteuerung: bis
  1 Mio. € voll, der übersteigende Betrag nur zu 60 %.
- **§ 11 GewStG** — Abrundung auf volle 100 €, Freibetrag
  (24.500 € natürliche Personen/Personengesellschaften, 5.000 €
  Vereine/jur. Personen öR, 0 € Kapitalgesellschaften), Steuer-
  messzahl 3,5 % (Hausgewerbetreibende ermäßigt 1,96 %).
- **§ 16 GewStG** — Hebesatz der hebeberechtigten Gemeinde,
  mindestens 200 % (§ 16 Abs. 4 Satz 2).
- **§ 36 Abs. 4b GewStG** — Erhebungszeiträume vor 2025 werden
  bewusst per begründetem Fachabbruch ausgeschlossen.

## Bewusst nicht modelliert

Außerhalb der reinen Steuerbetragsberechnung und daher als
**geprüfte Eingabe** geführt bzw. dokumentiert ausgeschlossen:

- die Ermittlung des **Gewinns aus Gewerbebetrieb** selbst
  (§ 7 Satz 1: „nach den Vorschriften des EStG oder KStG") sowie die
  *Höhe* der einzelnen, aus EStG/KStG-Sachverhalten abgeleiteten
  Hinzurechnungs-/Kürzungsbeträge — das GewStG schreibt nur deren
  Verrechnung vor, und diese ist hier vollständig und exakt
  implementiert;
- die **Zerlegung (§§ 28–34 GewStG)** auf mehrere Gemeinden;
  modelliert ist der Regelfall einer hebeberechtigten Gemeinde;
- Verfahren §§ 14a/19–21, § 35b, abgekürzter Erhebungszeitraum
  (§ 14 Satz 3), Steuerbefreiungen § 3, optierende Gesellschaft
  § 1a KStG (§ 2 Abs. 8); die erweiterte Kürzung § 9 Nr. 1 Satz 2
  dem Grunde nach.

## So liest sich dieses Dokument

- Jede **Datei** des Moduls ist ein eigenes Kapitel; die Testdatei
  (`*.test.findsl`) erscheint transparent als eigenes Kapitel.
- **§-Verweise** in Prosa und `@Quelle`-Hinweisen sind klickbare
  Tiefenlinks auf *gesetze-im-internet.de*.
- Einträge unter **Testfall** sind ausführbare Akzeptanztests; alle
  Sollwerte wurden von Hand aus dem Gesetzeswortlaut gerechnet.
- Der Anhang **„Explizit ausgeschlossene Konstellationen"** listet
  die begründeten, nicht abfangbaren Fachabbrüche (u. a. § 36
  Abs. 4b GewStG).

## Prüf- und Audit-Hinweis

Jede normgebundene Konstante und Funktion trägt eine
`@Quelle`-Annotation auf die exakte Fundstelle. Geldbeträge werden
präzise geführt; Rundung erfolgt ausschließlich explizit an der
gesetzlich vorgesehenen Stelle (§ 11 Abs. 1 Satz 3 GewStG:
Abrundung auf volle 100 €). Die Berechnung bildet die vom Gesetz
vorgeschriebene Arithmetik vollständig und exakt ab — Abweichungen
sind gegen den zitierten Paragraphen zu prüfen, nicht gegen diese
Darstellung.
