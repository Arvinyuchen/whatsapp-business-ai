import assert from 'node:assert/strict';
import test from 'node:test';

import { sendWhatsAppReply } from '../src/whatsapp-reply.js';

test('live replies use the authenticated WhatsApp message boundary', async () => {
  let request;
  const result = await sendWhatsAppReply({
    token: 'operator-secret',
    to: '8619566373059',
    body: '  Thanks, I can help with that.  ',
    fetchImpl: async (...args) => {
      request = args;
      return Response.json({ sent: true, messageId: 'wamid.sent' }, { status: 201 });
    }
  });

  assert.deepEqual(result, { messageId: 'wamid.sent' });
  assert.equal(request[0], '/api/whatsapp/messages');
  assert.equal(request[1].method, 'POST');
  assert.equal(request[1].headers.authorization, 'Bearer operator-secret');
  assert.deepEqual(JSON.parse(request[1].body), {
    to: '8619566373059',
    body: 'Thanks, I can help with that.'
  });
});

test('live replies require operator access, a valid recipient, and a non-empty body', async () => {
  const unusedFetch = () => assert.fail('fetch should not be called');

  await assert.rejects(
    sendWhatsAppReply({ token: '', to: '8619566373059', body: 'Hello', fetchImpl: unusedFetch }),
    /load the live workspace/i
  );
  await assert.rejects(
    sendWhatsAppReply({ token: 'token', to: 'invalid', body: 'Hello', fetchImpl: unusedFetch }),
    /invalid WhatsApp recipient/i
  );
  await assert.rejects(
    sendWhatsAppReply({ token: 'token', to: '8619566373059', body: '   ', fetchImpl: unusedFetch }),
    /reply cannot be empty/i
  );
});

test('live reply failures surface the safe server error', async () => {
  await assert.rejects(
    sendWhatsAppReply({
      token: 'token',
      to: '8619566373059',
      body: 'Hello',
      fetchImpl: async () => Response.json({ error: 'Meta rejected this message.' }, { status: 502 })
    }),
    /Meta rejected this message/i
  );
});
