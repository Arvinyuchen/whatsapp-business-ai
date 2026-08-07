const STORAGE_VERSION = 1;

export function createLocalStorageAdapter(key) {
  return {
    load() {
      try {
        const stored = JSON.parse(window.localStorage.getItem(key));
        return stored?.version === STORAGE_VERSION ? stored.state : null;
      } catch {
        return null;
      }
    },

    save(state) {
      try {
        window.localStorage.setItem(
          key,
          JSON.stringify({ version: STORAGE_VERSION, state })
        );
      } catch {
        // The demo remains usable when storage is blocked or full.
      }
    },

    clear() {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Reset still updates the in-memory store when storage is unavailable.
      }
    }
  };
}
