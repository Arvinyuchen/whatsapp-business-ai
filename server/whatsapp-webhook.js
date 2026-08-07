import { createHmac, timingSafeEqual } from 'node:crypto';

function signaturesMatch(appSecret, rawBody, signature) {
  if (!appSecret || !signature?.startsWith('sha256=')) return false;

  const expected = Buffer.from(
    `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`
  );
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function normalizeEvents(payload) {
  const events = [];

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = new Map(
        (value.contacts || []).map((contact) => [contact.wa_id, contact])
      );

      for (const message of value.messages || []) {
        if (message.type !== 'text') continue;
        events.push({
          type: 'message.received',
          messageId: message.id,
          from: message.from,
          contactName: contacts.get(message.from)?.profile?.name || message.from,
          text: message.text?.body || '',
          timestamp: message.timestamp,
          phoneNumberId: value.metadata?.phone_number_id
        });
      }

      for (const status of value.statuses || []) {
        events.push({
          type: 'message.status',
          messageId: status.id,
          status: status.status,
          recipient: status.recipient_id,
          timestamp: status.timestamp,
          conversationId: status.conversation?.id,
          phoneNumberId: value.metadata?.phone_number_id
        });
      }
    }
  }

  return events;
}

export function createWhatsAppWebhook({ verifyToken, appSecret }) {
  const missing = [
    !verifyToken && 'WHATSAPP_VERIFY_TOKEN',
    !appSecret && 'META_APP_SECRET'
  ].filter(Boolean);

  return {
    getStatus() {
      return { configured: missing.length === 0, missing: [...missing] };
    },

    verifySubscription({ mode, token, challenge }) {
      const verified = Boolean(
        verifyToken && mode === 'subscribe' && token === verifyToken
      );

      return verified
        ? { verified: true, challenge }
        : { verified: false };
    },

    receive({ rawBody, signature }) {
      if (!signaturesMatch(appSecret, rawBody, signature)) {
        return { accepted: false, events: [] };
      }

      return {
        accepted: true,
        events: normalizeEvents(JSON.parse(rawBody.toString('utf8')))
      };
    }
  };
}
