// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { IRuntimeResponse } from './runtime_protocol';
import {
  applyClaimMessage,
  applyRuntimeMessage,
  IClaimMessage,
  IDispatchMessage,
  IRuntimeEntry,
  IRuntimeMessage,
  toFetchResponse,
  toRuntimeRequest
} from './service_worker_bridge';
import {
  IClaim,
  isRuntimeIdentityUrl,
  resolveOwningClaim,
  resolveRuntimeClaim
} from './service_worker_routing';

/**
 * Minimal Service worker global types. The package does not include the
 * WebWorker lib, so the parts used here are declared locally.
 */
interface IServiceWorkerClient {
  id: string;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

interface IServiceWorkerGlobal {
  skipWaiting(): Promise<void>;
  clients: {
    claim(): Promise<void>;
    get(id: string): Promise<IServiceWorkerClient | undefined>;
  };
  addEventListener(type: 'install', listener: () => void): void;
  addEventListener(type: 'activate', listener: (event: any) => void): void;
  addEventListener(type: 'message', listener: (event: any) => void): void;
  addEventListener(type: 'fetch', listener: (event: any) => void): void;
}

const sw = self as unknown as IServiceWorkerGlobal;

let claims: IClaim[] = [];
let runtimes = new Map<string, IRuntimeEntry>();

/**
 * Ask the page that issued a request for the response of its Kernel.
 */
function dispatchToClient(
  client: IServiceWorkerClient,
  kernelId: string,
  prefix: string,
  request: Awaited<ReturnType<typeof toRuntimeRequest>>
): Promise<IRuntimeResponse> {
  return new Promise<IRuntimeResponse>(resolve => {
    const channel = new MessageChannel();
    channel.port1.onmessage = event => {
      resolve(event.data as IRuntimeResponse);
    };
    const message: IDispatchMessage = {
      type: 'dispatch',
      kernelId,
      prefix,
      request
    };
    client.postMessage(message, [channel.port2]);
  });
}

sw.addEventListener('install', () => {
  void sw.skipWaiting();
});

sw.addEventListener(
  'activate',
  (event: { waitUntil(p: Promise<void>): void }) => {
    event.waitUntil(sw.clients.claim());
  }
);

sw.addEventListener(
  'message',
  (event: { data: unknown; source: { id: string } }) => {
    const message = event.data as
      | IClaimMessage
      | IRuntimeMessage
      | undefined;
    if (!message) {
      return;
    }
    if (message.type === 'claim' || message.type === 'release') {
      claims = applyClaimMessage(claims, message, event.source.id);
    } else if (message.type === 'runtime') {
      runtimes = applyRuntimeMessage(runtimes, message, event.source.id);
    }
  }
);

sw.addEventListener(
  'fetch',
  (event: {
    request: Request;
    clientId: string;
    respondWith(response: Promise<Response>): void;
  }) => {
    const url = event.request.url;
    if (isRuntimeIdentityUrl(url)) {
      event.respondWith(
        Promise.resolve(
          new Response(JSON.stringify({ clientId: event.clientId }), {
            headers: { 'content-type': 'application/json' }
          })
        )
      );
      return;
    }

    const runtime = runtimes.get(event.clientId);
    const claim = runtime
      ? resolveRuntimeClaim(
          claims,
          url,
          runtime.ownerContextId,
          runtime.kernelId
        )
      : resolveOwningClaim(claims, url, event.clientId);
    if (claim === null) {
      return;
    }
    const ownerClientId = runtime ? runtime.ownerContextId : event.clientId;
    event.respondWith(
      (async () => {
        const client = await sw.clients.get(ownerClientId);
        if (!client) {
          return toFetchResponse({
            status: 503,
            headers: { 'content-type': 'text/plain' },
            body: new TextEncoder().encode('Issuing client is gone')
          });
        }
        const request = await toRuntimeRequest(event.request);
        const response = await dispatchToClient(
          client,
          claim.kernelId,
          claim.prefix,
          request
        );
        return toFetchResponse(response);
      })()
    );
  }
);
