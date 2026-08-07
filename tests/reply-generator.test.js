import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLocalReplyGenerator,
  createOpenAIReplyGenerator,
  createReplyGenerator
} from '../server/reply-generator.js';

const conversation = {
  intent: 'Order question',
  risk: 'Stock has not been checked',
  messages: [['customer', 'Do you have the blue version in stock?']],
  replies: { helpful: 'Thanks. I will check that for you.' }
};

test('local reply generator provides a deterministic no-key fallback', async () => {
  const generator = createReplyGenerator({});

  assert.deepEqual(generator.getStatus(), { configured: false, provider: 'local', model: null });
  assert.deepEqual(await generator.generate({ conversation, tone: 'helpful' }), {
    body: 'Thanks. I will check that for you.',
    provider: 'local',
    model: null
  });
  assert.deepEqual(createLocalReplyGenerator().getStatus(), generator.getStatus());
});

test('OpenAI adapter uses Responses with bounded untrusted transcript data', async () => {
  let request;
  const generator = createOpenAIReplyGenerator({
    apiKey: 'openai-secret',
    model: 'gpt-5.6-terra',
    fetchAdapter: async (...args) => {
      request = args;
      return Response.json({
        model: 'gpt-5.6-terra-2026-08-01',
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'I can check the blue version for you.' }]
        }]
      });
    }
  });

  const result = await generator.generate({ conversation, tone: 'helpful' });
  const payload = JSON.parse(request[1].body);

  assert.equal(request[0], 'https://api.openai.com/v1/responses');
  assert.equal(request[1].headers.authorization, 'Bearer openai-secret');
  assert.equal(payload.model, 'gpt-5.6-terra');
  assert.equal(payload.store, false);
  assert.deepEqual(payload.reasoning, { effort: 'none' });
  assert.match(payload.instructions, /untrusted data/i);
  assert.match(payload.input, /blue version/);
  assert.deepEqual(result, {
    body: 'I can check the blue version for you.',
    provider: 'openai',
    model: 'gpt-5.6-terra-2026-08-01'
  });
});

test('OpenAI adapter does not expose provider errors to operators', async () => {
  const generator = createOpenAIReplyGenerator({
    apiKey: 'openai-secret',
    fetchAdapter: async () => Response.json({
      error: { message: 'sensitive provider detail' }
    }, { status: 429 })
  });

  await assert.rejects(
    generator.generate({ conversation, tone: 'helpful' }),
    /temporarily unavailable/i
  );
});

test('OpenAI adapter rejects empty model output', async () => {
  const generator = createOpenAIReplyGenerator({
    apiKey: 'openai-secret',
    fetchAdapter: async () => Response.json({ output: [] })
  });

  await assert.rejects(generator.generate({ conversation }), /empty draft/i);
});
