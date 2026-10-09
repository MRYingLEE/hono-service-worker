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
