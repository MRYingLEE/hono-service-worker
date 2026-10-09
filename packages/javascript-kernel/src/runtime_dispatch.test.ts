/// <reference types="jest" />
import { JavaScriptExecutor } from './executor';
import { createRemoteRuntimeApi } from './runtime_remote';
import type { RuntimeOutputMessage } from './runtime_protocol';

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe('dispatchRequest', () => {
  // Cell code resolves free identifiers against the realm global, so the
  // runtime global scope must be globalThis, as it is for the Web Worker.
  const setup = async (outputs: RuntimeOutputMessage[] = []) => {
    const globalScope = globalThis as unknown as Record<string, any>;
    const executor = new JavaScriptExecutor(globalScope);
    const api = createRemoteRuntimeApi(globalScope, executor);
    await api.initialize({ baseUrl: 'http://localhost/' }, message => {
      outputs.push(message);
    });
    return api;
  };

  it('routes a GET request to a Hono route defined by cell code', async () => {
    const api = await setup();

    const reply = await api.execute("app.get('/hello', c => c.text('hi'));", 1);
    expect(reply.status).toBe('ok');

    const response = await api.dispatchRequest({
      method: 'GET',
      url: 'http://runtime.local/hello'
    });

    expect(response.status).toBe(200);
    expect(decode(response.body)).toBe('hi');
    expect(response.headers['content-type']).toContain('text/plain');
  });

  it('returns 404 for an unclaimed path', async () => {
    const api = await setup();

    const response = await api.dispatchRequest({
      method: 'GET',
      url: 'http://runtime.local/missing'
    });

    expect(response.status).toBe(404);
  });

  it('runs cell-defined middleware for requests under a claimed prefix', async () => {
    const api = await setup();

    const reply = await api.execute(
      [
        "claimPrefix('/mock/');",
        "app.use('/mock/*', async (c, next) => {",
        "  c.header('X-Mock-Middleware', 'ran');",
        '  await next();',
        '});',
        "app.get('/mock/hello', c => c.text('hi'));"
      ].join('\n'),
      1
    );
    expect(reply.status).toBe('ok');

    const response = await api.dispatchRequest({
      method: 'GET',
      url: 'http://runtime.local/mock/hello'
    });

    expect(response.status).toBe(200);
    expect(decode(response.body)).toBe('hi');
    expect(response.headers['x-mock-middleware']).toBe('ran');
  });

  it('returns 404 for an undefined path under a claimed prefix', async () => {
    const api = await setup();

    const reply = await api.execute(
      [
        "claimPrefix('/mock/');",
        "app.get('/mock/hello', c => c.text('hi'));"
      ].join('\n'),
      1
    );
    expect(reply.status).toBe('ok');

    const response = await api.dispatchRequest({
      method: 'GET',
      url: 'http://runtime.local/mock/missing'
    });

    expect(response.status).toBe(404);
  });

  it('drops an earlier cell route under a prefix that a later cell claims', async () => {
    const api = await setup();

    await api.execute(
      ["app.get('/r/x', c => c.text('first'));", "claimPrefix('/r/');"].join(
        '\n'
      ),
      1,
      undefined,
      'cell-1'
    );
    await api.execute(
      ["app.get('/r/x', c => c.text('second'));", "claimPrefix('/r/');"].join(
        '\n'
      ),
      2,
      undefined,
      'cell-2'
    );

    const response = await api.dispatchRequest({
      method: 'GET',
      url: 'http://runtime.local/r/x'
    });

    expect(response.status).toBe(200);
    expect(decode(response.body)).toBe('second');
  });

  it('keeps earlier cell routes under prefixes the later claim does not cover', async () => {
    const api = await setup();

    await api.execute(
      "app.get('/keep', c => c.text('kept'));",
      1,
      undefined,
      'cell-1'
    );
    await api.execute("claimPrefix('/r/');", 2, undefined, 'cell-2');

    const response = await api.dispatchRequest({
      method: 'GET',
      url: 'http://runtime.local/keep'
    });

    expect(response.status).toBe(200);
    expect(decode(response.body)).toBe('kept');
  });

  it('round-trips a JSON request and response body', async () => {
    const api = await setup();

    await api.execute(
      "app.post('/echo', async c => c.json({ received: await c.req.json() }));",
      1
    );

    const response = await api.dispatchRequest({
      method: 'POST',
      url: 'http://runtime.local/echo',
      headers: { 'content-type': 'application/json' },
      body: encode(JSON.stringify({ name: 'kernel', values: [1, 2, 3] }))
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/json');
    expect(JSON.parse(decode(response.body))).toEqual({
      received: { name: 'kernel', values: [1, 2, 3] }
    });
  });

  it('round-trips binary request and response bodies byte-for-byte', async () => {
    const api = await setup();

    await api.execute(
      "app.post('/bytes', async c => c.body(await c.req.arrayBuffer(), 200, { 'content-type': 'application/octet-stream' }));",
      1
    );

    const input = new Uint8Array(256);
    for (let i = 0; i < input.length; i++) {
      input[i] = i;
    }

    const response = await api.dispatchRequest({
      method: 'POST',
      url: 'http://runtime.local/bytes',
      headers: { 'content-type': 'application/octet-stream' },
      body: input
    });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(Array.from(response.body)).toEqual(Array.from(input));
  });

  it('preserves a Content-Type set by the handler', async () => {
    const api = await setup();

    await api.execute(
      "app.get('/typed', c => { c.header('content-type', 'application/vnd.kernel+json'); return c.body(new TextEncoder().encode('{}')); });",
      1
    );

    const response = await api.dispatchRequest({
      method: 'GET',
      url: 'http://runtime.local/typed'
    });

    expect(response.headers['content-type']).toBe(
      'application/vnd.kernel+json'
    );
  });

  it('returns 500 and reports the error when a handler throws', async () => {
    const outputs: RuntimeOutputMessage[] = [];
    const api = await setup(outputs);

    const reply = await api.execute(
      "app.get('/boom', () => { throw new Error('boom'); });",
      1
    );
    expect(reply.status).toBe('ok');

    const response = await api.dispatchRequest({
      method: 'GET',
      url: 'http://runtime.local/boom'
    });

    expect(response.status).toBe(500);

    const errors = outputs.filter(message => message.type === 'execute_error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      type: 'execute_error',
      bundle: { ename: 'Error', evalue: 'boom' }
    });
  });
});

describe('route table lifecycle', () => {
  const setup = async () => {
    const globalScope = globalThis as unknown as Record<string, any>;
    const executor = new JavaScriptExecutor(globalScope);
    const api = createRemoteRuntimeApi(globalScope, executor);
    await api.initialize({ baseUrl: 'http://localhost/' }, () => undefined);
    return api;
  };

  const get = (api: ReturnType<typeof createRemoteRuntimeApi>, path: string) =>
    api.dispatchRequest({ method: 'GET', url: `http://runtime.local${path}` });

  it('applies a changed handler from a re-run cell to the next request', async () => {
    const api = await setup();

    await api.execute(
      "app.get('/hello', c => c.text('one'));",
      1,
      undefined,
      'cell-a'
    );
    expect(decode((await get(api, '/hello')).body)).toBe('one');

    await api.execute(
      "app.get('/hello', c => c.text('two'));",
      2,
      undefined,
      'cell-a'
    );
    expect(decode((await get(api, '/hello')).body)).toBe('two');
  });

  it('returns 404 for a route removed from a re-run cell', async () => {
    const api = await setup();

    await api.execute(
      "app.get('/gone', c => c.text('gone'));\napp.get('/keep', c => c.text('keep'));",
      1,
      undefined,
      'cell-a'
    );
    await api.execute(
      "app.get('/keep', c => c.text('keep'));",
      2,
      undefined,
      'cell-a'
    );

    expect((await get(api, '/gone')).status).toBe(404);
    expect(decode((await get(api, '/keep')).body)).toBe('keep');
  });

  it('keeps routes from other cells when one cell is re-run', async () => {
    const api = await setup();

    await api.execute(
      "app.get('/a', c => c.text('a'));",
      1,
      undefined,
      'cell-a'
    );
    await api.execute(
      "app.get('/b', c => c.text('b'));",
      2,
      undefined,
      'cell-b'
    );
    await api.execute(
      "app.get('/a', c => c.text('a2'));",
      3,
      undefined,
      'cell-a'
    );

    expect(decode((await get(api, '/a')).body)).toBe('a2');
    expect(decode((await get(api, '/b')).body)).toBe('b');
  });

  it('empties the route table when the runtime is restarted', async () => {
    const api = await setup();
    await api.execute(
      "app.get('/hello', c => c.text('hi'));",
      1,
      undefined,
      'cell-a'
    );
    expect((await get(api, '/hello')).status).toBe(200);

    await api.dispose();
    await api.initialize({ baseUrl: 'http://localhost/' }, () => undefined);

    expect((await get(api, '/hello')).status).toBe(404);
  });

  it('starts with an empty route table in a new runtime', async () => {
    const first = await setup();
    await first.execute(
      "app.get('/hello', c => c.text('hi'));",
      1,
      undefined,
      'cell-a'
    );
    await first.dispose();

    const second = await setup();

    expect((await get(second, '/hello')).status).toBe(404);
  });
});

describe('identify', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const setup = async () => {
    const globalScope = globalThis as unknown as Record<string, any>;
    const executor = new JavaScriptExecutor(globalScope);
    const api = createRemoteRuntimeApi(globalScope, executor);
    await api.initialize({ baseUrl: 'http://localhost/' }, () => undefined);
    return api;
  };

  it('returns the clientId reported by the identity URL', async () => {
    const fetchMock = jest.fn(async () => {
      return new Response(JSON.stringify({ clientId: 'worker-1' }), {
        headers: { 'content-type': 'application/json' }
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const api = await setup();

    const clientId = await api.identify(
      'http://runtime.local/__runtime_identity__'
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://runtime.local/__runtime_identity__'
    );
    expect(clientId).toBe('worker-1');
  });

  it('returns null when the identity request is not ok', async () => {
    globalThis.fetch = jest.fn(
      async () => new Response('nope', { status: 503 })
    ) as unknown as typeof fetch;
    const api = await setup();

    await expect(
      api.identify('http://runtime.local/__runtime_identity__')
    ).resolves.toBeNull();
  });
});
