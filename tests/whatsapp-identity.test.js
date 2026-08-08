import assert from 'node:assert/strict';
import test from 'node:test';

import {
  conversationWhatsAppAddress,
  normalizeWhatsAppAddress,
  whatsappRecipientLabel
} from '../src/whatsapp-identity.js';

test('normalizes phone and BSUID recipient input without corrupting either', () => {
  assert.deepEqual(normalizeWhatsAppAddress('+61 449 550 842'), { to: '61449550842' });
  assert.deepEqual(normalizeWhatsAppAddress('610449550842'), { to: '61449550842' });
  assert.deepEqual(normalizeWhatsAppAddress('CN.13491208655302741918'), {
    recipient: 'CN.13491208655302741918'
  });
  assert.equal(normalizeWhatsAppAddress('not-a-recipient'), null);
});

test('derives both phone and BSUID addresses from a migrated conversation', () => {
  assert.deepEqual(conversationWhatsAppAddress({
    sourceId: '8619566373059',
    identity: {
      phoneNumber: '8619566373059',
      userId: 'CN.13491208655302741918',
      username: 'username_customer'
    }
  }), {
    to: '8619566373059',
    recipient: 'CN.13491208655302741918'
  });
});

test('labels username, phone, and BSUID recipients clearly for confirmation', () => {
  assert.equal(whatsappRecipientLabel({
    sourceId: '8619566373059',
    identity: { phoneNumber: '8619566373059', username: 'username_customer' }
  }), '@username_customer · +8619566373059');
  assert.equal(whatsappRecipientLabel({
    sourceId: 'CN.13491208655302741918',
    identity: { userId: 'CN.13491208655302741918' }
  }), 'CN.13491208655302741918');
});
