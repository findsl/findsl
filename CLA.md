# Contributor License Agreement (CLA) — FinDSL

Lizenznehmerin / Empfängerin der Rechteeinräumung: **devtank42 GmbH**
("devtank42"). Projekt: **FinDSL**.

Mit Einreichung eines Beitrags zu FinDSL stimmst du ("Beitragende:r")
diesem CLA zu. Es gibt zwei Varianten — wähle die zutreffende.

---

## Teil A — Individual CLA (natürliche Person)

1. **Definition "Beitrag".** Jeglicher von dir eingereichter Quelltext,
   jede Dokumentation, Konfiguration oder sonstiges Werk, das bewusst zur
   Aufnahme in FinDSL übermittelt wird ("Beitrag").

2. **Urheberrechtliche Lizenz.** Du räumst der devtank42 ein
   **weltweites, zeitlich und räumlich unbeschränktes, nicht
   ausschließliches, unwiderrufliches, übertragbares und
   unterlizenzierbares Nutzungsrecht** an deinem Beitrag ein, diesen in
   jeder bekannten und künftigen Nutzungsart zu nutzen, zu vervielfältigen,
   zu bearbeiten, zu verbreiten, öffentlich zugänglich zu machen und
   **unter beliebigen Lizenzbedingungen — einschließlich der EUPL-1.2
   sowie proprietärer/kommerzieller Lizenzen — zu unterlizenzieren**
   (Dual-Licensing).

3. **Patentlizenz.** Du gewährst der devtank42 und den Empfängern von
   FinDSL eine weltweite, royalty-freie, nicht ausschließliche,
   unwiderrufliche Patentlizenz an deinen Patentansprüchen, soweit sie
   durch deinen Beitrag oder dessen Kombination mit FinDSL notwendig
   verletzt würden.

4. **Du behältst deine Rechte.** Du bleibst Inhaber:in der Rechte an
   deinem Beitrag und darfst ihn uneingeschränkt auch anderweitig
   verwenden. Es findet **keine Vollrechtsübertragung** statt — nur die
   oben genannte (weite) Rechteeinräumung.

5. **Zusicherungen.** Du sicherst zu, dass (a) jeder Beitrag dein
   Originalwerk ist bzw. du zur Einräumung berechtigt bist, (b) dir keine
   Rechte Dritter oder deines Arbeitgebers entgegenstehen (bei
   Angestellten: § 69b UrhG / ggf. Arbeitgeber-Freigabe), (c) du Beiträge,
   die fremdem Recht unterliegen, deutlich kennzeichnest.

6. **Keine Gewährleistung.** Beiträge werden "wie besehen" eingebracht;
   über dieses CLA hinaus übernimmst du keine Gewährleistung.

---

## Teil B — Entity CLA (juristische Person / Arbeitgeber)

Wird der Beitrag im Rahmen eines Arbeits-/Auftragsverhältnisses
erbracht, schließt die **berechtigte vertretungsbefugte Person** der
Organisation dieses Entity CLA mit identischem Rechteumfang wie Teil A.
Die Organisation sichert zu, dass alle benannten beitragenden Personen
zur Einräumung berechtigt sind, und benennt diese (Liste pflegbar).

---

## Zustimmung / Signatur

Bis ein elektronischer CLA-Bot eingerichtet ist, gilt ein Beitrag als
unter diesem CLA eingebracht, wenn der Pull Request **eine der folgenden
Bestätigungen** enthält:

```
Ich habe CLA.md gelesen und stimme dem Individual CLA (Teil A) zu.
Name: <Vor- und Nachname>   E-Mail: <E-Mail>   Datum: <JJJJ-MM-TT>
```

oder für Organisationen analog mit Teil B und Angabe der Organisation
sowie der vertretungsbefugten Person.

Die devtank42 archiviert die Zustimmungen. Fragen: **contact@devtank42.de**.

---

## Datei-Header-Konvention

Jede **neue** Quelldatei (TypeScript/JavaScript) trägt oben — bei
Shebang-Dateien *nach* der `#!`-Zeile — folgenden Header:

```ts
// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2
```

Andere Dateitypen analog mit der jeweiligen Kommentarsyntax. Bestehende
Dateien werden schrittweise nachgezogen; das Fehlen eines Headers in
Altbestand ändert die Lizenzlage nicht (maßgeblich sind `LICENSE`,
`NOTICE` und die `package.json`-`license`-Felder).
