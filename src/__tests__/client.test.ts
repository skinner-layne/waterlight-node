import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Waterlight } from '../client';
import {
  WaterlightError,
  AuthenticationError,
  RateLimitError,
  InsufficientCreditsError,
  APIError,
} from '../errors';
import { Stream } from '../streaming';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal successful JSON Response. */
function jsonResponse(body: object, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> ?? {}) },
    ...init,
  });
}

/** Build an error Response with optional headers. */
function errorResponse(
  status: number,
  body: object = {},
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/** Fake ChatCompletion payload. */
const COMPLETION = {
  id: 'chatcmpl-abc',
  object: 'chat.completion' as const,
  created: 1700000000,
  model: 'mist-1-turbo',
  choices: [{ index: 0, message: { role: 'assistant' as const, content: 'Hello!' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
};

/** Build a ReadableStream that yields SSE frames. */
function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < frames.length) {
        controller.enqueue(encoder.encode(frames[i]));
        i++;
      } else {
        controller.close();
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let originalFetch: typeof globalThis.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  mockFetch = vi.fn();
  vi.stubGlobal('fetch', mockFetch);
  // Clear env so constructor tests are deterministic
  delete process.env.WATERLIGHT_API_KEY;
  delete process.env.WATERLIGHT_BASE_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  delete process.env.WATERLIGHT_API_KEY;
  delete process.env.WATERLIGHT_BASE_URL;
});

// ===========================================================================
// 1. Constructor
// ===========================================================================

describe('Constructor', () => {
  it('accepts an explicit apiKey', () => {
    const client = new Waterlight({ apiKey: 'wl-test-123' });
    expect(client.apiKey).toBe('wl-test-123');
  });

  it('falls back to WATERLIGHT_API_KEY env var', () => {
    process.env.WATERLIGHT_API_KEY = 'wl-from-env';
    const client = new Waterlight();
    expect(client.apiKey).toBe('wl-from-env');
  });

  it('throws WaterlightError when no key provided', () => {
    expect(() => new Waterlight()).toThrow(WaterlightError);
    expect(() => new Waterlight()).toThrow(/API key required/);
  });

  it('uses default baseUrl, timeout, and maxRetries', () => {
    const client = new Waterlight({ apiKey: 'k' });
    expect(client.baseUrl).toBe('https://api.waterlight.io');
    expect(client.timeout).toBe(120_000);
    expect(client.maxRetries).toBe(2);
  });

  it('strips trailing slashes from baseUrl', () => {
    const client = new Waterlight({ apiKey: 'k', baseUrl: 'https://example.com///' });
    expect(client.baseUrl).toBe('https://example.com');
  });

  it('accepts custom timeout and maxRetries', () => {
    const client = new Waterlight({ apiKey: 'k', timeout: 5000, maxRetries: 5 });
    expect(client.timeout).toBe(5000);
    expect(client.maxRetries).toBe(5);
  });

  it('picks up WATERLIGHT_BASE_URL from env', () => {
    process.env.WATERLIGHT_BASE_URL = 'https://custom.host';
    const client = new Waterlight({ apiKey: 'k' });
    expect(client.baseUrl).toBe('https://custom.host');
  });
});

// ===========================================================================
// 2. Non-streaming chat completion
// ===========================================================================

describe('Non-streaming chat.completions.create', () => {
  it('sends correct method, URL, headers, and body', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(COMPLETION));
    const client = new Waterlight({ apiKey: 'wl-key', baseUrl: 'https://api.test' });

    await client.chat.completions.create({
      model: 'mist-1-turbo',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer wl-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['User-Agent']).toBe('waterlight-node/0.2.1');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('mist-1-turbo');
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('returns parsed ChatCompletion', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(COMPLETION));
    const client = new Waterlight({ apiKey: 'k' });
    const result = await client.chat.completions.create({
      model: 'mist-1-turbo',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.id).toBe('chatcmpl-abc');
    expect(result.choices[0].message.content).toBe('Hello!');
    expect(result.usage.total_tokens).toBe(8);
  });
});

// ===========================================================================
// 3. Error handling — status code mapping
// ===========================================================================

describe('Error handling', () => {
  const client = new Waterlight({ apiKey: 'k', maxRetries: 0 });

  it('401 -> AuthenticationError', async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(401, { error: { message: 'Invalid API key' } }),
    );
    await expect(
      client.chat.completions.create({ model: 'm', messages: [] }),
    ).rejects.toThrow(AuthenticationError);
  });

  it('402 -> InsufficientCreditsError', async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(402, { error: { message: 'No credits' } }),
    );
    await expect(
      client.chat.completions.create({ model: 'm', messages: [] }),
    ).rejects.toThrow(InsufficientCreditsError);
  });

  it('429 -> RateLimitError with retryAfter', async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(429, { error: { message: 'Too many requests' } }, { 'retry-after': '30' }),
    );
    try {
      await client.chat.completions.create({ model: 'm', messages: [] });
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(RateLimitError);
      expect(e.retryAfter).toBe(30);
      expect(e.status).toBe(429);
    }
  });

  it('500 -> APIError', async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(500, { error: { message: 'Internal error' } }),
    );
    try {
      await client.chat.completions.create({ model: 'm', messages: [] });
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(APIError);
      expect(e.status).toBe(500);
    }
  });

  it('falls back to "Request failed" when error body is empty', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(418, {}));
    try {
      await client.chat.completions.create({ model: 'm', messages: [] });
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(APIError);
      expect(e.message).toBe('Request failed');
    }
  });
});

