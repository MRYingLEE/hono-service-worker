/// <reference types="jest" />
// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import type { IRuntimeRequest, IRuntimeResponse } from './runtime_protocol';
import type {
  IDispatchMessage,
  IDispatchTarget
} from './service_worker_bridge';
import {
  claimedPrefixes,
  claimPrefix,
  connectServiceWorker,
  IServiceWorkerContainer,
  IServiceWorkerRegistration,
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
    | ((event: { data: unknown; ports: readonly MessagePort[] }) => void)
    | null = null;
  registeredUrl: string | null = null;
  registerCount = 0;
  worker = new FakeWorker();
  private registration: IServiceWorkerRegistration | null = null;

  register(url: string): Promise<IServiceWorkerRegistration> {
    this.registerCount++;
    this.registeredUrl = url;
    this.worker = new FakeWorker();
    this.registration = {
      active: {
        scriptURL: url,
        postMessage: data => this.worker.postMessage(data)
      }
    };
    return Promise.resolve(this.registration);
  }

  getRegistrations(): Promise<readonly IServiceWorkerRegistration[]> {
    return Promise.resolve(this.registration ? [this.registration] : []);
  }

  get ready(): Promise<IServiceWorkerRegistration> {
    return Promise.resolve(this.registration as IServiceWorkerRegistration);
  }

  unregister(): void {
    this.registration = null;
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

  it('replies with a 500 when the backend fails, so the request does not hang', async () => {
    const container = new FakeContainer();
    const backends = new Map<string, IDispatchTarget>([
      [
        'k1',
        {
          dispatchRequest: async () => {
            throw new TypeError('Cannot read properties of undefined');
          }
        }
      ]
    ]);
    await connectServiceWorker(container, '/sw.js', backends);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const port = new FakePort();
    const message: IDispatchMessage = {
      type: 'dispatch',
      kernelId: 'k1',
      prefix: 'k1',
      request: { method: 'GET', url: 'http://x/k1/missing' }
    };
    container.listener?.({
      data: message,
      ports: [port as unknown as MessagePort]
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(port.posted).toEqual([
      {
        status: 500,
        headers: { 'content-type': 'text/plain' },
        body: new TextEncoder().encode('Internal Server Error')
      }
    ]);
    jest.restoreAllMocks();
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

describe('claimedPrefixes', () => {
  it('returns the prefixes claimed by a kernel, in claim order', async () => {
    const container = new FakeContainer();
    await connectServiceWorker(container, '/sw.js', new Map());

    await claimPrefix(container, 'claimed-k1', '/a/');
    await claimPrefix(container, 'claimed-k1', '/b/');
    await claimPrefix(container, 'claimed-k2', '/c/');

    expect(claimedPrefixes('claimed-k1')).toEqual(['/a/', '/b/']);
    expect(claimedPrefixes('claimed-k2')).toEqual(['/c/']);
  });

  it('drops prefixes once released', async () => {
    const container = new FakeContainer();
    await connectServiceWorker(container, '/sw.js', new Map());

    await claimPrefix(container, 'released-k1', '/a/');
    await claimPrefix(container, 'released-k1', '/b/');
    await releasePrefix(container, 'released-k1', '/a/');

    expect(claimedPrefixes('released-k1')).toEqual(['/b/']);
  });

  it('returns an empty list for an unknown kernel', () => {
    expect(claimedPrefixes('never-claimed')).toEqual([]);
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

  it('re-registers the Runtime when a prefix is reclaimed after a worker restart', async () => {
    const container = new FakeContainer();
    await connectServiceWorker(container, '/sw.js', new Map());
    await registerRuntimeClient(container, 'restarted-k1', 'worker-restarted');
    await claimPrefix(container, 'restarted-k1', '/demo/');

    // The registration URL remains active, but a restarted worker loses its
    // in-memory runtime table.
    container.worker = new FakeWorker();
    await claimPrefix(container, 'restarted-k1', '/demo/');

    expect(container.worker.posted).toEqual([
      { type: 'claim', kernelId: 'restarted-k1', prefix: '/demo/' },
      {
        type: 'runtime',
        kernelId: 'restarted-k1',
        clientId: 'worker-restarted'
      }
    ]);
  });
});

describe('when the Service worker registration is lost', () => {
  it('registers the Service worker again and replays claims and runtimes', async () => {
    const container = new FakeContainer();
    await connectServiceWorker(container, '/sw.js', new Map());
    await claimPrefix(container, 'replay-k1', '/a/');
    await registerRuntimeClient(container, 'replay-k1', 'worker-replay');
    container.unregister();

    await claimPrefix(container, 'replay-k1', '/b/');

    expect(container.registerCount).toBe(2);
    expect(container.worker.posted).toEqual(
      expect.arrayContaining([
        { type: 'claim', kernelId: 'replay-k1', prefix: '/a/' },
        {
          type: 'runtime',
          kernelId: 'replay-k1',
          clientId: 'worker-replay'
        },
        { type: 'claim', kernelId: 'replay-k1', prefix: '/b/' }
      ])
    );
  });

  it('does not register again while the Service worker is active', async () => {
    const container = new FakeContainer();
    await connectServiceWorker(container, '/sw.js', new Map());

    await claimPrefix(container, 'active-k1', '/a/');
    await claimPrefix(container, 'active-k1', '/b/');

    expect(container.registerCount).toBe(1);
  });
});
