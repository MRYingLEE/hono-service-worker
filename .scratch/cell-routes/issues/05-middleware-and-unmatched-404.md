# Middleware and unmatched-path 404 under a claimed prefix

Status: resolved
Blocked by: 01
Parent: [spec](../spec.md)

## What to build

- Hono middleware defined in cells runs for requests under the claimed prefix.
- A request under the claimed prefix that matches no route gets Hono's standard 404 response. The prefix is claimed but the path is not defined.

## Acceptance criteria

- [ ] A middleware that sets a header makes that header appear on a matching response.
- [ ] A dispatched request under the prefix with an undefined path returns 404.
- [ ] Jest tests cover both cases through the Runtime backend.

## Stories covered

7, 8

## Context pointers

- Spec: "Testing Decisions" (middleware and 404 cases).
