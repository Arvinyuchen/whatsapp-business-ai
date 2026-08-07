import assert from 'node:assert/strict';
import test from 'node:test';

import { createActivityRefresh } from '../src/activity-refresh.js';

function createScheduler() {
  let nextId = 0;
  const scheduled = new Map();

  return {
    setTimer(callback, delay) {
      const id = ++nextId;
      scheduled.set(id, { callback, delay });
      return id;
    },
    clearTimer(id) {
      scheduled.delete(id);
    },
    takeNext() {
      const [id, task] = scheduled.entries().next().value;
      scheduled.delete(id);
      return task;
    },
    count: () => scheduled.size
  };
}

test('activity refresh runs on schedule and queues the next non-overlapping refresh', async () => {
  const scheduler = createScheduler();
  let refreshCount = 0;
  const controller = createActivityRefresh({
    refresh: async () => { refreshCount += 1; },
    intervalMs: 25,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });

  controller.start();
  const firstTask = scheduler.takeNext();
  assert.equal(firstTask.delay, 25);
  await firstTask.callback();

  assert.equal(refreshCount, 1);
  assert.equal(scheduler.count(), 1);
});

test('activity refresh pauses while hidden and resumes when requested', async () => {
  const scheduler = createScheduler();
  let visible = false;
  let refreshCount = 0;
  const controller = createActivityRefresh({
    refresh: async () => { refreshCount += 1; },
    isVisible: () => visible,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });

  controller.start();
  await scheduler.takeNext().callback();
  assert.equal(refreshCount, 0);

  visible = true;
  await controller.refreshNow();
  assert.equal(refreshCount, 1);
  assert.equal(scheduler.count(), 1);
});

test('activity refresh does not overlap an in-flight request', async () => {
  const scheduler = createScheduler();
  let releaseRefresh;
  let refreshCount = 0;
  const controller = createActivityRefresh({
    refresh: () => {
      refreshCount += 1;
      return new Promise((resolve) => { releaseRefresh = resolve; });
    },
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });

  controller.start();
  const inFlight = scheduler.takeNext().callback();
  const recoveryResult = await controller.refreshNow();

  assert.equal(recoveryResult, false);
  assert.equal(refreshCount, 1);
  releaseRefresh();
  await inFlight;
  assert.equal(scheduler.count(), 1);
});

test('stopping activity refresh cancels pending work', () => {
  const scheduler = createScheduler();
  const controller = createActivityRefresh({
    refresh: async () => {},
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer
  });

  controller.start();
  controller.stop();

  assert.equal(controller.isActive(), false);
  assert.equal(scheduler.count(), 0);
});
