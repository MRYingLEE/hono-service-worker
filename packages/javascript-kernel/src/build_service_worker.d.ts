// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

export declare const OUTPUT_FILENAME: string;

/**
 * Bundle `service_worker.ts` into one self-contained script in `outputDir`.
 * Resolves to the path of the written file.
 */
export declare function buildServiceWorker(outputDir: string): Promise<string>;
