# Cell-defined routes: design and migration guide

## Purpose and scope

This document describes the cell-defined HTTP route feature implemented by the
JavaScript kernel and gives a migration guide for the JupyterLite polyglot
kernel deployed by `datax-now`. It is intended to explain both the
notebook-facing behavior and the boundaries between kernel, Runtime, and
browser-side routing, so the feature can be reimplemented without depending on
this repository's README.

The core idea is that a running notebook kernel can handle same-origin browser
requests for a claimed URL path prefix. Requests are routed to that kernel's
Runtime, where an in-process framework adapter invokes the registered handlers.
No network listening socket is opened.

The routing and request/response protocol are framework-neutral. The current
JavaScript implementation uses Hono in both its iframe and Web Worker Runtime
modes. This document describes that implementation as a reference, not as a
requirement that a polyglot kernel use Hono or JavaScript syntax.

## Notebook-facing behavior

In a JavaScript cell, `app` is the Runtime's Hono application.
`claimPrefix(prefix)` claims a URL prefix for the executing kernel; route
handlers are registered on `app`:

```javascript
claimPrefix('/api/my-notebook/');

app.get('/api/my-notebook/hello', c =>
  c.json({ message: 'hello' })
);
```

The browser can then make a same-origin request, for example:

```javascript
const response = await fetch('/api/my-notebook/hello');
const result = await response.json();
```

`claimedPrefixes()` returns a Promise for the prefixes currently owned by the
calling kernel. It is asynchronous because the Runtime asks the kernel-side
claim registry for its current list.

### Prefix and ownership rules

- Prefixes match complete path segments: `/api/report/` matches
  `/api/report/summary`, but not `/api/reporting`.
- If multiple prefixes match, the longest matching prefix wins.
- A new claim for the same prefix from the same page/client context replaces
  the previous claim, including when a different kernel makes the new claim.
- A request is dispatched only to the Runtime belonging to the kernel that
  owns the selected claim.
- Claims belong to their owning kernel, not to whichever kernel is currently
  selected in the notebook UI. Switching kernels does not transfer or release
  claims. They remain active until released, the owning kernel is restarted,
  or it is disposed.
- Re-running a cell replaces the route registrations made by that cell while
  retaining other cells' registrations. Calling `claimPrefix()` also removes
  other cells' routes in the same Runtime under the claimed prefix, using the
  same whole-segment rule as Service Worker matching: claiming `/api/report/`
  removes `/api/report/x` but not `/api/reporting/x`. Wildcard registrations
  (`use(handler)`, `all('*')`) and parameterised patterns whose static part
  overlaps the claim are removed as well. Cell-defined `notFound` and `onError`
  handlers are not path-scoped and are kept.
- A route, middleware, or handler registered after its cell has finished is
  ignored and logged at `warn`. Register routes synchronously while the cell
  runs. Registrations inside a `setTimeout`, a promise callback, or an event
  handler that fires after the cell ends do not take effect.
- Restarting a kernel clears its route table and releases its claims. Claims
  are released by the kernel's dispose path; a restarted kernel starts with
  none.

Treat prefixes as shared URL namespaces, not as access-control boundaries.
Use a stable, application-specific prefix such as
`/api/sales-dashboard/`; do not rely on the kernel ID or notebook selection to
avoid conflicts. Coordinate ownership if multiple notebooks intentionally
share a prefix. See [cell-defined-routes-best-practices.md](./cell-defined-routes-best-practices.md)
for naming and development recommendations.

### Responses and logging

- An unclaimed request is not intercepted by this feature and continues through
  the browser's normal fetch handling.
- A request intercepted under a claim returns `404` if no registered handler
  matches.
- A handler exception returns `500`. It is logged in the owning Runtime and is
  not emitted as an error output in the cell that initiated the request.
- If the claim exists but its owning kernel Runtime is unavailable, the
  response is `503` with plain text `Runtime for <prefix> is not running`.
  This also applies when the owning page does not answer within 20 seconds, so
  a frozen page cannot hang the request indefinitely.
