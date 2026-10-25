---
name: tanikun-pr-review
description: "Review, fix, and land a Tanikun pull request. Use when a PR is open, review comments arrive, CI turns red, or the user asks to merge."
---

# Tanikun PR review

Use this skill for an open pull request. Use `tanikun-moonbit-change` for code
fixes and `tanikun-docs-update` for documentation fixes.

## Gather state

```sh
gh pr view <number> --json state,mergeStateStatus,reviewDecision,reviews
gh pr checks <number>
git status --short
git log --oneline -5
```

Read every unresolved review thread. Read the full diff, not only the files in
the latest comment.

If `gh` cannot resolve DNS, set `GODEBUG=netdns=cgo` for the command.

## Fix

1. Add a focused test when the comment describes a behavior change.
2. Make the smallest fix.
3. Run the focused test, then `just test` and `just lint`.
4. For a docs-only PR, run `just lint` and the relevant link checks.
5. Push the fix before replying to the thread.

Do not request a bot review unless the user asks. Do not force push over another
person's work.

## Reply and resolve

- Reply with what changed and which command verified it.
- Resolve a thread only after the fix is pushed.
- Keep a thread open when the reviewer needs to confirm a trade-off.
- Re-run `gh pr checks <number> --watch` after the push.

If a check fails, load `tanikun-nix-ci` before changing production code.

## Merge

Merge only after the user approves the merge.

```sh
gh pr merge <number> --squash --delete-branch
git checkout main
git pull --ff-only
```

Then check:

- the issue closed automatically, or close it with a reason;
- `main` CI passes;
- the milestone is still accurate;
- the working tree is clean.

Do not close a milestone until `main` CI passes.

## Handoff

Report:

- review comments addressed;
- checks that passed;
- merge commit;
- issue and milestone state;
- any follow-up issue created.
