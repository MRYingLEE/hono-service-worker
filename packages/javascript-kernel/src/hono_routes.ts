// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { Hono } from 'hono';
import { headersToRecord } from './runtime_protocol';
import type { IRuntimeRequest, IRuntimeResponse } from './runtime_protocol';
import type {
  IRuntimeRoutes,
  IRuntimeRoutesOptions,
  RuntimeRoutesFactory
} from './runtime_routes';

interface IAppCall {
  method: string;
  args: unknown[];
}

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

const PATH_ARG_INDEX: Record<string, number> = {
  get: 0,
  post: 0,
  put: 0,
  delete: 0,
  patch: 0,
  options: 0,
  head: 0,
  all: 0,
  use: 0,
  route: 0,
  mount: 0,
  on: 1
};

const routePathOf = (call: IAppCall): string | undefined => {
  const index = PATH_ARG_INDEX[call.method];
  if (index === undefined) {
    return undefined;
  }
  const path = call.args[index];
  return typeof path === 'string' ? path : undefined;
};

class HonoRuntimeRoutes implements IRuntimeRoutes {
  constructor(private readonly _options: IRuntimeRoutesOptions) {
    this._app = this._createApp();
    this._cellApp = this._app;
  }

  get app(): Hono {
    return this._cellApp;
  }

  beginCell(cellKey: string): void {
    const calls: IAppCall[] = [];
    this._appCallsByCell.set(cellKey, calls);
    const target = this._app;
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
    this._cellApp = recorder;
    this._currentCellKey = cellKey;
  }

  endCell(): void {
    this._currentCellKey = null;
    const next = this._createApp();
    for (const calls of this._appCallsByCell.values()) {
      for (const { method, args } of calls) {
        const register: unknown = Reflect.get(next, method);
        if (typeof register !== 'function') {
          throw new Error(`Unsupported Hono registration method: ${method}`);
        }
        Reflect.apply(register, next, args);
      }
    }
    this._app = next;
    this._cellApp = next;
  }

  claimPrefix(prefix: string): void {
    if (this._currentCellKey === null) {
      return;
    }
    for (const [key, calls] of this._appCallsByCell) {
      if (key === this._currentCellKey) {
        continue;
      }
      this._appCallsByCell.set(
        key,
        calls.filter(call => {
          const path = routePathOf(call);
          return path === undefined || !path.startsWith(prefix);
        })
      );
    }
  }

  async dispatchRequest(request: IRuntimeRequest): Promise<IRuntimeResponse> {
    const response = await this._app.request(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body
    });
    // Middleware can leave an unmatched request without a Response.
    if (!response) {
      return {
        status: 404,
        headers: { 'content-type': 'text/plain; charset=UTF-8' },
        body: new TextEncoder().encode('404 Not Found')
      };
    }
    return {
      status: response.status,
      headers: headersToRecord(response.headers),
      body: new Uint8Array(await response.arrayBuffer())
    };
  }

  dispose(): void {
    this._appCallsByCell.clear();
    this._currentCellKey = null;
    this._app = this._createApp();
    this._cellApp = this._app;
  }

  private _createApp(): Hono {
    const app = new Hono();
    // Cell-level onError registrations are replayed later and take precedence.
    app.onError(async (error, c) => {
      await this._options.onError(error);
      return c.text('Internal Server Error', 500);
    });
    return app;
  }

  private _app: Hono;
  private _cellApp: Hono;
  // Map insertion order keeps rerun cells in their original position.
  private _appCallsByCell = new Map<string, IAppCall[]>();
  private _currentCellKey: string | null = null;
}

export const createHonoRuntimeRoutes: RuntimeRoutesFactory = options =>
  new HonoRuntimeRoutes(options);
