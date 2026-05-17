> Teil des FinDSL-Projektkontexts — aus CLAUDE.md aufgeteilt. Gesamtindex: [../CLAUDE.md](../CLAUDE.md)

## 10. Empfohlener Einstieg für Claude Code

> **Aufgabe „aus Gesetz X ein FinDSL-Modul + Tests generieren"?** Dann
> ist **[`GESETZ-ZU-FINDSL.md`](GESETZ-ZU-FINDSL.md)** die verbindliche,
> schrittweise Arbeitsanweisung (Gesetz-XML/PDF lesen, Scope-Trennung,
> Architektur, alle FinDSL-Fallstricke, Verifikation, Checkliste).
> Vorlagen: `examples/kst/` (klein), `examples/kraftst/` (groß),
> `examples/gewst/` (Verrechnungslogik). Erst den Leitfaden lesen, dann
> arbeiten.

1. **`SPEC.md` querlesen** — vor allem Kapitel 1 (Designprinzipien),
   Kapitel 3 (Typsystem) und Kapitel 4 (Ausdrücke). Die EBNF in Anhang A
   gibt dir das vollständige Grammatik-Bild.

2. **Eines der Beispiele anschauen** — `examples/kst/kst.findsl`
   ist ein guter Startpunkt (klein & klar; viele Sprachfeatures auf
   engem Raum). `examples/kraftst/` zeigt Modul-Dekomposition.

3. **Build-Roundtrip durchspielen** (vom Repo-Root) — `npm install &&
   npm run build && node packages/cli/out/main.js parse
   examples/kst/kst.findsl -v`. Damit weißt du,
   dass das Setup funktioniert.

4. **Aktuellen Validator-Code anschauen** — `packages/core/src/language/findsl-validator.ts`.
   Dort sind die zwei Checks, die das Pattern für weitere Validatoren
   vorgeben.

5. **Nächste Aufgaben** — Sprache, Interpreter, Validator, volle
   LSP-Provider-Suite und **Doc-Generator (Phase 1)** sind fertig
   (Status s. § 5). Offen ist v. a. **Codegen** (Java/TS/JS,
   `src/codegen/` leer) sowie die Stdlib-Diskussion und der optionale
   Starlight-Export (§ 8 b/c). Vor jeder Sprach-/Provider-Änderung:
   Drei-Artefakte-Sync + `langium:generate` + `build` + `bundle` +
   `npm test` (706 Tests) + Bundle-Smoke.

---

