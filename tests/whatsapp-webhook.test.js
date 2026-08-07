import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';

import { createWhatsAppWebhook } from '../server/whatsapp-webhook.js';

test('webhook confirms a valid Meta subscription challenge', () => {
  const webhook = createWhatsAppWebhook({
    verifyToken: 'local-verify-token',
    appSecret: 'app-secret'
  });

  const result = webhook.verifySubscription({
    mode: 'subscribe',
    token: 'local-verify-token',
    challenge: 'challenge-123'
  });

  assert.deepEqual(result, { verified: true, challenge: 'challenge-123' });
});

test('webhook accepts a signed inbound text message as a normalized event', () => {
  const appSecret = 'app-secret';
  const webhook = createWhatsAppWebhook({
    verifyToken: 'local-verify-token',
    appSecret
  });
  const rawBody = Buffer.from(JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-123',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { phone_number_id: 'phone-123' },
          contacts: [{ wa_id: '61400000000', profile: { name: 'Maria Chen' } }],
          messages: [{
            from: '61400000000',
            id: 'wamid.inbound',
            timestamp: '1785900000',
            type: 'text',
            text: { body: 'Do you have 80 cartons in stock?' }
          }]
        }
      }]
    }]
  }));
  const signature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

  const result = webhook.receive({ rawBody, signature });

  assert.deepEqual(result, {
    accepted: true,
    events: [{
      type: 'message.received',
      messageId: 'wamid.inbound',
      from: '61400000000',
      contactName: 'Maria Chen',
      text: 'Do you have 80 cartons in stock?',
      timestamp: '1785900000',
      phoneNumberId: 'phone-123'
    }]
  });
});

test('webhook normalizes outbound delivery status updates', () => {
  const appSecret = 'app-secret';
  const webhook = createWhatsAppWebhook({ verifyToken: 'verify', appSecret });
  const rawBody = Buffer.from(JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'phone-123' },
          statuses: [{
            id: 'wamid.outbound',
            status: 'delivered',
            timestamp: '1785900100',
            recipient_id: '61400000000',
            conversation: { id: 'conversation-123' }
          }]
        }
      }]
    }]
  }));
  const signature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

  const result = webhook.receive({ rawBody, signature });

  assert.deepEqual(result.events, [{
    type: 'message.status',
    messageId: 'wamid.outbound',
    status: 'delivered',
    recipient: '61400000000',
    timestamp: '1785900100',
    conversationId: 'conversation-123',
    phoneNumberId: 'phone-123'
  }]);
});

test('webhook reports missing secure configuration without exposing values', () => {
  const webhook = createWhatsAppWebhook({ verifyToken: '', appSecret: '' });

  assert.deepEqual(webhook.getStatus(), {
    configured: false,
    missing: ['WHATSAPP_VERIFY_TOKEN', 'META_APP_SECRET']
  });
});

test('webhook rejects payloads with an invalid signature', () => {
  const webhook = createWhatsAppWebhook({
    verifyToken: 'verify',
    appSecret: 'app-secret'
  });

  const result = webhook.receive({
    rawBody: Buffer.from('{"object":"whatsapp_business_account"}'),
    signature: 'sha256=invalid'
  });

  assert.deepEqual(result, { accepted: false, events: [] });
});
