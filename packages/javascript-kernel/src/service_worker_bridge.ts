// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import {
  headersToRecord,
  IRuntimeRequest,
  IRuntimeResponse
} from './runtime_protocol';
import {
  RuntimeUnavailableError,
  runtimeUnavailableMessage
} from './runtime_unavailable';
import { IClaim } from './service_worker_routing';

/**
 * Message a page posts to the Service worker to add or remove a claim.
 */
export interface IClaimMessage {
  type: 'claim' | 'release';
  kernelId: string;
  prefix: string;
}

/**
 * Message a Runtime sends, through its page, to register its own Client id
 * with the Kernel that owns it.
 */
export interface IRuntimeMessage {
  type: 'runtime';
  kernelId: string;
  clientId: string;
}

/**
 * A Runtime Client registered with the Service worker.
 */
export interface IRuntimeEntry {
  kernelId: string;
  ownerContextId: string;
}

/**
 * Message the Service worker posts to a page asking its Kernel to dispatch
 * a request. The reply is sent on the transferred MessagePort.
 */
export interface IDispatchMessage {
  type: 'dispatch';
  kernelId: string;
  prefix: string;
  request: IRuntimeRequest;
}

/**
 * Convert a Fetch API request into the plain data sent to a Runtime.
 */
export async function toRuntimeRequest(
  request: Request
): Promise<IRuntimeRequest> {
  const headers = headersToRecord(request.headers);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return {
    method: request.method,
    url: request.url,
    headers,
    body: hasBody ? new Uint8Array(await request.arrayBuffer()) : undefined
  };
}

/**
 * Convert a Runtime response into a Fetch API response for the Client.
 */
export function toFetchResponse(response: IRuntimeResponse): Response {
  return new Response(response.body as BodyInit, {
    status: response.status,
    headers: response.headers
  });
}

/**
 * Apply a claim or release message from a page to the claim table.
 *
 * Claims are scoped to the issuing Client, so a release only removes the
 * claim that same Client made.
 */
export function applyClaimMessage(
  claims: IClaim[],
  message: IClaimMessage,
  issuingContextId: string
): IClaim[] {
  if (message.type === 'release') {
    return claims.filter(
      claim =>
        !(
          claim.issuingContextId === issuingContextId &&
          claim.prefix === message.prefix &&
          claim.kernelId === message.kernelId
        )
    );
  }
  if (message.type !== 'claim') {
    return claims;
  }
  const others = claims.filter(
    claim =>
      !(
        claim.issuingContextId === issuingContextId &&
        claim.prefix === message.prefix
      )
  );
  return [
    ...others,
    {
      kernelId: message.kernelId,
      issuingContextId,
      prefix: message.prefix
    }
  ];
}

/**
 * Record a Runtime Client as belonging to a Kernel and to the page that
 * registered it. Re-registering the same Client replaces its entry.
 */
export function applyRuntimeMessage(
  runtimes: Map<string, IRuntimeEntry>,
  message: IRuntimeMessage,
  ownerContextId: string
): Map<string, IRuntimeEntry> {
  const next = new Map(runtimes);
  next.set(message.clientId, {
    kernelId: message.kernelId,
    ownerContextId
  });
  return next;
}

/**
 * Minimal view of a Kernel's runtime backend needed to dispatch requests.
 */
export interface IDispatchTarget {
  dispatchRequest(request: IRuntimeRequest): Promise<IRuntimeResponse>;
}

/**
 * Plain-text 503 naming the claimed prefix, used when no Runtime can answer.
 */
function unavailableResponse(prefix: string): IRuntimeResponse {
  return {
    status: 503,
    headers: { 'content-type': 'text/plain' },
    body: new TextEncoder().encode(runtimeUnavailableMessage(prefix))
  };
}

/**
 * True when a dispatch failed because the Runtime is disposed or failed to
 * load, as opposed to an error raised while handling the request.
 */
function isRuntimeUnavailable(error: unknown): boolean {
  return error instanceof RuntimeUnavailableError;
}

/**
 * Handle a dispatch message on the page by forwarding the request to the
 * backend of the Kernel it names. When that Kernel has no running Runtime
 * (not on this page, or its backend was disposed or failed to load), the
 * reply is a 503 naming the claimed prefix. Other errors propagate.
 */
export async function handleDispatchMessage(
  backends: Map<string, IDispatchTarget>,
  message: IDispatchMessage
): Promise<IRuntimeResponse> {
  const backend = backends.get(message.kernelId);
  if (!backend) {
    return unavailableResponse(message.prefix);
  }
  try {
    return await backend.dispatchRequest(message.request);
  } catch (error) {
    if (isRuntimeUnavailable(error)) {
      return unavailableResponse(message.prefix);
    }
    throw error;
  }
}
