## Zusammenfassung

Kurze Beschreibung der Änderungen.

## Zugehörige Issues

Closes #

## Art der Änderung

- [ ] Bugfix
- [ ] Neues Feature
- [ ] Sprachänderung (Grammatik/Syntax/Typsystem)
- [ ] Dokumentation / Doc-Generator
- [ ] Refactoring
- [ ] CI / Build / Tooling

## Checkliste

- [ ] Build-Roundtrip lokal grün: `npm run langium:generate && npm run build && npm run bundle && npm test` (alle Tests grün, Bundle-Smoke 4/4)
- [ ] Beispielmodule unverändert reproduzierbar (`parse`/`test` für `kst`/`kraftst`/`gewst`/`est`)
- [ ] **Bei Sprachänderung:** Grammatik-Trias synchron gepflegt — `SPEC.md` · `grammar/findsl.ebnf` · `packages/core/src/language/findsl.langium` (+ `langium:generate` neu ausgeführt)
- [ ] Neue Quelldateien tragen den Lizenz-Header gemäß `CLA.md` (SPDX `EUPL-1.2`; nach evtl. Shebang)
- [ ] Doku aktualisiert, falls einschlägig (`docs/`, ggf. `docs/changelog.md` vorne ergänzt)
- [ ] Keine Secrets/Credentials committet
- [ ] Commit-Messages folgen Conventional Commits (`feat:`/`fix:`/`refactor:`/`docs:`/`test:`/`chore:`/`perf:`/`ci:`)
- [ ] CLA unterzeichnet (Erstbeitragende: Sign-Kommentar unten posten, sofern nicht bereits unterzeichnet)

## KI-Agent-Offenlegung

- [ ] Dieser PR wurde von einem Menschen erstellt
- [ ] Dieser PR wurde von einem KI-Agenten erstellt (welcher: _______)
- [ ] Dieser PR wurde von Mensch + KI-Agent gemeinsam erstellt

> Bei KI-Beteiligung: Die menschliche Bedienperson unterzeichnet das CLA stellvertretend für die Einreichung (siehe `CONTRIBUTING.md`).

---

<sub>Erstbeitragende ohne gültiges CLA: bitte exakt folgenden Kommentar in diesem PR posten —
`I have read the CLA Document and I hereby sign the CLA`</sub>