- A handler's own status, headers, and body are returned to the caller.

Completed route requests are logged in the Runtime console: successful
responses at `info`, client errors at `warn`, and server errors at `error`.
`routeLogLevel` defaults to `warn`; supported levels are `debug`, `info`,
`warn`, `error`, and `silent`. Handler exceptions are also logged at `error`.

A `claimedPrefixes()` operation still pending when a kernel restarts may not
resolve: reinitialization clears outstanding Runtime-side requests.

The Worker Runtime sends a heartbeat every 1 second and treats it as lost after
3 seconds without a reply. A lost Runtime makes its claimed prefixes return
`503`, so a busy or crashed Runtime is reported rather than left to hang. The
JupyterLite extension also shuts a notebook's or console's JavaScript kernel
down when its tab closes, which releases that kernel's service worker claims.

## Architecture and request flow

The design has three separable responsibilities:

1. **Claim registry and browser routing:** a Service Worker observes claim and
   Runtime identity messages, matches fetch request paths to claims, and
   chooses the owning kernel.
2. **Kernel-to-Runtime bridge:** the kernel forwards a plain-data request to
   the backend for that kernel. The backend uses Comlink to dispatch into the
   Runtime (iframe or worker).
3. **In-process framework adapter:** the Runtime adapter runs route handlers
   and returns a plain-data response. It does not open a socket or cross the
   browser/network boundary itself.

Typical request sequence:

1. Cell code calls `claimPrefix('/api/my-notebook/')`.
2. The Runtime tells the kernel about the claim through an output message.
   The kernel tracks claims by its kernel ID and posts claim/release messages
   to the page's Service Worker.
3. The Runtime identifies the browser Client in which it runs and registers
   that identity against its kernel. This lets requests originating from the
   Runtime be attributed to the correct page and kernel.
4. Browser code calls `fetch()` for a URL under a claimed prefix. The Service
   Worker selects the longest matching claim for the issuing page/client. For
   requests made by a registered Runtime, selection is constrained to that
   Runtime's own kernel claims.
5. The Service Worker converts the Fetch `Request` to plain data and posts a
   dispatch message to the owning page using a `MessageChannel`.
6. The page identifies the backend by kernel ID and invokes its
   `dispatchRequest()` method. The backend forwards the plain-data request via
   Comlink to that kernel's Runtime.
7. The Runtime adapter invokes the matching handler and returns status,
   headers, and response bytes. The result travels back through the backend
   and MessagePort; the Service Worker turns it into a Fetch `Response`.

The kernel ID is the routing identity. UI selection is deliberately not part
of request dispatch. If no Runtime backend is registered or its backend has
been disposed/failed to load, the bridge returns the `503` response. Errors
other than Runtime unavailability propagate to the Service Worker dispatch
error handling rather than being silently converted to `503`.

## Runtime route adapter contract

Framework-specific behavior is behind a Runtime-local adapter. In this
repository that seam is `IRuntimeRoutes`; it is constructed inside each Runtime
initialization and never crosses Comlink as an app/framework object.

An adapter provides:

| Operation | Responsibility |
| --- | --- |
| `app` | Expose the framework instance to cells. |
| `beginCell(cellKey)` | Start recording the replacement registrations for the cell about to execute. |
| `endCell()` | Publish the new registrations and restore the shared framework app. |
| `claimPrefix(prefix)` | Remove other cells' registrations under a claimed prefix in this Runtime. It does not notify the Service Worker. |
| `dispatchRequest(request)` | Handle a framework-neutral request without opening a listening socket. |
| `dispose()` | Release route state and framework resources. |

The framework-neutral request shape is `{ method, url, headers?, body? }`,
where `body` is optional `Uint8Array` data. A response is
`{ status, headers, body }`, with response body bytes represented as
`Uint8Array`. Keep these plain-data shapes serializable across the kernel /
Runtime boundary. Do not send a framework app, Request/Response instance, or
handler function over Comlink.

