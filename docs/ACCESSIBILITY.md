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

## Controls and forms

- Every icon-only control needs an `aria-label` that names the action.
- A group of related icon-only controls needs a group label.
- Every input needs a `<label>` or an `aria-label`.
- A rejected form submit must keep the form open, announce the error with `role="alert"`, and connect it to the offending control with `aria-invalid` and `aria-describedby`.
- Visible focus uses the `--color-primary` ring.

## Tables

- Day headers use `scope="col"`.
- Period headers use `scope="row"`.
- The timetable stays inside a single `<main>` landmark.

## Page structure

- Every page has one `<main>` landmark.
- The planner has a skip link to the main content.

## Text and contrast

- Fill colors are not text colors. Use `--color-primary-text` and `--color-danger-text` for text on paper or canvas.
- Text below 18 pt must meet 4.5:1 contrast in both light and dark appearance.

## Verification

Run the same audit after any conditional render that adds controls, not only when the dialog opens.

`just test-browser` runs a scripted DOM audit for the page landmark and skip link, table scopes, input labels, icon-only control names, and dialog attributes. The same test checks Escape, focus restore, focus trap, scroll lock, and the primary focus ring for the picker and the course detail dialog. Contrast is checked by hand and is not part of the browser audit.
