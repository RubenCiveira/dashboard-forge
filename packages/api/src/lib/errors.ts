/** Base error class for API errors with HTTP status code */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NotFoundError extends ApiError {
  constructor(resource: string, id: string) {
    super("NOT_FOUND", `${resource} with id '${id}' not found`, 404);
  }
}

export class ConflictError extends ApiError {
  constructor(message: string) {
    super("CONFLICT", message, 409);
  }
}

export class ValidationError extends ApiError {
  constructor(message: string) {
    super("VALIDATION_ERROR", message, 422);
  }
}
