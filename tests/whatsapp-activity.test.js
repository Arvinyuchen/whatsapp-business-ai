import assert from 'node:assert/strict';
import test from 'node:test';

import {
  presentWhatsAppEvent,
  sortWhatsAppEvents
} from '../src/whatsapp-activity.js';

const formatTimestamp = (timestamp) => `time:${timestamp}`;

test('inbound WhatsApp events become operator-friendly activity records', () => {
  assert.deepEqual(presentWhatsAppEvent({
    type: 'message.received',
    messageId: 'wamid.inbound',
    from: '8619566373059',
    contactName: 'Arvin',
    text: 'Hello from the new number',
    timestamp: '1785900000'
  }, { formatTimestamp }), {
    id: 'wamid.inbound',
    kind: 'inbound',
    marker: '←',
    label: 'Inbound message',
    subject: 'Arvin',
    detail: 'Hello from the new number',
    timestamp: 'time:1785900000'
  });
});

test('delivery events distinguish successful and failed states', () => {
  const delivered = presentWhatsAppEvent({
    type: 'message.status',
    messageId: 'wamid.outbound',
    status: 'delivered',
    recipient: '8619566373059',
    timestamp: '1785900100'
  }, { formatTimestamp });
  const failed = presentWhatsAppEvent({
    type: 'message.status',
    status: 'failed',
    recipient: '8619566373059',
    timestamp: '1785900200'
  }, { formatTimestamp });

  assert.equal(delivered.kind, 'status');
  assert.equal(delivered.subject, 'Message delivered');
  assert.equal(delivered.detail, 'To 8619566373059');
  assert.equal(failed.kind, 'failed');
  assert.equal(failed.subject, 'Message failed');
});

test('activity is ordered newest first without mutating the API response', () => {
  const events = [
    { messageId: 'older', timestamp: '100' },
    { messageId: 'newer', timestamp: '200' }
  ];

  assert.deepEqual(sortWhatsAppEvents(events).map(({ messageId }) => messageId), ['newer', 'older']);
  assert.deepEqual(events.map(({ messageId }) => messageId), ['older', 'newer']);
});
