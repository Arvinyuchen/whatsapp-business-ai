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

test('server-owned live conversations sync into the inbox without local persistence', () => {
  const storage = createMemoryStorage();
  const store = createConversationStore([makeConversation({ workflow: 'open' })], { storage });
  const liveConversation = makeConversation({
    id: 'whatsapp:8619566373059',
    source: 'whatsapp',
    sourceId: '8619566373059',
    workflow: 'open',
    queue: [],
    activity: []
  });

  assert.deepEqual(store.syncLiveConversations([liveConversation]), { changed: true });
  store.select(liveConversation.id);
  store.setFilter('open');

  assert.equal(store.getSnapshot().conversations[0].id, liveConversation.id);
  const reloaded = createConversationStore([makeConversation({ workflow: 'open' })], { storage });
  assert.equal(reloaded.getSnapshot().conversations.some(({ source }) => source === 'whatsapp'), false);
});

test('live workspace sync replaces stale server projections', () => {
  const store = createConversationStore([]);
  const first = makeConversation({
    id: 'whatsapp:1', source: 'whatsapp', workflow: 'open', queue: [], activity: []
  });
  const resolved = { ...first, workflow: 'resolved' };

  store.syncLiveConversations([first]);
  assert.deepEqual(store.syncLiveConversations([resolved]), { changed: true });
  assert.equal(store.getSnapshot().conversations[0].workflow, 'resolved');
  assert.deepEqual(store.syncLiveConversations([resolved]), { changed: false });
});
