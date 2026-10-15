# Runtime unavailable returns 503 with a clear message

Status: resolved
Blocked by: 07
Parent: [spec](../spec.md)

## What to build

When a Client request matches a claimed prefix but the owning Kernel has no running Runtime, return HTTP 503 Service Unavailable with a plain-text body that names the prefix. The Client can then tell the notebook is not serving the request.

## Acceptance criteria

- [x] With no running Runtime for the owning Kernel, the Client gets status 503.
- [x] The response body is plain text and includes the claimed prefix.
- [x] A request under an unclaimed prefix is unaffected.
- [x] Jest or browser verification is recorded in the ticket's notes.

## Stories covered

20

## Context pointers

- Spec: "Further Notes" item 3 (decided here: 503), "Implementation Decisions" (Error mapping).

## Browser verification (2026-10-09)

A heartbeat (`RuntimeHeartbeat`, 1 s interval, 3 s timeout) detects an unresponsive Runtime. Requests fail immediately with `RuntimeUnavailableError`, which maps to 503.

- Real dead Runtime: `self.close()` in worker B (`/b/`). The page fetch returned 503, `text/plain`, body "Runtime for /b/ is not running", in about 1.1 s. Before the heartbeat this request hung past 8 s.
- Unclaimed path: `/nope/x` returned the static 404. `/manifest.webmanifest` returned 200.
- Busy cell (trade-off): a 6 s synchronous loop in worker C (`/c/`) made a request return 503 in about 3.4 s. A live worker that is busy for longer than about 3 s is reported as unavailable. After the loop ends, `/c/x` returns 200 again. The user chose to keep the 3 s heartbeat with this trade-off.
- Iframe C (`/i/`): `/i/x` returned 200 from its own cell, so the heartbeat does not affect a responsive Runtime.
- Ghost claim (a claim with no Runtime): this was checked synthetically. It returned 503 `text/plain`, "Runtime for /ghost/ is not running". It is not a real-world ghost, since claims are released on kernel dispose.
- Jest: `runtime_heartbeat.test.ts` (5 tests) covers the heartbeat, and `runtime_backends.test.ts` covers the worker wiring.
