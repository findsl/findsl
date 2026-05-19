// Unbenanntes (Default-)Package — die generierte Kst.java liegt seit
// ADR8 ebenfalls im unbenannten Package (Quelldatei direkt im
// Basisverzeichnis examples/kst).

import org.findsl.runtime.FinDslNumber;

/**
 * Phase-1-Differential: ruft die generierten Kst-Methoden (Objekt-Form,
 * Instanzmethoden, lowerCamel) mit den exakten Eingaben aus
 * examples/kst/kst.test.findsl und prueft gegen die Orakel-Sollwerte
 * (handgerechnet im .test-File; der Interpreter liefert sie laut gruener
 * vitest-Suite genau so). equalsValue = valuesEqual-Spiegel.
 */
public final class KstDifferential {
    private static int fails = 0;
    private static final Kst k = Kst.newInstance();

    static FinDslNumber g(String s) { return FinDslNumber.ganzzahl(s); }
    static FinDslNumber e(String s) { return FinDslNumber.euro(s); }
    static FinDslNumber p(String s) { return FinDslNumber.prozent(s); }

    static void check(String name, boolean ok) {
        if (!ok) { fails++; System.out.println("FAIL  " + name); }
        else System.out.println("ok    " + name);
    }
    static void eq(String name, FinDslNumber a, FinDslNumber b) {
        check(name, a.equalsValue(b));
    }

    public static void main(String[] args) {
        // § 23 Abs. 1 — Staffel
        eq("KstSatz 2010=15%", k.kstSatz(g("2010")), p("0.15"));
        eq("KstSatz 2025=15%", k.kstSatz(g("2025")), p("0.15"));
        eq("KstSatz 2027=15%", k.kstSatz(g("2027")), p("0.15"));
        eq("KstSatz 2028=14%", k.kstSatz(g("2028")), p("0.14"));
        eq("KstSatz 2029=13%", k.kstSatz(g("2029")), p("0.13"));
        eq("KstSatz 2030=12%", k.kstSatz(g("2030")), p("0.12"));
        eq("KstSatz 2031=11%", k.kstSatz(g("2031")), p("0.11"));
        eq("KstSatz 2032=10%", k.kstSatz(g("2032")), p("0.1"));
        eq("KstSatz 2050=10%", k.kstSatz(g("2050")), p("0.1"));

        // § 24 — Freibetrag
        eq("FB 100000/Keiner=5000", k.freibetragNach24(e("100000"), Kst.Freibetragsausschluss.Keiner), e("5000"));
        eq("FB 3000/Keiner=3000",   k.freibetragNach24(e("3000"),   Kst.Freibetragsausschluss.Keiner), e("3000"));
        eq("FB 5000/Keiner=5000",   k.freibetragNach24(e("5000"),   Kst.Freibetragsausschluss.Keiner), e("5000"));
        eq("FB 0/Keiner=0",         k.freibetragNach24(e("0"),      Kst.Freibetragsausschluss.Keiner), g("0"));
        eq("FB 100000/Nr1=0",       k.freibetragNach24(e("100000"), Kst.Freibetragsausschluss.Nr1KapitalLeistungen), g("0"));

        // § 7 Abs. 2 — zvE
        eq("zvE 100000-5000-0=95000",     k.zuVersteuerndesEinkommen(e("100000"), e("5000"), g("0")), e("95000"));
        eq("zvE 100000-5000-10000=85000", k.zuVersteuerndesEinkommen(e("100000"), e("5000"), e("10000")), e("85000"));

        // § 23 Abs. 1 × § 31 S. 2 — Betrag + Rundung
        eq("KSt 95000×15%(2025)=14250",  k.körperschaftsteuerBetrag(e("95000"), g("2025")), e("14250"));
        eq("KSt 12345×15%→1851 (S.2)",   k.körperschaftsteuerBetrag(e("12345"), g("2025")), e("1851"));
        eq("KSt 1000000×14%(2028)=140000", k.körperschaftsteuerBetrag(e("1000000"), g("2028")), e("140000"));
        eq("KSt zvE 0 → 0",              k.körperschaftsteuerBetrag(e("0"), g("2025")), g("0"));

        // § 23 Abs. 2 — Anpassung
        eq("Anp 10000/0%=10000",  k.anwenden23Abs2(e("10000"), p("0")), e("10000"));
        eq("Anp 10000/10%=11000", k.anwenden23Abs2(e("10000"), p("0.1")), e("11000"));

        // Gesamtberechnung
        Kst.KörperschaftsteuerErgebnis r1 = k.berechneKörperschaftsteuer(
            new Kst.KörperschaftsteuerFall(e("100000"), g("2025"), Kst.Freibetragsausschluss.Keiner, g("0"), p("0")));
        eq("Ges1 FB=5000",  r1.freibetragNach24(), e("5000"));
        eq("Ges1 zvE=95000", r1.zuVersteuerndesEinkommen(), e("95000"));
        eq("Ges1 satz=15%",  r1.steuersatz(), p("0.15"));
        eq("Ges1 KSt=14250", r1.körperschaftsteuer(), e("14250"));

        Kst.KörperschaftsteuerErgebnis r2 = k.berechneKörperschaftsteuer(
            new Kst.KörperschaftsteuerFall(e("1000000"), g("2028"), Kst.Freibetragsausschluss.Nr1KapitalLeistungen, g("0"), p("0")));
        eq("Ges2 FB=0",        r2.freibetragNach24(), g("0"));
        eq("Ges2 zvE=1000000", r2.zuVersteuerndesEinkommen(), e("1000000"));
        eq("Ges2 satz=14%",    r2.steuersatz(), p("0.14"));
        eq("Ges2 KSt=140000",  r2.körperschaftsteuer(), e("140000"));

        Kst.KörperschaftsteuerErgebnis r3 = k.berechneKörperschaftsteuer(
            new Kst.KörperschaftsteuerFall(e("3000"), g("2032"), Kst.Freibetragsausschluss.Keiner, g("0"), p("0")));
        eq("Ges3 FB=3000",  r3.freibetragNach24(), e("3000"));
        eq("Ges3 zvE=0",    r3.zuVersteuerndesEinkommen(), g("0"));
        eq("Ges3 KSt=0",    r3.körperschaftsteuer(), g("0"));

        Kst.KörperschaftsteuerErgebnis r4 = k.berechneKörperschaftsteuer(
            new Kst.KörperschaftsteuerFall(e("100000"), g("2025"), Kst.Freibetragsausschluss.Keiner, e("10000"), p("0")));
        eq("Ges4 zvE=85000",  r4.zuVersteuerndesEinkommen(), e("85000"));
        eq("Ges4 KSt=12750",  r4.körperschaftsteuer(), e("12750"));

        System.out.println(fails == 0
            ? "\nDIFFERENTIAL GRUEN — alle kst.test-Faelle bit-genau"
            : ("\nDIFFERENTIAL ROT — " + fails + " Abweichung(en)"));
        System.exit(fails == 0 ? 0 : 1);
    }
}
