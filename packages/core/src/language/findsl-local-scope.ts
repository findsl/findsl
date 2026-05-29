// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

/**
 * Gemeinsame Skelett-Typ-Inferenz für Hover- und Definition-Provider.
 *
 * Hover und Definition brauchen beide eine schnelle, fehlertolerante
 * Typ-Auflösung am Cursor, um:
 *   - Param-/Let-Bindings entlang der `$container`-Kette zu sammeln
 *     (`buildLocalScope`), inkl. Lambda-HOF-Element-Typ-Inferenz und
 *     `für jeden`-Iter-Binding (Issue #65),
 *   - den Empfänger-Typ vor einem Chain-Glied zu inferieren
 *     (`inferChainPrefix`) — delegiert an den autoritativen Ketten-Walker
 *     des Type-Checkers (`walkChain`), damit auch verkettete Builtin-
 *     Methoden (§ 11) korrekt durchlaufen werden — und
 *   - `Type`-Annotationen mit Cross-Modul-Fallback aufzulösen
 *     (`resolveAnnotationWithImports`).
 *
 * Die vier LSP-Provider (Hover/Definition/Inlay/Signatur) hatten das vor
 * Issue #70 jeweils dupliziert (ein gepatchter Bug betraf zwingend alle
 * Stellen). Diese Datei ist die EINE Quelle; der einzige Unterschied
 * (Hover nutzt eine Provider-Methode für Cross-Modul-Auflösung, Definition
 * eine freie Funktion mit `LangiumDocuments`) wird über `CrossModuleResolver`
 * abstrahiert — einen Callback, den der Aufrufer bindet.
 */

import type { AstNode } from 'langium';
import {
    isBlockExpr,
    isCall,
    isCallChain,
    isFieldAccess,
    isFuerExpr,
    isFunktionDecl,
    isLambda,
    isLetStmt,
    type ChainOp,
    type Expr,
    type Program,
    type Type as TypeAnnotation,
} from './generated/ast.js';
import { walkChain } from './findsl-inference.js';
import {
    infer,
    resolveTypeAnnotation,
    TNull,
    TypeEnv,
    type Type,
    type TypeContext,
} from './findsl-types.js';

/**
 * Brücke zur Cross-Modul-Typ-Auflösung. Hover bindet sich an die
 * Provider-Methode `resolveCrossModuleType(program, name)`; Definition
 * bindet die freie Funktion mit der `LangiumDocuments`-Closure
 * (`(p, n) => resolveCrossModuleType(p, n, documents)`).
 */
export type CrossModuleResolver = (program: Program, name: string) => Type | undefined;

/**
 * Wie `resolveTypeAnnotation`, aber mit Cross-Modul-Fallback. Importierte
 * Datensätze sind im Header-Kontext als Konstruktor-Funktionstypen
 * registriert — hier wird der Record-Ergebnistyp ausgepackt.
 */
export function resolveAnnotationWithImports(
    t: TypeAnnotation,
    ctx: TypeContext,
    program: Program,
    resolveCrossType: CrossModuleResolver,
): Type {
    const local = resolveTypeAnnotation(t, ctx);
    if (local.kind !== 'unknown') return local;
    if (!t?.atom || t.atom.$type !== 'NamedType') return local;

    const sym = resolveCrossType(program, t.atom.name);
    if (!sym) return local;

    // Datensatz-Konstruktor → Record
    if (sym.kind === 'function' && sym.result.kind === 'record') {
        return t.optional ? TNull(sym.result) : sym.result;
    }
    // Aufzählung
    if (sym.kind === 'enum') {
        return t.optional ? TNull(sym) : sym;
    }
    return local;
}

/** Inferiert den Typ einer Expression ohne Diagnostics zu sammeln. */
export function inferExprQuiet(
    expr: Expr | undefined, env: TypeEnv, ctx: TypeContext,
): Type | undefined {
    if (!expr) return undefined;
    try {
        return infer(expr, env, ctx, () => { /* swallow */ });
    } catch {
        return undefined;
    }
}

/**
 * Liefert den Element-Typ für `Liste<T>` / `Bereich<T>` / Nullable davon.
 * `Bereich`-Typen sind in `findsl-types.ts` als `list` vom Element-Typ
 * repräsentiert, daher deckt der List-Branch beides ab.
 */
export function elementOfListLike(t: Type | undefined): Type | undefined {
    if (!t) return undefined;
    const cur = t.kind === 'nullable' ? t.inner : t;
    return cur.kind === 'list' ? cur.element : undefined;
}

/**
 * Hilfsfunktion: liefert den Element-Typ des HOF-Empfängers VOR diesem
 * `FieldAccess` (z. B. den Element-Typ von `xs` bei `xs.zuordnen`).
 */
export function inferReceiverElementType(
    fieldAccess: AstNode, env: TypeEnv, ctx: TypeContext,
): Type | undefined {
    const chain = (fieldAccess as { $container?: AstNode }).$container;
    if (!chain || !isCallChain(chain)) return undefined;
    const idx = (chain.chain as ReadonlyArray<unknown>).indexOf(fieldAccess);
    if (idx < 0) return undefined;
    // Receiver-Typ über die Type-Checker-Infer-Funktion auf die CallChain
    // bis zum HOF-FieldAccess (exklusiv) ableiten. Wenn idx === 0,
    // ist der Receiver die Chain-Wurzel (Identifier).
    if (idx === 0) {
        const rootType = env.lookup((chain as { name?: string }).name ?? '');
        return elementOfListLike(rootType);
    }
    // Pragmatisch: `infer` auf die ganze Chain — wir brauchen den
    // Element-Typ ohnehin nur grob. Lieber kein falscher Typ als ein
    // erratener. (`CallChain` ist Teil der `Expr`-Union, siehe
    // generated/ast.ts — kein Cast nötig.)
    const fullType = inferExprQuiet(chain, env, ctx);
    return elementOfListLike(fullType);
}

