// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import type { IRuntimeRequest, IRuntimeResponse } from './runtime_protocol';

/**
 * Framework-specific route registration and request handling in a Runtime.
 * Each instance belongs to one initialization of one Runtime.
 */
export interface IRuntimeRoutes {
  /** The framework object exposed to cells as `app`. */
  readonly app: unknown;
  /** Replace this cell's registrations, retaining other cells' registrations. */
  beginCell(cellKey: string): void;
  /** Publish registrations, including those made before a cell failed. */
  endCell(): void;
  /** Let the executing cell replace other cells' routes under this prefix. */
  claimPrefix(prefix: string): void;
  /** Handle a plain-data request without opening a listening socket. */
  dispatchRequest(request: IRuntimeRequest): Promise<IRuntimeResponse>;
  /** Release route state and framework resources. */
  dispose(): void;
}

export interface IRuntimeRoutesOptions {
  /** Report handler exceptions unless a cell supplies its own error handler. */
  onError(error: unknown): void | Promise<void>;
}

/**
 * Constructed locally in the Runtime; factories and apps do not cross Comlink.
 */
export type RuntimeRoutesFactory = (
  options: IRuntimeRoutesOptions
) => IRuntimeRoutes;