The JavaScript/Hono adapter records route, middleware, not-found, and error
handler registrations per cell, then replays the registration sets in cell
order onto a fresh Hono app after execution. Re-running a cell replaces only
that cell's set; other cells keep their relative ordering. `endCell()` runs in
a `finally` path even if execution fails, so registrations made before the
failure remain published. Code run without a cell ID gets a distinct key based
on its execution count.

The default adapter reports uncaught handler exceptions through the Runtime's
`onError` hook and returns a `500` response. A cell-specific error handler is
preserved and wrapped so exceptions are still reported. Middleware and custom
not-found behavior should be exercised in the target framework adapter; in
particular, middleware that returns no response must still result in a defined
unmatched-route response.

The `RuntimeRoutesFactory` seam is an extension point for custom Runtime
bootstraps. The factory executes locally once per Runtime initialization.
Hono remains the default for both existing JavaScript runtime modes; this is
not notebook-facing framework selection and does not itself add Python or
polyglot execution support.

## Migration guidance for a JupyterLite polyglot kernel

### Preserve the portable behavior

The destination implementation should preserve these externally observable
properties unless the product explicitly chooses a different contract:

1. Cells can declare one or more prefixes and register request handlers.
2. Browser requests are routed by URL path, using whole-segment prefix
   matching and longest-prefix precedence.
3. Each request is sent only to the owning kernel Runtime; selecting another
   kernel does not change ownership.
4. A route cell can be re-executed without duplicating stale registrations or
   disturbing unrelated cells' routes.
5. Kernel restart/disposal removes the kernel's registrations and claims.
6. Requests and responses cross execution-context boundaries as plain data,
   including binary body bytes.
7. The unavailable-Runtime case and route error cases have explicit HTTP
   responses and diagnostics.

The browser-side claim registry, Service Worker routing, and plain-data
protocol are the most reusable pieces. The current Hono application and
JavaScript global bindings are language/runtime-specific.

### `datax-now` repository and build boundary

The current `datax-now` repository is the JupyterLite site builder/deployer;
it consumes the prebuilt `jupyterlite_xeus_x` wheel rather than containing the
polyglot kernel's Runtime source. In the checked-out architecture:

- `xeus-x` builds the multi-language WebAssembly kernel and publishes its wheel
  into `datax-now/built-in-wheels/`.
- `xeus-javascript-private` supplies the JavaScript sub-kernel source consumed
  by `xeus-x` as `src/xeus-javascript`.
- `datax-now/environment-deploy.yml` selects the wheel, and `build.sh` installs
  and assembles the static JupyterLite application. The configured default
  kernel name is `xpython`.

Accordingly, separate the migration into two changes when the feature needs
kernel/runtime behavior: implement it in the owning `xeus-x` or JavaScript
sub-kernel source, then publish and consume the resulting wheel through
`datax-now`. Change `datax-now` directly for deployment configuration,
packaging, notebook examples, or Service Worker/deployment-scope integration;
do not assume changing its deploy scripts alone adds a route API to the
kernel. Confirm the exact source ownership with the maintainers before
implementation because the route feature may span the polyglot kernel and its
JavaScript sub-kernel.

Use `cross_repos.md` in `datax-now` as the current source-of-truth for the
cross-repository build contract. After publishing a new wheel, update the
deployer's pinned wheel reference as required, rebuild the static site, and
verify the feature from a served JupyterLite page. The Service Worker must
control the same page that issues requests; a route test that calls an adapter
directly does not verify deployment scope or the full browser-to-kernel path.

### Map the pieces into the destination architecture

Before implementing, identify in the polyglot kernel:

- The stable identity for a kernel instance and the lifecycle events for
  restart/disposal.
- The browser/page context that owns the kernel and can communicate with the
  Service Worker.
- The execution Runtime for each language and the bridge used to dispatch work
  to that Runtime.
- How the execution layer exposes cell identity and execution count.
- How cells register handlers in each language, and whether the chosen
  framework can run in-process without listening on a port.

