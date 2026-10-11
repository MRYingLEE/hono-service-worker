# Can PGlite be hosted in a Service Worker?

This note investigates whether PGlite (WASM Postgres) can run inside a
browser Service Worker, for use as an in-browser Postgres backend for the
JavaScript kernel without a remote database server. Sources are PGlite's
own documentation/source (`electric-sql/pglite`), the W3C Service Worker
spec, and `web.dev`/MDN platform references. No code changes were made;
this is a feasibility record only.

**Terminology check first.** This repository already has a Service Worker
(`packages/javascript-kernel/src/service_worker.ts`), but it is a browser
`ServiceWorker` used purely to intercept `fetch` events and forward
cell-defined-route requests to the owning page over a `MessageChannel`
(`packages/javascript-kernel/src/service_worker.ts:96-140`). The kernel's
own code runs in a *dedicated* Web Worker
(`packages/javascript-kernel/src/worker-runtime.ts:1-9`), driven from the
page via Comlink, and registered with the Service Worker only so that
routed HTTP requests reach the right tab
(`packages/javascript-kernel/src/runtime_backends.ts:56-76`). This
distinction matters throughout: PGlite's own "worker" story targets
dedicated Web Workers, not Service Workers.

## 1. Single request queue (does PGlite serialize concurrent calls?)

Yes, and this is intrinsic to PGlite, not something a Service Worker would
need to add. PGlite is explicitly single-connection:

