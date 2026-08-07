export function createActivityRefresh({
  refresh,
  isVisible = () => true,
  intervalMs = 15_000,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) {
  let active = false;
  let running = false;
  let timer = null;

  function clearScheduledRefresh() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule() {
    if (!active) return;
    clearScheduledRefresh();
    timer = setTimer(run, intervalMs);
  }

  async function run() {
    timer = null;
    if (!active) return false;
    if (running || !isVisible()) {
      schedule();
      return false;
    }

    running = true;
    try {
      await refresh();
      return true;
    } finally {
      running = false;
      schedule();
    }
  }

  return {
    start() {
      active = true;
      schedule();
    },

    stop() {
      active = false;
      clearScheduledRefresh();
    },

    refreshNow() {
      clearScheduledRefresh();
      return run();
    },

    isActive() {
      return active;
    }
  };
}
