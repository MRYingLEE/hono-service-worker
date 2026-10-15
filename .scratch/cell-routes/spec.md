# Cell-defined routes served to Clients

Status: ready-for-agent

## Problem Statement

A notebook author who wants to mock or prototype an HTTP service today has to stand up a real server. A Client developer whose existing code calls a Remote service often cannot change that Remote service, and may not have its source at all. Neither can exercise the Client against behavior they control from inside a notebook.

The notebook author wants to write HTTP-style handlers in notebook cells and have the Client's existing requests answered by those handlers, without modifying the Client. The Client developer wants requests to a chosen prefix to reach the notebook while every other request keeps reaching the Remote service exactly as before.

Because a browser can have several notebooks open at once, each notebook's handlers must answer only the requests that its own Kernel owns. Otherwise two notebooks that claim the same prefix would answer each other's Clients.

## Solution

A Kernel's notebook cells can declare a Claimed prefix and define a Hono app whose routes live inside that Kernel's Runtime. The browser's Service worker intercepts requests from Clients. When a request falls under a Claimed prefix, the Service worker forwards it to the Owning kernel's Runtime, which runs the Hono app and returns the response. Requests that match no Claimed prefix pass through to the Remote service unchanged.

The Service worker is a thin, shared router. It holds no per-Kernel application state and never hosts the Hono app (see ADR-0001).

## User Stories

### Notebook author: declaring and defining routes

1. As a notebook author, I want to declare a Claimed prefix from a notebook cell, so that requests under that prefix are answered by my cell code instead of the Remote service.
2. As a notebook author, I want to define Hono routes in my cells, so that I can write handlers with the Hono API I already know.
3. As a notebook author, I want routes defined in one cell to stay available to requests made after that cell runs, so that I can build the route table up across several cells.
4. As a notebook author, I want to re-run a cell that defines a route and have the updated handler take effect on the next request, so that I can iterate without restarting the Kernel.
5. As a notebook author, I want a route I removed from a cell to stop answering requests after I re-run that cell, so that stale handlers do not linger.
6. As a notebook author, I want restarting the Kernel to clear its route table and release its Claimed prefixes, so that I start from a clean state.
7. As a notebook author, I want Hono middleware to run for requests under my Claimed prefix, so that I can add logging, headers, or simple auth to my mock.
8. As a notebook author, I want a request under my Claimed prefix that matches no route to get Hono's standard 404 response, so that I can see the prefix is claimed but the path is not defined.
9. As a notebook author, I want an exception thrown inside a handler to become an HTTP 500 response to the Client, so that the Client sees a failure instead of hanging.
10. As a notebook author, I want the error from a failing handler to be shown in the notebook, so that I can debug the handler without opening developer tools.
11. As a notebook author, I want to see the Claimed prefixes my Kernel currently holds, so that I know what it is serving.
12. As a notebook author, I want prefix matching to respect path segments, so that claiming `/api` does not capture requests to `/apiv2`.
13. As a notebook author, I want the most specific Claimed prefix to win when two of my prefixes overlap, so that I can override a broad route with a narrower one.

### Client developer: transparent interception

14. As a Client developer, I want my existing HTTP calls to a Claimed prefix to be answered by the notebook without changing my Client code, so that I can test against notebook-defined behavior as-is.
15. As a Client developer, I want requests that match no Claimed prefix to reach the Remote service unchanged, so that unclaimed APIs keep working.
16. As a Client developer, I want the HTTP method, path, query string, headers, and body of my request to reach the handler intact, so that handlers see what I sent.
17. As a Client developer, I want the status, headers, and body returned by the handler to come back to me unchanged, so that my Client behaves as it would against the Remote service.
18. As a Client developer, I want JSON request and response bodies to work end to end, so that typical JSON APIs can be mocked.
19. As a Client developer, I want binary request and response bodies to work end to end, so that file-style endpoints can be mocked.
20. As a Client developer, I want a request that the Service worker cannot route to a running Kernel to fail with a clear error, so that I can tell the notebook is not serving it.

### Notebook user: isolation between notebooks

21. As a notebook user with two notebooks open, I want a Client request issued by notebook A's page to be answered only by notebook A's Kernel, so that responses never leak between notebooks.
22. As a notebook user with two notebooks open, I want a Client request issued from a Runtime to be answered by the Kernel that owns that Runtime, so that requests from workers and iframes route correctly.
23. As a notebook user, I want two notebooks that claim the same prefix to each answer only their own requests, so that I can run them side by side.
24. As a notebook user, I want closing a notebook to release its Claimed prefixes, so that another notebook can claim them afterwards.
25. As a notebook user, I want the Service worker to be set up automatically when I open a notebook, so that I do not configure anything manually.
26. As a notebook user, I want this to work entirely in the browser with no server-side component, so that it runs in the same static JupyterLite deployment as the kernel.

### Maintainer: architecture and testability

