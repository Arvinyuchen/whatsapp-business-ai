import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyLiveConversationAction,
  loadLiveWorkspace
} from '../src/live-workspace.js';

test('live workspace client loads server-owned events and conversations', async () => {
  let request;
  const workspace = { events: [{ messageId: 'wamid.1' }], conversations: [{ id: 'whatsapp:1' }] };
  const result = await loadLiveWorkspace({
    token: 'operator-secret',
    fetchImpl: async (...args) => {
      request = args;
      return Response.json(workspace);
    }
  });

  assert.deepEqual(result, workspace);
  assert.equal(request[0], '/api/workspace');
  assert.equal(request[1].headers.authorization, 'Bearer operator-secret');
});

test('live conversation actions use the authenticated server boundary', async () => {
  let request;
  const result = await applyLiveConversationAction({
    token: 'operator-secret',
    conversationId: 'whatsapp:8619566373059',
    action: 'defer',
    fetchImpl: async (...args) => {
      request = args;
      return Response.json({ conversation: { id: 'whatsapp:8619566373059', workflow: 'deferred' } });
    }
  });

  assert.equal(request[0], '/api/conversations/whatsapp%3A8619566373059/actions');
  assert.equal(request[1].method, 'POST');
  assert.deepEqual(JSON.parse(request[1].body), { action: 'defer' });
  assert.equal(result.conversation.workflow, 'deferred');
});

test('live workspace client surfaces authorization failures', async () => {
  await assert.rejects(
    loadLiveWorkspace({
      token: 'wrong-token',
      fetchImpl: async () => Response.json({ error: 'Unauthorized' }, { status: 401 })
    }),
    /unauthorized/i
  );
});
