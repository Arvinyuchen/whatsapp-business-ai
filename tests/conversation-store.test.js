import assert from 'node:assert/strict';
import test from 'node:test';

import { createConversationStore } from '../src/conversation-store.js';

function makeConversation(overrides = {}) {
  return {
    id: 'ava',
    name: 'Ava Williams',
    workflow: 'needs_review',
    messages: [['customer', 'I need a refund.']],
    ...overrides
  };
}

function createMemoryStorage() {
  let value = null;

  return {
    load: () => value,
    save: (nextValue) => {
      value = structuredClone(nextValue);
    },
    clear: () => {
      value = null;
    }
  };
}

test('operator can send a non-empty reply and resolve the conversation', () => {
  const store = createConversationStore([makeConversation()]);

  store.sendReply('ava', 'I have escalated this for review.');

  const conversation = store.getSnapshot().conversations[0];
  assert.equal(conversation.workflow, 'resolved');
  assert.deepEqual(conversation.messages.at(-1), [
    'agent',
    'I have escalated this for review.'
  ]);
  assert.equal(conversation.activity.at(-1).type, 'sent');
});

test('accepted live replies retain the Meta message ID', () => {
  const store = createConversationStore([makeConversation({ source: 'whatsapp' })]);

  store.sendReply('ava', 'Your order is ready.', {
    live: true,
    messageId: 'wamid.sent'
  });

  const activity = store.getSnapshot().conversations[0].activity.at(-1);
  assert.equal(activity.label, 'Live reply accepted by WhatsApp');
  assert.equal(activity.messageId, 'wamid.sent');
});

test('operator cannot send a blank reply', () => {
  const store = createConversationStore([makeConversation()]);

  assert.throws(() => store.sendReply('ava', '   '), /reply cannot be empty/i);
  assert.equal(store.getSnapshot().conversations[0].workflow, 'needs_review');
});

test('operator can escalate a conversation for human review', () => {
  const store = createConversationStore([
    makeConversation({ workflow: 'open', activity: [] })
  ]);

  store.escalate('ava');

  const conversation = store.getSnapshot().conversations[0];
  assert.equal(conversation.workflow, 'needs_review');
  assert.equal(conversation.activity.at(-1).type, 'escalated');
});

test('operator can defer a conversation for follow-up', () => {
  const store = createConversationStore([
    makeConversation({ workflow: 'open', activity: [] })
  ]);

  store.defer('ava');

  const conversation = store.getSnapshot().conversations[0];
  assert.equal(conversation.workflow, 'deferred');
  assert.equal(conversation.activity.at(-1).type, 'deferred');
});

test('queue filters and metrics reflect the current workflow state', () => {
  const store = createConversationStore([
    makeConversation({ id: 'open', workflow: 'open', queue: ['order'], valueAmount: 1200 }),
    makeConversation({ id: 'review', workflow: 'needs_review', queue: ['urgent'], valueAmount: 340 }),
    makeConversation({ id: 'done', workflow: 'resolved', queue: ['order'], valueAmount: 800 })
  ]);

  store.setFilter('needs_review');
  const snapshot = store.getSnapshot();

  assert.deepEqual(snapshot.visibleConversations.map(({ id }) => id), ['review']);
  assert.deepEqual(snapshot.metrics, {
    active: 2,
    needsReview: 1,
    orders: 1,
    valueInPlay: 1540
  });
});

test('workflow decisions survive a store reload through the storage adapter', () => {
  const storage = createMemoryStorage();
  const firstStore = createConversationStore([makeConversation()], { storage });
  firstStore.sendReply('ava', 'Your refund review is underway.');

  const reloadedStore = createConversationStore([makeConversation()], { storage });

  assert.equal(reloadedStore.getSnapshot().conversations[0].workflow, 'resolved');
});

test('operator can reset the demo to its original conversations', () => {
  const storage = createMemoryStorage();
  const store = createConversationStore([makeConversation()], { storage });
  store.sendReply('ava', 'Your refund review is underway.');

  store.reset();

  const conversation = store.getSnapshot().conversations[0];
  assert.equal(conversation.workflow, 'needs_review');
  assert.equal(conversation.messages.length, 1);
});

