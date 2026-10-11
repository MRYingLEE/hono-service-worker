export interface IClaim {
  kernelId: string;
  issuingContextId: string;
  prefix: string;
}

export function resolveOwningKernel(
  claims: IClaim[],
  requestUrl: string,
  issuingContextId: string
): string | null {
  const claim = resolveOwningClaim(claims, requestUrl, issuingContextId);
  return claim === null ? null : claim.kernelId;
}

/**
 * The longest matching claim for a request, or null if none matches.
 */
export function resolveOwningClaim(
  claims: IClaim[],
  requestUrl: string,
  issuingContextId: string
): IClaim | null {
  return selectLongestClaim(claims, requestUrl, issuingContextId, null);
}

/**
 * The longest claim matching a request issued by a Runtime. Only claims
 * held by that Runtime's own Kernel are considered, so a same-prefix claim
 * from another Kernel in the same page is never used.
 */
export function resolveRuntimeClaim(
  claims: IClaim[],
  requestUrl: string,
  issuingContextId: string,
  kernelId: string
): IClaim | null {
  return selectLongestClaim(claims, requestUrl, issuingContextId, kernelId);
}

function selectLongestClaim(
  claims: IClaim[],
  requestUrl: string,
  issuingContextId: string,
  kernelId: string | null
): IClaim | null {
  const path = new URL(requestUrl).pathname;
  let best: IClaim | null = null;
  for (const claim of claims) {
    if (claim.issuingContextId !== issuingContextId) {
      continue;
    }
    if (kernelId !== null && claim.kernelId !== kernelId) {
      continue;
    }
    if (!matchesPrefix(path, claim.prefix)) {
      continue;
    }
    if (best === null || claim.prefix.length > best.prefix.length) {
      best = claim;
    }
  }
  return best;
}

export function matchesPrefix(path: string, prefix: string): boolean {
  if (path === prefix) {
    return true;
  }
  const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return path.startsWith(base);
}

export const RUNTIME_IDENTITY_SEGMENT = '__runtime_identity__';

/**
 * True when the request targets the reserved identity path, which a Runtime
 * fetches so the Service Worker can learn its own clientId.
 */
export function isRuntimeIdentityUrl(requestUrl: string): boolean {
  const segments = new URL(requestUrl).pathname.split('/');
  return segments[segments.length - 1] === RUNTIME_IDENTITY_SEGMENT;
}