Then place responsibilities as follows:

| Responsibility | Destination component |
| --- | --- |
| Match URLs and own claims | Browser Service Worker or equivalent page-level router |
| Track kernel lifecycle and forward claim messages | Kernel frontend/controller |
| Carry HTTP method, URL, headers, and bytes | Framework-neutral bridge protocol |
| Expose language/framework API to cells | Language-specific Runtime adapter |
| Replace registrations on cell re-execution | Execution-aware route registry in that Runtime |
| Return handler errors and request logs | Runtime error/logging integration |

The polyglot kernel may have one Runtime per language or a shared execution
service. Decide which entity owns claims before wiring handlers. The reference
behavior is per-kernel ownership: a route registered in one language Runtime
must not accidentally dispatch to another Runtime merely because it is the
currently active language. If route sharing across languages is desired, make
that a deliberate ownership model rather than an effect of selected-kernel or
selected-language state.

### Decisions specific to the target

These points require a target-repository decision; they cannot be answered by
the JavaScript kernel implementation:

- **Cell API:** choose language-appropriate names and idioms for declaring a
  prefix and registering routes. The current `app` global and
  `claimPrefix()` function are JavaScript/Hono bindings, not universal API
  requirements.
- **Framework adapter:** select a framework that handles requests in-process
  or implement a small router. Starting a local HTTP server and fetching it
  would change the security, lifecycle, and portability model.
- **Route state scope:** determine whether cells in different language
  runtimes within one polyglot kernel share a claim and/or route registry.
  Keep the kernel identity separate from the language-runtime identity.
- **Rerun semantics:** derive a stable cell key from the notebook execution
  protocol. If the protocol cannot provide cell IDs, use a unique execution
  key as the fallback; do not use a single shared key that overwrites every
  interactive execution.
- **Claim collisions:** choose whether to preserve same-prefix replacement
  (current behavior), reject a conflicting claim, or report conflict. Any
  intentional difference should be documented and tested.
- **Browser support and deployment:** confirm the Service Worker scope,
  origin, HTTPS/local-development constraints, and notebook page ownership in
  the destination deployment.
- **Errors and logging:** define how handler exceptions are reported to the
  owning Runtime and how `404`, `500`, and `503` are observed by callers.

### Suggested implementation order

1. Define a typed, serializable request/response protocol with binary-safe
   bodies and explicit HTTP status/headers.
2. Implement and unit-test prefix matching, longest-prefix selection,
   page/client scoping, same-prefix conflict behavior, and claim release.
3. Connect kernel claim/release messages to the Service Worker and associate
   each Runtime Client with its owning kernel.
4. Add a dispatch method to the execution bridge and verify it reaches only
   the Runtime for the owning kernel.
5. Implement the language-specific route adapter and expose its cell API.
6. Add execution-aware registration replacement, preserving other cells'
   registrations and the framework's required registration order.
7. Integrate restart/disposal, handler-error reporting, request logging, and
   unavailable-Runtime responses.
8. Exercise the full path from a notebook cell through browser `fetch()` and
   back to a response in each supported language/runtime mode.

## Reference implementation map

Paths below refer to the JavaScript-kernel implementation from which this
feature is being migrated:

| Source | Role |
| --- | --- |
| `packages/javascript-kernel/src/service_worker.ts` | Service Worker fetch interception, claim table updates, Runtime identity, and dispatch to the owning page. |
| `packages/javascript-kernel/src/service_worker_routing.ts` | Whole-segment matching, longest-prefix selection, Runtime-scoped selection, identity URL helper. |
| `packages/javascript-kernel/src/service_worker_bridge.ts` | Claim/runtime/dispatch messages and binary-safe conversion between Fetch and plain-data request/response. |
| `packages/javascript-kernel/src/service_worker_client.ts` | Page-side Service Worker connection and kernel claim/runtime registration. |
| `packages/javascript-kernel/src/kernel.ts` | Kernel-side handling of claim, release, and `claimedPrefixes()` messages and claim cleanup on disposal. |
| `packages/javascript-kernel/src/runtime_protocol.ts` | Runtime output messages, request/response types, initialization options, and Comlink API contract. |
| `packages/javascript-kernel/src/runtime_backends.ts` | Backend-to-Runtime dispatch and request lifecycle. |
| `packages/javascript-kernel/src/runtime_remote.ts` | Runtime globals, cell execution boundaries, route factory lifecycle, `claimedPrefixes()` request correlation, logging, and disposal. |
| `packages/javascript-kernel/src/runtime_routes.ts` | Framework-neutral route adapter interface and factory. |
| `packages/javascript-kernel/src/hono_routes.ts` | Hono adapter, per-cell registration recording/replay, request handling, and error behavior. |

