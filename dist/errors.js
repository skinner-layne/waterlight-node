"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.APIError = exports.InsufficientCreditsError = exports.RateLimitError = exports.AuthenticationError = exports.WaterlightError = void 0;
class WaterlightError extends Error {
    constructor(message, status, requestId) {
        super(message);
        this.name = 'WaterlightError';
        this.status = status;
        this.requestId = requestId;
    }
}
exports.WaterlightError = WaterlightError;
class AuthenticationError extends WaterlightError {
    constructor(message, requestId) {
        super(message, 401, requestId);
        this.name = 'AuthenticationError';
    }
}
exports.AuthenticationError = AuthenticationError;
class RateLimitError extends WaterlightError {
    constructor(message, retryAfter, requestId) {
        super(message, 429, requestId);
        this.name = 'RateLimitError';
        this.retryAfter = retryAfter;
    }
}
exports.RateLimitError = RateLimitError;
class InsufficientCreditsError extends WaterlightError {
    constructor(message, requestId) {
        super(message, 402, requestId);
        this.name = 'InsufficientCreditsError';
    }
}
exports.InsufficientCreditsError = InsufficientCreditsError;
class APIError extends WaterlightError {
    constructor(message, status, requestId) {
        super(message, status, requestId);
        this.name = 'APIError';
    }
}
exports.APIError = APIError;
