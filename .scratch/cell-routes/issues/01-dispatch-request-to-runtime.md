# Dispatching a request into a Runtime and getting a response

Status: resolved
Blocked by: none
Parent: [spec](../spec.md)

## What to build

Tracer bullet through the Runtime path, end to end, without the browser:

- A Kernel's Runtime holds one Hono app, exposed to cells as `app`. A cell can call `claimPrefix(prefix)` and add routes to `app` with the Hono API. The exact module specifier for these two names is chosen here and recorded in this ticket's notes, so later tickets and the docs use it.
- Add one request-dispatch operation to the backend interface (`IRuntimeBackend` in `runtime_backends.ts`) and to the Comlink protocol (`IRemoteRuntimeApi` in `runtime_protocol.ts`). Implement it for both the iframe and worker runtime backends. Request in: method, URL parts, headers, body. Response out: status, headers, body. This ticket only needs text bodies; binary and JSON are ticket 03.
- Jest is listed in the package's devDependencies and `test` script, but there is no Jest config file yet. Add one (ts-jest) so tests can run.

## Acceptance criteria

- [ ] A cell that runs `app.get('/hello', (c) => c.text('hi'))` followed by a dispatched `GET /hello` returns status 200 and body `hi`.
- [ ] The test runs real cell code through the Runtime backend, not mocked Hono objects.
- [ ] `yarn test` (or `npm test`) in `packages/javascript-kernel` runs the new test and passes.

## Stories covered

2, 3, 16, 17, 30

## Context pointers

- Spec: "Implementation Decisions" (Hono app location, Dispatch interface), "Testing Decisions" (primary seam).
- [ADR-0001](../../../docs/adr/0001-service-worker-routes-to-kernel-runtime.md): the Hono app lives in the Runtime, not the Service worker.
- [CONTEXT.md](../../../CONTEXT.md): terms Runtime, Hono app.
