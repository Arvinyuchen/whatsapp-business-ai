export function createRequestKeyStore({ generateKey = () => crypto.randomUUID() } = {}) {
  const requests = new Map();

  return {
    get(scope, fingerprint) {
      const existing = requests.get(scope);
      if (existing?.fingerprint === fingerprint) return existing.key;

      const key = generateKey();
      requests.set(scope, { fingerprint, key });
      return key;
    },

    complete(scope) {
      requests.delete(scope);
    }
  };
}
