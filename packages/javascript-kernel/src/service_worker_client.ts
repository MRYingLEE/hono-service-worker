// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  handleDispatchMessage,
  IClaimMessage,
  IDispatchMessage,
  IDispatchTarget,
  IRuntimeMessage
} from './service_worker_bridge';

/**
 * Minimal view of a Service worker registration used by the page.
 */
export interface IServiceWorkerRegistration {
  active: {
    readonly scriptURL?: string;
    postMessage(data: unknown): void;
  } | null;
}

/**
 * Minimal view of `navigator.serviceWorker` used by the page.
 */
export interface IServiceWorkerContainer {
  register(url: string): Promise<IServiceWorkerRegistration>;
  getRegistrations(): Promise<readonly IServiceWorkerRegistration[]>;
  readonly ready: Promise<IServiceWorkerRegistration>;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown; ports: readonly MessagePort[] }) => void
  ): void;
}

const serviceWorkerUrls = new WeakMap<IServiceWorkerContainer, string>();

/**
 * Register the Service worker once per container and answer its dispatch
 * messages by forwarding them to the backend of the named Kernel.
 */
export async function connectServiceWorker(
  container: IServiceWorkerContainer,
  url: string,
  backends: Map<string, IDispatchTarget>
): Promise<void> {
  if (serviceWorkerUrls.has(container)) {
    return;
  }
  serviceWorkerUrls.set(container, url);

  container.addEventListener('message', event => {
    const data = event.data as IDispatchMessage | undefined;
    if (!data || data.type !== 'dispatch') {
      return;
    }
    const port = event.ports[0];
    if (!port) {
      return;
    }
    void handleDispatchMessage(backends, data)
      .catch(error => {
        console.error('Kernel request dispatch failed', error);
        return {
          status: 500,
          headers: { 'content-type': 'text/plain' },
          body: new TextEncoder().encode('Internal Server Error')
        };
      })
      .then(response => port.postMessage(response));
  });

  await container.register(url);
}

const claimsByKernel = new Map<string, Set<string>>();

/**
 * Prefixes currently claimed by a Kernel, in claim order.
 */
export function claimedPrefixes(kernelId: string): string[] {
  return [...(claimsByKernel.get(kernelId) ?? [])];
}

/**
 * Ask the Service worker to route the prefix to a Kernel for this page.
 */
export async function claimPrefix(
  container: IServiceWorkerContainer,
  kernelId: string,
  prefix: string
): Promise<void> {
  let prefixes = claimsByKernel.get(kernelId);
  if (!prefixes) {
    prefixes = new Set<string>();
    claimsByKernel.set(kernelId, prefixes);
  }
  prefixes.add(prefix);
  await postToActive(container, { type: 'claim', kernelId, prefix });
}

/**
 * Ask the Service worker to stop routing the prefix to a Kernel for this page.
 */
export async function releasePrefix(
  container: IServiceWorkerContainer,
  kernelId: string,
  prefix: string
): Promise<void> {
  const prefixes = claimsByKernel.get(kernelId);
  prefixes?.delete(prefix);
  if (prefixes?.size === 0) {
    claimsByKernel.delete(kernelId);
  }
  await postToActive(container, { type: 'release', kernelId, prefix });
}

const runtimeClients = new Map<string, string>();

/**
 * Tell the Service worker which client a Runtime of the Kernel runs in, so
 * requests that Runtime issues are answered by that Kernel.
 */
export async function registerRuntimeClient(
  container: IServiceWorkerContainer,
  kernelId: string,
  clientId: string
): Promise<void> {
  runtimeClients.set(kernelId, clientId);
  await postToActive(container, { type: 'runtime', kernelId, clientId });
}

async function postToActive(
  container: IServiceWorkerContainer,
  message: IClaimMessage | IRuntimeMessage
): Promise<void> {
  const registration = await activeRegistration(container);
  registration.active?.postMessage(message);
}

/**
 * The active registration of the Kernel Service worker. jupyterlite-core
 * unregisters every Service worker when its version changes, which removes
 * this one; re-register it and replay the claims it lost.
 */
async function activeRegistration(
  container: IServiceWorkerContainer
): Promise<IServiceWorkerRegistration> {
  const url = serviceWorkerUrls.get(container);
  if (url === undefined) {
    const registration = await container.ready;
    if (!registration.active) {
      throw new Error('No active Service worker');
    }
    return registration;
  }

  const registrations = await container.getRegistrations();
  const current = registrations.find(
    registration => registration.active?.scriptURL === url
  );
  if (current?.active) {
    return current;
  }

  await container.register(url);
  const registration = await container.ready;
  if (!registration.active) {
    throw new Error('No active Service worker');
  }
  for (const [kernelId, prefixes] of claimsByKernel) {
    for (const prefix of prefixes) {
      registration.active.postMessage({ type: 'claim', kernelId, prefix });
    }
  }
  for (const [kernelId, clientId] of runtimeClients) {
    registration.active.postMessage({ type: 'runtime', kernelId, clientId });
  }
  return registration;
}
