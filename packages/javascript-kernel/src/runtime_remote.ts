// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Hono } from 'hono';
import { JavaScriptRuntimeEvaluator } from './runtime_evaluator';
import type { JavaScriptExecutor } from './executor';
import { normalizeError } from './errors';
import type {
  IRemoteRuntimeApi,
  IRuntimeRequest,
  IRuntimeResponse,
  RuntimeOutputMessage
} from './runtime_protocol';

interface IAppCall {
  method: string;
  args: unknown[];
}

/**
 * Hono methods that register routes or app-level handlers. Calls to these are
 * recorded per cell so the route table can be rebuilt when a cell re-runs.
 */
const REGISTRATION_METHODS = new Set([
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'options',
  'head',
  'all',
  'on',
  'use',
  'route',
  'mount',
  'notFound',
  'onError'
]);

/**
 * Create a Comlink runtime API bound to the provided global scope.
 */
export function createRemoteRuntimeApi(
  globalScope: Record<string, any>,
  executor?: JavaScriptExecutor
): IRemoteRuntimeApi {
  let evaluator: JavaScriptRuntimeEvaluator | null = null;
  let app: Hono = new Hono();
  const claimedPrefixes = new Set<string>();
  // Keyed by cell id; insertion order keeps a re-run cell in its original position.
  const appCallsByCell = new Map<string, IAppCall[]>();

  const ensureEvaluator = (): JavaScriptRuntimeEvaluator => {
    if (!evaluator) {
      throw new Error('Runtime is not initialized');
    }
    return evaluator;
  };

  const emitOutput = (
    callback: Parameters<IRemoteRuntimeApi['initialize']>[1],
    message: RuntimeOutputMessage
  ): void => {
    void Promise.resolve(callback(makeCloneSafe(message))).catch(() => {
      // Ignore output callback failures so execution replies can still resolve.
    });
  };

  /**
   * Wrap the live app so cell registrations are captured instead of applied
   * directly. Other properties are forwarded to the live app.
   */
  const createRecordingApp = (calls: IAppCall[]): Hono => {
    const target = app;
    const recorder: Hono = new Proxy(target, {
      get(obj, prop) {
        if (typeof prop === 'string' && REGISTRATION_METHODS.has(prop)) {
          return (...args: unknown[]) => {
            calls.push({ method: prop, args });
            return recorder;
          };
        }
        const value = Reflect.get(obj, prop, obj);
        return typeof value === 'function' ? value.bind(obj) : value;
      }
    });
    return recorder;
  };

  let outputCallback: Parameters<IRemoteRuntimeApi['initialize']>[1] | null =
    null;

  /**
   * Create a Hono app with the runtime's built-in error handler. Cell-level
   * `onError` registrations are replayed after this and take precedence.
   */
  const createAppWithErrorHandler = (): Hono => {
    const next = new Hono();
    // A handler exception becomes a 500 for the Client and is reported to
    // the notebook through the same error output as a failing cell.
    next.onError((error, c) => {
      const normalized = normalizeError(error);
      if (outputCallback) {
        emitOutput(outputCallback, {
          type: 'execute_error',
          bundle: {
            status: 'error',
            ename: normalized.name || 'Error',
            evalue: normalized.message || '',
            traceback: [
              normalized.stack ?? `${normalized.name}: ${normalized.message}`
            ]
          }
        });
      }
      return c.text('Internal Server Error', 500);
    });
    return next;
  };

  /**
   * Build a fresh app by replaying every cell's recorded registrations in order.
   */
  const rebuildApp = (): void => {
    const next = createAppWithErrorHandler();
    const target = next as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    for (const calls of appCallsByCell.values()) {
      for (const { method, args } of calls) {
        target[method].apply(next, args);
      }
    }
    app = next;
    globalScope.app = next;
  };

  return {
    async initialize(
      options: Parameters<IRemoteRuntimeApi['initialize']>[0],
      onOutput: Parameters<IRemoteRuntimeApi['initialize']>[1]
    ): Promise<void> {
      if (typeof options.baseUrl !== 'string') {
        throw new Error('Runtime baseUrl is required');
      }
      evaluator?.dispose();
      outputCallback = onOutput;
      app = createAppWithErrorHandler();
      appCallsByCell.clear();
      claimedPrefixes.clear();
      globalScope.app = app;
      globalScope.claimPrefix = (prefix: string): void => {
        claimedPrefixes.add(prefix);
      };
      evaluator = new JavaScriptRuntimeEvaluator({
        globalScope,
        executor,
        onOutput: message => {
          emitOutput(onOutput, message);
        }
      });
    },

    async execute(
      code: string,
      executionCount: number,
      parentMessageId?: string,
      cellId?: string
    ) {
      const runtime = ensureEvaluator();
      // Without a cell id, each execution gets its own record so its routes accumulate.
      const key = cellId ?? `execution:${executionCount}`;
      const calls: IAppCall[] = [];
      appCallsByCell.set(key, calls);
      globalScope.app = createRecordingApp(calls);
      try {
        return await runtime.execute(code, executionCount, parentMessageId);
      } finally {
        rebuildApp();
      }
    },

    async preloadModule(moduleName: string): Promise<void> {
      await ensureEvaluator().preloadModule(moduleName);
    },

    async registerCommTarget(
      targetName: string,
      moduleName: string,
      exportName?: string
    ): Promise<void> {
      await ensureEvaluator().registerCommTarget(
        targetName,
        moduleName,
        exportName
      );
    },

    async unregisterCommTarget(targetName: string): Promise<void> {
      ensureEvaluator().unregisterCommTarget(targetName);
    },

    async complete(code: string, cursorPos: number) {
      return ensureEvaluator().complete(code, cursorPos);
    },

    async inspect(
      code: string,
      cursorPos: number,
      detailLevel: Parameters<IRemoteRuntimeApi['inspect']>[2]
    ) {
      return ensureEvaluator().inspect(code, cursorPos, detailLevel);
    },

    async isComplete(code: string) {
      return ensureEvaluator().isComplete(code);
    },

    async handleCommOpen(
      commId: string,
      targetName: string,
      data: Record<string, unknown>,
      buffers?: ArrayBuffer[],
      parentMessageId?: string
    ): Promise<void> {
      ensureEvaluator().handleCommOpen(
        commId,
        targetName,
        data,
        buffers,
        parentMessageId
      );
    },

    async handleCommMsg(
      commId: string,
      data: Record<string, unknown>,
      buffers?: ArrayBuffer[],
      parentMessageId?: string
    ): Promise<void> {
      ensureEvaluator().handleCommMsg(commId, data, buffers, parentMessageId);
    },

    async handleCommClose(
      commId: string,
      data: Record<string, unknown>,
      buffers?: ArrayBuffer[],
      parentMessageId?: string
    ): Promise<void> {
      ensureEvaluator().handleCommClose(commId, data, buffers, parentMessageId);
    },

    async dispatchRequest(request: IRuntimeRequest): Promise<IRuntimeResponse> {
      const response = await app.request(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return {
        status: response.status,
        headers,
        body: new Uint8Array(await response.arrayBuffer())
      };
    },

    async dispose(): Promise<void> {
      evaluator?.dispose();
      evaluator = null;
    }
  };
}

/**
 * Make outbound payload clone-safe for Comlink transport.
 */
function makeCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // fall through to sanitization
    }
  }

  return sanitize(value, new WeakSet<object>(), 0) as T;
}

/**
 * Convert unsupported values (functions, cyclic objects) to plain data.
 */
function sanitize(value: any, seen: WeakSet<object>, depth: number): any {
  if (value === null || value === undefined) {
    return value;
  }

  if (depth > 8) {
    return '[Truncated]';
  }

  const valueType = typeof value;
  if (
    valueType === 'string' ||
    valueType === 'number' ||
    valueType === 'boolean'
  ) {
    return value;
  }
  if (valueType === 'bigint') {
    return value.toString();
  }
  if (valueType === 'symbol' || valueType === 'function') {
    return String(value);
  }

  if (value instanceof ArrayBuffer) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitize(item, seen, depth + 1));
  }

  if (valueType === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    const output: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = sanitize(item, seen, depth + 1);
    }

    seen.delete(value);
    return output;
  }

  return String(value);
}
