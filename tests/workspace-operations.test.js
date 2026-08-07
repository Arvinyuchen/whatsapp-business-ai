import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createMemoryWorkspaceStore } from '../server/workspace-store.js';
import {
  createWorkspaceOperations,
  verifyWorkspaceExport
} from '../server/workspace-operations.js';

async function createPopulatedStore() {
  const store = createMemoryWorkspaceStore({ eventLimit: 10 });
  await store.applyEvents([{
    type: 'message.received',
    messageId: 'wamid.ops',
    from: '8619566373059',
    text: 'Hello',
    timestamp: '1786147200'
  }]);
  await store.recordAudit({
    id: 'audit.ops',
    type: 'automation.decision',
    outcome: 'dry_run',
    timestamp: '2026-08-08T00:00:00.000Z'
  });
  return store;
}

test('operations reports health and aggregate metrics without customer content', async () => {
  const workspaceStore = await createPopulatedStore();
  const operations = createWorkspaceOperations({ workspaceStore });

  assert.deepEqual(await operations.health(), { status: 'ok', storage: 'ready' });
  assert.deepEqual(await operations.metrics(), {
    events: 1,
    conversations: 1,
    audits: 1,
    workflows: { open: 1 },
    automationOutcomes: { dry_run: 1 }
  });
});

test('workspace export is versioned and rejects duplicate recovery identities', async () => {
  const workspaceStore = await createPopulatedStore();
  const operations = createWorkspaceOperations({
    workspaceStore,
    now: () => new Date('2026-08-08T01:00:00.000Z')
  });
  const payload = await operations.exportWorkspace();

  assert.equal(payload.schemaVersion, 1);
  assert.deepEqual(verifyWorkspaceExport(payload), { valid: true, errors: [] });
  payload.workspace.conversations.push(structuredClone(payload.workspace.conversations[0]));
  assert.deepEqual(verifyWorkspaceExport(payload), {
    valid: false,
    errors: ['Conversation IDs must be unique.']
  });
});

test('atomic JSON backup is private and verifies after being written', async (context) => {
  const directory = await mkdtemp(join(tmpdir(), 'whatsapp-backup-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const workspaceStore = await createPopulatedStore();
  const operations = createWorkspaceOperations({
    workspaceStore,
    backupDirectory: directory,
    now: () => new Date('2026-08-08T01:02:03.000Z')
  });

  const result = await operations.backup();
  const payload = JSON.parse(await readFile(result.filePath, 'utf8'));
  const fileMode = (await stat(result.filePath)).mode & 0o777;

  assert.equal(result.exportedAt, '2026-08-08T01:02:03.000Z');
  assert.equal(fileMode, 0o600);
  assert.deepEqual(verifyWorkspaceExport(payload), { valid: true, errors: [] });
});

test('retention removes expired events and audits while preserving active conversations', async () => {
  const workspaceStore = createMemoryWorkspaceStore({ eventLimit: 10 });
  await workspaceStore.applyEvents([{
    type: 'message.received',
    messageId: 'wamid.old',
    from: '8619566373059',
    text: 'Old but still open',
    timestamp: '1704067200'
  }, {
    type: 'message.received',
    messageId: 'wamid.new',
    from: '8619566373059',
    text: 'Current',
    timestamp: '1786060800'
  }]);
  await workspaceStore.recordAudit({
    id: 'audit.old', type: 'operator.draft', timestamp: '2024-01-01T00:00:00.000Z'
  });
  await workspaceStore.recordAudit({
    id: 'audit.new', type: 'operator.draft', timestamp: '2026-08-07T00:00:00.000Z'
  });
  const operations = createWorkspaceOperations({
    workspaceStore,
    retentionDays: 30,
    eventLimit: 10,
    auditLimit: 10,
    now: () => new Date('2026-08-08T00:00:00.000Z')
  });

  const result = await operations.prune();
  const workspace = await workspaceStore.getWorkspace();

  assert.deepEqual(result.removed, { events: 1, conversations: 0, audits: 1 });
  assert.equal(workspace.conversations.length, 1);
  assert.deepEqual(workspace.events.map(({ messageId }) => messageId), ['wamid.new']);
  assert.deepEqual(workspace.audits.map(({ id }) => id), ['audit.new']);
});
