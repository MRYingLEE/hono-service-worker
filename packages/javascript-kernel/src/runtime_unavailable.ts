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
