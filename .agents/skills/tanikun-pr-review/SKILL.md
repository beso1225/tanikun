---
name: tanikun-pr-review
description: "Review, fix, and land a Tanikun pull request. Use when a PR is open, review comments arrive, CI turns red, or the user asks to merge."
---

# Tanikun PR review

Use this skill for an open pull request. Use `tanikun-planner-change` for planner
fixes, `tanikun-moonbit-change` for pure-package fixes,
`tanikun-sync-change` for sync, Worker, D1, or local auth fixes, and
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

## Delegated review, when requested

Wait for the current head's required CI checks before delegating review. Preserve
the user's chosen providers, models, and runtime modes. Give each reviewer the
exact head SHA, linked issue, full diff, previous findings, and relevant skills.

Require actionable findings as GitHub inline review comments on changed lines,
not as a single issue-level PR comment. Use a COMMENT review with `commit_id`,
and each finding's `path`, `line`, and `side` through the pull-request reviews
API. Include priority, the concrete failure, and the requested fix in each
comment. Verify every anchor against the actual patch for that SHA. If the
problem is an omission, anchor to the closest relevant changed line and explain
the missing behavior. Do not invent a finding to create an inline comment.

The review body may summarize the recommendation, model, reviewed SHA, and
limitations. A review with no findings needs only that summary. After pushing
fixes, reply to and resolve addressed threads, then request a new review task
for the new SHA. Stop when required CI passes and all requested reviewers have
no actionable blockers. Merge still requires the user's approval.

## Fix

1. Add a focused test when the comment describes a behavior change.
2. Make the smallest fix.
3. Run the focused test for the changed layer.
4. Run `just lint`. Run `just test` only when the change reaches MoonBit, the
   JavaScript export, or shared code that it covers.
5. For sync, Worker, D1, local auth, or coordinator changes, load
   `tanikun-sync-change` and run its focused ladder. Run `just test-sync` or
   `just test-session-proof` when the change crosses the real Worker, D1, or
   browser boundary. Do not run the real harness for a docs-only change.
6. For a docs-only PR, run `just lint` and the relevant link checks.
7. Push the fix before replying to the thread.

Do not request a bot review unless the user asks. Do not force push over another
person's work.

## Reply and resolve

- Reply with what changed and which command verified it.
- Resolve a thread only after the fix is pushed.
- Keep a thread open when the reviewer needs to confirm a trade-off.
- Use the host PR watch after the push when available. Otherwise use
  `gh pr checks <number> --watch`.

If a check fails, load `tanikun-nix-ci` before changing production code.

## Merge

Merge only after the user approves the merge. Confirm the latest head has
successful required checks and all actionable review threads are resolved.
Use the reviewed SHA so a new push cannot slip into the merge.

```sh
gh pr merge <number> --squash --match-head-commit <reviewed-sha> --delete-branch
git switch main
git pull --ff-only
```

The deletion rule protects the default branch, not feature branches. Delete
the merged feature branch when it is no longer needed. A GitHub connector
squash merge with `expected_head_sha` provides the same head check; branch
cleanup is a separate action.

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
