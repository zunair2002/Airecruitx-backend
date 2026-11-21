export class AppError extends Error {
  statusCode: number;
  /** Extra fields merged into the JSON error body (e.g. `nextAvailableAt` on a 429). */
  details?: Record<string, unknown>;

  constructor(message: string, statusCode: number, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
