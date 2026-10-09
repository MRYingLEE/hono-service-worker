// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { RuntimeUnavailableError } from './runtime_unavailable';

/**
 * Options for a runtime heartbeat.
 */
export interface IRuntimeHeartbeatOptions {
  /** Ask the runtime to answer; resolves when it does. */
  ping: () => Promise<unknown>;
  /** Time between pings, in milliseconds. */
  intervalMs: number;
  /** Time a ping may take before the runtime counts as silent. */
  timeoutMs: number;
}

/**
 * Detects a runtime that has stopped answering, so requests to it fail
 * instead of waiting forever.
 *
 * A busy runtime also misses pings, so it is reported as silent until it
 * answers again.
 */
export class RuntimeHeartbeat {
  constructor(options: IRuntimeHeartbeatOptions) {
    this._options = options;
    this._armSilence();
  }

  /**
   * Begin pinging the runtime on an interval.
   */
  start(): void {
    if (this._timer !== null) {
      return;
    }
    this._timer = setInterval(() => {
      void this._beat();
    }, this._options.intervalMs);
  }

  /**
   * Stop pinging the runtime.
   */
  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  /**
   * Settle with the work's result, or reject with RuntimeUnavailableError if
   * the runtime stops answering first.
   */
  run<T>(work: Promise<T>): Promise<T> {
    if (!this._responsive) {
      return Promise.reject(this._unavailable());
    }
    return Promise.race([work, this._silenced]);
  }

  /**
   * Send one ping and record whether the runtime answered in time.
   */
  private async _beat(): Promise<void> {
    if (this._pingInFlight) {
      return;
    }
    this._pingInFlight = true;
    try {
      await this._pingWithTimeout();
      this._markResponsive();
    } catch {
      this._markSilent();
    } finally {
      this._pingInFlight = false;
    }
  }

  private _pingWithTimeout(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(this._unavailable());
      }, this._options.timeoutMs);
      this._options.ping().then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error: unknown) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private _markResponsive(): void {
    if (!this._responsive) {
      this._responsive = true;
      this._armSilence();
    }
  }

  private _markSilent(): void {
    if (this._responsive) {
      this._responsive = false;
      this._rejectSilence(this._unavailable());
    }
  }

  private _armSilence(): void {
    this._silenced = new Promise<never>((_, reject) => {
      this._rejectSilence = reject;
    });
    // Requests that are not pending must not raise an unhandled rejection.
    this._silenced.catch(() => undefined);
  }

  private _unavailable(): RuntimeUnavailableError {
    return new RuntimeUnavailableError('Runtime stopped answering');
  }

  private _options: IRuntimeHeartbeatOptions;
  private _responsive = true;
  private _pingInFlight = false;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _silenced!: Promise<never>;
  private _rejectSilence!: (error: RuntimeUnavailableError) => void;
}
