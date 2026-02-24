import type { ChatCompletionChunk } from './types';
import { APIError, WaterlightError } from './errors';

const MAX_SSE_BUFFER = 10 * 1024 * 1024; // 10 MB

/**
 * SSE stream that implements AsyncIterable<ChatCompletionChunk>.
 *
 * Usage:
 *   const stream = client.chat.completions.create({ ..., stream: true });
 *   for await (const chunk of stream) {
 *     process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
 *   }
 */
export class Stream implements AsyncIterable<ChatCompletionChunk> {
  private readonly url: string;
  private readonly apiKey: string;
  private readonly body: string;
  private readonly timeout: number;

  constructor(url: string, apiKey: string, params: object, timeout: number = 120_000) {
    this.url = url;
    this.apiKey = apiKey;
    this.body = JSON.stringify({ ...params, stream: true });
    this.timeout = timeout;
  }

  async *[Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    let res: Response;
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'User-Agent': 'waterlight-node/0.2.1',
        },
        body: this.body,
        signal: controller.signal,
      });
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === 'AbortError') throw new APIError('Stream request timed out', 408);
      throw new APIError(`Network error: ${e?.message ?? e}`, 0);
    }

    if (!res.ok) {
      let errMsg = '';
      try { errMsg = await res.text(); } catch {}
      throw new WaterlightError(`Streaming error: ${res.status} ${errMsg}`, res.status);
    }

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > MAX_SSE_BUFFER) {
          throw new APIError('SSE buffer overflow: server sent too much data without delimiters', 0);
        }

        // Process complete SSE events (double newline delimited)
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);

          for (const line of rawEvent.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (data === '[DONE]') return;
            try {
              yield JSON.parse(data) as ChatCompletionChunk;
            } catch {
              // skip malformed chunks
            }
          }
        }
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
  }
}
