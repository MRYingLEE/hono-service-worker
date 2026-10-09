// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/// <reference types="jest" />

import { RuntimeHeartbeat } from './runtime_heartbeat';
import { RuntimeUnavailableError } from './runtime_unavailable';

describe('RuntimeHeartbeat', () => {
  const INTERVAL_MS = 1000;
  const TIMEOUT_MS = 3000;
  const STEP_MS = 100;

  let answering: boolean;
  let ping: jest.Mock<Promise<void>, []>;
  let heartbeat: RuntimeHeartbeat;

  const neverSettles = <T>(): Promise<T> => new Promise<T>(() => undefined);

  // Advance in small steps, letting promise callbacks run between timers as
  // they would in a browser.
  const advance = async (ms: number): Promise<void> => {
    for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) {
      jest.advanceTimersByTime(STEP_MS);
      for (let i = 0; i < 10; i++) {
        await Promise.resolve();
      }
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    answering = true;
    ping = jest.fn(() => (answering ? Promise.resolve() : neverSettles()));
    heartbeat = new RuntimeHeartbeat({
      ping,
      intervalMs: INTERVAL_MS,
      timeoutMs: TIMEOUT_MS
    });
  });

  afterEach(() => {
    heartbeat.stop();
    jest.useRealTimers();
  });

  it('passes a request through while the runtime answers pings', async () => {
    heartbeat.start();
    await advance(INTERVAL_MS * 3);

    await expect(heartbeat.run(Promise.resolve('reply'))).resolves.toBe(
      'reply'
    );
  });

  it('rejects a new request once pings stop being answered', async () => {
    heartbeat.start();
    answering = false;
    await advance(INTERVAL_MS + TIMEOUT_MS);

    await expect(heartbeat.run(neverSettles())).rejects.toBeInstanceOf(
      RuntimeUnavailableError
    );
  });

  it('rejects a request that was already pending when pings stop', async () => {
    heartbeat.start();
    const pending = heartbeat.run(neverSettles<string>());
    answering = false;
    await advance(INTERVAL_MS + TIMEOUT_MS);

    await expect(pending).rejects.toBeInstanceOf(RuntimeUnavailableError);
  });

  it('answers requests again once pings resume', async () => {
    heartbeat.start();
    answering = false;
    await advance(INTERVAL_MS + TIMEOUT_MS);
    answering = true;
    await advance(INTERVAL_MS * 2 + TIMEOUT_MS);

    await expect(heartbeat.run(Promise.resolve('back'))).resolves.toBe('back');
  });

  it('stops pinging after stop()', async () => {
    heartbeat.start();
    await advance(INTERVAL_MS);
    heartbeat.stop();
    const calls = ping.mock.calls.length;
    await advance(INTERVAL_MS * 5);

    expect(ping.mock.calls.length).toBe(calls);
  });
});
