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
  active: { postMessage(data: unknown): void } | null;
}

/**
 * Minimal view of `navigator.serviceWorker` used by the page.
 */
export interface IServiceWorkerContainer {
  register(url: string): Promise<IServiceWorkerRegistration>;
  readonly ready: Promise<IServiceWorkerRegistration>;
  addEventListener(
    type: 'message',
    listener: (event: { data: unknown; ports: readonly MessagePort[] }) => void
  ): void;
}

const connected = new WeakSet<IServiceWorkerContainer>();

/**
 * Register the Service worker once per container and answer its dispatch
 * messages by forwarding them to the backend of the named Kernel.
 */
export async function connectServiceWorker(
  container: IServiceWorkerContainer,
  url: string,
  backends: Map<string, IDispatchTarget>
): Promise<void> {
  if (connected.has(container)) {
    return;
  }
  connected.add(container);

  container.addEventListener('message', event => {
    const data = event.data as IDispatchMessage | undefined;
    if (!data || data.type !== 'dispatch') {
      return;
    }
    const port = event.ports[0];
    if (!port) {
      return;
    }
    void handleDispatchMessage(backends, data).then(response =>
      port.postMessage(response)
    );
  });

  await container.register(url);
}

/**
 * Ask the Service worker to route the prefix to a Kernel for this page.
 */
export async function claimPrefix(
  container: IServiceWorkerContainer,
  kernelId: string,
  prefix: string
): Promise<void> {
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
  await postToActive(container, { type: 'release', kernelId, prefix });
}

/**
 * Tell the Service worker which client a Runtime of the Kernel runs in, so
 * requests that Runtime issues are answered by that Kernel.
 */
export async function registerRuntimeClient(
  container: IServiceWorkerContainer,
  kernelId: string,
  clientId: string
): Promise<void> {
  await postToActive(container, { type: 'runtime', kernelId, clientId });
}

async function postToActive(
  container: IServiceWorkerContainer,
  message: IClaimMessage | IRuntimeMessage
): Promise<void> {
  const registration = await container.ready;
  if (!registration.active) {
    throw new Error('No active Service worker');
  }
  registration.active.postMessage(message);
}
