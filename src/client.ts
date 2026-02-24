import {
  AuthenticationError,
  RateLimitError,
  InsufficientCreditsError,
  APIError,
  WaterlightError,
} from './errors';
import type {
  ChatCompletionCreateParams,
  ChatCompletion,
  ChatCompletionChunk,
  EmbeddingCreateParams,
  EmbeddingResponse,
  ModelList,
} from './types';
import { Stream } from './streaming';

const DEFAULT_BASE_URL = 'https://api.waterlight.io';
const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function handleError(status: number, body: any, headers?: Headers): never {
  const errObj = body?.error;
  const msg: string = (typeof errObj === 'object' ? errObj?.message : errObj) ?? 'Request failed';
  const requestId = headers?.get('x-request-id') ?? undefined;
  if (status === 401) throw new AuthenticationError(msg, requestId);
  if (status === 429) {
    const ra = headers?.get('retry-after');
    const retryAfter = ra ? parseFloat(ra) : undefined;
    throw new RateLimitError(msg, retryAfter, requestId);
  }
  if (status === 402) throw new InsufficientCreditsError(msg, requestId);
  throw new APIError(msg, status, requestId);
}

/** Chat completions namespace. */
class Completions {
  constructor(private readonly client: Waterlight) {}

  /**
   * Create a chat completion.
   *
   * @param params - Chat completion parameters
   * @returns ChatCompletion if stream is false/undefined, Stream if stream is true
   */
  create(params: ChatCompletionCreateParams & { stream: true }): Stream;
  create(params: ChatCompletionCreateParams & { stream?: false }): Promise<ChatCompletion>;
  create(params: ChatCompletionCreateParams): Promise<ChatCompletion> | Stream;
  create(params: ChatCompletionCreateParams): Promise<ChatCompletion> | Stream {
    if (params.stream) {
      return new Stream(
        `${this.client.baseUrl}/v1/chat/completions`,
        this.client.apiKey,
        params,
        this.client.timeout,
      );
    }
    return this.client['_post']('/v1/chat/completions', { ...params, stream: false });
  }
}

/** Chat namespace — mirrors openai.chat. */
class Chat {
  readonly completions: Completions;
  constructor(client: Waterlight) {
    this.completions = new Completions(client);
  }
}

/** Embeddings namespace. */
class Embeddings {
  constructor(private readonly client: Waterlight) {}

  async create(params: EmbeddingCreateParams): Promise<EmbeddingResponse> {
    return this.client['_post']('/v1/embeddings', params);
  }
}

/** Models namespace. */
class Models {
  constructor(private readonly client: Waterlight) {}

  async list(): Promise<ModelList> {
    return this.client['_get']('/v1/models');
  }
}

/** Billing info response. */
export interface BillingInfo {
  plan: string;
  billing_mode: string;
  spent_usd: number;
  total_requests: number;
  total_tokens: number;
  rpm_limit: number;
  tpm_limit: number;
  balance_usd?: number;
  min_deposit_usd?: number;
  budget_usd?: number;
  remaining_usd?: number;
  monthly_usd?: number;
  daily_limit?: number;
  daily_used?: number;
  allowed_models?: string[];
}

/** Billing namespace — Waterlight-specific (not in OpenAI SDK). */
class Billing {
  constructor(private readonly client: Waterlight) {}

  async get(): Promise<BillingInfo> {
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
export class Waterlight {
  /** @internal */
  private readonly _apiKey: string;
  readonly baseUrl: string;
  readonly timeout: number;
  readonly maxRetries: number;

  readonly chat: Chat;
  readonly embeddings: Embeddings;
  readonly models: Models;
  readonly billing: Billing;

  /** Access the API key (prefer using the client methods instead). */
  get apiKey(): string { return this._apiKey; }

  constructor(opts: { apiKey?: string; baseUrl?: string; timeout?: number; maxRetries?: number } = {}) {
    const key = opts.apiKey ?? process.env.WATERLIGHT_API_KEY;
    if (!key) {
      throw new WaterlightError(
        'API key required. Pass apiKey or set WATERLIGHT_API_KEY env var. ' +
        'Get your key at https://waterlight.io',
      );
    }
    this._apiKey = key;
    const resolvedUrl = (opts.baseUrl ?? process.env.WATERLIGHT_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    if (!resolvedUrl.startsWith('https://') && !resolvedUrl.startsWith('http://localhost') && !resolvedUrl.startsWith('http://127.0.0.1')) {
      throw new WaterlightError(
        `baseUrl must use HTTPS (got: ${resolvedUrl.slice(0, 40)}...). HTTP is only allowed for localhost development.`,
      );
    }
    this.baseUrl = resolvedUrl;
    this.timeout = opts.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;

    this.chat = new Chat(this);
    this.embeddings = new Embeddings(this);
    this.models = new Models(this);
    this.billing = new Billing(this);
  }

  private async _post<T>(path: string, body: object): Promise<T> {
    return this._request<T>('POST', path, body);
  }

  private async _get<T>(path: string): Promise<T> {
    return this._request<T>('GET', path);
  }

  private async _request<T>(method: string, path: string, body?: object): Promise<T> {
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
          const data: any = await res.json().catch(() => ({}));
          handleError(res.status, data, res.headers);
        }
        return await res.json() as T;
      } catch (e: any) {
        clearTimeout(timer);
        if (e instanceof WaterlightError) throw e;
        if (e?.name === 'AbortError') throw new APIError('Request timed out', 408);
        throw new APIError(`Network error: ${e?.message ?? e}`, 0);
      }
    }
  }
}
