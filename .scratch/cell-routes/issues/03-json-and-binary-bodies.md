# JSON and binary bodies round-trip through dispatch

Status: resolved
Blocked by: 01
Parent: [spec](../spec.md)

## What to build

Extend the dispatch operation from ticket 01 so request and response bodies survive the round trip in both directions for JSON and binary data. Headers, including `Content-Type`, must be preserved. The serialized form must carry binary bodies over the Comlink protocol.

## Acceptance criteria

- [ ] A cell handler that reads `c.req.json()` and returns `c.json(...)` gets the same JSON back through dispatch.
- [ ] A binary request body and a binary response body (e.g. `Uint8Array`) survive the round trip byte-for-byte.
- [ ] `Content-Type` set by the handler reaches the response unchanged.
- [ ] Jest tests cover JSON and binary cases.

## Stories covered

16, 18, 19

## Context pointers

- Spec: "Implementation Decisions" (Dispatch interface: binary bodies supported), "Testing Decisions" (JSON and binary bodies case).
