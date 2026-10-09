/// <reference types="jest" />
/// <reference types="node" />
// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import {
  buildLabScripts,
  SERVICE_WORKER_FILENAME,
  WORKER_RUNTIME_FILENAME
} from './build_lab_scripts';

const BUILD_TIMEOUT = 60000;

describe('buildLabScripts', () => {
  let outputDir: string;
  let paths: string[];

  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-scripts-'));
    paths = await buildLabScripts(outputDir);
  }, BUILD_TIMEOUT);

  afterAll(async () => {
    await fs.rm(outputDir, { recursive: true, force: true });
  });

  it('writes the service worker and the worker runtime into the output directory', () => {
    expect(paths).toEqual([
      path.join(outputDir, SERVICE_WORKER_FILENAME),
      path.join(outputDir, WORKER_RUNTIME_FILENAME)
    ]);
  });

  it('bundles every module so neither script has an import or require left', async () => {
    for (const bundlePath of paths) {
      const code = await fs.readFile(bundlePath, 'utf8');

      expect(code).not.toMatch(/(^|[;\n{}])\s*import\b/);
      expect(code).not.toMatch(/\brequire\(/);
    }
  });

  it('registers the install, activate, message and fetch listeners in the service worker', async () => {
    const code = await fs.readFile(paths[0], 'utf8');
    const listeners: string[] = [];
    const self = {
      addEventListener: (type: string) => {
        listeners.push(type);
      }
    };

    vm.runInNewContext(code, { self });

    expect(listeners.sort()).toEqual(['activate', 'fetch', 'install', 'message']);
  });

  it('listens for runtime messages in the worker runtime', async () => {
    const code = await fs.readFile(paths[1], 'utf8');
    const listeners: string[] = [];
    const sandbox: Record<string, unknown> = {
      addEventListener: (type: string) => {
        listeners.push(type);
      },
      postMessage: () => undefined,
      console
    };
    sandbox.self = sandbox;

    vm.runInNewContext(code, sandbox);

    expect(listeners).toContain('message');
  });
});
