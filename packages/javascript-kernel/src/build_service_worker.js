// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

const { execFile } = require('child_process');
const path = require('path');

const OUTPUT_FILENAME = 'javascript-kernel-service-worker.js';
const ENTRY = path.join(__dirname, 'service_worker.ts');

// Runs in a child Node process: rspack exposes only an `exports` map, which
// Jest 26's resolver cannot read, so the test host must not load it directly.
function buildServiceWorker(outputDir) {
  const target = path.resolve(outputDir);
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [__filename, target], (err, _stdout, stderr) => {
      if (err) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(path.join(target, OUTPUT_FILENAME));
    });
  });
}

function bundle(outputDir) {
  const { rspack } = require('@rspack/core');
  const config = {
    mode: 'production',
    target: 'webworker',
    devtool: false,
    entry: ENTRY,
    output: { path: outputDir, filename: OUTPUT_FILENAME },
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
  };

  return new Promise((resolve, reject) => {
    rspack(config, (err, stats) => {
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

module.exports = { buildServiceWorker, OUTPUT_FILENAME };

if (require.main === module) {
  const outputDir = process.argv[2];
  if (!outputDir) {
    console.error('usage: build_service_worker.js <output-dir>');
    process.exit(2);
  }
  bundle(path.resolve(outputDir)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
