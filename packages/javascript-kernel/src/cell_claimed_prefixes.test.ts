/// <reference types="jest" />

import { JavaScriptExecutor } from './executor';
import { createRemoteRuntimeApi } from './runtime_remote';

type OnOutput = (message: { type: string; [key: string]: unknown }) => void;

// Captures the onOutput callback each kernel passes to its runtime backend,
// so the test drives the Kernel with the messages a real runtime would send.
const backendOnOutput: OnOutput[] = [];
const backendReplies: Array<Array<{ requestId: string; prefixes: string[] }>> =
  [];

// Stands in for the Service Worker container and records claim/release calls.
const claimedBySw = new Map<string, Set<string>>();

jest.doMock('@jupyterlite/services', () => ({
  BaseKernel: class {
    id: string;
    isDisposed = false;
    executionCount = 0;
    constructor(options: { id: string }) {
      this.id = options.id;
    }
    stream(): void {}
    dispose(): void {
      this.isDisposed = true;
    }
  }
}));

// The fake backend runs the real runtime remote API against globalThis, so
// cell code calls the same `claimedPrefixes`/`claimPrefix` globals a browser
// cell would, and runtime messages reach the Kernel through its onOutput path.
jest.doMock('./runtime_backends', () => {
  class FakeBackend {
    readonly ready: Promise<void>;
    readonly remote: ReturnType<typeof createRemoteRuntimeApi>;
    readonly replies: Array<{ requestId: string; prefixes: string[] }>;
    constructor(options: { onOutput: OnOutput }) {
      backendOnOutput.push(options.onOutput);
      const replies: Array<{ requestId: string; prefixes: string[] }> = [];
      backendReplies.push(replies);
      this.replies = replies;
      this.remote = createRemoteRuntimeApi(
        globalThis as unknown as Record<string, any>,
        new JavaScriptExecutor(globalThis as unknown as Record<string, any>)
      );
      this.ready = this.remote.initialize(
        { baseUrl: 'http://localhost/' },
        options.onOutput as Parameters<typeof this.remote.initialize>[1]
      );
    }
    execute(code: string, count: number, parent?: string, cellId?: string) {
      return this.ready.then(() =>
        this.remote.execute(code, count, parent, cellId)
      );
    }
    resolveClaimedPrefixes(requestId: string, prefixes: string[]) {
      this.replies.push({ requestId, prefixes });
      return this.ready.then(() =>
        this.remote.resolveClaimedPrefixes(requestId, prefixes)
      );
    }
    dispose() {
      return this.remote.dispose();
    }
  }
  return {
    IFrameRuntimeBackend: FakeBackend,
    WorkerRuntimeBackend: FakeBackend
  };
});

class FakeContainer {
  readonly ready = Promise.resolve({
    active: {
      postMessage: (message: {
        type: 'claim' | 'release';
        kernelId: string;
        prefix: string;
      }) => {
        const set = claimedBySw.get(message.kernelId) ?? new Set<string>();
        if (message.type === 'claim') {
          set.add(message.prefix);
        } else {
          set.delete(message.prefix);
        }
        claimedBySw.set(message.kernelId, set);
      }
    }
  });
  register(): Promise<{ active: { postMessage(data: unknown): void } | null }> {
    return this.ready;
  }
  addEventListener(): void {}
}

const createdKernels: any[] = [];

const createKernel = async (id: string): Promise<any> => {
  const { JavaScriptKernel } = await import('./kernel');
  const kernel: any = new JavaScriptKernel({
    id,
    name: 'javascript',
    location: '/',
    sendMessage: () => {},
    serviceWorker: new FakeContainer()
  } as unknown as ConstructorParameters<typeof JavaScriptKernel>[0]);
  createdKernels.push(kernel);
  return kernel;
};

const runCell = async (kernel: any, code: string): Promise<void> => {
  const reply = await kernel.executeRequest({ code });
  if (reply.status !== 'ok') {
    throw new Error(`cell failed: ${JSON.stringify(reply)}`);
  }
};

// Runs a cell that reads claimedPrefixes() through the cell path and returns
// what the cell observed.
const readFromCell = async (kernel: any): Promise<string[]> => {
  const g = globalThis as unknown as Record<string, any>;
  delete g.__cellClaimed;
  await runCell(kernel, 'globalThis.__cellClaimed = await claimedPrefixes();');
  return g.__cellClaimed;
};

describe('cell claimedPrefixes()', () => {
  beforeEach(() => {
    backendOnOutput.length = 0;
    backendReplies.length = 0;
    claimedBySw.clear();
  });

  afterEach(() => {
    while (createdKernels.length > 0) {
      createdKernels.pop().dispose();
    }
  });

  it('returns the owning kernel claims after claims, releases, and restarts', async () => {
    const kernel = await createKernel('kernel-a');
    expect(await readFromCell(kernel)).toEqual([]);

    await runCell(kernel, "claimPrefix('/alpha/');");
    await runCell(kernel, "claimPrefix('/beta/');");
    expect(await readFromCell(kernel)).toEqual(['/alpha/', '/beta/']);

    await runCell(kernel, "releasePrefix('/alpha/');");
    expect(await readFromCell(kernel)).toEqual(['/beta/']);

    // Restart: the Kernel releases its claims, then a new Kernel starts.
    kernel.dispose();
    createdKernels.pop();
    const restarted = await createKernel('kernel-a');
    expect(await readFromCell(restarted)).toEqual([]);

    await runCell(restarted, "claimPrefix('/gamma/');");
    expect(await readFromCell(restarted)).toEqual(['/gamma/']);
  });

  it('answers each request from the kernel that sent it', async () => {
    // Each runtime's initialize overwrites the shared cell globals, so every
    // kernel's claims are made before the next kernel is created. Requests are
    // then driven through each kernel's own onOutput channel.
    const flush = () => new Promise(resolve => setTimeout(resolve, 0));
    const first = await createKernel('kernel-one');
    await runCell(first, "claimPrefix('/one/');");
    await flush();
    const second = await createKernel('kernel-two');
    await runCell(second, "claimPrefix('/two/');");
    await flush();

    const [firstOutput, secondOutput] = backendOnOutput;
    firstOutput({ type: 'claimed_prefixes_request', requestId: 'r-1' });
    secondOutput({ type: 'claimed_prefixes_request', requestId: 'r-2' });
    await flush();

    expect(backendReplies[0]).toEqual([
      { requestId: 'r-1', prefixes: ['/one/'] }
    ]);
    expect(backendReplies[1]).toEqual([
      { requestId: 'r-2', prefixes: ['/two/'] }
    ]);
  });
});
