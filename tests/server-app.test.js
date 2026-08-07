import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createApp } from '../server/app.js';
import { createMemoryWorkspaceStore } from '../server/workspace-store.js';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

test('status route combines client and webhook readiness safely', async () => {
  const app = createApp({
    whatsappClient: {
      getStatus: () => ({
        configured: false,
        graphVersion: 'v25.0',
        missing: ['WHATSAPP_ACCESS_TOKEN']
      })
    },
    whatsappWebhook: {
      getStatus: () => ({
        configured: false,
        missing: ['META_APP_SECRET']
      })
    }
  });

  const response = await app.handle(
    new Request('http://localhost/api/whatsapp/status')
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    configured: false,
    graphVersion: 'v25.0',
    missing: ['WHATSAPP_ACCESS_TOKEN', 'META_APP_SECRET'],
    webhookPath: '/webhooks/whatsapp',
    webhookUrl: null
  });
});

test('status route reports a configured public webhook without exposing secrets', async () => {
  const app = createApp({
    publicWebhookUrl: 'https://example.ts.net/webhooks/whatsapp',
    whatsappClient: {
      getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] })
    },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });

  const response = await app.handle(
    new Request('http://localhost/api/whatsapp/status')
  );

  assert.equal((await response.json()).webhookUrl, 'https://example.ts.net/webhooks/whatsapp');
});

test('webhook route returns a verified subscription challenge', async () => {
  const app = createApp({
    whatsappClient: { getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }) },
    whatsappWebhook: {
      getStatus: () => ({ configured: true, missing: [] }),
      verifySubscription: ({ mode, token, challenge }) => ({
        verified: mode === 'subscribe' && token === 'verify-token',
        challenge
      })
    }
  });

  const response = await app.handle(new Request(
    'http://localhost/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=abc123'
  ));

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'abc123');
});

test('signed webhook events are accepted and exposed to the operator inbox', async () => {
  const normalizedEvent = {
    type: 'message.received',
    messageId: 'wamid.inbound',
    from: '61400000000',
    text: 'Hello'
  };
  const app = createApp({
    adminToken: 'operator-secret',
    whatsappClient: { getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }) },
    whatsappWebhook: {
      getStatus: () => ({ configured: true, missing: [] }),
      receive: ({ signature }) => ({
        accepted: signature === 'sha256=valid',
        events: [normalizedEvent]
      })
    }
  });

  const webhookResponse = await app.handle(new Request(
    'http://localhost/webhooks/whatsapp',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-hub-signature-256': 'sha256=valid'
      },
      body: '{"object":"whatsapp_business_account"}'
    }
  ));
  const inboxResponse = await app.handle(
    new Request('http://localhost/api/whatsapp/events', {
      headers: { authorization: 'Bearer operator-secret' }
    })
  );

  assert.deepEqual(await webhookResponse.json(), {
    received: true,
    eventCount: 1,
    duplicateCount: 0
  });
  assert.deepEqual(await inboxResponse.json(), { events: [normalizedEvent] });
});

test('webhook retries are acknowledged once and deduplicated from the operator inbox', async () => {
  const normalizedEvent = {
    type: 'message.received',
    messageId: 'wamid.duplicate',
    from: '61400000000',
    text: 'Hello again'
  };
  const app = createApp({
    adminToken: 'operator-secret',
    whatsappClient: { getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }) },
    whatsappWebhook: {
      getStatus: () => ({ configured: true, missing: [] }),
      receive: () => ({ accepted: true, events: [normalizedEvent] })
    }
  });
  const webhookRequest = () => new Request('http://localhost/webhooks/whatsapp', {
    method: 'POST',
    body: '{}'
  });

  const firstResponse = await app.handle(webhookRequest());
  const retryResponse = await app.handle(webhookRequest());
  const inboxResponse = await app.handle(new Request('http://localhost/api/whatsapp/events', {
    headers: { authorization: 'Bearer operator-secret' }
  }));

  assert.deepEqual(await firstResponse.json(), {
    received: true,
    eventCount: 1,
    duplicateCount: 0
  });
  assert.deepEqual(await retryResponse.json(), {
    received: true,
    eventCount: 0,
    duplicateCount: 1
  });
  assert.deepEqual((await inboxResponse.json()).events, [normalizedEvent]);
});

test('webhook events reject unauthenticated operator access', async () => {
  const app = createApp({
    adminToken: 'operator-secret',
    whatsappClient: {
      getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] })
    },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });

  const response = await app.handle(
    new Request('http://localhost/api/whatsapp/events')
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Unauthorized' });
});

