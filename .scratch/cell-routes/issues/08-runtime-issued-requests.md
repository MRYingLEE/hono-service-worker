# Requests issued from a Runtime route to the Runtime's own Kernel

Status: resolved
Blocked by: 07
Parent: [spec](../spec.md)

## What to build

Requests issued from inside a Runtime (a Web Worker or an iframe) must be attributed to the Kernel that owns that Runtime, not to the page's Kernel. Identify the issuing context from the request, then pass it to the routing module from ticket 02 to choose the owner. Requests from workers and iframes must route correctly.

## Acceptance criteria

- [x] A request issued from a worker Runtime is answered by that Runtime's Kernel.
- [x] A request issued from an iframe Runtime is answered by that Runtime's Kernel.
- [x] With two notebooks open, a request from notebook A's page or Runtime is never answered by notebook B's Kernel.
- [x] Browser verification for the two-notebook case is recorded in the ticket's notes.

## Stories covered

21, 22

## Context pointers

- Spec: "Implementation Decisions" (Owning kernel resolution).
- [CONTEXT.md](../../../CONTEXT.md): term Owning kernel.
- `packages/javascript-kernel/src/runtime_backends.ts` (worker and iframe backends).

## Browser verification (2026-10-09)

Two Web Worker consoles on one page, each with its own claim.

- K1 claimed `/a/` and K2 claimed `/b/`. `/a/x` returned `from K1` and `/b/x` returned `from K2`.
- Last claim wins across kernels: K2 then claimed `/a/`, and `/a/x` returned `K2 took /a/`.
- The page-side checks above used `fetch` from the page only. The Runtime checks are recorded in the section below.

## Requests issued from inside Runtimes (2026-10-09)

Each request below was issued from inside the Runtime itself (`fetch` in a Web Worker cell or an iframe Runtime), not from the page.

- Worker A, notebook at `/w/`: `/w/x` returned 200 from its own cell handler.
- Worker B, second notebook at `/b/`: `/b/x` returned 200 from B. A's `/w/x` was not answered by B.
- Iframe C, `/i/`: `/i/x` returned 200 from its own cell handler.
- Unclaimed `/nope/x` returned the static 404.
- Heartbeat change: after it was added, iframe C and the `/c/` worker were re-checked. Results are in ticket 10.

Two-notebook behaviour holds across the Runtime boundary. Two notebooks in one page: the user decided last claim wins across kernels for a shared prefix. No rejection of conflicting claims.
