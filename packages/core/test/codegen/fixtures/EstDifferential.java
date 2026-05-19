// Unbenanntes (Default-)Package — die generierte Est.java liegt seit
// ADR8 ebenfalls im unbenannten Package (Quelldatei direkt im
// Basisverzeichnis examples/est).

import java.util.List;

import org.findsl.runtime.FinDslAbort;
import org.findsl.runtime.FinDslListe;
import org.findsl.runtime.FinDslNumber;
import org.findsl.runtime.Tarifart;

/**
 * Phase-2-Differential: ruft die generierten Est-Methoden (Objekt-Form,
 * Listen/Lambda/Cast/Interpolation/abbruch) mit den exakten Eingaben aus
 * examples/est/est.test.findsl gegen die handgerechneten Orakel-Sollwerte
 * (der Interpreter liefert sie laut gruener vitest-Suite genau so).
 * equalsValue = valuesEqual-Spiegel (art-agnostisch, Euro-kanonisch).
 */
public final class EstDifferential {
    private static int fails = 0;
    private static final Est e = Est.newInstance();

    static FinDslNumber g(String s) { return FinDslNumber.ganzzahl(s); }
    static FinDslNumber eu(String s) { return FinDslNumber.euro(s); }
    static final FinDslNumber G0 = g("0");

    static void check(String name, boolean ok) {
        if (!ok) { fails++; System.out.println("FAIL  " + name); }
        else System.out.println("ok    " + name);
    }
    static void eq(String name, FinDslNumber a, FinDslNumber b) {
        check(name, a.equalsValue(b));
    }
    static void abbr(String name, Runnable r) {
        try { r.run(); check(name, false); }
        catch (FinDslAbort ok) { check(name, true); }
    }

    static Est.Kind kind(String faktor, String monate) {
        return new Est.Kind(g(faktor), g(monate), FinDslNumber.prozent("1"));
    }

    /** EinkommensteuerFall mit den 8 variierenden Feldern; Rest = Default. */
    static Est.EinkommensteuerFall fall(
            FinDslNumber nsArbeit, FinDslNumber sonstSA,
            FinDslListe<FinDslNumber> spenden, FinDslListe<FinDslNumber> agb,
            FinDslListe<Est.Kind> kinder, Tarifart art,
            FinDslNumber anr, FinDslNumber hinz) {
        return new Est.EinkommensteuerFall(
            G0, G0, G0, nsArbeit, G0, G0, G0, G0, G0, G0,
            sonstSA, spenden, G0, agb, kinder, G0, art, anr, hinz);
    }

