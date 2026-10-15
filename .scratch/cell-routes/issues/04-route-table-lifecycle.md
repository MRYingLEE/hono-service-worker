# Route table lifecycle: re-run, removal, and restart

Status: resolved
Blocked by: 01
Parent: [spec](../spec.md)

## What to build

The route table should reflect the most recent execution of the cells that define it:

- Re-running a cell replaces that cell's routes. The updated handler applies on the next request.
- Removing a route from a cell and re-running it makes that path return 404.
- Restarting the Kernel empties the route table.

Hono has no API for removing a route, so the implementation probably needs to track routes per defining cell and rebuild the Hono app on each run. The approach is up to the implementer. Claim release on restart is ticket 09, not this one.

## Acceptance criteria

- [ ] Re-running a cell with a changed handler changes the response to the next request.
- [ ] A route removed from a re-run cell returns 404.
- [ ] After a Kernel restart, previously defined routes return 404.
- [ ] Jest tests exercise these through the Runtime backend.

## Stories covered

3, 4, 5, 6

## Context pointers

- Spec: "Implementation Decisions" (Route table lifecycle), "Testing Decisions" (re-run and restart cases).
