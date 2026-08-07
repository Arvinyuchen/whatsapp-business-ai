import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createFileEventStore, createMemoryEventStore } from '../server/event-store.js';

const inboundEvent = {
  type: 'message.received',
  messageId: 'wamid.inbound',
  from: '61400000000',
  text: 'Hello'
};

test('memory event store bounds history and deduplicates message retries', async () => {
  const store = createMemoryEventStore({ limit: 2 });

  assert.deepEqual(await store.append([inboundEvent, inboundEvent]), {
    added: 1,
    duplicates: 1
  });
  await store.append([{
    type: 'message.status',
    messageId: 'wamid.outbound',
    status: 'delivered'
  }, {
    type: 'message.status',
    messageId: 'wamid.outbound',
    status: 'read'
  }]);

  assert.deepEqual((await store.list()).map(({ status }) => status), ['delivered', 'read']);
});

test('file event store survives recreation and keeps delivery transitions', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'whatsapp-event-store-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'events.json');
  const firstStore = createFileEventStore({ filePath });

  await firstStore.append([inboundEvent, {
    type: 'message.status',
    messageId: 'wamid.outbound',
    status: 'delivered'
  }, {
    type: 'message.status',
    messageId: 'wamid.outbound',
    status: 'read'
  }]);
  const recreatedStore = createFileEventStore({ filePath });

  assert.deepEqual(await recreatedStore.list(), [inboundEvent, {
    type: 'message.status',
    messageId: 'wamid.outbound',
    status: 'delivered'
  }, {
    type: 'message.status',
    messageId: 'wamid.outbound',
    status: 'read'
  }]);
  assert.deepEqual(await recreatedStore.append([inboundEvent]), {
    added: 0,
    duplicates: 1
  });
});
