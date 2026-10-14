# AI Integration Patterns (Vercel AI SDK)

> **Skill:** react-web | **Stack:** Vercel AI SDK, Next.js 15, React 19

## Setup

```bash
npm install ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/google
```

## Streaming Chat UI

```ts
// app/api/chat/route.ts
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-4o'),
    system: 'You are a helpful assistant. Be concise.',
    messages,
  });

  return result.toDataStreamResponse();
}
```

```tsx
// app/chat/page.tsx
'use client';

import { useChat } from 'ai/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function ChatPage() {
  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: '/api/chat',
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto">
      <ScrollArea className="flex-1 p-4">
        {messages.map(m => (
          <div
            key={m.id}
            className={`mb-4 p-4 rounded-lg ${
              m.role === 'user'
                ? 'bg-primary text-primary-foreground ml-12'
                : 'bg-muted mr-12'
            }`}
          >
            <p className="whitespace-pre-wrap">{m.content}</p>
          </div>
        ))}
        {isLoading && (
          <div className="bg-muted mr-12 p-4 rounded-lg">
            <span className="animate-pulse">Thinking...</span>
          </div>
        )}
      </ScrollArea>

      <form onSubmit={handleSubmit} className="p-4 border-t flex gap-2">
        <Input
          value={input}
          onChange={handleInputChange}
          placeholder="Type a message..."
          disabled={isLoading}
        />
        <Button type="submit" disabled={isLoading || !input.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}
```

## Tool Calling (Function Calling)

```ts
// app/api/chat/route.ts
import { openai } from '@ai-sdk/openai';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { db } from '@/lib/db';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: openai('gpt-4o'),
    messages,
    tools: {
      searchProducts: tool({
        description: 'Search the product catalog',
        parameters: z.object({
          query: z.string().describe('Search query'),
          category: z.enum(['electronics', 'clothing', 'books']).optional(),
          maxPrice: z.number().optional(),
        }),
        execute: async ({ query, category, maxPrice }) => {
          const products = await db.product.findMany({
            where: {
              name: { contains: query },
              ...(category && { category }),
              ...(maxPrice && { price: { lte: maxPrice } }),
            },
            take: 5,
          });
          return products.map(p => ({ id: p.id, name: p.name, price: p.price }));
        },
      }),
      createOrder: tool({
        description: 'Create a new order',
        parameters: z.object({
          items: z.array(z.object({
            productId: z.string(),
            quantity: z.number().min(1).max(10),
          })),
          email: z.string().email(),
        }),
        execute: async ({ items, email }) => {
          const user = await db.user.findUnique({ where: { email } });
          if (!user) return { error: 'User not found. Please create an account first.' };

          const order = await db.order.create({
            data: {
              userId: user.id,
              items: { create: items },
            },
          });
          return { orderId: order.id, status: 'confirmed' };
        },
      }),
    },
  });

  return result.toDataStreamResponse();
}
```

## Structured Output (Generate Object)

```ts
// app/actions/analyze.ts
'use server';

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

const analysisSchema = z.object({
  sentiment: z.enum(['positive', 'negative', 'neutral']),
  topics: z.array(z.string()),
  summary: z.string().max(200),
  actionItems: z.array(z.object({
    description: z.string(),
    priority: z.enum(['high', 'medium', 'low']),
  })).max(5),
  score: z.number().min(0).max(100),
});

export async function analyzeFeedback(text: string) {
  const { object } = await generateObject({
    model: openai('gpt-4o'),
    schema: analysisSchema,
    prompt: `Analyze this customer feedback:\n\n${text}`,
    temperature: 0.1, // Low temp for structured output
  });

  return object;
}
```

## RAG (Retrieval-Augmented Generation) Patterns

