import { createHash, timingSafeEqual } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest();
}

export function isOperatorAuthorized(authorization, adminToken) {
  if (!adminToken) return false;
  return timingSafeEqual(
    digest(authorization),
    digest(`Bearer ${adminToken}`)
  );
}

const rolePermissions = {
  viewer: new Set(['read']),
  agent: new Set(['read', 'draft', 'reply', 'manage']),
  admin: new Set(['read', 'draft', 'reply', 'manage', 'admin'])
};

export function parseOperatorAccounts(value) {
  if (!value) return [];
  let accounts;
  try {
    accounts = JSON.parse(value);
  } catch {
    throw new Error('OPERATOR_ACCOUNTS_JSON must be valid JSON.');
  }
  if (!Array.isArray(accounts)) throw new Error('OPERATOR_ACCOUNTS_JSON must be an array.');
  return accounts.map((account) => {
    const id = String(account?.id || '').trim();
    const role = String(account?.role || '').trim();
    const token = String(account?.token || '');
    if (!/^[A-Za-z0-9_.-]{1,64}$/.test(id) || !rolePermissions[role] || token.length < 12) {
      throw new Error('Each operator account requires a safe ID, valid role, and token of at least 12 characters.');
    }
    return { id, role, token };
  });
}

export function createOperatorAccess({ accounts = [], legacyAdminToken } = {}) {
  const rawAccounts = [
    ...accounts,
    ...(legacyAdminToken ? [{ id: 'legacy-admin', role: 'admin', token: legacyAdminToken }] : [])
  ];
  if (new Set(rawAccounts.map(({ id }) => id)).size !== rawAccounts.length
    || new Set(rawAccounts.map(({ token }) => token)).size !== rawAccounts.length) {
    throw new Error('Operator account IDs and tokens must be unique.');
  }
  const configuredAccounts = rawAccounts.map((account) => ({
    id: account.id,
    role: account.role,
    authorizationDigest: digest(`Bearer ${account.token}`)
  }));

  return {
    isConfigured: () => configuredAccounts.length > 0,
    authenticate(authorization) {
      const presented = digest(authorization);
      let principal = null;
      for (const account of configuredAccounts) {
        if (timingSafeEqual(presented, account.authorizationDigest)) {
          principal = { id: account.id, role: account.role };
        }
      }
      return principal;
    },
    can(principal, permission) {
      return Boolean(principal && rolePermissions[principal.role]?.has(permission));
    }
  };
}

export function createIdempotencyStore({
  ttlMs = 5 * 60 * 1000,
  maxEntries = 500,
  now = Date.now
} = {}) {
  const entries = new Map();

  function prune() {
    const currentTime = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime && entry.settled) entries.delete(key);
    }

    if (entries.size < maxEntries) return;
    for (const [key, entry] of entries) {
      if (!entry.settled) continue;
      entries.delete(key);
      if (entries.size < maxEntries) break;
    }
  }

  return {
    async execute({ key, fingerprint, operation }) {
      prune();
      const existing = entries.get(key);
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw Object.assign(
            new Error('Idempotency key was already used for a different message.'),
            { status: 409 }
          );
        }
        return existing.promise;
      }

      const entry = {
        fingerprint,
        expiresAt: now() + ttlMs,
        settled: false,
        promise: null
      };
      entry.promise = Promise.resolve().then(operation);
      entries.set(key, entry);

      try {
        const result = await entry.promise;
        entry.settled = true;
        return result;
      } catch (error) {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      }
    }
  };
}
