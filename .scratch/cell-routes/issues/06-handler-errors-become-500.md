# Handler exceptions become HTTP 500 and are reported to the notebook

Status: resolved
Blocked by: 01
Parent: [spec](../spec.md)

## What to build

An exception thrown inside a handler becomes an HTTP 500 response to the Client, so the Client sees a failure rather than a hang. The error is also reported in the notebook so the author can debug without developer tools. Reuse the existing error display path (`errors.ts`, `display.ts`) rather than inventing a new one.

## Acceptance criteria

- [ ] A throwing handler returns status 500 through dispatch.
- [ ] The error appears in the notebook cell output (or the existing error output path for the cell that failed).
- [ ] Jest tests cover the 500 response and the error report.

## Stories covered

9, 10

## Context pointers

- Spec: "Implementation Decisions" (Error mapping), "Testing Decisions" (throwing handler case).
- `packages/javascript-kernel/src/errors.ts`, `packages/javascript-kernel/src/display.ts`.