27. As a maintainer, I want the Hono app to run inside each Kernel's Runtime rather than in the Service worker, so that Kernels never share route state (ADR-0001).
28. As a maintainer, I want the Service worker to only forward intercepted requests and return responses, so that its logic stays small and easy to reason about.
29. As a maintainer, I want the routing decision (which Kernel owns a request, or whether it passes through) to be testable without a browser, so that regressions are caught in CI.
30. As a maintainer, I want request dispatch into a Runtime to be testable through the existing Runtime backend interface, so that tests run real cell code and exercise the same path the browser uses.
31. As a maintainer, I want the Remote service's source code to be unnecessary for this feature to work, so that it applies to black-box services.
32. As a maintainer, I want the feature to add no required changes to Clients, so that adoption does not depend on other teams.
33. As a maintainer, I want Claimed prefix state kept per Kernel, so that disposing one Kernel cannot affect another's routes.

## Implementation Decisions

- **Hono app location.** The Hono app lives inside each Kernel's Runtime, one app per Kernel, as ADR-0001 requires. It is not hosted in the Service worker or in the shared worker.
- **Service worker role.** The Service worker is a router. It maps a Claimed prefix to its Owning kernel and forwards the intercepted request to that Kernel's Runtime. It returns the Runtime's response to the Client. It keeps no route handlers and no per-Kernel application state.
- **Pass-through.** A request that matches no Claimed prefix is not modified and goes to the Remote service as it would without this feature.
- **Owning kernel resolution.** The owner is determined from the identity of the requesting page or Runtime (the Client's origin context), not from the URL alone. A request can only be answered by the Kernel that owns its issuing context.
- **Claim lifecycle.** A Kernel registers its Claimed prefixes with the Service worker when its cells declare them. It releases them on Kernel restart and on notebook close.
- **Matching rules.** Prefixes match on whole path segments. When several Claimed prefixes match, the longest one wins.
- **Route table lifecycle.** The route table reflects the most recent execution of the cells that define it. Re-running a cell replaces that cell's routes. Restarting the Kernel empties the route table.
- **Dispatch interface.** The Runtime backend interface gains one request-dispatch operation that accepts a serialized request and returns a serialized response. The operation travels over the existing Comlink-based runtime protocol. Request and response carry method, URL parts, headers, and body, with binary bodies supported.
- **Error mapping.** An exception thrown in a handler becomes an HTTP 500 response to the Client, and the error is also reported to the notebook. A request that reaches no running Kernel gets an explicit error response.
- **Modules touched (conceptual).** The Runtime backend and runtime protocol gain request dispatch. A new Service worker routing module holds the Claimed prefix table and the owner resolution. The Kernel registers and releases claims as its cells run and as it restarts or closes.
- **Cell-facing API.** The exact syntax for declaring a Claimed prefix from a cell is not yet decided (see Further Notes). Route definition uses the Hono API.

## Testing Decisions

What makes a good test here: it exercises external behavior, meaning what a Client gets back for a given request and given notebook state. It does not assert on internal Hono objects, Comlink wiring, or the order of internal calls.

- **Primary seam: Runtime backend interface.** Tests execute cells through the Runtime backend, then dispatch synthetic requests through the new dispatch operation. Cases to cover:
  - A route defined in a cell answers a matching request with the handler's status, headers, and body.
  - JSON and binary bodies survive the round trip in both directions.
  - Middleware runs for requests under the prefix.
  - An unmatched path under a claimed prefix returns 404.
  - A throwing handler returns 500 and reports the error.
  - Re-running a cell replaces its routes; removing a route makes it 404.
  - Restarting the Kernel clears all routes.
- **Secondary seam: Service worker routing decision.** This is a pure function over the Claimed prefix table, the request URL, and the issuing context. Tests cover:
  - Unclaimed requests pass through.
  - Segment-boundary matching (`/api` does not match `/apiv2`).
  - Longest prefix wins among overlapping claims.
  - Two Kernels claiming the same prefix each own only their own issuing contexts.
  - Releasing a claim removes it from routing.
- **Prior art.** The repository has no test files yet, but Jest is already configured for the `javascript-kernel` package with ts-jest and `@jupyterlab/testutils`. New tests should use that setup (the package's `test` script). No existing test should be modified to accommodate this feature.

## Out of Scope

- Any change to the Remote service or to Client code.
- Persisting routes or Claimed prefixes across page reloads or browser restarts.
- Hosting the Hono app in the Service worker or in a shared worker (ruled out by ADR-0001).
- Server-side or multi-user deployments outside JupyterLite.
- Using the Hono service-worker adapter from the repository's `service-worker.md`. That file is general Hono reference material and is not the design for this feature.
- Full Hono feature coverage (WebSocket, streaming responses, and similar) beyond what the stories above need.

## Further Notes

Open decisions to settle before or during implementation:

1. **Cell syntax for declaring a Claimed prefix.** Not yet decided.
2. **Conflicting claims.** Behavior when two Kernels claim the same prefix from the same issuing context is not decided. Story 23 covers only separate issuing contexts.
3. **Runtime unavailable.** The exact status code and message for a request whose Owning kernel has no running Runtime are not decided (story 20 leaves this open).
4. **Requests before routes exist.** Behavior for a request that arrives after a prefix is claimed but before its cell has defined any routes is not decided.
5. **Handler logging.** Whether `console` output from a handler appears in the notebook cell output or elsewhere is not decided (story 10 covers errors only).

Terms follow [CONTEXT.md](/home/ying/javascript-kernel/CONTEXT.md). This spec respects [ADR-0001](/home/ying/javascript-kernel/docs/adr/0001-service-worker-routes-to-kernel-runtime.md).
