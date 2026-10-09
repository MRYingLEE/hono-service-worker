/// <reference types="jest" />
import {
  applyClaimMessage,
  applyRuntimeMessage,
  handleDispatchMessage,
  toFetchResponse,
  toRuntimeRequest
} from './service_worker_bridge';
import { IClaim } from './service_worker_routing';
import { IRuntimeRequest, IRuntimeResponse } from './runtime_protocol';
import {
  RuntimeUnavailableError,
  runtimeUnavailableMessage
} from './runtime_unavailable';

describe('runtimeUnavailableMessage', () => {
  it('names the claimed prefix in the plain-text body', () => {
    expect(runtimeUnavailableMessage('cells')).toBe(
      'Runtime for cells is not running'
    );
  });
});

describe('toRuntimeRequest', () => {
  it('converts a GET request into plain data without a body', async () => {
    const request = new Request('http://localhost/cell/hello?x=1', {
      method: 'GET',
      headers: { accept: 'text/plain' }
    });

    const runtimeRequest = await toRuntimeRequest(request);

    expect(runtimeRequest.method).toBe('GET');
    expect(runtimeRequest.url).toBe('http://localhost/cell/hello?x=1');
    expect(runtimeRequest.headers?.accept).toBe('text/plain');
    expect(runtimeRequest.body).toBeUndefined();
  });

  it('reads a text body for a POST request', async () => {
    const request = new Request('http://localhost/cell/echo', {
      method: 'POST',
      body: 'payload'
    });

    const runtimeRequest = await toRuntimeRequest(request);

    expect(runtimeRequest.method).toBe('POST');
    expect(new TextDecoder().decode(runtimeRequest.body)).toBe('payload');
  });
});

