/**
 * Raised when a Runtime is disposed or fails to load, so requests to it
 * cannot be answered.
 */
export class RuntimeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeUnavailableError';
  }
}

/**
 * Plain-text body naming the claimed prefix, sent when no Runtime can answer.
 */
export function runtimeUnavailableMessage(prefix: string): string {
  return `Runtime for ${prefix} is not running`;
}
