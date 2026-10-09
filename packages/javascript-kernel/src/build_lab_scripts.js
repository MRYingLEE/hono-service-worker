// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

const { execFile } = require('child_process');
const path = require('path');

const SERVICE_WORKER_FILENAME = 'javascript-kernel-service-worker.js';
const WORKER_RUNTIME_FILENAME = 'javascript-kernel-worker-runtime.js';

const SCRIPTS = [
  {
    entry: path.join(__dirname, 'service_worker.ts'),
    filename: SERVICE_WORKER_FILENAME
  },
  {
    entry: path.join(__dirname, 'worker-runtime.ts'),
    filename: WORKER_RUNTIME_FILENAME
  }
];

// Runs in a child Node process: rspack exposes only an `exports` map, which
// Jest 26's resolver cannot read, so the test host must not load it directly.
function buildLabScripts(outputDir) {
  const target = path.resolve(outputDir);
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [__filename, target], (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(SCRIPTS.map(script => path.join(target, script.filename)));
    });
  });
}

function bundle(outputDir) {
  const { rspack } = require('@rspack/core');
  const configs = SCRIPTS.map(script => ({
    mode: 'production',
    target: 'webworker',
    devtool: false,
    entry: script.entry,
    output: { path: outputDir, filename: script.filename },
    resolve: { extensions: ['.ts', '.js'] },
    module: {
      rules: [
        {
          test: /\.ts$/,
          loader: 'builtin:swc-loader',
          options: {
            jsc: {
              parser: { syntax: 'typescript' },
              target: 'es2019'
            }
          }
        }
      ]
    }
  }));

  return new Promise((resolve, reject) => {
    rspack(configs, (err, stats) => {
      if (err) {
        reject(err);
        return;
      }
      if (stats.hasErrors()) {
        reject(new Error(stats.toString('errors-only')));
        return;
      }
      resolve();
    });
  });
}

module.exports = {
  buildLabScripts,
  SERVICE_WORKER_FILENAME,
  WORKER_RUNTIME_FILENAME
};

if (require.main === module) {
  const outputDir = process.argv[2];
  if (!outputDir) {
    console.error('usage: build_lab_scripts.js <output-dir>');
    process.exit(2);
  }
  bundle(path.resolve(outputDir)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}
