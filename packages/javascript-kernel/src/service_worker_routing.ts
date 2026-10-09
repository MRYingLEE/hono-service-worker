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
  const path = new URL(requestUrl).pathname;
  let best: IClaim | null = null;
  for (const claim of claims) {
    if (claim.issuingContextId !== issuingContextId) {
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

function matchesPrefix(path: string, prefix: string): boolean {
  if (path === prefix) {
    return true;
  }
  const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return path.startsWith(base);
}
