/// <reference types="jest" />

type OnOutput = (message: { type: string; [key: string]: unknown }) => void;

// Captures the onOutput callback each kernel passes to its runtime backend,
// so tests can simulate runtime messages without a real worker or iframe.
const backendOnOutput: OnOutput[] = [];

// Records every stream output a kernel publishes to its cell.
const streamOutputs: Array<{ name: string; text: string }> = [];

jest.doMock('@jupyterlite/services', () => ({
  BaseKernel: class {
    id: string;
    isDisposed = false;
    constructor(options: { id: string }) {
      this.id = options.id;
    }
    stream(content: { name: string; text: string }): void {
      streamOutputs.push(content);
    }
    dispose(): void {
      this.isDisposed = true;
    }
  }
}));

jest.doMock('./runtime_backends', () => ({
  IFrameRuntimeBackend: class {
    constructor(options: { onOutput: OnOutput }) {
      backendOnOutput.push(options.onOutput);
    }
    dispose(): void {}
  },
  WorkerRuntimeBackend: class {
    constructor(options: { onOutput: OnOutput }) {
      backendOnOutput.push(options.onOutput);
    }
    dispose(): void {}
  }
}));

interface IClaimCall {
  kind: 'claim' | 'release';
  kernelId: string;
  prefix: string;
}

// Stands in for the Service Worker container and records every claim and
// release that the kernel sends through the ticket 07 client functions.
class FakeContainer {
  readonly calls: IClaimCall[] = [];
  readonly ready = Promise.resolve({
    active: {
      postMessage: (message: {
        type: 'claim' | 'release';
        kernelId: string;
        prefix: string;
      }) => {
        this.calls.push({
          kind: message.type,
          kernelId: message.kernelId,
          prefix: message.prefix
        });
      }
    }
  });
  register(): Promise<{
    active: { postMessage(data: unknown): void } | null;
  }> {
    return this.ready;
  }
  addEventListener(): void {}
}

const createdKernels: any[] = [];

const createKernel = async (
  id: string,
  container: FakeContainer
): Promise<{ kernel: any; onOutput: OnOutput }> => {
  const { JavaScriptKernel } = await import('./kernel');
  const before = backendOnOutput.length;
  const kernel: any = new JavaScriptKernel({
    id,
    name: 'javascript',
    location: '/',
    sendMessage: () => {},
    serviceWorker: container
  } as unknown as ConstructorParameters<typeof JavaScriptKernel>[0]);
  const onOutput = backendOnOutput[before];
  expect(onOutput).toBeDefined();
  createdKernels.push(kernel);
  return { kernel, onOutput };
};

const claim = (onOutput: OnOutput, prefix: string): void => {
  onOutput({ type: 'claim_prefix', prefix });
};

const release = (onOutput: OnOutput, prefix: string): void => {
  onOutput({ type: 'release_prefix', prefix });
};

const flush = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 0));

