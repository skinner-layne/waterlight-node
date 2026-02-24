"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Waterlight = void 0;
const errors_1 = require("./errors");
const streaming_1 = require("./streaming");
const DEFAULT_BASE_URL = 'https://api.waterlight.io';
const DEFAULT_TIMEOUT = 120000;
const DEFAULT_MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function handleError(status, body, headers) {
    const errObj = body?.error;
    const msg = (typeof errObj === 'object' ? errObj?.message : errObj) ?? 'Request failed';
    const requestId = headers?.get('x-request-id') ?? undefined;
    if (status === 401)
        throw new errors_1.AuthenticationError(msg, requestId);
    if (status === 429) {
        const ra = headers?.get('retry-after');
        const retryAfter = ra ? parseFloat(ra) : undefined;
        throw new errors_1.RateLimitError(msg, retryAfter, requestId);
    }
    if (status === 402)
        throw new errors_1.InsufficientCreditsError(msg, requestId);
    throw new errors_1.APIError(msg, status, requestId);
}
/** Chat completions namespace. */
class Completions {
    constructor(client) {
        this.client = client;
    }
    create(params) {
        if (params.stream) {
            return new streaming_1.Stream(`${this.client.baseUrl}/v1/chat/completions`, this.client.apiKey, params, this.client.timeout);
        }
        return this.client['_post']('/v1/chat/completions', { ...params, stream: false });
    }
}
/** Chat namespace — mirrors openai.chat. */
class Chat {
    constructor(client) {
        this.completions = new Completions(client);
    }
}
/** Embeddings namespace. */
class Embeddings {
    constructor(client) {
        this.client = client;
    }
    async create(params) {
        return this.client['_post']('/v1/embeddings', params);
    }
}
/** Models namespace. */
class Models {
    constructor(client) {
        this.client = client;
    }
    async list() {
        return this.client['_get']('/v1/models');
    }
}
/** Billing namespace — Waterlight-specific (not in OpenAI SDK). */
class Billing {
    constructor(client) {
        this.client = client;
    }
    async get() {
        return this.client['_get']('/v1/billing');
    }
}
/**
 * Waterlight API client — OpenAI-compatible interface.
 *
 * @example
 * ```ts
 * import { Waterlight } from 'waterlight';
 *
 * const client = new Waterlight({ apiKey: 'wl-...' });
 *
 * // Non-streaming
 * const response = await client.chat.completions.create({
 *   model: 'mist-1-turbo',
 *   messages: [{ role: 'user', content: 'Hello!' }],
 * });
 * console.log(response.choices[0].message.content);
 *
 * // Streaming
 * const stream = client.chat.completions.create({
 *   model: 'mist-1-turbo',
 *   messages: [{ role: 'user', content: 'Tell me a story' }],
 *   stream: true,
 * });
 * for await (const chunk of stream) {
 *   process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
 * }
 * ```
 */
class Waterlight {
    /** Access the API key (prefer using the client methods instead). */
    get apiKey() { return this._apiKey; }
    constructor(opts = {}) {
        const key = opts.apiKey ?? process.env.WATERLIGHT_API_KEY;
        if (!key) {
            throw new errors_1.WaterlightError('API key required. Pass apiKey or set WATERLIGHT_API_KEY env var. ' +
                'Get your key at https://waterlight.io');
        }
        this._apiKey = key;
        const resolvedUrl = (opts.baseUrl ?? process.env.WATERLIGHT_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
        if (!resolvedUrl.startsWith('https://') && !resolvedUrl.startsWith('http://localhost') && !resolvedUrl.startsWith('http://127.0.0.1')) {
            throw new errors_1.WaterlightError(`baseUrl must use HTTPS (got: ${resolvedUrl.slice(0, 40)}...). HTTP is only allowed for localhost development.`);
        }
        this.baseUrl = resolvedUrl;
        this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
        this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
        this.chat = new Chat(this);
        this.embeddings = new Embeddings(this);
        this.models = new Models(this);
        this.billing = new Billing(this);
    }
    async _post(path, body) {
        return this._request('POST', path, body);
    }
    async _get(path) {
        return this._request('GET', path);
    }
    async _request(method, path, body) {
        const url = `${this.baseUrl}${path}`;
        let attempt = 0;
        while (true) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.timeout);
            try {
                const res = await fetch(url, {
                    method,
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        ...(body ? { 'Content-Type': 'application/json' } : {}),
                        'User-Agent': 'waterlight-node/0.2.1',
                    },
                    ...(body ? { body: JSON.stringify(body) } : {}),
                    signal: controller.signal,
                });
                clearTimeout(timer);
                if (!res.ok) {
                    if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
                        const retryAfter = res.headers.get('retry-after');
                        const delay = retryAfter ? parseFloat(retryAfter) * 1000 : 500 * 2 ** attempt;
                        await sleep(delay);
                        attempt++;
                        continue;
                    }
                    const data = await res.json().catch(() => ({}));
                    handleError(res.status, data, res.headers);
                }
                return await res.json();
            }
            catch (e) {
                clearTimeout(timer);
                if (e instanceof errors_1.WaterlightError)
                    throw e;
                if (e?.name === 'AbortError')
                    throw new errors_1.APIError('Request timed out', 408);
                throw new errors_1.APIError(`Network error: ${e?.message ?? e}`, 0);
            }
        }
    }
}
exports.Waterlight = Waterlight;
