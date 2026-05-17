/**
 * Phase 5 — Capability-Nachweis: mehr-entitätige Berechnung über den
 * ECHTEN Pfad (Type-Checker akzeptiert + `pruefe`-Runner führt aus).
 * Genau das, was vor dem Interpreter-Ausbau unmöglich war (Listen,
 * `für jeden`, parametrische Lambdas, § 11.2-Methoden).
 */

import { describe, it, expect } from 'vitest';
import { parseSource } from '../helpers/parse.js';
import { typeCheckProgram } from '../../src/language/findsl-types.js';
import { runPruefe } from '../../src/interpret/pruefe.js';

const SRC = `--
# Kinderfreibetrag — Capability-Demo (Liste/zuordnen/summe/für jeden)

Mehr-entitätige Berechnung: Kinderfreibetrag je Kind über eine Liste,
aggregiert. Bewusst vereinfacht — reiner Capability-Nachweis des
Interpreter-/Type-Checker-Ausbaus, kein Gesetzesmodul.
--

-- Vereinfachter Kinderfreibetrag je Kind (Demo-Wert). --
@Quelle("§ 32 Absatz 6 EStG (vereinfacht, Capability-Demo)")
konst KFB_JE_KIND: Euro = 6.384

--
Ein Kind mit Anrechnungsfaktor.

@param name   Vorname
@param faktor 1 = voller Freibetrag, 0 = kein Freibetrag
--
datensatz Kind(
    name:   Text,
    faktor: Ganzzahl = 1,
)

--
Gesamter Kinderfreibetrag: je Kind KFB_JE_KIND mal Faktor, summiert.

@param kinder Liste der Kinder
@rückgabe     Summe der Kinderfreibeträge in Euro
--
@Quelle("§ 32 Absatz 6 EStG (vereinfacht)")
fn KinderfreibetragGesamt(kinder: Liste<Kind>): Euro =
    kinder.zuordnen({ k -> KFB_JE_KIND * k.faktor }).summe()

--
Namen der Kinder mit vollem Faktor (für jeden + filtern).

@param kinder Liste der Kinder
@rückgabe     Liste der Namen mit faktor == 1
--
fn VolleKinder(kinder: Liste<Kind>): Liste<Text> =
    für jeden k aus kinder.filtern({ k -> k.faktor == 1 }) { k.name }

prüfe "Capability — Liste/zuordnen/summe/für jeden/filtern" {
    testfall "zwei volle + ein nuller → 6.384·2 = 12.768" {
        var kinder: Liste<Kind> = [
            Kind(name = "Anna"),
            Kind(name = "Ben"),
            Kind(name = "Cara", faktor = 0),
        ]
        KinderfreibetragGesamt(kinder) == 12.768
            und VolleKinder(kinder).länge == 2
            und VolleKinder(kinder).kopf == "Anna"
    }
    testfall "leere Liste → 0 (D1: leere summe)" {
        var keine: Liste<Kind> = []<Kind>
        KinderfreibetragGesamt(keine) == 0
    }
}
`;

describe('Capability — Liste/Lambda/für-jeden über den echten Pfad', () => {
    it('Type-Checker akzeptiert das mehr-entitätige Modul ohne Fehler', async () => {
        const program = await parseSource(SRC);
        const msgs: string[] = [];
        typeCheckProgram(program, (_n, m) => msgs.push(m));
        expect(msgs).toEqual([]);
    });

    it('`pruefe`-Runner führt es aus — alle Testfälle grün', async () => {
        const program = await parseSource(SRC);
        const report = runPruefe(program);
        expect(report.errored).toBe(0);
        expect(report.failed).toBe(0);
        expect(report.total).toBe(2);
        expect(report.passed).toBe(2);
    });
});
