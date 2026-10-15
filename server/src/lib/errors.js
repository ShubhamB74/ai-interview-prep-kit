/** Structured error: `code` is machine-readable, `message` is human-readable. */
export class AppError extends Error {
  constructor(code, message, { status = 500, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class PipelineError extends AppError {
  constructor(code, message, details) {
    super(code, message, { status: 422, details });
    this.name = 'PipelineError';
  }
}

export const notImplemented = (what, phase) =>
  new AppError('NOT_IMPLEMENTED', `${what} is not implemented yet (planned: ${phase}).`, { status: 501 });
