// Copyright (C) 2026 devtank42 GmbH
// Licensed under the EUPL-1.2 (see LICENSE) OR a commercial licence
// from devtank42 GmbH (see LICENSE-COMMERCIAL.md).
// SPDX-License-Identifier: EUPL-1.2

package org.findsl.runtime;

import java.util.function.Consumer;

/**
 * Injizierbare Senke für die FinDSL-{@code ausgabe}-Anweisung (ADR7) —
 * Spiegel der {@code AusgabeSink} des Interpreters
 * ({@code environment.ts}, Default no-op). Generierte JUnit-Tests können
 * die Senke setzen und die gesammelten Zeilen prüfen; produktiv bleibt
 * sie standardmäßig stumm.
 *
 * <p>Phase 0: Grundgerüst. Die generierte {@code ausgabe}-Anweisung
 * (Phase 3) ruft {@link #write(String)}.
 */
public final class Output {

    private static final Consumer<String> NOOP = s -> { };

    private static final ThreadLocal<Consumer<String>> SINK =
        ThreadLocal.withInitial(() -> NOOP);

    private Output() { }

    /** Setzt die Senke für den aktuellen Thread (Tests). */
    public static void setSink(Consumer<String> sink) {
        SINK.set(sink == null ? NOOP : sink);
    }

    /**
     * Entfernt die Thread-lokale Senke vollständig (zurück auf den stummen
     * Default). {@code remove()} statt {@code set(NOOP)} — sonst bliebe in
     * Thread-Pools eine Referenz im Thread-State hängen (ThreadLocal-Leak).
     */
    public static void reset() {
        SINK.remove();
    }

    /** Gibt eine Zeile an die aktuelle Senke aus (kein Rückgabewert). */
    public static void write(String text) {
        SINK.get().accept(text);
    }
}