describe('toFetchResponse', () => {
  it('builds a Response from a runtime response', async () => {
    const response = toFetchResponse({
      status: 201,
      headers: { 'content-type': 'text/plain' },
      body: new TextEncoder().encode('created')
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(await response.text()).toBe('created');
  });
});

describe('applyRuntimeMessage', () => {
  it('records the Kernel and owning page for a Runtime client', () => {
    const runtimes = applyRuntimeMessage(
      new Map(),
      { type: 'runtime', kernelId: 'kA', clientId: 'worker-1' },
      'page-1'
    );
    expect(runtimes.get('worker-1')).toEqual({
      kernelId: 'kA',
      ownerContextId: 'page-1'
    });
  });

  it('replaces the entry when the same Runtime client registers again', () => {
    const first = applyRuntimeMessage(
      new Map(),
      { type: 'runtime', kernelId: 'kA', clientId: 'worker-1' },
      'page-1'
    );
    const second = applyRuntimeMessage(
      first,
      { type: 'runtime', kernelId: 'kB', clientId: 'worker-1' },
      'page-2'
    );
    expect(second.get('worker-1')).toEqual({
      kernelId: 'kB',
      ownerContextId: 'page-2'
    });
  });
});

describe('applyClaimMessage', () => {
  const base: IClaim[] = [];

  it('adds a claim issued by the sending client', () => {
    const claims = applyClaimMessage(
      base,
      { type: 'claim', kernelId: 'k1', prefix: '/cells' },
      'client-a'
    );

    expect(claims).toEqual([
      { kernelId: 'k1', issuingContextId: 'client-a', prefix: '/cells' }
    ]);
  });

  it('replaces an existing claim for the same client and prefix', () => {
    const first = applyClaimMessage(
      base,
      { type: 'claim', kernelId: 'k1', prefix: '/cells' },
      'client-a'
    );
    const second = applyClaimMessage(
      first,
      { type: 'claim', kernelId: 'k2', prefix: '/cells' },
      'client-a'
    );

    expect(second).toEqual([
      { kernelId: 'k2', issuingContextId: 'client-a', prefix: '/cells' }
    ]);
  });

  it('keeps claims from other clients', () => {
    const first = applyClaimMessage(
      base,
      { type: 'claim', kernelId: 'k1', prefix: '/cells' },
      'client-a'
    );
    const second = applyClaimMessage(
      first,
      { type: 'claim', kernelId: 'k2', prefix: '/cells' },
      'client-b'
    );

    expect(second).toHaveLength(2);
  });

  it('removes only the matching client, kernel and prefix on release', () => {
    let claims = applyClaimMessage(
      base,
      { type: 'claim', kernelId: 'k1', prefix: '/cells' },
      'client-a'
    );
    claims = applyClaimMessage(
      claims,
      { type: 'claim', kernelId: 'k1', prefix: '/cells' },
      'client-b'
    );

    const remaining = applyClaimMessage(
      claims,
      { type: 'release', kernelId: 'k1', prefix: '/cells' },
      'client-a'
    );

    expect(remaining).toEqual([
      { kernelId: 'k1', issuingContextId: 'client-b', prefix: '/cells' }
    ]);
  });

  it('ignores messages that are not claim or release', () => {
    const claims = applyClaimMessage(
      base,
      { type: 'unknown' } as never,
      'client-a'
    );

    expect(claims).toEqual([]);
  });
});

describe('handleDispatchMessage', () => {
  const request: IRuntimeRequest = {
    method: 'GET',
    url: 'http://localhost/cells/hello'
  };

  it('forwards the request to the backend of the named kernel', async () => {
    const seen: IRuntimeRequest[] = [];
    const backends = new Map([
      [
        'k1',
        {
          dispatchRequest: async (req: IRuntimeRequest) => {
            seen.push(req);
            return {
              status: 200,
              headers: {},
              body: new TextEncoder().encode('hi')
            };
          }
        }
      ]
    ]);

    const response = await handleDispatchMessage(backends, {
      type: 'dispatch',
      kernelId: 'k1',
      prefix: 'cells',
      request
    });

    expect(seen).toEqual([request]);
    expect(response).toEqual({
      status: 200,
      headers: {},
      body: new TextEncoder().encode('hi')
    });
  });

  it('answers 503 when no kernel with that id is on the page', async () => {
    const response: IRuntimeResponse = await handleDispatchMessage(new Map(), {
      type: 'dispatch',
      kernelId: 'missing',
      prefix: 'cells',
      request
    });

    expect(response.status).toBe(503);
  });

  it('names the claimed prefix in a plain-text 503 when the kernel is not on the page', async () => {
    const response = await handleDispatchMessage(new Map(), {
      type: 'dispatch',
      kernelId: 'k1',
      prefix: 'cells',
      request
    });

    expect(response.status).toBe(503);
    expect(response.headers['content-type']).toBe('text/plain');
    expect(new TextDecoder().decode(response.body)).toContain('cells');
  });

  it('answers a plain-text 503 naming the prefix when the runtime is not running', async () => {
    const backends = new Map([
      [
        'k1',
        {
          dispatchRequest: async () => {
            throw new RuntimeUnavailableError('Worker runtime disposed');
          }
        }
      ]
    ]);

    const response = await handleDispatchMessage(backends, {
      type: 'dispatch',
      kernelId: 'k1',
      prefix: 'cells',
      request
    });

    expect(response.status).toBe(503);
    expect(response.headers['content-type']).toBe('text/plain');
    expect(new TextDecoder().decode(response.body)).toContain('cells');
  });

  it('does not turn an unrelated dispatch error into a 503', async () => {
    const backends = new Map([
      [
        'k1',
        {
          dispatchRequest: async () => {
            throw new TypeError('handler blew up');
          }
        }
      ]
    ]);

    await expect(
      handleDispatchMessage(backends, {
        type: 'dispatch',
        kernelId: 'k1',
        prefix: 'cells',
        request
      })
    ).rejects.toThrow('handler blew up');
  });
});
