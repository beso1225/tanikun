# Accessibility baseline

This document is the current baseline for the planner UI. Apply it to every new view, modal, form, and table.

## Modals

Every modal uses the shared `modal_shell` in [main.mbt](../apps/web/cmd/browser/main.mbt). The shell owns the backdrop, dialog semantics, header, close control, and body. The browser-level behavior matches any element with `role="dialog"` and `aria-modal="true"`, not a fixed dialog ID.

A modal must have:

- `role="dialog"`;
- `aria-modal="true"`;
- `aria-labelledby` pointing at its heading;
- an Escape handler;
- a focus trap;
- focus restored to the control that opened it;
- a body scroll lock while open;
- backdrop click dismissal.

The picker, course detail, custom course, override editor, and settings dialogs use this shell.
The focus trap includes visible, enabled buttons, links, inputs, selects,
textareas, and elements with a `tabindex` other than `-1`. Hidden inputs and controls
without a rendered rectangle are excluded.

## Controls and forms

- Every icon-only control needs an `aria-label` that names the action.
- A group of related icon-only controls needs a group label.
- Every input needs a `<label>` or an `aria-label`.
- A rejected form submit must keep the form open, announce the error with `role="alert"`, and connect it to the offending control with `aria-invalid` and `aria-describedby`.
- A rejected custom or override form submit moves focus to the invalid control when one is available.
- Undo returns focus to the restored course control when it is visible. Otherwise, it moves focus to the catalogue button.
- Visible focus uses the `--color-primary` ring.

## Tables

- Day headers use `scope="col"`.
- Period headers use `scope="row"`.
- The timetable stays inside a single `<main>` landmark.
- At phone widths, both occupied grid cells and the readable course list are keyboard reachable. This preserves the grid's placement interaction and gives the list its own detail controls, at the cost of a longer tab path.

## Page structure

- Every page has one `<main>` landmark.
- The planner has a skip link to the main content.

## Text and contrast

- Fill colors are not text colors. Use `--color-primary-text` and `--color-danger-text` for text on paper or canvas.
- Text below 18 pt must meet 4.5:1 contrast in both light and dark appearance.

## Verification

Run the same audit after any conditional render that adds controls, not only when the dialog opens.

`just test-browser` runs a scripted DOM audit for the page landmark and skip link, table scopes, input labels, icon-only control names, and dialog attributes. The test checks modal keyboard behavior, focus after form errors and undo, and the primary focus ring. It covers reverse focus traversal in settings and the custom form. Contrast is checked by hand and is not part of the browser audit. Screen-reader output requires separate manual verification.
