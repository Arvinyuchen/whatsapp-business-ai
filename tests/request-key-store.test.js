import assert from 'node:assert/strict';
import test from 'node:test';

import { createRequestKeyStore } from '../src/request-key-store.js';

test('request keys persist for identical retries and rotate after edits or completion', () => {
  let sequence = 0;
  const store = createRequestKeyStore({ generateKey: () => `request-${++sequence}` });

  assert.equal(store.get('reply:1', 'same payload'), 'request-1');
  assert.equal(store.get('reply:1', 'same payload'), 'request-1');
  assert.equal(store.get('reply:1', 'edited payload'), 'request-2');

  store.complete('reply:1');
  assert.equal(store.get('reply:1', 'edited payload'), 'request-3');
});

test('request key scopes keep concurrent conversations independent', () => {
  let sequence = 0;
  const store = createRequestKeyStore({ generateKey: () => `request-${++sequence}` });

  assert.equal(store.get('reply:1', 'payload'), 'request-1');
  assert.equal(store.get('reply:2', 'payload'), 'request-2');
  assert.equal(store.get('reply:1', 'payload'), 'request-1');
});
