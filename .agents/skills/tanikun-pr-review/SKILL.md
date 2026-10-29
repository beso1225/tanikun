---
name: tanikun-pr-review
description: "Review, fix, and land a Tanikun pull request. Use when a PR is open, review comments arrive, CI turns red, or the user asks to merge."
---

# Tanikun PR review

Use this skill for an open pull request. Use `tanikun-planner-change` for planner
fixes, `tanikun-moonbit-change` for pure-package fixes, and
`tanikun-docs-update` for documentation fixes.

## Gather state

```sh
gh pr view <number> --json state,headRefOid,mergeStateStatus,reviewDecision,reviews
gh pr checks <number>
git status --short
git log --oneline -5
```

Read every unresolved review thread. Read the full diff, not only the files in
the latest comment. Check linked issue acceptance criteria against the final
implementation before closing them; a passing test does not prove omitted scope.

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

Merge only after the user approves the merge. Confirm the latest head has
successful required checks and all actionable review threads are resolved.
Use the reviewed SHA so a new push cannot slip into the merge.

```sh
gh pr merge <number> --squash --match-head-commit <reviewed-sha>
git switch main
git pull --ff-only
```

Branch deletion is blocked by repository rules; do not add `--delete-branch`.
The GitHub connector's squash merge with `expected_head_sha` is equivalent.

Then check:

- the issue closed automatically, or close it with a reason;
- the `main` CI run whose `headSha` matches the merge commit completes with
  successful job conclusions (use `gh run list --branch main`, then
  `gh run watch <run-id> --exit-status` and `gh run view <run-id>`);
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
