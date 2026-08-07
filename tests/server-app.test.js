import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { createApp } from '../server/app.js';

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

  assert.deepEqual(await webhookResponse.json(), { received: true, eventCount: 1 });
  assert.deepEqual(await inboxResponse.json(), { events: [normalizedEvent] });
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
        'content-type': 'application/json'
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
        'content-type': 'application/json'
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
  assert.match(await response.text(), /Review what the AI wants to send/i);
});
