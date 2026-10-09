// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

export declare const SERVICE_WORKER_FILENAME: string;
export declare const WORKER_RUNTIME_FILENAME: string;

/**
 * Bundle `service_worker.ts` and `worker-runtime.ts` into one self-contained
 * script each in `outputDir`. Resolves to the paths of the written files, in
 * that order.
 */
export declare function buildLabScripts(outputDir: string): Promise<string[]>;
