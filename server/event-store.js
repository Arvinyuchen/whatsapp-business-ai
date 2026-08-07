import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

function clone(value) {
  return structuredClone(value);
}

function getEventKey(event) {
  if (!event?.type || !event.messageId) return null;
  if (event.type === 'message.status') {
    return `${event.type}:${event.messageId}:${event.status || 'updated'}`;
  }
  return `${event.type}:${event.messageId}`;
}

function addUniqueEvents(currentEvents, incomingEvents, limit) {
  const keys = new Set(currentEvents.map(getEventKey).filter(Boolean));
  const added = [];
  let duplicates = 0;

  for (const event of incomingEvents) {
    const key = getEventKey(event);
    if (key && keys.has(key)) {
      duplicates += 1;
      continue;
    }

    if (key) keys.add(key);
    added.push(clone(event));
  }

  return {
    events: [...currentEvents, ...added].slice(-limit),
    added: added.length,
    duplicates
  };
}

export function createMemoryEventStore({ limit = 50 } = {}) {
  let events = [];

  return {
    async append(incomingEvents) {
      const result = addUniqueEvents(events, incomingEvents, limit);
      events = result.events;
      return { added: result.added, duplicates: result.duplicates };
    },

    async list() {
      return clone(events);
    }
  };
}

export function createFileEventStore({ filePath, limit = 50 }) {
  if (!filePath) throw new Error('A webhook event store path is required.');

  let events;
  let operation = Promise.resolve();

  async function load() {
    if (events) return;

    try {
      const payload = JSON.parse(await readFile(filePath, 'utf8'));
      if (!Array.isArray(payload.events)) throw new Error('Invalid event store payload.');
      events = payload.events.slice(-limit);
    } catch (error) {
      if (error.code === 'ENOENT') {
        events = [];
        return;
      }
      throw error;
    }
  }

  function serialize(task) {
    const next = operation.then(task, task);
    operation = next.catch(() => {});
    return next;
  }

  return {
    append(incomingEvents) {
      return serialize(async () => {
        await load();
        const result = addUniqueEvents(events, incomingEvents, limit);
        if (!result.added) {
          return { added: 0, duplicates: result.duplicates };
        }

        events = result.events;
        await mkdir(dirname(filePath), { recursive: true });
        const temporaryPath = `${filePath}.${process.pid}.tmp`;
        await writeFile(temporaryPath, JSON.stringify({ events }, null, 2), {
          encoding: 'utf8',
          mode: 0o600
        });
        await rename(temporaryPath, filePath);
        return { added: result.added, duplicates: result.duplicates };
      });
    },

    list() {
      return serialize(async () => {
        await load();
        return clone(events);
      });
    }
  };
}
