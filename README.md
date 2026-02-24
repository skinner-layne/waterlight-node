# Waterlight Node.js SDK

OpenAI-compatible TypeScript/JavaScript client for the [Waterlight API](https://waterlight.io). Zero dependencies — uses only the built-in `fetch` API.

## Install

```bash
npm install waterlight
```

## Quick Start

```typescript
import { Waterlight } from 'waterlight';

const client = new Waterlight({ apiKey: 'wl-...' });

const response = await client.chat.completions.create({
  model: 'mist-1-turbo',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(response.choices[0].message.content);
```

## Drop-in OpenAI Replacement

```typescript
// Before
import OpenAI from 'openai';
const client = new OpenAI({ apiKey: 'sk-...' });

// After
import { Waterlight } from 'waterlight';
const client = new Waterlight({ apiKey: 'wl-...' });

// Same API — no other code changes needed
const response = await client.chat.completions.create({
  model: 'mist-1-turbo',
  messages: [{ role: 'user', content: 'Hello!' }],
});
```

## Streaming

```typescript
const stream = client.chat.completions.create({
  model: 'mist-1-turbo',
  messages: [{ role: 'user', content: 'Tell me a story' }],
  stream: true,
});

for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
}
```

## Tool Calling

```typescript
const response = await client.chat.completions.create({
  model: 'mist-1-turbo',
  messages: [{ role: 'user', content: "What's the weather in Austin?" }],
  tools: [{
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string' },
        },
        required: ['location'],
      },
    },
  }],
});

if (response.choices[0].message.tool_calls) {
  for (const call of response.choices[0].message.tool_calls) {
    console.log(call);
  }
}
```

## Embeddings

```typescript
const result = await client.embeddings.create({
  input: 'Hello world',
});
console.log(result.data[0].embedding.length); // dimension count
```

## Models

```typescript
const models = await client.models.list();
for (const model of models.data) {
  console.log(model.id);
}
```

## Billing

```typescript
import { Waterlight, BillingInfo } from 'waterlight';

const billing: BillingInfo = await client.billing.get();
console.log(billing); // plan, spent_usd, balance, limits
```

## Error Handling

```typescript
import {
  Waterlight,
  AuthenticationError,
  RateLimitError,
  InsufficientCreditsError,
  APIError,
} from 'waterlight';

try {
  const response = await client.chat.completions.create({
    model: 'mist-1-turbo',
    messages: [{ role: 'user', content: 'Hello' }],
  });
} catch (e) {
  if (e instanceof AuthenticationError) {
    console.error('Invalid API key');
  } else if (e instanceof RateLimitError) {
    console.error('Rate limited');
  } else if (e instanceof InsufficientCreditsError) {
    console.error('Add credits at https://waterlight.io');
  } else if (e instanceof APIError) {
    console.error(`API error ${e.statusCode}: ${e.message}`);
  }
}
```

## Configuration

| Parameter | Env Var | Default |
|-----------|---------|---------|
| `apiKey` | `WATERLIGHT_API_KEY` | — (required) |
| `baseUrl` | `WATERLIGHT_BASE_URL` | `https://api.waterlight.io` |
| `timeout` | — | `120000` (ms) |
| `maxRetries` | — | `2` |

```typescript
// Using env var
process.env.WATERLIGHT_API_KEY = 'wl-...';
const client = new Waterlight(); // picks up from env

// Explicit
const client = new Waterlight({
  apiKey: 'wl-...',
  baseUrl: 'https://custom.endpoint.com',
  timeout: 60_000,      // 60s timeout
  maxRetries: 3,         // retry 429/5xx up to 3 times
});
```

## Requirements

- Node.js 18+ (uses built-in `fetch`)
- TypeScript 5+ (for type definitions)
- Zero runtime dependencies

## License

MIT
