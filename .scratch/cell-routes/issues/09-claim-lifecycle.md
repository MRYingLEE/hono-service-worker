# Claim lifecycle: registration, replacement, release

Status: resolved
Blocked by: 04, 07
Parent: [spec](../spec.md)

## What to build

- A Kernel registers its Claimed prefixes with the Service worker when its cells declare them through `claimPrefix`.
- Conflicting claims from the same notebook: last claim wins. A later `claimPrefix` for a prefix replaces the earlier claim. Behavior was decided during planning.
- Claims are released on Kernel restart and on notebook close, so another notebook can claim the same prefix afterwards.
- Claim state is per Kernel. Disposing one Kernel must not change another Kernel's routes.

## Acceptance criteria

- [x] After a cell calls `claimPrefix`, requests under that prefix are routed to the Kernel.
- [x] A second `claimPrefix` for the same prefix in the same notebook replaces the first, and the earlier cell no longer owns that claim.
- [x] Kernel restart releases the Kernel's claims and clears its routes.
- [x] Closing the notebook releases its claims, and another notebook can then claim the same prefix.
- [x] Disposing one Kernel does not affect another Kernel's claims.
- [x] Jest tests cover the Kernel-level cases; browser verification covers notebook close.

## Stories covered

1, 6, 24, 33

## Context pointers

- Spec: "Implementation Decisions" (Claim lifecycle, Route table lifecycle), "Further Notes" item 2 (resolved here).
- `packages/javascript-kernel/src/kernel.ts` (Kernel dispose and restart).

## Browser verification (2026-10-09)

- Claimed route: passed (see the ticket's first criterion).
- Restart: confirmed restart released the claim. `/api/hello` returned to the remote 404 after the kernel restarted.
- Kernel shutdown: shutting a kernel down released its claims. `/b/x` fell through to 404.
- Close notebook: **fails**. Closing the Console tab kept its kernel alive (it still appeared under Kernels), so its claim persisted and `/b/x` still answered. The claim is only released when the kernel is shut down. Whether closing the tab should shut down the kernel is an open decision.
- Replacement across cells in the same notebook: not tested. Last-claim-wins was checked across two kernels only.

## Re-check after fixes (2026-10-09)

- Close notebook: fixed. Closing a notebook or console tab now shuts down its kernel (user decision), which releases its claims. Closing Untitled7 changed `/c/x` from 200 to 404. A new Web Worker notebook (Untitled9) then claimed `/c/` and `/c/x` returned 200 `from C9`. So another notebook can claim the prefix afterwards.
- Same-notebook replacement: fixed. A later `claimPrefix` for the same prefix drops the earlier cell's routes under that prefix (user decision). The second handler now answers, and the claim list shows the prefix once. Jest covers this in `runtime_dispatch.test.ts`.
- Cross-kernel dispose: disposing one kernel released `/s/` and `/b/x` still answered from B.
- Jest: kernel-level cases are in `kernel_claims.test.ts` and `runtime_dispatch.test.ts`. Browser verification covers the notebook close.
