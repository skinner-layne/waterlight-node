export declare class WaterlightError extends Error {
    readonly status?: number;
    readonly requestId?: string;
    constructor(message: string, status?: number, requestId?: string);
}
export declare class AuthenticationError extends WaterlightError {
    constructor(message: string, requestId?: string);
}
export declare class RateLimitError extends WaterlightError {
    readonly retryAfter?: number;
    constructor(message: string, retryAfter?: number, requestId?: string);
}
export declare class InsufficientCreditsError extends WaterlightError {
    constructor(message: string, requestId?: string);
}
export declare class APIError extends WaterlightError {
    constructor(message: string, status?: number, requestId?: string);
}
