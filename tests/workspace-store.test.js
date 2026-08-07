import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createMemoryWorkspaceStore,
  createSqliteWorkspaceStore
} from '../server/workspace-store.js';

const inboundEvent = {
  type: 'message.received',
  messageId: 'wamid.inbound',
  from: '8619566373059',
  contactName: 'New test number',
  text: 'Can you help?'
};

test('SQLite workspace survives recreation with its live conversation projection', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'whatsapp-workspace-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'workspace.sqlite');
  const firstStore = createSqliteWorkspaceStore({ filePath });
  await firstStore.applyEvents([inboundEvent]);

  const recreatedStore = createSqliteWorkspaceStore({ filePath });
  const workspace = await recreatedStore.getWorkspace();

  assert.deepEqual(workspace.events, [inboundEvent]);
  assert.equal(workspace.conversations[0].id, 'whatsapp:8619566373059');
  assert.deepEqual(workspace.conversations[0].messages, [['customer', 'Can you help?']]);
});

test('workspace deduplicates webhook retries and builds chronological transcripts', async () => {
  const store = createMemoryWorkspaceStore();
  const newer = { ...inboundEvent, messageId: 'wamid.newer', text: 'Second', timestamp: '200' };
  const older = { ...inboundEvent, messageId: 'wamid.older', text: 'First', timestamp: '100' };

  const first = await store.applyEvents([newer, older, older]);
  const replay = await store.applyEvents([newer]);
  const workspace = await store.getWorkspace();

  assert.deepEqual(first, { added: 2, duplicates: 1, conversationsChanged: 2 });
  assert.deepEqual(replay, { added: 0, duplicates: 1, conversationsChanged: 0 });
  assert.deepEqual(workspace.conversations[0].messages, [
    ['customer', 'First'],
    ['customer', 'Second']
  ]);
});

test('recorded replies reconcile to the latest delivery state', async () => {
  const store = createMemoryWorkspaceStore();
  await store.applyEvents([inboundEvent]);
  await store.recordReply({
    conversationId: 'whatsapp:8619566373059',
    to: '8619566373059',
    body: 'Yes, I can help.',
    messageId: 'wamid.outbound'
  });

  await store.applyEvents([{
    type: 'message.status',
    messageId: 'wamid.outbound',
    status: 'delivered',
    timestamp: '300'
  }, {
    type: 'message.status',
    messageId: 'wamid.outbound',
    status: 'read',
    timestamp: '400'
  }]);
  const conversation = (await store.getWorkspace()).conversations[0];

  assert.equal(conversation.workflow, 'resolved');
  assert.deepEqual(conversation.messages.at(-1), ['agent', 'Yes, I can help.']);
  assert.equal(conversation.activity.at(-1).deliveryStatus, 'read');
  assert.equal(conversation.activity.at(-1).label, 'Live reply read');
});

test('failed delivery reopens a server-owned conversation for review', async () => {
  const store = createMemoryWorkspaceStore();
  await store.applyEvents([inboundEvent]);
  await store.recordReply({
    conversationId: 'whatsapp:8619566373059',
    to: '8619566373059',
    body: 'Yes, I can help.',
    messageId: 'wamid.outbound'
  });
  await store.applyEvents([{
    type: 'message.status',
    messageId: 'wamid.outbound',
    status: 'failed',
    timestamp: '500'
  }]);

  const conversation = (await store.getWorkspace()).conversations[0];
  assert.equal(conversation.workflow, 'needs_review');
  assert.equal(conversation.riskLevel, 'high');
  assert.ok(conversation.tags.includes('Delivery failed'));
});

test('operator actions mutate the shared conversation and reject unsupported actions', async () => {
  const store = createMemoryWorkspaceStore();
  await store.applyEvents([inboundEvent]);

  const escalated = await store.applyAction({
    conversationId: 'whatsapp:8619566373059',
    action: 'escalate'
  });
  const deferred = await store.applyAction({
    conversationId: 'whatsapp:8619566373059',
    action: 'defer'
  });

  assert.equal(escalated.workflow, 'needs_review');
  assert.equal(deferred.workflow, 'deferred');
  await assert.rejects(
    store.applyAction({ conversationId: deferred.id, action: 'delete' }),
    /unsupported conversation action/i
  );
});

test('workspace bounds raw event history without deleting conversations', async () => {
  const store = createMemoryWorkspaceStore({ eventLimit: 2 });
  await store.applyEvents([inboundEvent, {
    ...inboundEvent,
    messageId: 'wamid.second',
    text: 'Second message'
  }, {
    ...inboundEvent,
    messageId: 'wamid.third',
    text: 'Third message'
  }]);

  const workspace = await store.getWorkspace();
  assert.equal(workspace.events.length, 2);
  assert.equal(workspace.conversations.length, 1);
  assert.equal(workspace.conversations[0].messages.length, 3);
});
