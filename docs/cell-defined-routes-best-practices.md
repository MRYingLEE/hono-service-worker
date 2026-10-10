# Cell-defined routes: best practices

Cell-defined routes let a running JavaScript kernel handle requests under a
claimed URL prefix. The prefix is a shared URL namespace, so choose it as
carefully as you would choose an API path.

## Give each notebook or application a stable namespace

Use a short, stable, application-specific path segment after the common API
prefix. Prefer a lowercase slug with hyphens:

```javascript
const routePrefix = '/api/sales-dashboard/';

claimPrefix(routePrefix);
app.get(`${routePrefix}summary`, c => c.json({ total: 42 }));
```

The request must use the same path:

```javascript
const response = await fetch('/api/sales-dashboard/summary');
const summary = await response.json();
```

Choose a name that distinguishes the notebook's routes from other notebooks
and applications, for example `/api/customer-import/` or
`/api/project-42/reporting/`. Avoid generic prefixes such as `/api/` or
`/data/` when multiple notebooks may run in the same JupyterLite page.

## Do not use the kernel ID as the route namespace

Claims are associated internally with the kernel that made them, but the
prefix is matched against request URL paths. It is not a kernel-name or
kernel-ID field. Kernel IDs identify runtime instances and may change after a
restart; including one in the URL makes requests unstable without preventing
conflicts between kernels that claim the same prefix.

Notebook names and IDs are not automatically added to a claim either. If
notebook identity matters for avoiding collisions, encode a stable,
URL-safe notebook or application slug in the prefix yourself. Treat that slug
as a namespace, not as an access-control mechanism.

## Understand same-prefix replacement

Within a JupyterLite page, claiming the same prefix again replaces the earlier
claim for that page and prefix. This is true even if a different kernel makes
the later claim. A request under that prefix is dispatched only to the kernel
that currently owns the matching claim. Switching the selected kernel does
not itself restart the previous kernel or transfer its routes.

Use distinct prefixes for independent notebooks. If two notebooks
intentionally share one API namespace, coordinate ownership: have one kernel
own the prefix and register the routes there rather than having both kernels
claim it. A more specific prefix can be used for a separate sub-namespace;
the longest matching prefix wins.

## Keep claim and route paths aligned

Claim the smallest prefix that covers the routes the kernel is meant to serve.
Register each route under that prefix, and use a trailing slash for a
directory-like namespace (for example, `/api/sales-dashboard/`). Prefixes
match whole path segments: `/api/report/` covers `/api/report/summary`, but
not `/api/reporting`.

When a cell is re-run, its route registrations are replaced. Keep the claim
in a cell that is run whenever the notebook's route setup is initialized, and
re-run that cell after restarting the kernel. Restarting clears the kernel's
routes and releases its claims; selecting another kernel does not.

## Verify ownership while developing

Use `claimedPrefixes()` to inspect the prefixes claimed by the current kernel:

```javascript
await claimedPrefixes();
```

Test both a route that should match and a nearby path that should not. For
example, if the claim is `/api/sales-dashboard/`, test
`/api/sales-dashboard/summary` and `/api/sales-dashboard-old/summary`.
Unexpected `404` responses can indicate that the active kernel has no matching
route; a `503` indicates that a claim exists but its owning Runtime is not
available.
