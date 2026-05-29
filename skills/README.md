# FinDSL Agent Skills

Dieses Verzeichnis enthält **ausgelieferte Agent Skills** für FinDSL — im
offenen [Agent-Skills-Format](https://github.com/anthropics/skills)
(`SKILL.md` mit YAML-Frontmatter). Sie sind **Release-Artefakte**: sie werden
mit FinDSL verteilt und sind dafür gedacht, in den Skill-Ordner eines
KI-Coding-Agenten installiert zu werden — nicht für die interne
Repo-Entwicklung unter `.claude/`.

## Enthaltene Skills

| Skill | Zweck |
| --- | --- |
| [`findsl-author/`](findsl-author/SKILL.md) | Generiert valide FinDSL-Programme (+ `prüfe`-Tests) aus Alltagssprache oder aus Gesetzestexten. Setzt das installierte `findsl`-CLI voraus. |

## Kompatibilität — ein Skill, mehrere Agenten

Das `SKILL.md`-Format ist ein **geteilter Standard**: **Claude Code**,
**OpenCode** und **Codex** lesen dieselbe Datei. Es braucht **keine
separaten Skills** je Agent — nur das Discovery-Verzeichnis unterscheidet
sich. Installation = den Skill-Ordner in das passende Verzeichnis kopieren
(oder symlinken).

### Claude Code

```bash
# projektweit (gilt im jeweiligen Projekt):
mkdir -p .claude/skills && cp -R skills/findsl-author .claude/skills/
# ODER global (gilt überall):
mkdir -p ~/.claude/skills && cp -R skills/findsl-author ~/.claude/skills/
```

### OpenCode

OpenCode entdeckt Skills u. a. aus `.opencode/skills/`, **`.claude/skills/`**
und `.agents/skills/` (projektweit) sowie den entsprechenden Ordnern unter
`~/.config/opencode/`, `~/.claude/`, `~/.agents/` (global).

```bash
# projektweit:
mkdir -p .opencode/skills && cp -R skills/findsl-author .opencode/skills/
# ODER global:
mkdir -p ~/.config/opencode/skills && cp -R skills/findsl-author ~/.config/opencode/skills/
```

> **Tipp:** Da OpenCode auch `.claude/skills/` liest, deckt eine einzige
> Installation nach `.claude/skills/` (projektweit) bzw. `~/.claude/skills/`
> (global) **beide** Agenten zugleich ab.

### Codex

Codex unterstützt denselben Agent-Skills-Standard; folge der Codex-
Dokumentation für das jeweilige Skill-Verzeichnis und kopiere den
`findsl-author/`-Ordner dorthin.

## Voraussetzung

Die Skills rufen zur Verifikation das **`findsl`-CLI** auf
(`findsl parse …`, `findsl test …`). Installation prüfen mit
`findsl --help`.

## Lizenz

EUPL-1.2 (wie FinDSL) — siehe Repository-`LICENSE`.
