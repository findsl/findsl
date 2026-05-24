# Generierte TS-/JS-Module testen: Mocking-Naht (`vi.mock`)

> Bezug: Issue #142 (Folge zu #141, Java-DI). Diese Seite beschreibt, **wie
> Konsumenten** des TS-/JS-Generats Cross-Modul-Abhängigkeiten im Test durch
> Stubs ersetzen — und **warum** die Struktur bewusst von der Java-Lösung (#141)
> abweicht.

## Die Naht: Namespace-Importe

Ein generiertes FinDSL-Modul besteht aus **reinen, zustandslosen Top-Level-
Funktionen** (bit-genau zum Interpreter). Ruft ein Modul eine Funktion eines
anderen Moduls auf, geschieht das **ausschließlich** über einen Namespace-
Import:

```ts
// Kraftst.ts (komponierendes Modul)
import * as KraftstgTarifLeicht from './KraftstgTarifLeicht.js';

export function tarifNach9Abs1(f: KraftstgTypen.Fahrzeug): EuroCent {
    // …
    if (f.art === KraftstgTypen.Fahrzeugart.Pkw) {
        return EuroCent.von(KraftstgTarifLeicht.steuerPkw(f)); // ← Cross-Modul-Aufruf
    }
    // …
}
```

Diese `import * as Owner` + `Owner.methode(…)`-Kante ist der **einzige**
Kopplungspunkt zwischen Modulen — und damit der Austauschpunkt fürs Mocking.
Es gibt keinen direkten, nicht-mockbaren Named-Import einer Cross-Modul-
Funktion. (Regressionsschutz: `packages/core/test/codegen/ts-mock-seam.test.ts`.)

## So mockst du ein Sub-Modul (`vitest`)

```ts
import { vi, it, expect } from 'vitest';
import * as Tarif from './KraftstgTarifLeicht.js';
import { tarifNach9Abs1 } from './Kraftst.js';
import * as Typen from './KraftstgTypen.js';
import { EuroCent, FinDslNumber } from './runtime/index.js';

// Ersetzt ALLE Exporte von KraftstgTarifLeicht durch Auto-Mocks.
vi.mock('./KraftstgTarifLeicht.js');

it('isolierter Test mit gestubbter Abhängigkeit', () => {
    // Stub-Rückgabe über die Runtime bauen (von() erwartet eine FinDslNumber):
    vi.mocked(Tarif.steuerPkw).mockReturnValue(EuroCent.von(FinDslNumber.dezimal('123.45')));

    const f = { art: Typen.Fahrzeugart.Pkw } as Typen.Fahrzeug;
    const result = tarifNach9Abs1(f);

    expect(Tarif.steuerPkw).toHaveBeenCalled();
    expect(result.equalsValue(FinDslNumber.dezimal('123.45'))).toBe(true);
});
```

### ESM-Mock-Semantik (wichtig)

- **Hoisting:** `vi.mock(...)` wird von Vitest an den Dateianfang gehoben (vor
  alle Importe). Schreibe es daher auf Modulebene, nicht in `beforeEach`. Für
  dynamisch berechnete Stubs `vi.mocked(...).mockReturnValue(...)` **im Test**
  setzen (wie oben), nicht in der Factory.
- **Modul-weit:** Der Mock ersetzt das Sub-Modul für **alle** Importeure
  innerhalb derselben Testdatei. `vi.mock` ohne Factory **auto-mockt** (jede
  exportierte Funktion → `vi.fn()`, Default-Rückgabe `undefined`); setze die
  benötigten Rückgaben explizit, sonst läuft z. B. `EuroCent.von(undefined)`
  in einen Fehler.
- **Stub-Werte über die Runtime:** Geld-/Zahlwerte mit
  `EuroCent.von(FinDslNumber.dezimal('…'))` (bzw. `Ganzzahl.von(FinDslNumber.ganzzahl('…'))`)
  bauen — `…​.von()` erwartet eine `FinDslNumber`, keine native Zahl.

### JavaScript-Target

`--lang js` ist ein **deterministischer Typ-Strip** des TS-Generats
(`emit-js/strip.ts`). Die Namespace-Import-Naht bleibt unverändert erhalten →
exakt dasselbe `vi.mock`-Muster gilt für das JS-Generat (importiere weiterhin
`./Kraftst.js` usw.).

## Warum keine Konstruktor-Injektion wie im Java-Generat (#141)?

Die strukturelle Abweichung zu #141 ist **beabsichtigt** — gleiche Zielsetzung
(Testbarkeit/Mocking), unterschiedliche Sprachidiome:

| | Java (#141) | TypeScript/ESM (#142) |
|---|---|---|
| Mock-Mechanismus | Mockito mockt Klassen/Interfaces | `vi.mock` ersetzt Module |
| Nötiger Injektionspunkt | Konstruktor-Injektion + Factory pro Package | **keiner** — die Modul-Kante genügt |
| Modulform | Interface + Impl, Instanzen | Top-Level-`export function` (zustandslos) |

FinDSL-Module haben **keinen Konstruktions-Zustand**, der zu injizieren wäre;
die einzige „Abhängigkeit" ist die statische Referenz auf ein anderes
Funktionsmodul — ESM-Modul-Mocking trifft genau das. Die funktionale Modulform
(`emit-ts/emitter.ts`) auf Closure-Factory oder Klassen+Factory umzubauen würde
den Emitter erheblich verkomplizieren, das Drift-Risiko gegen das bit-genaue
Orakel erhöhen und Konsumenten ein unnötiges Factory-Ritual aufzwingen
(Verstoß gegen KISS/YAGNI und „Sprachidiom respektieren").

→ **„Parität zu #141" bedeutet hier: gleichwertige Mocking-Naht, nicht gleiche
Struktur.** Ein späterer Klassen-/Factory-Umbau wäre eine Fehlinterpretation.
