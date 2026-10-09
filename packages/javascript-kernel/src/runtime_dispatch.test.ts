/// <reference types="jest" />
import { JavaScriptExecutor } from './executor';
import { createRemoteRuntimeApi } from './runtime_remote';

describe('dispatchRequest', () => {
  // Cell code resolves free identifiers against the realm global, so the
  // runtime global scope must be globalThis, as it is for the Web Worker.
  const setup = async () => {
    const globalScope = globalThis as unknown as Record<string, any>;
    const executor = new JavaScriptExecutor(globalScope);
    const api = createRemoteRuntimeApi(globalScope, executor);
    await api.initialize({ baseUrl: 'http://localhost/' }, () => undefined);
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
    expect(response.body).toBe('hi');
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
    expect((await get(api, '/hello')).body).toBe('one');

    await api.execute(
      "app.get('/hello', c => c.text('two'));",
      2,
      undefined,
      'cell-a'
    );
    expect((await get(api, '/hello')).body).toBe('two');
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
    expect((await get(api, '/keep')).body).toBe('keep');
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

    expect((await get(api, '/a')).body).toBe('a2');
    expect((await get(api, '/b')).body).toBe('b');
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
