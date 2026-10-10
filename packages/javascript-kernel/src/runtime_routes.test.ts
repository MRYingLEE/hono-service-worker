// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

/// <reference types="jest" />

import { JavaScriptExecutor } from './executor';
import { createRemoteRuntimeApi } from './runtime_remote';
import type {
  IRuntimeRequest,
  IRuntimeResponse,
  RuntimeOutputMessage
} from './runtime_protocol';
import type {
  IRuntimeRoutes,
  IRuntimeRoutesOptions,
  RuntimeRoutesFactory
} from './runtime_routes';

type Handler = (request: IRuntimeRequest) => Promise<IRuntimeResponse>;
interface IRoute {
  method: string;
  path: string;
  handler: Handler;
}

const response = (status: number, text: string): IRuntimeResponse => ({
  status,
  headers: { 'content-type': 'text/plain' },
  body: new TextEncoder().encode(text)
});

// A non-Hono adapter with a different registration interface, used through
// the same Runtime seam as the default adapter.
class TestRoutes implements IRuntimeRoutes {
  constructor(private readonly _options: IRuntimeRoutesOptions) {}

  readonly app = {
    define: (method: string, path: string, handler: Handler): void => {
      const routes = this._cells.get(this._currentCell);
      if (!routes) {
        throw new Error('Routes must be defined during cell execution');
      }
      routes.push({ method, path, handler });
    }
  };

  beginCell(cellKey: string): void {
    this._currentCell = cellKey;
    this._cells.set(cellKey, []);
  }

  endCell(): void {
    this._currentCell = '';
  }

  claimPrefix(prefix: string): void {
    for (const [key, routes] of this._cells) {
      if (key !== this._currentCell) {
        this._cells.set(
          key,
          routes.filter(route => !route.path.startsWith(prefix))
        );
      }
    }
  }

  async dispatchRequest(request: IRuntimeRequest): Promise<IRuntimeResponse> {
    const path = new URL(request.url).pathname;
    for (const routes of this._cells.values()) {
      const route = routes.find(
        route => route.method === request.method && route.path === path
      );
      if (route) {
        try {
          return await route.handler(request);
        } catch (error) {
          this._options.onError(error);
          return response(500, 'Internal Server Error');
        }
      }
    }
    return response(404, 'Not Found');
  }

  dispose(): void {
    this._cells.clear();
    this._currentCell = '';
  }

  private _cells = new Map<string, IRoute[]>();
  private _currentCell = '';
}

describe('Runtime route adapter seam', () => {
  let api: ReturnType<typeof createRemoteRuntimeApi>;
  let outputs: RuntimeOutputMessage[];
  let adapters: TestRoutes[];

  beforeEach(async () => {
    outputs = [];
    adapters = [];
    const factory: RuntimeRoutesFactory = options => {
      const adapter = new TestRoutes(options);
      adapters.push(adapter);
      return adapter;
    };
    api = createRemoteRuntimeApi(
      globalThis,
      new JavaScriptExecutor(globalThis),
      factory
    );
    await api.initialize({ baseUrl: 'http://localhost/' }, message => {
      outputs.push(message);
    });
  });

  afterEach(async () => {
    await api.dispose();
  });

  const get = (path: string) =>
    api.dispatchRequest({ method: 'GET', url: `http://runtime.local${path}` });

  const define = (path: string, text: string) =>
    `app.define('GET', '${path}', async () => ({
      status: 200, headers: { 'x-framework': 'test' },
      body: new TextEncoder().encode('${text}')
    }));`;

  it('exposes a non-Hono app and forwards the exact plain-data request and response', async () => {
    const reply = await api.execute(
      `app.define('POST', '/echo', async request => ({
        status: 201, headers: request.headers, body: request.body
      }));`,
      1,
      undefined,
      'echo'
    );
    expect(reply.status).toBe('ok');
    const body = new Uint8Array([0, 127, 255]);
    const headers = { 'content-type': 'application/octet-stream' };
    const request = {
      method: 'POST',
      url: 'http://runtime.local/echo?value=1',
      headers,
      body
    };
    const dispatch = jest.spyOn(adapters[0], 'dispatchRequest');
    expect(await api.dispatchRequest(request)).toEqual({
      status: 201,
      headers,
      body
    });
    expect(dispatch).toHaveBeenCalledWith(request);
    expect(Reflect.get(globalThis, 'app')).toBe(adapters[0].app);
  });

  it('replaces rerun cell routes while retaining other cells', async () => {
    await api.execute(define('/first', 'one'), 1, undefined, 'first');
    await api.execute(define('/other', 'other'), 2, undefined, 'second');
    await api.execute(define('/new', 'two'), 3, undefined, 'first');

    expect((await get('/first')).status).toBe(404);
    expect(new TextDecoder().decode((await get('/new')).body)).toBe('two');
    expect(new TextDecoder().decode((await get('/other')).body)).toBe('other');
  });

  it('retains cell order when an earlier cell reruns', async () => {
    await api.execute(define('/same', 'first'), 1, undefined, 'first');
    await api.execute(define('/same', 'second'), 2, undefined, 'second');
    await api.execute(define('/same', 'updated'), 3, undefined, 'first');
    expect(new TextDecoder().decode((await get('/same')).body)).toBe('updated');
  });

  it('delegates prefix replacement while keeping claim and release messages neutral', async () => {
    await api.execute(define('/api/x', 'first'), 1, undefined, 'first');
    await api.execute(
      `${define('/api/x', 'second')} claimPrefix('/api/'); releasePrefix('/api/');`,
      2,
      undefined,
      'second'
    );
    expect(new TextDecoder().decode((await get('/api/x')).body)).toBe('second');
    expect(outputs).toEqual(
      expect.arrayContaining([
        { type: 'claim_prefix', prefix: '/api/' },
        { type: 'release_prefix', prefix: '/api/' }
      ])
    );
  });

  it('finishes cell registration even when cell execution fails', async () => {
    const endCell = jest.spyOn(adapters[0], 'endCell');
    const reply = await api.execute(
      `${define('/partial', 'registered')} throw new Error('cell failed');`,
      1,
      undefined,
      'first'
    );
    expect(reply.status).toBe('error');
    expect(endCell).toHaveBeenCalledTimes(1);
    expect((await get('/partial')).status).toBe(200);
  });

  it('reports adapter handler errors through notebook execute_error output', async () => {
    await api.execute(
      "app.define('GET', '/boom', async () => { throw new Error('adapter failed'); });",
      1
    );
    expect((await get('/boom')).status).toBe(500);
    expect(outputs.filter(message => message.type === 'execute_error')).toEqual(
      [
        expect.objectContaining({
          bundle: expect.objectContaining({
            ename: 'Error',
            evalue: 'adapter failed'
          })
        })
      ]
    );
  });

  it('disposes and replaces the adapter on reinitialization', async () => {
    await api.execute(define('/old', 'old'), 1);
    const dispose = jest.spyOn(adapters[0], 'dispose');
    await api.initialize({ baseUrl: 'http://localhost/' }, () => undefined);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(adapters).toHaveLength(2);
    expect(Reflect.get(globalThis, 'app')).toBe(adapters[1].app);
    expect((await get('/old')).status).toBe(404);

    const finalDispose = jest.spyOn(adapters[1], 'dispose');
    await api.dispose();
    expect(finalDispose).toHaveBeenCalledTimes(1);
    await expect(get('/old')).rejects.toThrow('Runtime is not initialized');
  });
});
