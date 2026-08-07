import assert from 'node:assert/strict';
import test from 'node:test';

import { createWhatsAppClient } from '../server/whatsapp-client.js';

test('configured client sends a text message through the Meta adapter', async () => {
  let request;
  const fetchAdapter = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ messages: [{ id: 'wamid.123' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const client = createWhatsAppClient({
    accessToken: 'test-token',
    phoneNumberId: '123456',
    graphVersion: 'v25.0',
    fetchAdapter
  });

  const result = await client.sendText({
    to: '61400000000',
    body: 'Your order is ready.'
  });

  assert.deepEqual(result, { messageId: 'wamid.123' });
  assert.equal(request.url, 'https://graph.facebook.com/v25.0/123456/messages');
  assert.deepEqual(JSON.parse(request.options.body), {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '61400000000',
    type: 'text',
    text: { body: 'Your order is ready.', preview_url: false }
  });
});

test('configured client lists message templates as operator-ready records', async () => {
  let requestUrl;
  const client = createWhatsAppClient({
    accessToken: 'test-token',
    phoneNumberId: '123456',
    whatsappBusinessAccountId: '654321',
    graphVersion: 'v25.0',
    fetchAdapter: async (url) => {
      requestUrl = url;
      return Response.json({
        data: [
          {
            id: 'template-1',
            name: 'arvin_greeting',
            status: 'APPROVED',
            language: 'en_US',
            category: 'MARKETING',
            components: [
              { type: 'BODY', text: 'Hi, this is Arvin from Nika Flame.' }
            ]
          }
        ]
      });
    }
  });

  const templates = await client.listTemplates();

  assert.equal(
    requestUrl,
    'https://graph.facebook.com/v25.0/654321/message_templates?fields=id,name,status,language,category,components&limit=100'
  );
  assert.deepEqual(templates, [
    {
      id: 'template-1',
      name: 'arvin_greeting',
      status: 'APPROVED',
      language: 'en_US',
      category: 'MARKETING',
      body: 'Hi, this is Arvin from Nika Flame.'
    }
  ]);
});

test('configured client sends an approved message template', async () => {
  let request;
  const client = createWhatsAppClient({
    accessToken: 'test-token',
    phoneNumberId: '123456',
    fetchAdapter: async (url, options) => {
      request = { url, options };
      return Response.json({ messages: [{ id: 'wamid.template' }] });
    }
  });

  const result = await client.sendTemplate({
    to: '61400000000',
    name: 'arvin_greeting',
    language: 'en_US'
  });

  assert.deepEqual(result, { messageId: 'wamid.template' });
  assert.deepEqual(JSON.parse(request.options.body), {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '61400000000',
    type: 'template',
    template: {
      name: 'arvin_greeting',
      language: { code: 'en_US' }
    }
  });
});

test('unconfigured client refuses to send', async () => {
  const client = createWhatsAppClient({
    accessToken: '',
    phoneNumberId: '',
    fetchAdapter: () => {
      throw new Error('fetch should not run');
    }
  });

  await assert.rejects(
    client.sendText({ to: '61400000000', body: 'Hello' }),
    /not configured/i
  );
});

test('client reports configuration readiness without exposing secrets', () => {
  const client = createWhatsAppClient({
    accessToken: '',
    phoneNumberId: '123456',
    graphVersion: 'v25.0'
  });

  assert.deepEqual(client.getStatus(), {
    configured: false,
    graphVersion: 'v25.0',
    missing: ['WHATSAPP_ACCESS_TOKEN']
  });
});

test('client surfaces a safe Meta error when sending fails', async () => {
  const client = createWhatsAppClient({
    accessToken: 'secret-token',
    phoneNumberId: '123456',
    fetchAdapter: async () =>
      new Response(JSON.stringify({ error: { message: 'Recipient is invalid' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
  });

  await assert.rejects(
    client.sendText({ to: 'invalid', body: 'Hello' }),
    /recipient is invalid/i
  );
});
