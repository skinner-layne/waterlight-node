import type { ChatCompletionCreateParams, ChatCompletion, EmbeddingCreateParams, EmbeddingResponse, ModelList } from './types';
import { Stream } from './streaming';
/** Chat completions namespace. */
declare class Completions {
    private readonly client;
    constructor(client: Waterlight);
    /**
     * Create a chat completion.
     *
     * @param params - Chat completion parameters
     * @returns ChatCompletion if stream is false/undefined, Stream if stream is true
     */
    create(params: ChatCompletionCreateParams & {
        stream: true;
    }): Stream;
    create(params: ChatCompletionCreateParams & {
        stream?: false;
    }): Promise<ChatCompletion>;
    create(params: ChatCompletionCreateParams): Promise<ChatCompletion> | Stream;
}
/** Chat namespace — mirrors openai.chat. */
declare class Chat {
    readonly completions: Completions;
    constructor(client: Waterlight);
}
/** Embeddings namespace. */
declare class Embeddings {
    private readonly client;
    constructor(client: Waterlight);
    create(params: EmbeddingCreateParams): Promise<EmbeddingResponse>;
}
/** Models namespace. */
declare class Models {
    private readonly client;
    constructor(client: Waterlight);
    list(): Promise<ModelList>;
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
declare class Billing {
    private readonly client;
    constructor(client: Waterlight);
    get(): Promise<BillingInfo>;
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
export declare class Waterlight {
    /** @internal */
    private readonly _apiKey;
    readonly baseUrl: string;
    readonly timeout: number;
    readonly maxRetries: number;
    readonly chat: Chat;
    readonly embeddings: Embeddings;
    readonly models: Models;
    readonly billing: Billing;
    /** Access the API key (prefer using the client methods instead). */
    get apiKey(): string;
    constructor(opts?: {
        apiKey?: string;
        baseUrl?: string;
        timeout?: number;
        maxRetries?: number;
    });
    private _post;
    private _get;
    private _request;
}
export {};
