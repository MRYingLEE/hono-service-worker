// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.
/// <reference types="jest" />

import { WORKER_RUNTIME_FILENAME as BUNDLED_WORKER_RUNTIME_FILENAME } from './build_lab_scripts';
import { WORKER_RUNTIME_FILENAME, workerRuntimeUrl } from './runtime_backends';

describe('workerRuntimeUrl', () => {
  it('resolves the worker runtime next to the lab page', () => {
    expect(workerRuntimeUrl('http://127.0.0.1:8900/lab/index.html')).toBe(
      'http://127.0.0.1:8900/lab/javascript-kernel-worker-runtime.js'
    );
  });

  it('names the same script the lab build emits', () => {
    expect(WORKER_RUNTIME_FILENAME).toBe(BUNDLED_WORKER_RUNTIME_FILENAME);
  });
});