test('queue advances after the selected conversation is resolved', () => {
  const store = createConversationStore([
    makeConversation({ id: 'first', workflow: 'open' }),
    makeConversation({ id: 'second', workflow: 'open' })
  ]);
  store.select('first');

  store.sendReply('first', 'Confirmed.');

  assert.equal(store.getSnapshot().selectedId, 'second');
});

test('deferred conversations leave the active queue and the operator advances', () => {
  const store = createConversationStore([
    makeConversation({ id: 'first', workflow: 'open' }),
    makeConversation({ id: 'second', workflow: 'open' })
  ]);
  store.select('first');

  store.defer('first');

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.selectedId, 'second');
  assert.deepEqual(snapshot.visibleConversations.map(({ id }) => id), ['second']);
});

test('inbound WhatsApp events create live inbox conversations', () => {
  const store = createConversationStore([makeConversation({ workflow: 'open' })]);

  const result = store.ingestWhatsAppEvents([{
    type: 'message.received',
    messageId: 'wamid.first',
    from: '8619566373059',
    contactName: 'New test number',
    text: 'Can you help with an order?'
  }]);

  const conversation = store.getSnapshot().conversations[0];
  assert.deepEqual(result, { created: 1, updated: 0, ignored: 0 });
  assert.equal(conversation.id, 'whatsapp:8619566373059');
  assert.equal(conversation.name, 'New test number');
  assert.equal(conversation.workflow, 'open');
  assert.deepEqual(conversation.messages, [['customer', 'Can you help with an order?']]);
});

test('new messages reopen and move an existing WhatsApp conversation to the top', () => {
  const store = createConversationStore([
    makeConversation({ id: 'other', workflow: 'open' })
  ]);
  store.ingestWhatsAppEvents([{
    type: 'message.received',
    messageId: 'wamid.first',
    from: '8619566373059',
    contactName: 'New test number',
    text: 'First message'
  }]);
  store.sendReply('whatsapp:8619566373059', 'First reply');

  const result = store.ingestWhatsAppEvents([{
    type: 'message.received',
    messageId: 'wamid.second',
    from: '8619566373059',
    contactName: 'Updated name',
    text: 'Follow-up message'
  }]);

  const conversation = store.getSnapshot().conversations[0];
  assert.deepEqual(result, { created: 0, updated: 1, ignored: 0 });
  assert.equal(conversation.id, 'whatsapp:8619566373059');
  assert.equal(conversation.name, 'Updated name');
  assert.equal(conversation.workflow, 'open');
  assert.deepEqual(conversation.messages.at(-1), ['customer', 'Follow-up message']);
});

test('replayed WhatsApp events are ignored and remain deduplicated after reload', () => {
  const storage = createMemoryStorage();
  const event = {
    type: 'message.received',
    messageId: 'wamid.duplicate',
    from: '8619566373059',
    text: 'Only store this once'
  };
  const firstStore = createConversationStore([], { storage });
  firstStore.ingestWhatsAppEvents([event]);
  const reloadedStore = createConversationStore([], { storage });

  const result = reloadedStore.ingestWhatsAppEvents([event]);
  const conversation = reloadedStore.getSnapshot().conversations[0];

  assert.deepEqual(result, { created: 0, updated: 0, ignored: 1 });
  assert.equal(conversation.messages.length, 1);
});

test('inbound event batches become chronological conversation transcripts', () => {
  const store = createConversationStore([]);

  store.ingestWhatsAppEvents([{
    type: 'message.received',
    messageId: 'wamid.newer',
    from: '8619566373059',
    text: 'Second message',
    timestamp: '200'
  }, {
    type: 'message.received',
    messageId: 'wamid.older',
    from: '8619566373059',
    text: 'First message',
    timestamp: '100'
  }]);

  const conversation = store.getSnapshot().conversations[0];
  assert.deepEqual(conversation.messages, [
    ['customer', 'First message'],
    ['customer', 'Second message']
  ]);
  assert.equal(conversation.preview, 'Second message');
});
