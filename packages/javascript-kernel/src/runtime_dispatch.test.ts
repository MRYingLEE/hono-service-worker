/// <reference types="jest" />
import { JavaScriptExecutor } from './executor';
import { createRemoteRuntimeApi } from './runtime_remote';
import type { RuntimeOutputMessage } from './runtime_protocol';

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
