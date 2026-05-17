/**
 * Lexikalischer Scope mit Parent-Chain.
 *
 * Eine Environment ist ein Frame mit Name→Wert-Bindings plus optionalem
 * Parent-Verweis. `lookup` läuft die Kette aufwärts; `define` legt im
 * aktuellen Frame an und verhindert versehentliches Shadowing.
 */

import { InterpretError, type Value } from './values.js';

/** Senke für `ausgabe`-Anweisungen (SPEC § 5.4). Host bestimmt das Ziel. */
export type AusgabeSink = (text: string) => void;
const NOOP_SINK: AusgabeSink = () => { /* still im reinen Lauf */ };

export class Environment {
    private readonly bindings = new Map<string, Value>();
    private readonly ownSink?: AusgabeSink;

    constructor(readonly parent: Environment | null = null, sink?: AusgabeSink) {
        this.ownSink = sink;
    }

    /** Effektiver Sink: eigener, sonst geerbt (Parent-Kette), sonst No-op. */
    get sink(): AusgabeSink {
        return this.ownSink ?? this.parent?.sink ?? NOOP_SINK;
    }

    define(name: string, value: Value): void {
        if (this.bindings.has(name)) {
            throw new InterpretError(`Mehrfach-Deklaration im selben Scope: "${name}".`);
        }
        this.bindings.set(name, value);
    }

    /**
     * Liefert den Wert oder `undefined`, wenn der Name nirgends gebunden ist.
     * Der Interpreter unterscheidet "unbekannt" je nach Kontext (Symbol-
     * Fallback, Datensatz-Konstruktor, Fehler) — daher kein throw hier.
     */
    lookup(name: string): Value | undefined {
        const local = this.bindings.get(name);
        if (local !== undefined) return local;
        return this.parent?.lookup(name);
    }

    has(name: string): boolean {
        return this.lookup(name) !== undefined;
    }

    child(): Environment {
        return new Environment(this);
    }
}
