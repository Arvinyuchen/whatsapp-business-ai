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
