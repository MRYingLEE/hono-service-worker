// Copyright (c) Jupyter Development Team.
// Distributed under the terms of the Modified BSD License.

export type RuntimeLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
export type RuntimeLogMethod = Exclude<RuntimeLogLevel, 'silent'>;
export type RuntimeLogger = Pick<Console, RuntimeLogMethod>;

const LOG_LEVELS: Record<RuntimeLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50
};

function isRuntimeLogLevel(level: string): level is RuntimeLogLevel {
  return Object.prototype.hasOwnProperty.call(LOG_LEVELS, level);
}

export function normalizeRuntimeLogLevel(level: unknown): RuntimeLogLevel {
  if (level === undefined) {
    return 'warn';
  }
  if (typeof level !== 'string' || !isRuntimeLogLevel(level)) {
    throw new Error(
      `Invalid route log level "${String(level)}". Expected debug, info, warn, error, or silent.`
    );
  }
  return level;
}

export function captureRuntimeLogger(
  globalScope: Record<string, any>
): RuntimeLogger {
  const logger = globalScope.console as Console;
  return {
    debug: logger.debug.bind(logger),
    info: logger.info.bind(logger),
    warn: logger.warn.bind(logger),
    error: logger.error.bind(logger)
  };
}

export function logRouteMessage(
  logger: RuntimeLogger,
  configuredLevel: RuntimeLogLevel,
  level: RuntimeLogMethod,
  message: string,
  details?: Record<string, unknown>
): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[configuredLevel]) {
    return;
  }
  const args =
    details === undefined
      ? [`[JavaScript Kernel routes] ${message}`]
      : [`[JavaScript Kernel routes] ${message}`, details];
  logger[level](...args);
}
