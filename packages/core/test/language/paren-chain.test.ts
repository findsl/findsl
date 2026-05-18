/**
 * Phase 0b — Grammatik-Fundament: Postfix-Kette auf geklammertem Ausdruck
 * (`(a * b).abrunden()`, `(liste).länge`, `(wert)[0]`).
 *
 * Sicherstellt:
 *  (a) Ohne folgende Kette bleibt `( expr )` TRANSPARENT — kein
 *      `ParenChain`-Wrapper (kein AST-Ripple für bestehende Klammern).
 *  (b) Mit folgender Kette entsteht ein `ParenChain` (receiver = innerer
 *      Ausdruck, chain = ChainOp+).
 *  (c) Type-Checker und Interpreter behandeln den geklammerten Empfänger
 *      über DENSELBEN Ketten-Walker wie einen Namens-Empfänger
 *      (Feldzugriff, Listen-Methoden §11.2, Index) — Parität.
 *  (d) Teil-Parse (offene Klammer) kippt weder Validierung noch Eval.
 *
 * Skalare Rundungs-/Text-Methoden (`.abrunden()` auf `EuroCent` etc.)
 * sind NICHT Teil von Phase 0b — nur die bestehenden Ketten-Operationen
 * werden auf Paritäts-Niveau durch eine Klammer geführt.
 */

import { describe, it, expect } from 'vitest';
import { parseSource, parseExpr } from '../helpers/parse.js';
import {
    TypeEnv,
    buildContext,
    infer,
    typeCheckProgram,
    typeToString,
} from '../../src/language/findsl-types.js';
import { interpretProgram } from '../../src/interpret/interpreter.js';
import {
    isBinaryOp,
    isKonstDecl,
    isParenChain,
    type Expr,
} from '../../src/language/generated/ast.js';

/** Das Wert-AST der `konst R`. */
async function valueOfR(expr: string): Promise<Expr> {
    const program = await parseExpr(expr);
    for (const d of program.decls) {
        if (isKonstDecl(d) && d.name === 'R' && d.value) return d.value;
    }
    throw new Error('konst R fehlt');
}

/** Inferierter Typ des Ausdrucks (annotation-unabhängig via `infer`). */
async function typeOfR(expr: string): Promise<string> {
    const program = await parseExpr(expr);
    const ctx = buildContext(program);
    const value = await valueOfR(expr);
    return typeToString(infer(value, new TypeEnv(), ctx, () => {}));
}

/** Typfehler eines vollständigen Snippets. */
async function diags(src: string): Promise<string[]> {
    const program = await parseSource(src);
    const msgs: string[] = [];
    typeCheckProgram(program, (_n, m) => msgs.push(m));
    return msgs;
}

/** Laufzeitwert der Modul-Konstante R. */
async function evalR(expr: string): Promise<unknown> {
    const program = await parseSource(`konst R: Dezimal = ${expr}\n`);
    const mod = interpretProgram(program);
    const v = mod.env.lookup('R');
    if (!v) throw new Error('R nicht definiert');
    return v;
}

describe('ParenChain — Grammatik', () => {
    it('reine Klammer ohne Kette bleibt transparent (kein ParenChain)', async () => {
        const v = await valueOfR('(1 + 2)');
        expect(isParenChain(v)).toBe(false);
        expect(isBinaryOp(v)).toBe(true);
    });

    it('Klammer + Kette erzeugt ParenChain (receiver = innerer Ausdruck)', async () => {
        const v = await valueOfR('([1, 2, 3]).länge');
        expect(isParenChain(v)).toBe(true);
        if (isParenChain(v)) {
            expect(v.chain.length).toBe(1);
            expect(v.receiver.$type).toBe('ListLiteral');
        }
    });

    it('verschachtelte Klammern: nur die mit Kette werden Wrapper', async () => {
        const v = await valueOfR('((1 + 2)).länge');
        // äußere Klammer trägt die Kette → ParenChain; innere bleibt transparent
        expect(isParenChain(v)).toBe(true);
        if (isParenChain(v)) expect(isBinaryOp(v.receiver)).toBe(true);
    });
});

describe('ParenChain — Type-Checker-Parität', () => {
    it('Listen-Methode durch Klammer: ([1,2,3]).länge → Ganzzahl', async () => {
        expect(await typeOfR('([1, 2, 3]).länge')).toBe('Ganzzahl');
    });

    it('Listen-Methode mit Aufruf: ([1,2,3]).summe() → Ganzzahl', async () => {
        expect(await typeOfR('([1, 2, 3]).summe()')).toBe('Ganzzahl');
    });

    it('Index durch Klammer: ([10,20,30])[1] → Ganzzahl', async () => {
        expect(await typeOfR('([10, 20, 30])[1]')).toBe('Ganzzahl');
    });

    it('Feldzugriff durch Klammer auf Datensatz-Konstruktor', async () => {
        const src =
            'datensatz P(x: Euro = 0)\n' +
            'konst R: Euro = (P(x = 5)).x\n';
        expect(await diags(src)).toEqual([]);
    });

    it('Parität: (liste).methode ≡ liste.methode', async () => {
        const paren = await typeOfR('([1, 2, 3]).zuordnen({ n -> n + 1 })');
        expect(paren).toBe('Liste<Ganzzahl>');
    });
});

describe('ParenChain — Interpreter-Parität', () => {
    it('([1,2,3]).summe() == 6', async () => {
        const v = await evalR('([1, 2, 3]).summe()') as { kind: string; value: { toString(): string } };
        expect(v.kind).toBe('numeric');
        expect(v.value.toString()).toBe('6');
    });

    it('([10,20,30])[1] == 20', async () => {
        const v = await evalR('([10, 20, 30])[1]') as { kind: string; value: { toString(): string } };
        expect(v.kind).toBe('numeric');
        expect(v.value.toString()).toBe('20');
    });

    it('Feldzugriff durch Klammer: (P(x=5)).x == 5', async () => {
        const program = await parseSource(
            'datensatz P(x: Euro = 0)\n' +
            'konst R: Euro = (P(x = 5)).x\n',
        );
        const mod = interpretProgram(program);
        const v = mod.env.lookup('R') as { kind: string; value: { toString(): string } };
        expect(v.kind).toBe('numeric');
        expect(v.value.toString()).toBe('5');
    });
});

describe('ParenChain — Teil-Parse-Robustheit', () => {
    it('offene Klammer mit Kette kippt die Validierung nicht', async () => {
        // Unvollständig wie beim Tippen — darf NICHT werfen.
        await expect(diags('konst R: Ganzzahl = ([1, 2, 3]).\n')).resolves.toBeDefined();
        await expect(diags('konst R: Ganzzahl = (.länge\n')).resolves.toBeDefined();
    });
});
