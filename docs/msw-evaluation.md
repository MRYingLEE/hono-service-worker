# MSW (Mock Service Worker) evaluation

This document evaluates whether [MSW](https://github.com/mswjs/msw) (v3.0.3,
evaluated against a local checkout) could simplify this codebase. It is an
assessment, not a migration plan.

## Conclusion

MSW **cannot replace the browser-side routing architecture** of this kernel,
but it **can simplify the test suite**.

- The reason cell-defined routes exist is to let a plain `fetch()` issued in
  one execution context (a notebook page, an iframe, or a web worker) reach
  Hono handlers that live in *another* context (the owning kernel's runtime).
  MSW handlers only produce responses *in their own context*; they have no
  notion of routing a request to a different JS context, of per-client claim
  tables, or of multi-kernel ownership. The domain-specific parts of this
  codebase are exactly the parts MSW does not provide.
- MSW's browser mode works by installing *its own* service worker
  (`mockServiceWorker.js`). A page scope can hold only one service worker, and
  jupyterlite-core already registers one and **unregisters all service workers
  on version change** — the behavior `service_worker_client.ts` actively
  compensates for. Co-locating MSW's worker in that slot would mean merging
  the claim/dispatch logic into one worker, which removes no code.
- Where MSW does help: the Jest tests hand-roll fake dispatch targets,
  plain-data `IRuntimeRequest`/`IRuntimeResponse` records, and injected Fetch
  globals. `setupServer` from `msw/node` plus `http`/`HttpResponse` would
  replace much of that scaffolding with idiomatic handlers, at zero runtime
  cost.

## How the current request flow works

```
cell code in runtime (iframe/worker)
  → fetch() intercepted by the page's Service Worker (claim matching)
  → SW dispatches {kernelId, prefix, request} to the owning page via MessageChannel
  → owning page forwards to the kernel backend (Comlink)
  → Hono app in the runtime answers (in-process, no socket)
```

Key pieces and why each is not MSW-equivalent:

| Component (file) | Role | MSW equivalent? |
| --- | --- | --- |
| `service_worker.ts` | SW `fetch` listener: matches URL against claims, answers the reserved identity URL, dispatches to owning client with a 20 s timeout → 503 | Interception only; no cross-client dispatch |
| `service_worker_routing.ts` | Longest-prefix, whole-segment claim matching; `__runtime_identity__` clientId discovery | None — claims are multi-tenant state, not handlers |
| `service_worker_bridge.ts` | Plain-data request/response conversion; claim table maintenance; 503/500 semantics | None — the wire protocol is custom |
| `service_worker_client.ts` | Page-side registration, claim bookkeeping, SW re-registration + claim replay when jupyterlite-core wipes workers | None — lifecycle tied to JupyterLite |
| `hono_routes.ts` | Hono adapter with per-cell re-run semantics (`beginCell`/`endCell`, claim overlap stripping, late-registration warning) | Handler ergonomics could be MSW-style, but cell semantics would still be hand-written |
| `runtime_backends.ts` | iframe/worker backends; heartbeat (1 s ping / 3 s lost → 503); runtime client registration | None |

The identity mechanism (`__runtime_identity__` → clientId) and the plain-data
response shape (`{status, headers: Record, body: Uint8Array}`, no streaming)
have no MSW equivalent; both would survive any MSW adoption.

## Constraints for MSW in this environment

1. **One service worker per scope.** MSW's browser mode and this kernel's SW
   cannot coexist; adopting MSW's worker means embedding the claim/dispatch
   logic inside it, netting out most of the "simplification".
2. **JupyterLite lifecycle.** jupyterlite-core unregisters all service
   workers on version change; the existing re-registration and claim-replay
   logic in `service_worker_client.ts` would have to apply to an MSW worker
   too, but MSW's handshake assumes a stable page-scoped worker.
3. **Runtimes are iframes and module workers** under the lab page's scope,
   deliberately, so the page SW controls their fetches. MSW's client-side
   hooks (`setupWorker` in the page) do not run inside the iframe or the
   worker — interception would still have to be SW-side, as today.
4. **No streaming responses.** The dispatch protocol carries full bodies
   only; MSW's streaming `HttpResponse` would be downgraded.
5. **Bundle target.** The SW bundle is a 2.2 KB rspack IIFE
   (`build_lab_scripts.js`); MSW's worker plus `@mswjs/interceptors`-sized
   dependencies would bloat it, for a routing feature MSW doesn't provide.

The architecture already anticipates this seam: `docs/cell-defined-routes.md`
describes the browser router as "a Service Worker **or equivalent
page-level router**". MSW-style interception is the same class of mechanism,
so it is a natural future replacement for the SW *boilerplate* — but not a
drop-in.

## Recommended use of MSW

### 1. Test suite (do now, low risk)

`packages/javascript-kernel` uses Jest 29 with a custom node environment that
copies `Request`/`Response`/`Headers` from the Node realm because Hono's
`app.request()` needs the Fetch globals (`jest.environment.js`). Files such as
`runtime_dispatch.test.ts` (737 lines) and `service_worker_bridge.test.ts`
hand-build fake `IDispatchTarget` backends and `IRuntimeRequest`/`IRuntimeResponse`
records.

Adopt `msw/node`:

- `setupServer` + `http.get/post(path, () => HttpResponse.json(...))` in place
  of the fake dispatch targets where tests assert on request/response shapes;
- MSW's `listens`/assertion helpers for "the request reached the handler with
  these headers" checks;
- `resetHandlers()` maps naturally onto the cell re-run model in tests of
  `hono_routes.ts` semantics (though `HonoRuntimeRoutes` itself still needs
  its own tests — MSW does not model cells).

No runtime or service-worker code changes; the only new dependency is a
devDependency of `@jupyterlite/javascript-kernel`.

### 2. MSW-style handler surface for cells (optional, later)

Notebooks that mock remote APIs (`examples/openai-mock.ipynb`,
`examples/openma-cloudflare-setup.ipynb`) today must write
`claimPrefix` + `app.get` (Hono). Exposing an MSW-shaped
`http.post('*/chat/completions', ...)` global alongside `app` would be
friendlier for that use case. This is a *feature addition* — the dispatch
machinery underneath (SW, claims, Comlink) stays, and the codebase does not
get smaller.

### 3. Not recommended

Replacing `service_worker.ts`/claims/bridge with MSW's `mockServiceWorker.js`.
It conflicts with jupyterlite-core's SW lifecycle, loses cross-context
dispatch, and keeps all of the custom code while adding a large dependency.

## Suggested next steps

1. Spike: rewrite one test file (e.g. `runtime_dispatch.test.ts`) using
   `msw/node` and compare the diff; confirm Jest + MSW Fetch-global
   interplay (MSW on Node 22+ uses the native Fetch API, which the
   `jest.environment.js` injection already provides).
2. If the spike is favorable, migrate the remaining fake-backend tests and
   add `msw` as a devDependency.
3. Track separately: an MSW-style user-facing handler surface for mock-API
   notebooks.