// ===========================================================================
// 4. Request ID
// ===========================================================================

describe('Request ID parsing', () => {
  it('attaches x-request-id to error objects', async () => {
    const client = new Waterlight({ apiKey: 'k', maxRetries: 0 });
    mockFetch.mockResolvedValueOnce(
      errorResponse(401, { error: { message: 'bad key' } }, { 'x-request-id': 'req-xyz-123' }),
    );
    try {
      await client.chat.completions.create({ model: 'm', messages: [] });
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e.requestId).toBe('req-xyz-123');
    }
  });

  it('requestId is undefined when header absent', async () => {
    const client = new Waterlight({ apiKey: 'k', maxRetries: 0 });
    mockFetch.mockResolvedValueOnce(errorResponse(403, { error: 'Forbidden' }));
    try {
      await client.chat.completions.create({ model: 'm', messages: [] });
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e.requestId).toBeUndefined();
    }
  });
});

// ===========================================================================
// 5. Retry logic
// ===========================================================================

describe('Retry logic', () => {
  it('retries on 429 and then succeeds', async () => {
    const client = new Waterlight({ apiKey: 'k', maxRetries: 2 });
    // First call: 429, second call: 200
    mockFetch
      .mockResolvedValueOnce(errorResponse(429, { error: 'rate limited' }, { 'retry-after': '0.01' }))
      .mockResolvedValueOnce(jsonResponse(COMPLETION));

    const result = await client.chat.completions.create({
      model: 'm', messages: [{ role: 'user', content: 'x' }],
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.id).toBe('chatcmpl-abc');
  });

  it('retries on 500 and then succeeds', async () => {
    const client = new Waterlight({ apiKey: 'k', maxRetries: 2 });
    mockFetch
      .mockResolvedValueOnce(errorResponse(500, { error: 'server error' }))
      .mockResolvedValueOnce(jsonResponse(COMPLETION));

    const result = await client.chat.completions.create({
      model: 'm', messages: [{ role: 'user', content: 'x' }],
    });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.id).toBe('chatcmpl-abc');
  });

  it('retries on 502, 503, 504', async () => {
    const client = new Waterlight({ apiKey: 'k', maxRetries: 3 });
    mockFetch
      .mockResolvedValueOnce(errorResponse(502, {}))
      .mockResolvedValueOnce(errorResponse(503, {}))
      .mockResolvedValueOnce(errorResponse(504, {}))
      .mockResolvedValueOnce(jsonResponse(COMPLETION));

    const result = await client.chat.completions.create({
      model: 'm', messages: [{ role: 'user', content: 'x' }],
    });
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(result.id).toBe('chatcmpl-abc');
  });

  it('respects maxRetries limit and throws after exhaustion', async () => {
    const client = new Waterlight({ apiKey: 'k', maxRetries: 1 });
    mockFetch
      .mockResolvedValueOnce(errorResponse(500, { error: 'err1' }))
      .mockResolvedValueOnce(errorResponse(500, { error: { message: 'err2' } }));

    await expect(
      client.chat.completions.create({ model: 'm', messages: [] }),
    ).rejects.toThrow(APIError);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 401', async () => {
    const client = new Waterlight({ apiKey: 'k', maxRetries: 3 });
    mockFetch.mockResolvedValueOnce(
      errorResponse(401, { error: { message: 'bad key' } }),
    );

    await expect(
      client.chat.completions.create({ model: 'm', messages: [] }),
    ).rejects.toThrow(AuthenticationError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff timing', async () => {
    vi.useFakeTimers();
    const client = new Waterlight({ apiKey: 'k', maxRetries: 2 });

    mockFetch
      .mockResolvedValueOnce(errorResponse(500, { error: 'e' }))
      .mockResolvedValueOnce(errorResponse(500, { error: 'e' }))
      .mockResolvedValueOnce(jsonResponse(COMPLETION));

    const promise = client.chat.completions.create({
      model: 'm', messages: [{ role: 'user', content: 'x' }],
    });

    // First retry: 500 * 2^0 = 500ms
    await vi.advanceTimersByTimeAsync(500);
    // Second retry: 500 * 2^1 = 1000ms
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result.id).toBe('chatcmpl-abc');
    expect(mockFetch).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it('respects Retry-After header for backoff delay', async () => {
    vi.useFakeTimers();
    const client = new Waterlight({ apiKey: 'k', maxRetries: 1 });

    mockFetch
      .mockResolvedValueOnce(errorResponse(429, { error: 'rl' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse(COMPLETION));

    const promise = client.chat.completions.create({
      model: 'm', messages: [{ role: 'user', content: 'x' }],
    });

    // Retry-After: 2 seconds -> 2000ms delay
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;
    expect(result.id).toBe('chatcmpl-abc');

    vi.useRealTimers();
  });
});

// ===========================================================================
// 6. Timeout
// ===========================================================================

describe('Timeout', () => {
  it('fires AbortError -> APIError with status 408', async () => {
    const client = new Waterlight({ apiKey: 'k', timeout: 50 });

    mockFetch.mockImplementation((_url: string, init: RequestInit) => {
      // Return a promise that never resolves, but listen for abort
      return new Promise((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => {
          const err = new DOMException('The operation was aborted.', 'AbortError');
          reject(err);
        });
      });
    });

    try {
      await client.chat.completions.create({ model: 'm', messages: [] });
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(APIError);
      expect(e.message).toBe('Request timed out');
      expect(e.status).toBe(408);
    }
  });

  it('wraps generic network errors', async () => {
    const client = new Waterlight({ apiKey: 'k' });
    mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

    try {
      await client.chat.completions.create({ model: 'm', messages: [] });
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(APIError);
      expect(e.message).toContain('Network error');
      expect(e.status).toBe(0);
    }
  });
});

// ===========================================================================
// 7. Streaming
// ===========================================================================

describe('Streaming', () => {
  const CHUNK_1 = {
    id: 'chunk-1',
    object: 'chat.completion.chunk' as const,
    created: 1700000000,
    model: 'mist-1-turbo',
    choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
  };
  const CHUNK_2 = {
    id: 'chunk-2',
    object: 'chat.completion.chunk' as const,
    created: 1700000000,
    model: 'mist-1-turbo',
    choices: [{ index: 0, delta: { content: ' world' }, finish_reason: null }],
  };
  const CHUNK_DONE = {
    id: 'chunk-3',
    object: 'chat.completion.chunk' as const,
    created: 1700000000,
    model: 'mist-1-turbo',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  };

  it('parses SSE data lines and yields ChatCompletionChunks', async () => {
    const body = sseStream([
      `data: ${JSON.stringify(CHUNK_1)}\n\n`,
      `data: ${JSON.stringify(CHUNK_2)}\n\n`,
      `data: ${JSON.stringify(CHUNK_DONE)}\n\n`,
      `data: [DONE]\n\n`,
    ]);

    mockFetch.mockResolvedValueOnce(new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }));

    const client = new Waterlight({ apiKey: 'wl-key' });
    const stream = client.chat.completions.create({
      model: 'mist-1-turbo',
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    });

    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].choices[0].delta.content).toBe('Hello');
    expect(chunks[1].choices[0].delta.content).toBe(' world');
    expect(chunks[2].choices[0].finish_reason).toBe('stop');
  });

  it('terminates on [DONE] signal', async () => {
    const body = sseStream([
      `data: ${JSON.stringify(CHUNK_1)}\n\n`,
      `data: [DONE]\n\n`,
      // This chunk should never be yielded
      `data: ${JSON.stringify(CHUNK_2)}\n\n`,
    ]);

    mockFetch.mockResolvedValueOnce(new Response(body, { status: 200 }));

    const client = new Waterlight({ apiKey: 'k' });
    const stream = client.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
    });

    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(1);
  });

  it('skips malformed JSON chunks gracefully', async () => {
    const body = sseStream([
      `data: ${JSON.stringify(CHUNK_1)}\n\n`,
      `data: {invalid json\n\n`,
      `data: ${JSON.stringify(CHUNK_2)}\n\n`,
      `data: [DONE]\n\n`,
    ]);

    mockFetch.mockResolvedValueOnce(new Response(body, { status: 200 }));

    const client = new Waterlight({ apiKey: 'k' });
    const stream = client.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
    });

    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    // malformed chunk skipped, 2 valid chunks yielded
    expect(chunks).toHaveLength(2);
    expect(chunks[0].id).toBe('chunk-1');
    expect(chunks[1].id).toBe('chunk-2');
  });

  it('sends correct streaming headers', async () => {
    const body = sseStream([`data: [DONE]\n\n`]);
    mockFetch.mockResolvedValueOnce(new Response(body, { status: 200 }));

    const client = new Waterlight({ apiKey: 'wl-stream', baseUrl: 'https://api.test' });
    const stream = client.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
    });
    // Consume the stream to trigger the fetch
    for await (const _ of stream) { /* drain */ }

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers['Accept']).toBe('text/event-stream');
    expect(init.headers['Authorization']).toBe('Bearer wl-stream');
    expect(init.headers['User-Agent']).toBe('waterlight-node/0.2.1');
    const parsed = JSON.parse(init.body);
    expect(parsed.stream).toBe(true);
  });

  it('throws WaterlightError on non-OK streaming response', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Server Error', { status: 500 }));

    const client = new Waterlight({ apiKey: 'k' });
    const stream = client.chat.completions.create({
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
      stream: true,
    });

    await expect(async () => {
      for await (const _ of stream) { /* drain */ }
    }).rejects.toThrow(WaterlightError);
  });
});

