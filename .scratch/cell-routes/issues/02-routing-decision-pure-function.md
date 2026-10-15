# Service worker routing decision as a pure function

Status: resolved
Blocked by: none
Parent: [spec](../spec.md)

## What to build

A new Service worker routing module that holds the Claimed prefix table and resolves ownership. It is a pure function with no browser APIs. Inputs: the claim table, the request URL, and the identity of the issuing context. Output: the owning Kernel id, or pass-through.

Rules:

- Prefixes match on whole path segments.
- The longest matching prefix wins.
- Ownership depends on the issuing context. Two Kernels that claim the same prefix each own only their own issuing contexts.
- Releasing a claim removes it from routing.

Not wired into the browser yet; that is ticket 07.

## Acceptance criteria

- [ ] Unclaimed requests return pass-through.
- [ ] `/api` does not match `/apiv2`.
- [ ] Among overlapping claims, the longest prefix wins.
- [ ] Two Kernels claiming the same prefix each own only their own issuing contexts.
- [ ] After a claim is released, requests under it pass through.
- [ ] Tests are Jest tests, run with the package's `test` script.

## Stories covered

12, 13, 15, 21, 23, 24, 29, 33

## Context pointers

- Spec: "Implementation Decisions" (Owning kernel resolution, Matching rules), "Testing Decisions" (secondary seam).
- [CONTEXT.md](../../../CONTEXT.md): terms Claimed prefix, Owning kernel, Client.
