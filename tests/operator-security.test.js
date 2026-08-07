import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIdempotencyStore,
  createOperatorAccess,
  isOperatorAuthorized,
  parseOperatorAccounts
} from '../server/operator-security.js';

test('operator bearer authentication accepts only the configured token', () => {
  assert.equal(isOperatorAuthorized('Bearer operator-secret', 'operator-secret'), true);
  assert.equal(isOperatorAuthorized('Bearer wrong', 'operator-secret'), false);
  assert.equal(isOperatorAuthorized('', 'operator-secret'), false);
  assert.equal(isOperatorAuthorized('Bearer operator-secret', ''), false);
});

test('operator access authenticates roles and enforces permissions', () => {
  const access = createOperatorAccess({ accounts: [
    { id: 'reader', role: 'viewer', token: 'viewer-secret-token' },
    { id: 'casey', role: 'agent', token: 'agent-secret-token' },
    { id: 'arvin', role: 'admin', token: 'admin-secret-token' }
  ] });

  const viewer = access.authenticate('Bearer viewer-secret-token');
  const agent = access.authenticate('Bearer agent-secret-token');
  const admin = access.authenticate('Bearer admin-secret-token');

  assert.deepEqual(viewer, { id: 'reader', role: 'viewer' });
  assert.equal(access.can(viewer, 'read'), true);
  assert.equal(access.can(viewer, 'reply'), false);
  assert.equal(access.can(agent, 'manage'), true);
  assert.equal(access.can(agent, 'admin'), false);
  assert.equal(access.can(admin, 'admin'), true);
  assert.equal(access.authenticate('Bearer wrong-token'), null);
});

test('operator account configuration validates safe unique identities', () => {
  assert.deepEqual(parseOperatorAccounts(JSON.stringify([{
    id: 'casey', role: 'agent', token: 'agent-secret-token'
  }])), [{ id: 'casey', role: 'agent', token: 'agent-secret-token' }]);
  assert.throws(() => parseOperatorAccounts('not-json'), /valid JSON/i);
  assert.throws(() => parseOperatorAccounts(JSON.stringify([{
    id: 'bad id', role: 'owner', token: 'short'
  }])), /safe ID/i);
  assert.throws(() => createOperatorAccess({ accounts: [
    { id: 'one', role: 'agent', token: 'same-secret-token' },
    { id: 'two', role: 'viewer', token: 'same-secret-token' }
  ] }), /unique/i);
});

test('idempotency store shares one in-flight result for matching retries', async () => {
  const store = createIdempotencyStore();
  let calls = 0;
  let release;
  const operation = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };

  const first = store.execute({ key: 'request-1', fingerprint: 'message-a', operation });
  const retry = store.execute({ key: 'request-1', fingerprint: 'message-a', operation });
  await Promise.resolve();
  release({ messageId: 'wamid.sent' });

  assert.deepEqual(await first, { messageId: 'wamid.sent' });
  assert.deepEqual(await retry, { messageId: 'wamid.sent' });
  assert.equal(calls, 1);
});

test('idempotency store rejects key reuse with a different payload', async () => {
  const store = createIdempotencyStore();
  await store.execute({
    key: 'request-1',
    fingerprint: 'message-a',
    operation: async () => ({ messageId: 'wamid.sent' })
  });

  await assert.rejects(
    store.execute({
      key: 'request-1',
      fingerprint: 'message-b',
      operation: async () => assert.fail('operation should not run')
    }),
    (error) => error.status === 409 && /different message/i.test(error.message)
  );
});

test('failed sends can be retried with the same idempotency key', async () => {
  const store = createIdempotencyStore();
  await assert.rejects(store.execute({
    key: 'request-1',
    fingerprint: 'message-a',
    operation: async () => { throw new Error('temporary failure'); }
  }));

  const result = await store.execute({
    key: 'request-1',
    fingerprint: 'message-a',
    operation: async () => ({ messageId: 'wamid.retry' })
  });
  assert.deepEqual(result, { messageId: 'wamid.retry' });
});