// ===========================================================================
// 8. Error classes
// ===========================================================================

describe('Error classes', () => {
  it('WaterlightError is an Error', () => {
    const e = new WaterlightError('test');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(WaterlightError);
    expect(e.name).toBe('WaterlightError');
  });

  it('AuthenticationError extends WaterlightError with status 401', () => {
    const e = new AuthenticationError('bad key', 'req-1');
    expect(e).toBeInstanceOf(WaterlightError);
    expect(e).toBeInstanceOf(AuthenticationError);
    expect(e.name).toBe('AuthenticationError');
    expect(e.status).toBe(401);
    expect(e.requestId).toBe('req-1');
  });

  it('RateLimitError extends WaterlightError with status 429 and retryAfter', () => {
    const e = new RateLimitError('slow down', 30, 'req-2');
    expect(e).toBeInstanceOf(WaterlightError);
    expect(e.name).toBe('RateLimitError');
    expect(e.status).toBe(429);
    expect(e.retryAfter).toBe(30);
    expect(e.requestId).toBe('req-2');
  });

  it('InsufficientCreditsError extends WaterlightError with status 402', () => {
    const e = new InsufficientCreditsError('no credits', 'req-3');
    expect(e).toBeInstanceOf(WaterlightError);
    expect(e.name).toBe('InsufficientCreditsError');
    expect(e.status).toBe(402);
  });

  it('APIError extends WaterlightError with arbitrary status', () => {
    const e = new APIError('oops', 503, 'req-4');
    expect(e).toBeInstanceOf(WaterlightError);
    expect(e.name).toBe('APIError');
    expect(e.status).toBe(503);
    expect(e.requestId).toBe('req-4');
  });
});

