# Document cell-defined routes in the README

Status: resolved
Blocked by: 09, 10, 11
Parent: [spec](../spec.md)

## What to build

Update [README.md](../../../README.md) with a section on cell-defined routes. Cover:

- Using `claimPrefix` and `app` in a cell, with a short example.
- Claim lifecycle: restart and notebook close release claims, and re-running a cell replaces its routes.
- Response behavior: 404 for unmatched paths under a claim, 500 for handler errors, and 503 when the owning Kernel is not running.
- The `claimedPrefixes()` helper.

Use the existing README structure. Only the documentation for this feature changes.

## Acceptance criteria

- [ ] The README section matches the behavior implemented in tickets 01 to 11.
- [ ] The example code in the README matches the exported module specifier chosen in ticket 01.

## Context pointers

- Spec: "Solution", "Implementation Decisions".
- Existing README section on kernel startup extensions (style reference).
