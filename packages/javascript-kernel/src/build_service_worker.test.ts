/// <reference types="jest" />
/// <reference types="node" />
// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { buildServiceWorker, OUTPUT_FILENAME } from './build_service_worker';

const BUILD_TIMEOUT = 60000;

describe('buildServiceWorker', () => {
  let outputDir: string;
  let bundlePath: string;

  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-bundle-'));
    bundlePath = await buildServiceWorker(outputDir);
  }, BUILD_TIMEOUT);

  afterAll(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('writes one script named for the JupyterLite service worker', () => {
    expect(path.basename(bundlePath)).toBe(OUTPUT_FILENAME);
    expect(path.dirname(bundlePath)).toBe(outputDir);
  });

  it('bundles every module so the script has no import or require left', async () => {
    const code = await fs.readFile(bundlePath, 'utf8');

    expect(code).not.toMatch(/(^|[;\n{}])\s*import\b/);
    expect(code).not.toMatch(/\brequire\(/);
  });

  it('registers the install, activate, message and fetch listeners when evaluated', async () => {
    const code = await fs.readFile(bundlePath, 'utf8');
    const listeners: string[] = [];
    const self = {
      addEventListener: (type: string) => {
        listeners.push(type);
      }
    };

    vm.runInNewContext(code, { self });

    expect(listeners.sort()).toEqual(['activate', 'fetch', 'install', 'message']);
  });
});
