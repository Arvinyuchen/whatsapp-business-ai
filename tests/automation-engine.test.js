import assert from 'node:assert/strict';
import test from 'node:test';

import { createAutomationEngine } from '../server/automation-engine.js';
import { createMemoryWorkspaceStore } from '../server/workspace-store.js';

const inbound = {
  type: 'message.received',
  messageId: 'wamid.automation.inbound',
  from: '8619566373059',
  text: 'What time do you close?'
};

async function createHarness({ mode = 'dry-run', allowlist = ['8619566373059'], draft } = {}) {
  const workspaceStore = createMemoryWorkspaceStore();
  await workspaceStore.applyEvents([inbound]);
  let generated = 0;
  let sent = 0;
  const engine = createAutomationEngine({
    mode,
    allowlist,
    minConfidence: 0.9,
    workspaceStore,
    replyGenerator: {
      generate: async () => {
        generated += 1;
        return draft || {
          body: 'We close at 5pm.',
          confidence: 0.96,
          requiresHuman: false
        };
      }
    },
    whatsappClient: {
      sendText: async () => {
        sent += 1;
        return { messageId: 'wamid.automation.outbound' };
      }
    },
    now: () => new Date('2026-08-08T00:00:00.000Z')
  });
  return { engine, workspaceStore, counts: () => ({ generated, sent }) };
}

test('dry-run evaluates an allowlisted inquiry without sending', async () => {
  const harness = await createHarness();

  const decisions = await harness.engine.run();
  const workspace = await harness.workspaceStore.getWorkspace();

  assert.equal(decisions[0].outcome, 'dry_run');
  assert.equal(decisions[0].reason, 'live_send_disabled');
  assert.deepEqual(harness.counts(), { generated: 1, sent: 0 });
  assert.deepEqual(workspace.audits, decisions);
});

test('non-allowlisted recipients are blocked before draft generation', async () => {
  const harness = await createHarness({ allowlist: [] });

  const decisions = await harness.engine.run();

  assert.equal(decisions[0].reason, 'recipient_not_allowlisted');
  assert.deepEqual(harness.counts(), { generated: 0, sent: 0 });
});

test('low-confidence and human-required drafts cannot auto-send', async () => {
  const lowConfidence = await createHarness({
    mode: 'live',
    draft: { body: 'Maybe.', confidence: 0.5, requiresHuman: false }
  });
  const humanRequired = await createHarness({
    mode: 'live',
    draft: { body: 'Refund promised.', confidence: 1, requiresHuman: true }
  });

  const lowDecision = (await lowConfidence.engine.run())[0];
  const humanDecision = (await humanRequired.engine.run())[0];

  assert.equal(lowDecision.reason, 'confidence_below_threshold');
  assert.equal(humanDecision.reason, 'draft_requires_human');
  assert.equal(lowConfidence.counts().sent, 0);
  assert.equal(humanRequired.counts().sent, 0);
});

test('live mode sends once only after all guards pass', async () => {
  const harness = await createHarness({ mode: 'live' });

  const first = await harness.engine.run();
  const replay = await harness.engine.run();
  const workspace = await harness.workspaceStore.getWorkspace();

  assert.equal(first[0].outcome, 'sent');
  assert.deepEqual(replay, []);
  assert.deepEqual(harness.counts(), { generated: 1, sent: 1 });
  assert.equal(workspace.conversations[0].workflow, 'resolved');
  assert.deepEqual(workspace.conversations[0].messages.at(-1), ['agent', 'We close at 5pm.']);
});

test('failed live sends are audited and never retried automatically', async () => {
  const workspaceStore = createMemoryWorkspaceStore();
  await workspaceStore.applyEvents([inbound]);
  let attempts = 0;
  const engine = createAutomationEngine({
    mode: 'live',
    allowlist: ['8619566373059'],
    minConfidence: 0.9,
    workspaceStore,
    replyGenerator: {
      generate: async () => ({ body: 'Safe reply.', confidence: 1, requiresHuman: false })
    },
    whatsappClient: {
      sendText: async () => {
        attempts += 1;
        throw new Error('Meta unavailable');
      }
    }
  });

  const first = await engine.run();
  const replay = await engine.run();

  assert.equal(first[0].outcome, 'failed');
  assert.equal(first[0].reason, 'send_failed');
  assert.deepEqual(replay, []);
  assert.equal(attempts, 1);
});