```ts
// app/api/rag/route.ts
import { openai } from '@ai-sdk/openai';
import { streamText, embed } from 'ai';

// 1. Embed documents (run once at build time or via background job)
async function embedDocuments(docs: { id: string; content: string }[]) {
  const { embedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: docs.map(d => d.content).join('\n\n'),
  });
  return embedding;
}

// 2. At query time: find relevant docs, inject into prompt
export async function POST(req: Request) {
  const { query, messages } = await req.json();

  // Embed the query
  const { embedding: queryEmbedding } = await embed({
    model: openai.embedding('text-embedding-3-small'),
    value: query,
  });

  // Vector search (pgvector, Pinecone, etc.)
  const relevantDocs = await db.$queryRaw`
    SELECT id, content, 1 - (embedding <=> ${queryEmbedding}::vector) AS similarity
    FROM documents
    ORDER BY similarity DESC
    LIMIT 5
  `;

  // Inject context into system prompt
  const context = (relevantDocs as any[]).map(d => d.content).join('\n\n---\n\n');

  const result = streamText({
    model: openai('gpt-4o'),
    system: `Answer questions using the following context. If the answer isn't in the context, say you don't know.\n\nContext:\n${context}`,
    messages,
  });

  return result.toDataStreamResponse();
}
```

## Prompt Management

```ts
// lib/prompts.ts
export const prompts = {
  summarize: `You are a summarization expert. Create a concise summary that:
- Captures the main point in one sentence
- Lists key takeaways as bullet points
- Is under 150 words total
- Uses professional but accessible language`,

  codeReview: `You are a senior code reviewer. Review the following code for:
1. Bugs and edge cases
2. Performance issues
3. Security vulnerabilities
4. Adherence to TypeScript best practices
5. Opportunities for simplification

Format your response with clear sections and severity levels (🔴 critical, 🟡 warning, 🔵 suggestion).`,

  translateToSQL: `Convert the following natural language query to SQL.
Database schema:
${dbSchema}

Rules:
- Use PostgreSQL syntax
- Add appropriate indexes in comments
- Handle NULL cases
- Only output the SQL, no explanation`,
};

// Usage
import { prompts } from '@/lib/prompts';
import { streamText } from 'ai';

const result = streamText({
  model: openai('gpt-4o'),
  system: prompts.codeReview,
  messages: [{ role: 'user', content: code }],
});
```

## Multi-Step Agent Pattern

```ts
// app/actions/agent.ts
'use server';

import { generateText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

export async function runResearchAgent(topic: string) {
  const maxSteps = 5;
  let step = 0;
  let findings: string[] = [];

  const result = await generateText({
    model: openai('gpt-4o'),
    system: 'You are a research agent. Gather information, then synthesize a report.',
    prompt: topic,
    maxSteps,
    tools: {
      search: tool({
        description: 'Search the web for information',
        parameters: z.object({ query: z.string() }),
        execute: async ({ query }) => {
          const results = await webSearch(query);
          findings.push(`Search "${query}": ${results}`);
          return results;
        },
      }),
      analyze: tool({
        description: 'Analyze collected findings',
        parameters: z.object({ insight: z.string() }),
        execute: async ({ insight }) => {
          findings.push(`Analysis: ${insight}`);
          return 'Analysis recorded';
        },
      }),
      finalReport: tool({
        description: 'Generate the final report',
        parameters: z.object({
          summary: z.string(),
          keyFindings: z.array(z.string()),
          recommendations: z.array(z.string()),
        }),
        execute: async (report) => {
          return { ...report, researchSteps: step };
        },
      }),
    },
  });

  return { text: result.text, findings, steps: step };
}
```

## Gotchas

1. **Streaming requires Edge or Node.js runtime** — the `streamText` response uses `ReadableStream`. Works on both but verify your deployment target.
2. **Tool execution happens on your server** — tool code runs in your Next.js route handler. Keep it fast (sub-second) to avoid timeout.
3. **Don't expose secrets in prompts** — system prompts are visible in the route handler, not the client, but don't hardcode API keys.
4. **Rate limiting is your responsibility** — Vercel AI SDK doesn't include rate limiting. Add `@upstash/ratelimit` or similar.
5. **Token costs** — `streamText` streams tokens one at a time. Users pay per token even if they cancel early. Set `maxTokens` to cap costs.
6. **`generateObject` is non-streaming** — the entire structured output arrives at once. For streaming structured data, use `streamObject` instead.
