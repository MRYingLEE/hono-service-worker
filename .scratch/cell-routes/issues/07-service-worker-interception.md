# Service worker interception and forwarding for notebook page requests

Status: resolved
Blocked by: 01, 02
Parent: [spec](../spec.md)

## What to build

Wire the routing module from ticket 02 into the browser:

- Register the Service worker automatically when a notebook opens, with no manual setup.
- Intercept requests issued by the notebook page. When the request falls under a claimed prefix, forward it to the owning Kernel's Runtime using the dispatch operation from ticket 01, and return that response to the Client.
- Requests that match no claim pass through unmodified to the Remote service.
- The Service worker holds no route handlers and no per-Kernel application state. Do not host the Hono app in it. Do not use the Hono service-worker adapter from `service-worker.md`; that file is reference material only.

No automated test seam covers the Service worker wiring. Verify it in a running JupyterLite build in the browser: one claimed route answers, an unclaimed request reaches the Remote service, and the Service worker is registered on notebook open.

## Acceptance criteria

- [x] Opening a notebook registers the Service worker with no user action.
- [x] A Client request under a claimed prefix returns the cell's handler response.
- [x] A Client request outside any claim is unchanged and reaches the Remote service.
- [x] The browser check above is recorded in the ticket's notes.

## Stories covered

1, 14, 15, 16, 17, 25, 26, 28

## Context pointers

- Spec: "Implementation Decisions" (Service worker role, Pass-through, Modules touched).
- [ADR-0001](../../../docs/adr/0001-service-worker-routes-to-kernel-runtime.md).

## Browser verification (2026-10-09)

Run against a JupyterLite static build (`jupyter lite build --contents examples`) served on port 8900, in a JavaScript (Web Worker) console.

- Registration: **fails** in a real build. The extension registers `./javascript-kernel-service-worker.js`, which resolves to `/lab/javascript-kernel-service-worker.js`, but no build step emits that file. It returned 404 and the console showed `Failed to register the service worker`. To continue, the bundle was copied into `lab/` by hand. The unticked box stays open until the file is shipped.
- Claimed request: `/api/hello` returned 200 `application/json` from the cell handler. This passed with the hand-copied bundle.
- Unclaimed pass-through: `/manifest.webmanifest` returned 200 and `/nope/x` returned the static 404. This passed with the hand-copied bundle.

## Re-check after shipping the SW build (2026-10-09)

- Registration: passes. The SW script is now emitted into `lab/` by the jupyterlite-core addon (`javascript-kernel-service-worker.js`). On app load the SW registers at scope `/lab/` with no user action. The earlier failure above is resolved.
- Claimed request, pass-through, and 404 results above still hold on the rebuilt output.
