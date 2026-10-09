/// <reference types="jest" />
// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import type { IRuntimeRequest, IRuntimeResponse } from './runtime_protocol';
import type {
  IDispatchMessage,
  IDispatchTarget
} from './service_worker_bridge';
import {
  claimPrefix,
  connectServiceWorker,
  IServiceWorkerContainer,
  registerRuntimeClient,
  releasePrefix
} from './service_worker_client';

class FakePort {
  posted: unknown[] = [];

  postMessage(data: unknown): void {
    this.posted.push(data);
  }
}

class FakeWorker {
  posted: unknown[] = [];

  postMessage(data: unknown): void {
    this.posted.push(data);
  }
}

class FakeContainer implements IServiceWorkerContainer {
  listener:
    ((event: { data: unknown; ports: readonly MessagePort[] }) => void) | null =
    null;
  registeredUrl: string | null = null;
  registerCount = 0;
  worker = new FakeWorker();

  register(url: string): Promise<{ active: FakeWorker }> {
    this.registerCount++;
    this.registeredUrl = url;
    return Promise.resolve({ active: this.worker });
  }

  get ready(): Promise<{ active: FakeWorker }> {
    return Promise.resolve({ active: this.worker });
  }

  addEventListener(
    _type: 'message',
    listener: (event: { data: unknown; ports: readonly MessagePort[] }) => void
  ): void {
    this.listener = listener;
  }
}

describe('connectServiceWorker', () => {
  it('registers the service worker script once', async () => {
    const container = new FakeContainer();
    const backends = new Map<string, IDispatchTarget>();
    await connectServiceWorker(container, '/sw.js', backends);
    await connectServiceWorker(container, '/sw.js', backends);

    expect(container.registerCount).toBe(1);
    expect(container.registeredUrl).toBe('/sw.js');
  });

  it('answers a dispatch message through the matching backend', async () => {
    const container = new FakeContainer();
    const response: IRuntimeResponse = {
      status: 200,
      headers: { 'content-type': 'text/plain' },
      body: new TextEncoder().encode('hi')
    };
    const dispatched: IRuntimeRequest[] = [];
    const backends = new Map<string, IDispatchTarget>([
      [
        'k1',
        {
          dispatchRequest: async (request: IRuntimeRequest) => {
            dispatched.push(request);
            return response;
          }
        }
      ]
    ]);
    await connectServiceWorker(container, '/sw.js', backends);

    const port = new FakePort();
    const message: IDispatchMessage = {
      type: 'dispatch',
      kernelId: 'k1',
      prefix: 'k1',
      request: { method: 'GET', url: 'http://x/k1/a' }
    };
    container.listener?.({
      data: message,
      ports: [port as unknown as MessagePort]
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(dispatched).toEqual([{ method: 'GET', url: 'http://x/k1/a' }]);
    expect(port.posted).toEqual([response]);
  });
});

describe('claimPrefix / releasePrefix', () => {
  it('posts claim and release messages to the active worker', async () => {
    const container = new FakeContainer();
    await connectServiceWorker(container, '/sw.js', new Map());

    await claimPrefix(container, 'k1', '/k1');
    await releasePrefix(container, 'k1', '/k1');

    expect(container.worker.posted).toEqual([
      { type: 'claim', kernelId: 'k1', prefix: '/k1' },
      { type: 'release', kernelId: 'k1', prefix: '/k1' }
    ]);
  });
});

describe('registerRuntimeClient', () => {
  it('posts a runtime registration to the active worker', async () => {
    const container = new FakeContainer();
    await connectServiceWorker(container, '/sw.js', new Map());

    await registerRuntimeClient(container, 'k1', 'worker-1');

    expect(container.worker.posted).toEqual([
      { type: 'runtime', kernelId: 'k1', clientId: 'worker-1' }
    ]);
  });
});
