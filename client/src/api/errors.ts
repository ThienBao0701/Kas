export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

/**
 * The known backend error codes (Phase 2 API). Kept as a union for reference,
 * but ApiError.code is a plain string so an unknown code never breaks parsing.
 */
export type KnownErrorCode =
  | 'AUTH_REQUIRED'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'PASSWORD_CHANGE_REQUIRED'
  | 'FORBIDDEN'
  | 'BRANCH_ACCESS_DENIED'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'UNKNOWN';

/** A structured error carrying the backend's error code and HTTP status. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  /** True when the server says the request is unauthenticated. */
  get isAuthError(): boolean {
    return this.status === 401 || this.code === 'AUTH_REQUIRED';
  }
}

/** Thrown when the request never reached the server (offline, DNS, abort). */
export class NetworkError extends Error {
  constructor(
    message = 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối và thử lại.',
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

/** A user-safe message for any thrown error — never a stack trace. */
export function toUserMessage(error: unknown): string {
  if (error instanceof NetworkError) return error.message;
  if (error instanceof ApiError) return error.message;
  return 'Đã xảy ra lỗi không mong muốn. Vui lòng thử lại.';
}