// ===========================================================================
// 9. Other API namespaces (embeddings, models, billing)
// ===========================================================================

describe('Embeddings', () => {
  it('calls POST /v1/embeddings and returns response', async () => {
    const embeddingResp = {
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] }],
      model: 'mist-embed-1',
      usage: { prompt_tokens: 4, completion_tokens: 0, total_tokens: 4 },
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(embeddingResp));

    const client = new Waterlight({ apiKey: 'k' });
    const result = await client.embeddings.create({ input: 'hello world' });

    expect(result.data[0].embedding).toEqual([0.1, 0.2, 0.3]);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/v1/embeddings');
    expect(init.method).toBe('POST');
  });
});

describe('Models', () => {
  it('calls GET /v1/models and returns model list', async () => {
    const modelList = {
      object: 'list',
      data: [{ id: 'mist-1-turbo', object: 'model', created: 1700000000, owned_by: 'waterlight' }],
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(modelList));

    const client = new Waterlight({ apiKey: 'k' });
    const result = await client.models.list();

    expect(result.data[0].id).toBe('mist-1-turbo');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain('/v1/models');
    expect(init.method).toBe('GET');
    // GET requests should not have Content-Type
    expect(init.headers['Content-Type']).toBeUndefined();
  });
});

describe('Billing', () => {
  it('calls GET /v1/billing and returns billing info', async () => {
    const billingInfo = {
      plan: 'pro',
      billing_mode: 'prepaid',
      spent_usd: 12.50,
      total_requests: 1000,
      total_tokens: 500000,
      rpm_limit: 60,
      tpm_limit: 100000,
      balance_usd: 87.50,
    };
    mockFetch.mockResolvedValueOnce(jsonResponse(billingInfo));

    const client = new Waterlight({ apiKey: 'k' });
    const result = await client.billing.get();

    expect(result.plan).toBe('pro');
    expect(result.spent_usd).toBe(12.50);
    expect(result.balance_usd).toBe(87.50);
  });
});
