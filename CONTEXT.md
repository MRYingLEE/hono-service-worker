# JavaScript Kernel

A JupyterLite kernel that runs JavaScript from notebook cells, and lets those cells serve HTTP-style routes to existing client code.

## Language

**Kernel**:
A JavaScript kernel attached to one notebook. Each Kernel owns exactly one Runtime.
_Avoid_: Notebook kernel session

**Runtime**:
The isolated execution context, a Web Worker or an iframe, in which a Kernel runs cell code.
_Avoid_: Worker, when you mean the browser's service worker

**Service worker**:
The single browser-managed script per origin scope that intercepts network requests from controlled pages and workers.
_Avoid_: Worker, Runtime

**Remote service**:
The existing HTTP service that Clients call today. Its source code may be unavailable.
_Avoid_: Backend, server

**Client**:
Existing code that sends HTTP requests to a Remote service. It is not changed by this project.

**Claimed prefix**:
The URL prefix that a Kernel declares from its notebook cells. The Kernel serves requests under it instead of the Remote service.

**Owning kernel**:
The Kernel whose notebook page or Runtime issued a Client request. It is the only Kernel that serves that request.

**Hono app**:
The Hono route table that a Kernel's cells define. It lives inside that Kernel's Runtime.
_Avoid_: Server, service worker app
