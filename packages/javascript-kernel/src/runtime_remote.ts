// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { JavaScriptRuntimeEvaluator } from './runtime_evaluator';
import type { JavaScriptExecutor } from './executor';
import { createHonoRuntimeRoutes } from './hono_routes';
import type { IRuntimeRoutes, RuntimeRoutesFactory } from './runtime_routes';
import type {
  IRemoteRuntimeApi,
  IRuntimeRequest,
  IRuntimeResponse,
  RuntimeOutputMessage
} from './runtime_protocol';
import {
  captureRuntimeLogger,
  logRouteMessage,
  normalizeRuntimeLogLevel
} from './runtime_logging';

/**
 * Create a Comlink runtime API bound to the provided global scope.
 * The route factory runs locally; both built-in backends default to Hono.
 */
export function createRemoteRuntimeApi(
  globalScope: Record<string, any>,
  executor?: JavaScriptExecutor,
  routesFactory: RuntimeRoutesFactory = createHonoRuntimeRoutes
): IRemoteRuntimeApi {
  let evaluator: JavaScriptRuntimeEvaluator | null = null;
  // Cell `claimedPrefixes()` calls waiting on the Kernel's answer, keyed by request id.
  const pendingClaimedPrefixes = new Map<
    string,
    (prefixes: string[]) => void
  >();
  let nextClaimedPrefixesRequest = 0;
  let routeLogger = captureRuntimeLogger(globalScope);

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

  const createRoutes = () =>
    routesFactory({
      onError(error, request) {
        logRouteMessage(
          routeLogger,
          routeLogLevel,
          'error',
          'Request handler failed',
          {
            method: request.method,
            path: new URL(request.url).pathname,
            error
          }
        );
      },
      log(level, message, details) {
        logRouteMessage(routeLogger, routeLogLevel, level, message, details);
      }
    });
  let routes: IRuntimeRoutes | null = null;
  let routeLogLevel = normalizeRuntimeLogLevel(undefined);
  const ensureRoutes = (): IRuntimeRoutes => {
    if (!routes) {
      throw new Error('Runtime is not initialized');
    }
    return routes;
  };

  return {
    async initialize(
      options: Parameters<IRemoteRuntimeApi['initialize']>[0],
      onOutput: Parameters<IRemoteRuntimeApi['initialize']>[1]
    ): Promise<void> {
      if (typeof options.baseUrl !== 'string') {
        throw new Error('Runtime baseUrl is required');
      }
      routeLogLevel = normalizeRuntimeLogLevel(options.routeLogLevel);
      evaluator?.dispose();
      routeLogger = captureRuntimeLogger(globalScope);
      routes?.dispose();
      routes = createRoutes();
      globalScope.app = routes.app;
      globalScope.claimPrefix = (prefix: string): void => {
        ensureRoutes().claimPrefix(prefix);
        emitOutput(onOutput, { type: 'claim_prefix', prefix });
      };
      globalScope.releasePrefix = (prefix: string): void => {
        emitOutput(onOutput, { type: 'release_prefix', prefix });
      };
      pendingClaimedPrefixes.clear();
      globalScope.claimedPrefixes = (): Promise<string[]> =>
        new Promise<string[]>(resolve => {
          const requestId = `claimed-prefixes-${nextClaimedPrefixesRequest++}`;
          pendingClaimedPrefixes.set(requestId, resolve);
          emitOutput(onOutput, { type: 'claimed_prefixes_request', requestId });
        });
      evaluator = new JavaScriptRuntimeEvaluator({
        globalScope,
        executor,
        onOutput: message => {
          emitOutput(onOutput, message);
        }
      });
    },

    async identify(identityUrl: string): Promise<string | null> {
      const response = await globalScope.fetch(identityUrl);
      if (!response.ok) {
        return null;
      }
      const body = (await response.json()) as { clientId?: unknown };
      return typeof body.clientId === 'string' ? body.clientId : null;
    },

    async execute(
      code: string,
      executionCount: number,
      parentMessageId?: string,
      cellId?: string
    ) {
      const runtime = ensureEvaluator();
      const cellRoutes = ensureRoutes();
      // Without a cell id, each execution gets its own record so its routes accumulate.
      const key = cellId ?? `execution:${executionCount}`;
      cellRoutes.beginCell(key);
      globalScope.app = cellRoutes.app;
      try {
        return await runtime.execute(code, executionCount, parentMessageId);
      } finally {
        cellRoutes.endCell();
        globalScope.app = cellRoutes.app;
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
      return ensureRoutes().dispatchRequest(request);
    },

    async resolveClaimedPrefixes(
      requestId: string,
      prefixes: string[]
    ): Promise<void> {
      const resolve = pendingClaimedPrefixes.get(requestId);
      if (!resolve) {
        return;
      }
      pendingClaimedPrefixes.delete(requestId);
      resolve([...prefixes]);
    },

    async ping(): Promise<void> {
      return;
    },

    async dispose(): Promise<void> {
      evaluator?.dispose();
      evaluator = null;
      routes?.dispose();
      routes = null;
      pendingClaimedPrefixes.clear();
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
