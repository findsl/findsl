> Teil des FinDSL-Projektkontexts — aus CLAUDE.md aufgeteilt. Gesamtindex: [../CLAUDE.md](../CLAUDE.md)

## 3. Tech-Stack

| Komponente              | Wahl                              | Rationale                                                                            |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------------ |
| **Sprache**             | TypeScript                        | Lebt im selben Prozess wie VS-Code-Extension; kein schwergewichtiger Java-Subprozess |
| **Language-Workbench**  | Langium 4.2.x                     | "Batteries included": Parser + AST + LSP-Server aus einer Grammatik (2026-05-16 von 3.3 migriert) |
| **Parser**              | Chevrotain 12 (via Langium)       | Error-tolerant, schnell, gute Diagnostics                                            |
| **Build**               | TypeScript-Compiler (`tsc`)       | Kein Bundler nötig; ESM-Module                                                       |
| **CLI-Framework**       | Commander                         | Standard, schlank                                                                    |
| **Numerik**             | `decimal.js`                      | BigDecimal-Äquivalent für JS, präzise Festkomma-Arithmetik                           |
| **VS-Code-Integration** | LSP via Langium-Server            | Standard-LSP, eine Codebase für Editor und CLI                                       |
| **Tests**               | Vitest                            | Schnell, modern                                                                      |

**Vorgeschichte:** Wir hatten anfangs einen Python-Prototyp (Lark-basiert,
gelöscht), dann ein Java/ANTLR-Skelett (gelöscht), und sind dann zu
TypeScript/Langium gewechselt. Der Hauptgrund: VS-Code-Extension mit
TypeScript ist deutlich leichtgewichtiger als ein Java-LSP-Subprozess.

---