test('operator workspace exposes the shared live conversation projection', async () => {
  const workspaceStore = createMemoryWorkspaceStore();
  await workspaceStore.applyEvents([{
    type: 'message.received',
    messageId: 'wamid.workspace',
    from: '8619566373059',
    text: 'Is this shared?'
  }]);
  const app = createApp({
    adminToken: 'operator-secret',
    workspaceStore,
    whatsappClient: { getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }) },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });

  const response = await app.handle(new Request('http://localhost/api/workspace', {
    headers: { authorization: 'Bearer operator-secret' }
  }));
  const workspace = await response.json();

  assert.equal(response.status, 200);
  assert.equal(workspace.events.length, 1);
  assert.equal(workspace.conversations[0].id, 'whatsapp:8619566373059');
});

test('live reply is recorded once in the shared workspace with an idempotent retry', async () => {
  let sendCount = 0;
  const workspaceStore = createMemoryWorkspaceStore();
  await workspaceStore.applyEvents([{
    type: 'message.received',
    messageId: 'wamid.inbound.shared',
    from: '8619566373059',
    text: 'Can you help?'
  }]);
  const app = createApp({
    adminToken: 'operator-secret',
    workspaceStore,
    whatsappClient: {
      getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }),
      sendText: async () => {
        sendCount += 1;
        return { messageId: 'wamid.outbound.shared' };
      }
    },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });
  const request = () => new Request('http://localhost/api/whatsapp/messages', {
    method: 'POST',
    headers: {
      authorization: 'Bearer operator-secret',
      'content-type': 'application/json',
      'idempotency-key': 'shared-reply-request'
    },
    body: JSON.stringify({
      conversationId: 'whatsapp:8619566373059',
      to: '8619566373059',
      body: 'Yes, I can help.'
    })
  });

  const first = await app.handle(request());
  const retry = await app.handle(request());
  const firstPayload = await first.json();
  const retryPayload = await retry.json();
  const workspace = await workspaceStore.getWorkspace();

  assert.equal(first.status, 201);
  assert.equal(retry.status, 201);
  assert.equal(firstPayload.conversation.workflow, 'resolved');
  assert.deepEqual(retryPayload, firstPayload);
  assert.equal(sendCount, 1);
  assert.equal(workspace.conversations[0].messages.filter(([sender]) => sender === 'agent').length, 1);
});

test('operator actions update live conversations on the server', async () => {
  const workspaceStore = createMemoryWorkspaceStore();
  await workspaceStore.applyEvents([{
    type: 'message.received',
    messageId: 'wamid.action',
    from: '8619566373059',
    text: 'Please follow up later.'
  }]);
  const app = createApp({
    adminToken: 'operator-secret',
    workspaceStore,
    whatsappClient: { getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }) },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });

  const response = await app.handle(new Request(
    'http://localhost/api/conversations/whatsapp%3A8619566373059/actions',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer operator-secret',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ action: 'defer' })
    }
  ));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).conversation.workflow, 'deferred');
});

test('operator can generate a draft for a server-owned live conversation', async () => {
  const workspaceStore = createMemoryWorkspaceStore();
  await workspaceStore.applyEvents([{
    type: 'message.received',
    messageId: 'wamid.draft',
    from: '8619566373059',
    text: 'Do you have this in stock?'
  }]);
  let generationInput;
  const app = createApp({
    adminToken: 'operator-secret',
    workspaceStore,
    replyGenerator: {
      getStatus: () => ({ configured: true, provider: 'test', model: 'test-model' }),
      generate: async (input) => {
        generationInput = input;
        return { body: 'I will check availability.', provider: 'test', model: 'test-model' };
      }
    },
    whatsappClient: { getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }) },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });

  const response = await app.handle(new Request(
    'http://localhost/api/conversations/whatsapp%3A8619566373059/draft',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer operator-secret',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ tone: 'helpful' })
    }
  ));

  assert.equal(response.status, 200);
  assert.equal((await response.json()).draft.body, 'I will check availability.');
  assert.equal(generationInput.conversation.id, 'whatsapp:8619566373059');
  assert.equal(generationInput.tone, 'helpful');
});

test('AI status reports local fallback without exposing API credentials', async () => {
  const app = createApp({
    adminToken: 'operator-secret',
    whatsappClient: { getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }) },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });

  const response = await app.handle(new Request('http://localhost/api/ai/status', {
    headers: { authorization: 'Bearer operator-secret' }
  }));

  assert.deepEqual(await response.json(), { configured: false, provider: 'local', model: null });
});

test('operator can list WhatsApp message templates', async () => {
  const templates = [
    {
      id: 'template-1',
      name: 'arvin_greeting',
      status: 'APPROVED',
      language: 'en_US',
      category: 'MARKETING',
      body: 'Hi, this is Arvin from Nika Flame.'
    }
  ];
  const app = createApp({
    adminToken: 'operator-secret',
    whatsappClient: {
      getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }),
      listTemplates: async () => templates
    },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });

  const response = await app.handle(new Request(
    'http://localhost/api/whatsapp/templates',
    { headers: { authorization: 'Bearer operator-secret' } }
  ));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { templates });
});