    public static void main(String[] args) {
        // § 32a Abs. 1 — Grundtarif (Zonen 1–5)
        eq("Grund 0=0",         e.estGrundtarif(eu("0")),       g("0"));
        eq("Grund 12348=0",     e.estGrundtarif(eu("12348")),   g("0"));
        eq("Grund 12349=0",     e.estGrundtarif(eu("12349")),   g("0"));
        eq("Grund 15000=435",   e.estGrundtarif(eu("15000")),   eu("435"));
        eq("Grund 17799=1034",  e.estGrundtarif(eu("17799")),   eu("1034"));
        eq("Grund 17800=1035",  e.estGrundtarif(eu("17800")),   eu("1035"));
        eq("Grund 50000=10548", e.estGrundtarif(eu("50000")),   eu("10548"));
        eq("Grund 69878=18213", e.estGrundtarif(eu("69878")),   eu("18213"));
        eq("Grund 69879=18213", e.estGrundtarif(eu("69879")),   eu("18213"));
        eq("Grund 100000=30864", e.estGrundtarif(eu("100000")), eu("30864"));
        eq("Grund 277825=105550", e.estGrundtarif(eu("277825")), eu("105550"));
        eq("Grund 277826=105551", e.estGrundtarif(eu("277826")), eu("105551"));
        eq("Grund 300000=115529", e.estGrundtarif(eu("300000")), eu("115529"));

        // § 32a Abs. 5 — Splitting
        eq("Split 200000=61728", e.estSplitting(eu("200000")), eu("61728"));
        eq("Split 100001=21096", e.estSplitting(eu("100001")), eu("21096"));
        eq("Split 150000=40728", e.estSplitting(eu("150000")), eu("40728"));

        // abbruch — negatives zvE
        abbr("Grund(-1) → abbruch", () -> e.estGrundtarif(eu("-1")));
        abbr("Split(-2) → abbruch", () -> e.estSplitting(eu("-2")));

        // § 2 Kaskade mit Listen — Fall K
        Est.EinkommensteuerErgebnis k = e.berechneEinkommensteuer(fall(
            eu("60000"), eu("4000"),
            FinDslListe.of(List.of(eu("2000"))),
            FinDslListe.of(List.of(eu("5000"))),
            FinDslListe.of(List.of(kind("1", "12"), kind("1", "12"))),
            Tarifart.Grundtarif, G0, G0));
        eq("K gde=60000",   k.gesamtbetragDerEinkuenfte(), eu("60000"));
        eq("K kfb=9756",    k.kinderfreibetraege(), eu("9756"));
        eq("K agb=3264",    k.abziehbareAussergewoehnlicheBelastungen(), eu("3264"));
        eq("K ein=50736",   k.einkommen(), eu("50736"));
        eq("K zve=40980",   k.zuVersteuerndesEinkommen(), eu("40980"));
        eq("K tarif=7521",  k.tariflicheEinkommensteuer(), eu("7521"));
        eq("K fest=7521",   k.festzusetzendeEinkommensteuer(), eu("7521"));

        // Fall S — Splitting, 3 Kinder (eines halbjährig), Spenden gekappt
        Est.EinkommensteuerErgebnis s = e.berechneEinkommensteuer(fall(
            eu("100000"), G0,
            FinDslListe.of(List.of(eu("10000"), eu("20000"))),
            FinDslListe.of(List.of(eu("3000"), eu("5000"))),
            FinDslListe.of(List.of(kind("2", "12"), kind("2", "12"), kind("2", "6"))),
            Tarifart.Splitting, eu("2500"), eu("600")));
        eq("S kfb=24390",   s.kinderfreibetraege(), eu("24390"));
        eq("S agb=6511",    s.abziehbareAussergewoehnlicheBelastungen(), eu("6511"));
        eq("S ein=73489",   s.einkommen(), eu("73489"));
        eq("S zve=49099",   s.zuVersteuerndesEinkommen(), eu("49099"));
        eq("S tarif=5462",  s.tariflicheEinkommensteuer(), eu("5462"));
        eq("S fest=3562",   s.festzusetzendeEinkommensteuer(), eu("3562"));

        // Fall L — agB unter zumutbarer Belastung → 0
        Est.EinkommensteuerErgebnis l = e.berechneEinkommensteuer(fall(
            eu("40000"), G0, FinDslListe.empty(),
            FinDslListe.of(List.of(eu("1000"))),
            FinDslListe.empty(), Tarifart.Grundtarif, G0, G0));
        eq("L agb=0",       l.abziehbareAussergewoehnlicheBelastungen(), g("0"));
        eq("L ein=40000",   l.einkommen(), eu("40000"));
        eq("L zve=40000",   l.zuVersteuerndesEinkommen(), eu("40000"));
        eq("L tarif=7209",  l.tariflicheEinkommensteuer(), eu("7209"));

        // Fall 0 — leere Listen (Regressionsanker)
        Est.EinkommensteuerErgebnis n = e.berechneEinkommensteuer(fall(
            eu("50000"), G0, FinDslListe.empty(), FinDslListe.empty(),
            FinDslListe.empty(), Tarifart.Grundtarif, G0, G0));
        eq("0 kfb=0",       n.kinderfreibetraege(), g("0"));
        eq("0 agb=0",       n.abziehbareAussergewoehnlicheBelastungen(), g("0"));
        eq("0 ein=50000",   n.einkommen(), eu("50000"));
        eq("0 zve=50000",   n.zuVersteuerndesEinkommen(), eu("50000"));
        eq("0 tarif=10548", n.tariflicheEinkommensteuer(), eu("10548"));

        System.out.println(fails == 0
            ? "\nDIFFERENTIAL GRUEN — alle est.test-Faelle bit-genau"
            : ("\nDIFFERENTIAL ROT — " + fails + " Abweichung(en)"));
        System.exit(fails == 0 ? 0 : 1);
    }
}