/**
 * Inferiert den Element-Typ des HOF-Empfängers, in dem das Lambda lebt.
 * Unterstützt Trailing-Lambda (`.zuordnen { k -> … }`) UND reguläres
 * Call-Arg (`.zuordnen({ k -> … })`). Issue #65.
 */
export function inferHOFElementType(
    lam: object, env: TypeEnv, ctx: TypeContext,
): Type | undefined {
    const container = (lam as { $container?: AstNode }).$container;
    if (!container) return undefined;

    // Trailing-Lambda: container ist der FieldAccess selbst.
    if (isFieldAccess(container)) {
        return inferReceiverElementType(container, env, ctx);
    }
    // Regulärer Call-Arg: container ist CallArg, dessen $container ein
    // Call ist, dessen Vorgänger im chain der HOF-FieldAccess ist.
    const callArgParent = (container as { $container?: AstNode }).$container;
    if (callArgParent && isCall(callArgParent)) {
        const chain = (callArgParent as { $container?: AstNode }).$container;
        if (chain && isCallChain(chain)) {
            const callIdx = (chain.chain as ReadonlyArray<unknown>).indexOf(callArgParent);
            if (callIdx > 0) {
                const prev = chain.chain[callIdx - 1];
                if (isFieldAccess(prev)) {
                    return inferReceiverElementType(prev, env, ctx);
                }
            }
        }
    }
    return undefined;
}

/**
 * Sammelt Param- und Let-Bindings entlang der `$container`-Kette ausgehend
 * von einem inneren AST-Knoten. Äußere Bindings landen zuerst, innere
 * überschreiben sie — die `TypeEnv`-Semantik (Map-set) regelt Shadowing
 * automatisch.
 *
 * Param-Typen werden über `resolveAnnotationWithImports` aufgelöst,
 * damit Cross-Modul-importierte Datensatz-Typen korrekt zum Record-Typ
 * werden. Lambda-Parameter ohne Annotation erben (Issue #65) den
 * Element-Typ des HOF-Empfängers; `für jeden k aus xs` bindet `k` an
 * den Element-Typ der Source.
 */
export function buildLocalScope(
    from: { $container?: object },
    ctx: TypeContext,
    program: Program,
    resolveCrossType: CrossModuleResolver,
): TypeEnv {
    const env = ctx.globals.child();
    const stack: object[] = [];
    let n: object | undefined = from;
    while (n) {
        stack.push(n);
        n = (n as { $container?: object }).$container;
    }
    const resolve = (t: TypeAnnotation) =>
        resolveAnnotationWithImports(t, ctx, program, resolveCrossType);
    for (const node of stack.reverse()) {
        if (isFunktionDecl(node)) {
            for (const p of node.params) {
                env.define(p.name, resolve(p.type));
            }
        } else if (isBlockExpr(node) || isLambda(node)) {
            for (const s of node.stmts) {
                if (isLetStmt(s)) env.define(s.name, resolve(s.type));
            }
            if (isLambda(node)) {
                for (const p of node.params) {
                    if (p.type) {
                        env.define(p.name, resolve(p.type));
                    } else {
                        const elemT = inferHOFElementType(node, env, ctx);
                        if (elemT) env.define(p.name, elemT);
                    }
                }
            }
        } else if (isFuerExpr(node)) {
            const srcT = inferExprQuiet(node.source, env, ctx);
            const elemT = elementOfListLike(srcT);
            if (elemT && node.iter) env.define(node.iter, elemT);
        }
    }
    return env;
}

/**
 * Type-Stepper für einen `ChainOp` (`()`, `.field`, `?.field`, `!!`).
 *
 * Hover braucht die TOLERANTE Variante: ein `?.field` auf einen
 * NICHT-nullable Record wird trotzdem als Field-Access behandelt, damit
 * der Hover-Inhalt bei semantisch-falschem aber syntaktisch-gültigem
 * Code etwas Sinnvolles zeigt. Definition liefert für genau diesen Fall
 * `TUnknown`, weil ein „Sprung-zur-Definition" auf ungenutzten Cast
 * nicht sinnvoll ist (`tolerant: false`).
 */
/**
 * Inferiert den Empfänger-Typ VOR dem Chain-Glied an `untilIndex`, indem
 * der autoritative Ketten-Walker (`walkChain` aus dem Type-Checker) über
 * das Chain-Prefix `chain[0..untilIndex)` läuft. Ersetzt das frühere
 * Glied-für-Glied-`stepChainOp`, das Builtin-Methoden NICHT kannte: bei
 * `a.mindestens(b).mindestens(c)` lieferte es nach dem ersten
 * `.mindestens(…)` `unknown` (Empfänger ist kein Record) → der zweite
 * `.mindestens` fand keine Methode mehr. `walkChain` behandelt alle
 * Methoden-Familien (§ 11) korrekt und konsumiert das jeweils folgende
 * `Call`-Glied — so funktioniert Hover/Definition/Inlay/Signatur auch bei
 * verketteten Builtins.
 *
 * Diagnosen werden verschluckt (reiner Lese-Pfad). `unknown` → `undefined`
 * (gleiche Fehl-Semantik wie zuvor: der Aufrufer bricht dann ab).
 */
export function inferChainPrefix(
    start: Type,
    chain: ReadonlyArray<ChainOp>,
    untilIndex: number,
    node: AstNode,
    env: TypeEnv,
    ctx: TypeContext,
): Type | undefined {
    const result = walkChain(
        start, chain.slice(0, untilIndex), node, env, ctx, () => {},
    );
    return result.kind === 'unknown' ? undefined : result;
}
