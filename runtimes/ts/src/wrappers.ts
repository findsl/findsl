// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

import { FinDslNumber } from './findsl-number.js';

/**
 * Sprechende Domänen-Sicht-Typen (Euro/EuroCent/Cent/Prozent/Ganzzahl/
 * Dezimal) — je eine {@link FinDslNumber} (IS-A: erben die gesamte
 * bit-genaue Arithmetik/Cast/Rundung/Text-Semantik). KEIN Eigenverhalten,
 * KEIN eigenes Tag: der tatsächliche Laufzeit-Tag bleibt im geerbten
 * `type`-Feld; der Wrapper ist nur die an Deklarationsgrenzen sichtbare
 * Sicht. 1:1-Port der Java-Sicht-Subklassen (`org.findsl.runtime.Euro` …).
 *
 * `von(kern)` etikettiert nur — konvertiert NICHT (Wert + tatsächlicher
 * Tag des Kerns bleiben unverändert). Die echte Zahlart-Konvertierung
 * steht orakel-treu bereits im übergebenen Ausdruck (`.cast(…)` /
 * `.withMoneyAnnotation(…)` / `.abrunden(…)`). Unboxing ist ein No-op
 * (IS-A) — der Emitter reicht den Wert direkt durch.
 */

export class Euro extends FinDslNumber {
    static von(kern: FinDslNumber): Euro { return new Euro(kern.value, kern.type); }
}

export class EuroCent extends FinDslNumber {
    static von(kern: FinDslNumber): EuroCent { return new EuroCent(kern.value, kern.type); }
}

export class Cent extends FinDslNumber {
    static von(kern: FinDslNumber): Cent { return new Cent(kern.value, kern.type); }
}

export class Prozent extends FinDslNumber {
    static von(kern: FinDslNumber): Prozent { return new Prozent(kern.value, kern.type); }
}

export class Ganzzahl extends FinDslNumber {
    static von(kern: FinDslNumber): Ganzzahl { return new Ganzzahl(kern.value, kern.type); }
}

export class Dezimal extends FinDslNumber {
    static von(kern: FinDslNumber): Dezimal { return new Dezimal(kern.value, kern.type); }
}
