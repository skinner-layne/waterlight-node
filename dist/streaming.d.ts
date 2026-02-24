import type { ChatCompletionChunk } from './types';
/**
 * SSE stream that implements AsyncIterable<ChatCompletionChunk>.
 *
 * Usage:
 *   const stream = client.chat.completions.create({ ..., stream: true });
 *   for await (const chunk of stream) {
 *     process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
 *   }
 */
export declare class Stream implements AsyncIterable<ChatCompletionChunk> {
    private readonly url;
    private readonly apiKey;
    private readonly body;
    private readonly timeout;
    constructor(url: string, apiKey: string, params: object, timeout?: number);
    [Symbol.asyncIterator](): AsyncIterator<ChatCompletionChunk>;
}