Useful acceptance-test references:

- `packages/javascript-kernel/src/service_worker_routing.test.ts` and
  `service_worker_bridge.test.ts` cover route selection and protocol behavior.
- `packages/javascript-kernel/src/kernel_claims.test.ts` covers claim/release
  lifecycle and kernel ownership.
- `packages/javascript-kernel/src/runtime_dispatch.test.ts` covers handler
  dispatch, bodies, errors, logging, and cell reruns.
- `packages/javascript-kernel/src/runtime_routes.test.ts` covers the
  framework-adapter seam and execution lifecycle.
- `packages/javascript-kernel/src/cell_claimed_prefixes.test.ts` covers the
  cell-facing `claimedPrefixes()` request/response flow.

Notebook examples in the reference repository:
[basic cell routes](../examples/cell-defined-routes.ipynb),
[direct OpenAI mock](../examples/openai-mock.ipynb), and
[OpenAI SDK mock](../examples/openai-sdk-mock.ipynb).

## Cross-language capability: status and suggestions

Status: not implemented. The JavaScript kernel supports cell-defined routes
only for the JavaScript Runtime. The work below is planned for a future
change.

### Current status

Reusable as-is (language-neutral):

- Plain-data request and response types with `Uint8Array` bodies.
- Service Worker claim registry, whole-segment and longest-prefix matching,
  and Runtime-scoped selection.
- The `IRuntimeRoutes` adapter interface and the `RuntimeRoutesFactory` seam.
- The 503 unavailable response and the 20 second timeout.

Hard-wired to JavaScript, Hono, or Comlink:

- The default route factory is Hono.
- `app`, `claimPrefix`, and `claimedPrefixes` are installed as JavaScript
  globals.
- `IRemoteRuntimeApi` is a Comlink contract that mixes kernel and Runtime
  concerns.
- The 1 second / 3 second heartbeat exists only in the Worker Runtime backend;
  the iframe mode has none.
- Runtime identity is learned by fetching the reserved `__runtime_identity__`
  URL from the Runtime's client context.

Gaps against the design:

- The page's backend map is keyed by kernel ID only, so a polyglot kernel with
  several language Runtimes cannot select one. Kernel identity must be kept
  separate from language-runtime identity.
- Claims carry no Runtime field, so routing cannot target a specific language
  Runtime within a kernel.
- No second-language adapter or cross-runtime contract test exists.

### Suggestions

1. Decide ownership first: one Runtime per kernel or per language, which
   repository owns each layer (`xeus-x`, `xeus-javascript-private`, or
   `datax-now`), and the cell API naming for each language. Confirm with the
   maintainers before implementation.
2. Generalise the seams: key backends by kernel ID plus Runtime ID, add a
   Runtime field to claims, and move the protocol to a neutral typed schema
   that does not depend on Comlink.
3. Make the heartbeat and identity handshake part of the Runtime contract so
   every Runtime type reports liveness and identity the same way, without
   requiring the Runtime to fetch from its client context.
4. Build a proof of concept with one non-JavaScript Runtime, and validate the
   seams from step 2 against it.
5. Add contract tests that run the same route scenarios against every Runtime
   type, covering routing, replacement, release, dispatch, errors, and the
   503 path.