describe('kernel claim lifecycle', () => {
  beforeEach(() => {
    backendOnOutput.length = 0;
    streamOutputs.length = 0;
  });

  afterEach(() => {
    // Disposing releases claims in the shared registry so tests stay isolated.
    for (const kernel of createdKernels.splice(0)) {
      kernel.dispose();
    }
  });

  it('loads kernel.ts under Jest', async () => {
    const { JavaScriptKernel } = await import('./kernel');
    expect(typeof JavaScriptKernel).toBe('function');
  });

  it('sends a cell claim to the Service Worker with the kernel id', async () => {
    const container = new FakeContainer();
    const { onOutput } = await createKernel('kernel-a', container);

    claim(onOutput, '/api/');
    await flush();

    expect(container.calls).toEqual([
      { kind: 'claim', kernelId: 'kernel-a', prefix: '/api/' }
    ]);
  });

  it('re-posts a same-notebook re-claim so the Service Worker replaces it', async () => {
    const container = new FakeContainer();
    const { onOutput } = await createKernel('kernel-a', container);

    claim(onOutput, '/api/');
    claim(onOutput, '/api/');
    await flush();

    expect(container.calls).toEqual([
      { kind: 'claim', kernelId: 'kernel-a', prefix: '/api/' },
      { kind: 'claim', kernelId: 'kernel-a', prefix: '/api/' }
    ]);
  });

  it('releases the kernel claims on dispose', async () => {
    const container = new FakeContainer();
    const { kernel, onOutput } = await createKernel('kernel-a', container);

    claim(onOutput, '/api/');
    claim(onOutput, '/docs/');
    await flush();
    kernel.dispose();
    await flush();

    expect(container.calls.filter(call => call.kind === 'release')).toEqual([
      { kind: 'release', kernelId: 'kernel-a', prefix: '/api/' },
      { kind: 'release', kernelId: 'kernel-a', prefix: '/docs/' }
    ]);
  });

  it('releases claims when a kernel is restarted with the same id', async () => {
    const container = new FakeContainer();
    const { kernel, onOutput } = await createKernel('kernel-a', container);
    claim(onOutput, '/api/');
    await flush();

    kernel.dispose();
    await flush();
    const { onOutput: nextOnOutput } = await createKernel(
      'kernel-a',
      container
    );
    claim(nextOnOutput, '/api/');
    await flush();

    expect(container.calls).toEqual([
      { kind: 'claim', kernelId: 'kernel-a', prefix: '/api/' },
      { kind: 'release', kernelId: 'kernel-a', prefix: '/api/' },
      { kind: 'claim', kernelId: 'kernel-a', prefix: '/api/' }
    ]);
  });

  it('keeps another kernel claims intact when one kernel is disposed', async () => {
    const container = new FakeContainer();
    const { kernel: kernelA, onOutput: onOutputA } = await createKernel(
      'kernel-a',
      container
    );
    const { onOutput: onOutputB } = await createKernel('kernel-b', container);
    claim(onOutputA, '/api/');
    claim(onOutputB, '/docs/');
    await flush();

    kernelA.dispose();
    await flush();

    expect(container.calls.filter(call => call.kind === 'release')).toEqual([
      { kind: 'release', kernelId: 'kernel-a', prefix: '/api/' }
    ]);
  });

  it('exports claimedPrefixes and reports claims made by a kernel', async () => {
    const { claimedPrefixes } = await import('./service_worker_client');
    const container = new FakeContainer();
    const { onOutput } = await createKernel('kernel-a', container);

    expect(claimedPrefixes('kernel-a')).toEqual([]);
    claim(onOutput, '/api/');
    claim(onOutput, '/docs/');
    await flush();

    expect(claimedPrefixes('kernel-a')).toEqual(['/api/', '/docs/']);
    expect(claimedPrefixes('kernel-b')).toEqual([]);
  });

  it('removes a prefix from claimedPrefixes after its release', async () => {
    const { claimedPrefixes } = await import('./service_worker_client');
    const container = new FakeContainer();
    const { onOutput } = await createKernel('kernel-a', container);
    claim(onOutput, '/api/');
    claim(onOutput, '/docs/');
    await flush();

    release(onOutput, '/api/');
    await flush();

    expect(claimedPrefixes('kernel-a')).toEqual(['/docs/']);
  });

  it('empties claimedPrefixes when the kernel is disposed', async () => {
    const { claimedPrefixes } = await import('./service_worker_client');
    const container = new FakeContainer();
    const { kernel, onOutput } = await createKernel('kernel-a', container);
    claim(onOutput, '/api/');
    await flush();

    kernel.dispose();
    await flush();

    expect(claimedPrefixes('kernel-a')).toEqual([]);
  });

  it('starts a restarted kernel with no claims carried over', async () => {
    const { claimedPrefixes } = await import('./service_worker_client');
    const container = new FakeContainer();
    const { kernel, onOutput } = await createKernel('kernel-a', container);
    claim(onOutput, '/api/');
    await flush();

    kernel.dispose();
    await flush();
    const { onOutput: nextOnOutput } = await createKernel(
      'kernel-a',
      container
    );

    expect(claimedPrefixes('kernel-a')).toEqual([]);

    claim(nextOnOutput, '/docs/');
    await flush();

    expect(claimedPrefixes('kernel-a')).toEqual(['/docs/']);
  });

  it('prints the resulting claim set in the cell output after each claim', async () => {
    const container = new FakeContainer();
    const { onOutput } = await createKernel('kernel-a', container);

    claim(onOutput, '/api/');
    claim(onOutput, '/docs/');
    await flush();

    expect(streamOutputs).toEqual([
      { name: 'stdout', text: 'Claimed prefixes: /api/\n' },
      { name: 'stdout', text: 'Claimed prefixes: /api/, /docs/\n' }
    ]);
  });

  it('does not print a claim set when a prefix is released', async () => {
    const container = new FakeContainer();
    const { onOutput } = await createKernel('kernel-a', container);
    claim(onOutput, '/api/');
    release(onOutput, '/api/');
    await flush();

    expect(streamOutputs).toEqual([
      { name: 'stdout', text: 'Claimed prefixes: /api/\n' }
    ]);
  });
});
