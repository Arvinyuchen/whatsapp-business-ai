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
    model: null,
    confidence: 0,
    requiresHuman: true
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
          content: [{
            type: 'output_text',
            text: JSON.stringify({
              body: 'I can check the blue version for you.',
              confidence: 0.94,
              requiresHuman: false
            })
          }]
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
  assert.equal(payload.text.format.type, 'json_schema');
  assert.match(payload.instructions, /untrusted data/i);
  assert.match(payload.input, /blue version/);
  assert.deepEqual(result, {
    body: 'I can check the blue version for you.',
    provider: 'openai',
    model: 'gpt-5.6-terra-2026-08-01',
    confidence: 0.94,
    requiresHuman: false
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

test('enabled local acknowledgement safely covers an OpenAI outage', async () => {
  const generator = createReplyGenerator({
    apiKey: 'openai-secret',
    model: 'gpt-5.6-terra',
    acknowledgementFallbackEnabled: true,
    fetchAdapter: async () => Response.json({
      error: { code: 'credit_balance_exhausted' }
    }, { status: 429 })
  });

  assert.deepEqual(generator.getStatus(), {
    configured: true,
    provider: 'openai',
    model: 'gpt-5.6-terra',
    fallback: 'local_acknowledgement'
  });
  assert.deepEqual(await generator.generate({ conversation, tone: 'helpful' }), {
    body: 'Thanks for contacting Nika Flame. We received your message and a team member will reply shortly.',
    provider: 'local_acknowledgement',
    model: null,
    confidence: 1,
    requiresHuman: false
  });
});

test('enabled local acknowledgement works without an OpenAI key', async () => {
  const generator = createReplyGenerator({ acknowledgementFallbackEnabled: true });

  assert.deepEqual(await generator.generate({ conversation }), {
    body: 'Thanks for contacting Nika Flame. We received your message and a team member will reply shortly.',
    provider: 'local_acknowledgement',
    model: null,
    confidence: 1,
    requiresHuman: false
  });
});

test('OpenAI adapter rejects empty model output', async () => {
  const generator = createOpenAIReplyGenerator({
    apiKey: 'openai-secret',
    fetchAdapter: async () => Response.json({ output: [] })
  });

  await assert.rejects(generator.generate({ conversation }), /invalid draft/i);
});