test('message route sends through the configured WhatsApp client', async () => {
  const whatsappClient = {
    getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }),
    sendText: async ({ to, body }) => ({
      messageId: `${to}:${body}`
    })
  };
  const app = createApp({
    adminToken: 'operator-secret',
    whatsappClient,
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });

  const response = await app.handle(new Request(
    'http://localhost/api/whatsapp/messages',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer operator-secret',
        'content-type': 'application/json',
        'idempotency-key': 'message-request-1'
      },
      body: JSON.stringify({ to: '61400000000', body: 'Your order is ready.' })
    }
  ));

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    sent: true,
    messageId: '61400000000:Your order is ready.'
  });
});

test('message route reuses an idempotent send result', async () => {
  let sendCount = 0;
  const app = createApp({
    adminToken: 'operator-secret',
    whatsappClient: {
      getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }),
      sendText: async () => {
        sendCount += 1;
        return { messageId: 'wamid.once' };
      }
    },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });
  const request = () => new Request('http://localhost/api/whatsapp/messages', {
    method: 'POST',
    headers: {
      authorization: 'Bearer operator-secret',
      'content-type': 'application/json',
      'idempotency-key': 'message-request-retry'
    },
    body: JSON.stringify({ to: '61400000000', body: 'Only send once.' })
  });

  const firstResponse = await app.handle(request());
  const retryResponse = await app.handle(request());

  assert.equal(firstResponse.status, 201);
  assert.equal(retryResponse.status, 201);
  assert.deepEqual(await retryResponse.json(), { sent: true, messageId: 'wamid.once' });
  assert.equal(sendCount, 1);
});

test('message route requires an idempotency key before sending', async () => {
  let sendCount = 0;
  const app = createApp({
    adminToken: 'operator-secret',
    whatsappClient: {
      getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }),
      sendText: async () => { sendCount += 1; }
    },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });

  const response = await app.handle(new Request('http://localhost/api/whatsapp/messages', {
    method: 'POST',
    headers: {
      authorization: 'Bearer operator-secret',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ to: '61400000000', body: 'Do not send.' })
  }));

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Idempotency-Key/i);
  assert.equal(sendCount, 0);
});

test('message route rejects malformed JSON as a client error', async () => {
  const app = createApp({
    adminToken: 'operator-secret',
    whatsappClient: {
      getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }),
      sendText: async () => assert.fail('send should not run')
    },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });

  const response = await app.handle(new Request('http://localhost/api/whatsapp/messages', {
    method: 'POST',
    headers: {
      authorization: 'Bearer operator-secret',
      'content-type': 'application/json',
      'idempotency-key': 'malformed-request'
    },
    body: '{'
  }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Request body must be valid JSON.' });
});

test('message route sends an approved WhatsApp template', async () => {
  const app = createApp({
    adminToken: 'operator-secret',
    whatsappClient: {
      getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }),
      sendTemplate: async ({ to, name, language }) => ({
        messageId: `${to}:${name}:${language}`
      })
    },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });

  const response = await app.handle(new Request(
    'http://localhost/api/whatsapp/messages',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer operator-secret',
        'content-type': 'application/json',
        'idempotency-key': 'template-request-1'
      },
      body: JSON.stringify({
        to: '61400000000',
        type: 'template',
        template: { name: 'arvin_greeting', language: 'en_US' }
      })
    }
  ));

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    sent: true,
    messageId: '61400000000:arvin_greeting:en_US'
  });
});

test('message route stays unavailable until an admin token is configured', async () => {
  const app = createApp({
    whatsappClient: {
      getStatus: () => ({ configured: true, graphVersion: 'v25.0', missing: [] }),
      sendText: async () => ({ messageId: 'must-not-send' })
    },
    whatsappWebhook: { getStatus: () => ({ configured: true, missing: [] }) }
  });

  const response = await app.handle(new Request(
    'http://localhost/api/whatsapp/messages',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: '61400000000', body: 'Do not send this.' })
    }
  ));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'Operator API is not configured.'
  });
});

test('app serves the dashboard from the project root', async () => {
  const app = createApp({
    staticRoot: projectRoot,
    whatsappClient: { getStatus: () => ({ configured: false, graphVersion: 'v25.0', missing: [] }) },
    whatsappWebhook: { getStatus: () => ({ configured: false, missing: [] }) }
  });

  const response = await app.handle(new Request('http://localhost/'));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  const body = await response.text();
  assert.match(body, /Review what the AI wants to send/i);
  assert.match(body, /This dashboard needs the local server/i);
});
