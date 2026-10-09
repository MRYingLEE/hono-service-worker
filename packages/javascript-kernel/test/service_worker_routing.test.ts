/// <reference types="jest" />
import { IClaim, resolveOwningKernel } from '../src/service_worker_routing';

const URL_BASE = 'https://example.org';

describe('resolveOwningKernel', () => {
  it('passes through a request that matches no claim', () => {
    expect(
      resolveOwningKernel([], `${URL_BASE}/api/users`, 'ctx-1')
    ).toBeNull();
  });

  it('routes a request under a claimed prefix to its owner', () => {
    const claims: IClaim[] = [
      { kernelId: 'k1', issuingContextId: 'ctx-1', prefix: '/api' }
    ];
    expect(resolveOwningKernel(claims, `${URL_BASE}/api/users`, 'ctx-1')).toBe(
      'k1'
    );
  });

  it('matches whole path segments only, so /api does not claim /apiv2', () => {
    const claims: IClaim[] = [
      { kernelId: 'k1', issuingContextId: 'ctx-1', prefix: '/api' }
    ];
    expect(
      resolveOwningKernel(claims, `${URL_BASE}/apiv2/users`, 'ctx-1')
    ).toBeNull();
  });

  it('lets the longest matching prefix win', () => {
    const claims: IClaim[] = [
      { kernelId: 'short', issuingContextId: 'ctx-1', prefix: '/api' },
      { kernelId: 'long', issuingContextId: 'ctx-1', prefix: '/api/v2' }
    ];
    expect(
      resolveOwningKernel(claims, `${URL_BASE}/api/v2/items`, 'ctx-1')
    ).toBe('long');
    expect(resolveOwningKernel(claims, `${URL_BASE}/api/v1`, 'ctx-1')).toBe(
      'short'
    );
  });

  it('scopes ownership to the issuing context when two Kernels claim the same prefix', () => {
    const claims: IClaim[] = [
      { kernelId: 'kA', issuingContextId: 'ctx-A', prefix: '/shared' },
      { kernelId: 'kB', issuingContextId: 'ctx-B', prefix: '/shared' }
    ];
    expect(resolveOwningKernelFor(claims, 'ctx-A')).toBe('kA');
    expect(resolveOwningKernelFor(claims, 'ctx-B')).toBe('kB');
    expect(resolveOwningKernelFor(claims, 'ctx-C')).toBeNull();

    function resolveOwningKernelFor(c: IClaim[], ctx: string): string | null {
      return resolveOwningKernel(c, `${URL_BASE}/shared/x`, ctx);
    }
  });

  it('passes through once a claim is released', () => {
    const claims: IClaim[] = [
      { kernelId: 'k1', issuingContextId: 'ctx-1', prefix: '/api' }
    ];
    const afterRelease = claims.filter(c => c.kernelId !== 'k1');
    expect(
      resolveOwningKernel(afterRelease, `${URL_BASE}/api/users`, 'ctx-1')
    ).toBeNull();
  });
});