> "PGlite is single user/connection." — electric-sql/pglite README
> (https://github.com/electric-sql/pglite, "How to build PGlite and
> contribute" section)

The TypeScript client enforces this with an internal `async-mutex` lock
around `query`/`exec`/`transaction`:

- `export { Mutex } from 'async-mutex'` —
  `electric-sql/pglite:packages/pglite/src/index.ts`
- "We wrap the public query method in the transaction mutex to ensure that
  only one query can be executed at a time and not concurrently with a
  transaction" — `electric-sql/pglite:packages/pglite/src/base.ts:198`
  (same comment repeated for `exec` at `base.ts:239`)

So every caller (whatever communication channel is used) effectively
submits to one FIFO queue already. A Service Worker would not be adding
concurrency control; it would just be another (or the only) place that
mutex lives.

## 2. define + CRUD API compatibility

PGlite exposes a conventional Postgres client surface
(`electric-sql/pglite:docs/docs/api.md:149-290`):

- `query(sql, params?, options?)` — extended query protocol, parameterized
- `exec(sql, options?)` — simple query protocol, multi-statement, no params
- `sql\`...\`` tagged template — sugar over `query`
- `transaction(callback)` — interactive transaction with `tx.query`,
  `tx.exec`, `tx.rollback()`
- `listen`/`unlisten`/`onNotification` for `LISTEN`/`NOTIFY`
- `dumpDataDir()`/`loadDataDir` for export/import

All standard DDL/DML (`CREATE TABLE`, `INSERT`, `UPDATE`, `DELETE`,
`SELECT`, transactions) works via these methods — there is no special
"CRUD" API, just SQL over `query`/`exec`/`transaction`. This is identical
whether PGlite runs on the main thread, in a dedicated Worker, or (with the
caveats below) in a Service Worker: the wire-level API is transport
agnostic, so a page would call the same `query`/`exec`/`transaction`
shapes over whatever message channel exposes the instance.

## 3. Lifecycle / persistence

PGlite offers three virtual filesystems relevant to the browser
(`electric-sql/pglite:docs/docs/filesystems.md`):

- **In-memory (default)** — no persistence beyond `dumpDataDir()`/
  `loadDataDir`; available everywhere (`filesystems.md:9-15`).
- **IndexedDB (`idb://...`)** — "loading all files for the database into
  memory on start, and flushing them to IndexedDB after each query if they
  have changed" (`filesystems.md:63`). Usable from a Service Worker, since
  IndexedDB is available in that scope, but every flush is async and adds
  per-query latency unless `relaxedDurability` is used
  (`filesystems.md:65`).
- **OPFS "access handle pool" (`opfs-ahp://...`)** — "only available when
  PGlite is run in a Web Worker" (`filesystems.md:89`), because it depends
  on `FileSystemSyncAccessHandle.createSyncAccessHandle()`, which the File
  System Access API restricts to dedicated worker contexts — not Service
  Workers, not Shared Workers, not the main thread (MDN,
  https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle).
  **This rules out the fastest/most durable PGlite filesystem for a
  Service Worker-hosted instance.**

Lifecycle is the bigger problem. The W3C Service Worker spec states the
model plainly:

> "Service workers are started and kept alive by their relationship to
> events, not documents... the necessity to time-limit the execution of
> background processing contexts..."
> (https://w3c.github.io/ServiceWorker/#service-worker-lifetime)

In practice, browsers terminate an idle Service Worker (commonly after
~30 seconds with no in-flight event) and respawn it cold on the next
event; no in-memory JS state survives (MDN, "ServiceWorkerGlobalScope",
https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope).
For PGlite this means:

- An in-memory PGlite instance hosted in the Service Worker would be
  silently discarded whenever the browser decides to recycle the worker,
  with no event to hook the shutdown.
- Re-creating the instance means re-running Postgres's WASM boot/`initdb`
  cost on every wake — a cost PGlite's own docs frame as a *feature* for
  ephemeral test instances, not something to pay on every HTTP request.
- Durable storage (IndexedDB) survives worker recycling, but only the
  *data*, not the open `PGlite`/connection object — every restart still
  re-opens the datadir from IndexedDB.

## 4. Communication from clients

PGlite's documented multi-consumer story is `PGliteWorker` + `worker()`
(`electric-sql/pglite:docs/docs/multi-tab-worker.md:1-45`), and it is built
on dedicated Web Workers, not Service Workers:

> "This starts a worker for each tab, but then runs an election to
> nominate one as the leader. Only the leader then starts PGlite by
> calling the `init` function, and handles all queries." —
> `multi-tab-worker.md:38`

Leader election uses the Web Locks API, and inter-tab messaging uses
`BroadcastChannel` (confirmed by PGlite's own worker/multi-tab
documentation surfaced via electric-sql.github.io and referenced in the
project's docs site navigation, `docs/.vitepress/config.mts`). A Service
Worker already *is* a single shared instance per registration/origin, so
in principle it sidesteps the "which tab is the leader" problem PGlite
solves for dedicated workers — but you would be trading a documented,
tested leader-election/BroadcastChannel protocol for an undocumented,
custom one built on Service Worker `message`/`fetch` events, with no
primary-source guidance from PGlite on how to adapt `init()`/`worker()`
internals to that scope.

In this repository's existing comm channel, the Service Worker already
exchanges request/response payloads with pages via `postMessage` and
per-call `MessageChannel`s
(`packages/javascript-kernel/src/service_worker.ts:53-70`). The same
primitive (structured-clone `postMessage`, `MessageChannel` for
request/response correlation) is reusable for PGlite query dispatch, but
it has to be built from scratch — PGlite does not ship a Service Worker
transport.

## 5. WASM / worker compatibility

- PGlite is Emscripten-compiled Postgres running in **single-process
  mode** (no `fork()`), per PGlite's own README: "programs compiled with
  Emscripten... cannot fork new processes, and operate strictly in a
  single-process mode... PostgreSQL includes a 'single user mode'... PGlite
  is single user/connection" (https://github.com/electric-sql/pglite).
  Nothing in PGlite's documented build requires `SharedArrayBuffer` /
  cross-origin isolation (`COOP`/`COEP`) for this reason — it is not a
  multi-threaded pthreads build. (No PGlite doc page asserts a COOP/COEP
  requirement; absence of such a requirement is inferred from the
  single-process design description above, not independently confirmed in
  the docs reviewed.)
- WebAssembly instantiation (`WebAssembly.compileStreaming`/`instantiate`)
  and `fetch` are both available inside `ServiceWorkerGlobalScope`, so
  loading `pglite.wasm` is not blocked outright.
- Module-type Service Workers (`register(url, { type: 'module' })`),
  which PGlite's own worker file needs ("you can use the recommended
  `?worker` import... worker.format: 'es'",
  `electric-sql/pglite:docs/docs/bundler-support.md`), only support
  **static** `import` — dynamic `import()` is not allowed inside a Service
  Worker module, mirroring the existing restriction on dynamic
  `importScripts()` (web.dev, "ES modules in service workers",
  https://web.dev/articles/es-modules-in-sw). PGlite's extension loading
  and worker bootstrap use dynamic patterns in places (e.g. `new
  URL('./file', import.meta.url)` resolution, optional extension
  bundles), which would need auditing/rewriting for a Service Worker
  module context.
  Browser support for `type: 'module'` Service Worker registration is also
  uneven historically — Chrome and Safari support it, Firefox did not
  until very recently (per Firefox's own module-worker rollout) — so a
  module-type Service Worker reduces cross-browser reach versus the
  dedicated Worker path PGlite documents and tests.

## 6. Bundling constraints

PGlite's documented bundler guidance
(`electric-sql/pglite:docs/docs/bundler-support.md`) is all written from
the assumption of bundling for dedicated Workers:

- Vite: exclude `@electric-sql/pglite` from `optimizeDeps`, and set
  `worker.format: 'es'` for the "Multi-tab Worker" specifically.
- esbuild: does not support the `new URL('./file', import.meta.url)`
  pattern PGlite uses to locate `pglite.wasm`/`initdb.wasm`/`pglite.data`;
  the documented workaround is to fetch and pass these assets manually via
  `pgliteWasmModule`/`initdbWasmModule`/`fsBundle`.

None of this guidance mentions Service Workers; adapting it would mean
manually fetching/compiling the three PGlite asset files inside the
Service Worker's `install` handler (so they're available before any
`fetch` is served), with no documented precedent to follow.

## 7. Service Worker-specific restrictions (summary)

| Constraint | Effect on hosting PGlite in a Service Worker |
|---|---|
| Idle termination, event-driven restart (W3C spec, §Service Worker Lifetime) | In-memory PGlite state is not safe between events; must reload from IndexedDB on every cold start |
| No `createSyncAccessHandle` (OPFS sync) in Service Worker scope (MDN) | Loses PGlite's fastest/most durable browser FS (`opfs-ahp://`); forced onto async IndexedDB FS with per-query flush cost |
| Static-only ES module imports in module Service Workers (web.dev) | PGlite's worker bootstrap/extension loading needs auditing for dynamic `import()` usage |
| One Service Worker instance shared per registration/origin | Naturally serializes access (good fit for PGlite's single-connection model) but removes the documented/tested leader-election path (`PGliteWorker`) |
| No documented PGlite Service Worker transport | `postMessage`/`MessageChannel` plumbing (this repo already has a pattern for it) must be hand-built and hand-tested |

## 8. Practical architecture options

1. **Dedicated Worker, PGlite's documented path (recommended).** Host
   PGlite inside a dedicated Web Worker — e.g. alongside or inside this
   repository's existing `worker-runtime.ts`
   (`packages/javascript-kernel/src/worker-runtime.ts:1-9`), which already
   runs per-kernel code via Comlink from the page. Use PGlite's
   `worker()`/`PGliteWorker` pair
   (`electric-sql/pglite:docs/docs/multi-tab-worker.md:9-45`) if multiple
   tabs/kernels need to share one instance; this gets IndexedDB and OPFS
   AHP persistence, tested leader election, and no idle-termination risk
   beyond normal tab lifetime.
2. **Service Worker as a thin router only, dedicated Worker as the real
   host.** Keep this repository's existing `service_worker.ts` exactly as
   it is (routing fetch/`claimPrefix()` traffic to the owning page/kernel,
   `packages/javascript-kernel/src/service_worker.ts:96-140`), and have the
   Service Worker's `fetch` handler, when it resolves to a
   cell-defined-route that wants a database, dispatch (as it already does)
   to the page, which in turn calls into the dedicated Worker that owns
   PGlite. This adds no new Service Worker risk and reuses the existing
   `MessageChannel` request/response convention
   (`packages/javascript-kernel/src/service_worker.ts:53-70`).
3. **PGlite directly inside the Service Worker (not recommended).**
   Technically possible only with the in-memory or IndexedDB filesystem
   (no OPFS AHP), a classic (non-module) Service Worker script or careful
   avoidance of dynamic imports, and an explicit reload-from-IndexedDB on
   every service worker (re)start to tolerate idle termination. This loses
   PGlite's own tested multi-tab protocol and the fastest VFS, and has no
   PGlite documentation or examples to validate against — it would be new,
   unverified integration work, not a documented interaction pattern.

## Bottom line

PGlite's CRUD/SQL surface (`query`/`exec`/`transaction`) is
transport-agnostic and already internally queues all operations behind a
single mutex, so "single request queue" and "CRUD API compatibility" are
not blockers either way. The blockers are Service Worker-specific: no
synchronous OPFS access, idle termination that discards in-memory state,
static-import-only module scripts, and the complete absence of any
PGlite-documented Service Worker transport or example. PGlite's own
documented, tested answer to "share one Postgres across contexts without a
server" is the dedicated-Worker `PGliteWorker`/`worker()` pair, which maps
cleanly onto this repository's existing dedicated worker-runtime
architecture; routing through the existing Service Worker (as a thin relay
to that worker, option 2 above) is compatible with today's codebase, while
hosting PGlite's engine directly inside the Service Worker is not a path
PGlite supports today.

## Sources

- PGlite README — https://github.com/electric-sql/pglite
- PGlite API reference — `electric-sql/pglite:docs/docs/api.md`
- PGlite Filesystems — `electric-sql/pglite:docs/docs/filesystems.md`
- PGlite Multi-tab Worker — `electric-sql/pglite:docs/docs/multi-tab-worker.md`
- PGlite Bundler Support — `electric-sql/pglite:docs/docs/bundler-support.md`
- PGlite mutex/queue — `electric-sql/pglite:packages/pglite/src/index.ts`,
  `electric-sql/pglite:packages/pglite/src/base.ts:198,239`
- W3C Service Worker spec, Service Worker Lifetime —
  https://w3c.github.io/ServiceWorker/#service-worker-lifetime
- MDN, `ServiceWorkerGlobalScope` —
  https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope
- MDN, `FileSystemFileHandle.createSyncAccessHandle()` —
  https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle
- web.dev, "ES modules in service workers" —
  https://web.dev/articles/es-modules-in-sw
- This repository: `packages/javascript-kernel/src/service_worker.ts`,
  `packages/javascript-kernel/src/worker-runtime.ts`,
  `packages/javascript-kernel/src/runtime_backends.ts`
