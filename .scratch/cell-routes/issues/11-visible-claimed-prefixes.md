# Notebook author can see the Kernel's current claimed prefixes

Status: resolved
Blocked by: 09
Parent: [spec](../spec.md)

## What to build

Let the notebook author see which Claimed prefixes their Kernel currently holds (story 11). The spec does not choose a mechanism, so this ticket assumes the following. Confirm with the user before merging if you disagree:

- Export `claimedPrefixes()` from the same module as `claimPrefix`. It returns the Kernel's current claims.
- Each `claimPrefix` call prints the resulting claim set in its cell output.

## Acceptance criteria

- [ ] `claimedPrefixes()` returns exactly the prefixes held by the Kernel after claims, releases, and restarts.
- [ ] The cell that calls `claimPrefix` shows the claimed prefix in its output.
- [ ] Jest tests cover `claimedPrefixes()`.

## Stories covered

11

## Context pointers

- Spec: story 11, "Cell-facing API".
