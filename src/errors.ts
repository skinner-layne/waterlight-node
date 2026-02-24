export class WaterlightError extends Error {
  readonly status?: number;
  readonly requestId?: string;
  constructor(message: string, status?: number, requestId?: string) {
    super(message);
    this.name = 'WaterlightError';
    this.status = status;
    this.requestId = requestId;
  }
}

export class AuthenticationError extends WaterlightError {
  constructor(message: string, requestId?: string) {
    super(message, 401, requestId);
    this.name = 'AuthenticationError';
  }
}

export class RateLimitError extends WaterlightError {
  readonly retryAfter?: number;
  constructor(message: string, retryAfter?: number, requestId?: string) {
    super(message, 429, requestId);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

export class InsufficientCreditsError extends WaterlightError {
  constructor(message: string, requestId?: string) {
    super(message, 402, requestId);
    this.name = 'InsufficientCreditsError';
  }
}

export class APIError extends WaterlightError {
  constructor(message: string, status?: number, requestId?: string) {
    super(message, status, requestId);
    this.name = 'APIError';
  }
}
