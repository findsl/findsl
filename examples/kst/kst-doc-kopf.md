---
name: Körperschaftsteuer — Tarif, Freibetrag, Bemessungsgrundlage
untertitel: Festsetzung der Körperschaftsteuer nach §§ 7, 23, 24, 31 KStG
autor: FinDSL
beschreibung: Audit-fähige, ausführbare Abbildung der Körperschaftsteuer-Festsetzung aus FinDSL-Quelltext.
metadaten:
  Gesetz: Körperschaftsteuergesetz (KStG 1977)
  Stand: zuletzt geändert durch Art. 30 G v. 4.2.2026 I Nr. 33
  Normbereich: §§ 7, 23, 24, 31 KStG
  Quelle: gesetze-im-internet.de/kstg_1977
  Erzeugung: findsl doku (aus FinDSL-Quelltext)
---

## Zweck dieser Dokumentation

Diese Dokumentation ist eine **Audit-Vorlage**: Sie wird vollständig
und deterministisch aus dem FinDSL-Quelltext des Körperschaftsteuer-
Moduls erzeugt. Jede Konstante, jede Rechenstufe und jeder Testfall
stammt unverändert aus der ausführbaren Quelle — es gibt keine
zweite, abweichende „Erklärung". Damit ist sie gleichermaßen für
Sachbearbeiter:innen, Verwaltungsjurist:innen, Prüfer:innen und
maschinelle Auswertung (KI-gestützte Audits) geeignet.

## Abgebildeter Normbereich

Modelliert ist die Festsetzung der Körperschaftsteuer in der
gesetzlichen Reihenfolge:

- **§ 24 KStG** — Freibetrag von 5.000 €, höchstens in Höhe des
  Einkommens (Satz 1), mit den drei Ausschlusstatbeständen des
  Satz 2 (Nr. 1–3).
- **§ 7 Abs. 2 KStG** — zu versteuerndes Einkommen = Einkommen
  i.S.d. § 8 Abs. 1 KStG, vermindert um die Freibeträge der
  §§ 24 und 25 KStG.
- **§ 23 Abs. 1 KStG** — nach Veranlagungszeitraum gestaffelter
  Steuersatz (bis 2027: 15 %, 2028: 14 %, 2029: 13 %, 2030: 12 %,
  2031: 11 %, ab 2032: 10 %).
- **§ 31 Satz 2 KStG** — Abrundung der festgesetzten Steuer auf
  volle Euro zugunsten der/des Steuerpflichtigen.
- **§ 23 Abs. 2 KStG** — proportionale Anpassung über die
  Ermächtigung des § 51 Abs. 3 EStG (Regelfall 0 %).

## Bewusst nicht modelliert

Außerhalb des Normbereichs §§ 7/23/24 und daher als **geprüfte
Eingaben** geführt (damit die § 7 Abs. 2-Formel rechnerisch
vollständig bleibt):

- die Ermittlung des **Einkommens i.S.d. § 8 Abs. 1 KStG** selbst
  (sie folgt den Vorschriften des EStG/KStG und ist ein eigenes,
  hier nicht abgebildetes Verfahren);
- der **Freibetrag nach § 25 KStG**.

## So liest sich dieses Dokument

- Jede **Datei** des Moduls ist ein eigenes Kapitel; die Testdatei
  (`*.test.findsl`) erscheint transparent als eigenes Kapitel.
- Innerhalb eines Kapitels sind die Deklarationen nach Bereich
  gruppiert (Konstanten, Datensätze, Aufzählungen, Funktionen,
  Prüfungen).
- **§-Verweise** in Prosa und in den `@Quelle`-Hinweisen sind als
  Tiefenlinks auf *gesetze-im-internet.de* klickbar.
- Einträge unter **Testfall** sind ausführbare Akzeptanztests; alle
  Sollwerte wurden von Hand aus dem Gesetzeswortlaut gerechnet.
- Ein etwaiger Anhang **„Explizit ausgeschlossene Konstellationen"**
  listet alle begründeten, nicht abfangbaren Fachabbrüche.

## Prüf- und Audit-Hinweis

Jede normgebundene Konstante und Funktion trägt eine
`@Quelle`-Annotation auf die exakte Fundstelle. Geldbeträge werden
präzise (ohne Float-Rundungsfehler) geführt; Rundung erfolgt
ausschließlich explizit an der gesetzlich vorgesehenen Stelle
(§ 31 Satz 2 KStG). Die Berechnung bildet die vom Gesetz
vorgeschriebene Arithmetik vollständig und exakt ab — Abweichungen
sind gegen den zitierten Paragraphen zu prüfen, nicht gegen diese
Darstellung.
