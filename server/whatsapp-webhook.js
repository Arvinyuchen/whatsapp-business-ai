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
      const contacts = value.contacts || [];

      for (const message of value.messages || []) {
        if (message.type !== 'text') continue;
        const contact = contacts.find((candidate) => (
          (message.from && candidate.wa_id === message.from)
          || (message.from_user_id && candidate.user_id === message.from_user_id)
          || (message.from_parent_user_id
            && candidate.parent_user_id === message.from_parent_user_id)
        ));
        const phoneNumber = message.from || contact?.wa_id;
        const userId = message.from_user_id || contact?.user_id;
        const parentUserId = message.from_parent_user_id || contact?.parent_user_id;
        const username = contact?.profile?.username;
        const from = userId || phoneNumber || parentUserId;
        events.push({
          type: 'message.received',
          messageId: message.id,
          from,
          ...(phoneNumber && from !== phoneNumber ? { phoneNumber } : {}),
          ...(userId ? { userId } : {}),
          ...(parentUserId ? { parentUserId } : {}),
          ...(username ? { username } : {}),
          contactName: contact?.profile?.name || username || phoneNumber || userId || parentUserId,
          text: message.text?.body || '',
          timestamp: message.timestamp,
          phoneNumberId: value.metadata?.phone_number_id
        });
      }

      for (const status of value.statuses || []) {
        const contact = contacts.find((candidate) => (
          (status.recipient_id && candidate.wa_id === status.recipient_id)
          || (status.recipient_user_id && candidate.user_id === status.recipient_user_id)
          || (status.recipient_parent_user_id
            && candidate.parent_user_id === status.recipient_parent_user_id)
        ));
        const phoneNumber = status.recipient_id || contact?.wa_id;
        const userId = status.recipient_user_id || contact?.user_id;
        const parentUserId = status.recipient_parent_user_id || contact?.parent_user_id;
        const username = contact?.profile?.username;
        const recipient = userId || phoneNumber || parentUserId;
        events.push({
          type: 'message.status',
          messageId: status.id,
          status: status.status,
          recipient,
          ...(phoneNumber && recipient !== phoneNumber ? { phoneNumber } : {}),
          ...(userId ? { userId } : {}),
          ...(parentUserId ? { parentUserId } : {}),
          ...(username ? { username } : {}),
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
