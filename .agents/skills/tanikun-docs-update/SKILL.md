---
name: tanikun-docs-update
description: "Update Tanikun documentation, ADR indexes, AGENTS.md, or Phase evidence. Use when changing README files, current or historical docs, documentation links, or English and Japanese wording."
---

# Tanikun docs update

Use this skill for documentation changes. For code and behavior changes, use
`tanikun-moonbit-change` first.

## Read first

- [AGENTS.md](../../../AGENTS.md)
- [docs/README.md](../../../docs/README.md)
- the current document you will edit
- [GLOSSARY.md](../../../GLOSSARY.md) when a domain term changes

## Classify the document

| Kind         | Examples                                                                      | Rule                                                               |
| ------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Current      | `README.md`, `docs/PHASE_1.md`, `docs/PHASE_1_RESULTS.md`, `docs/MUTATION.md` | Update facts, commands, and links.                                 |
| Historical   | `docs/PHASE_0.md`, `docs/INITIAL_DESIGN.md`, `docs/TECH_REVIEW.md`            | Keep the evidence. Add or update a historical note and links only. |
| Index        | `docs/README.md`, `docs/adr/README.md`                                        | Keep entries short and link to the owning document.                |
| Instructions | `AGENTS.md`, project skills                                                   | Move procedures into skills; keep only invariants in AGENTS.md.    |

Do not rewrite historical evidence to match the current implementation. Point
readers to the current contract instead.

## English source

Write the English source first.

- Apply the `technical-writing` and `unslop` skills.
- Use sentence case headings, straight quotes, and no em dashes.
- Use the real command, path, symbol, or issue number.
- Keep each link label specific to its target.
- Explain a command by what it runs, not by what it feels like.

## Japanese source

Derive Japanese text from the finished English source. Do not translate the
English line by line when the result is unnatural.

- Apply the `yomiyasu` skill.
- Use `です` and `ます` consistently unless the existing document uses another
  style.
- Keep domain terms consistent with `GLOSSARY.md`.
- Run the yomiyasu linter on changed Japanese files:

```sh
python3 ~/.agents/skills/yomiyasu/scripts/yomiyasu_lint.py README.ja.md \
  --doc-type article
```

Treat linter output as review hints. Keep structural choices such as glossary
term emphasis or a README task list when the role of the text explains them.

## Check links and status

- Update `docs/README.md` when a current or historical document moves.
- Update `docs/adr/README.md` when ADR status changes.
- Check every relative link you touch.
- Keep phase status consistent across `README.md`, `README.ja.md`, and the
  current Phase document.

## Verify

```sh
just lint
```

`just lint` runs markdownlint, oxfmt, editorconfig-checker, and the repository
linters. Run `just test` only when the change touches code or generated output.

## Hand off

Report:

- which documents are current and which are historical;
- the English and Japanese checks you ran;
- any linter warnings you kept and why;
- any links or status that still need a code or issue update.

Do not commit `_build/`, `*.generated.mbti`, `.cache/`, or `.turtles/`.
