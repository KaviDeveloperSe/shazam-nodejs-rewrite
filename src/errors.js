export class AppError extends Error {
  constructor(message, status = 500, code = 'ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}
export class InputError extends AppError { constructor(message) { super(message, 400, 'BAD_REQUEST'); } }
export class NotFoundError extends AppError { constructor(message) { super(message, 404, 'NOT_FOUND'); } }
export class UpstreamError extends AppError { constructor(message, status = 502) { super(message, status, 'UPSTREAM_ERROR'); } }
export class LimitedError extends AppError { constructor(message) { super(message, 429, 'RATE_LIMIT'); } }
