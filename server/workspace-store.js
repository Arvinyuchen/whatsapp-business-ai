import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function clone(value) {
  return structuredClone(value);
}

function emptyWorkspace() {
  return { events: [], conversations: [], audits: [] };
}

function normalizeWorkspace(workspace) {
  return {
    events: Array.isArray(workspace?.events) ? workspace.events : [],
    conversations: Array.isArray(workspace?.conversations) ? workspace.conversations : [],
    audits: Array.isArray(workspace?.audits) ? workspace.audits : []
  };
}

function getEventKey(event) {
  if (!event?.type || !event.messageId) return null;
  if (event.type === 'message.status') {
    return `${event.type}:${event.messageId}:${event.status || 'updated'}`;
  }
  return `${event.type}:${event.messageId}`;
}

function deliveryLabel(status) {
  const labels = {
    sent: 'Live reply sent by WhatsApp',
    delivered: 'Live reply delivered',
    read: 'Live reply read',
    failed: 'Live reply delivery failed',
    undelivered: 'Live reply undelivered'
  };
  return labels[status] || `Live reply status: ${status || 'updated'}`;
}

function eventIsoTimestamp(event) {
  const seconds = Number(event?.timestamp);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1_000).toISOString()
    : new Date().toISOString();
}

function createConversation(event) {
  const contactName = event.contactName || `WhatsApp ${String(event.from).slice(-4)}`;
  return {
    id: `whatsapp:${event.from}`,
    source: 'whatsapp',
    sourceId: event.from,
    processedMessageIds: event.messageId ? [event.messageId] : [],
    name: contactName,
    company: 'WhatsApp contact',
    status: 'Live inbound message',
    workflow: 'open',
    intent: 'New inbound message',
    confidence: 100,
    queue: [],
    value: '$0',
    valueAmount: 0,
    risk: 'No automated decision has been made for this live message',
    riskLevel: 'low',
    action: 'Review the message and prepare a reply',
    preview: event.text || 'New WhatsApp message',
    tags: ['Live', 'Inbound'],
    messages: [['customer', event.text || 'Message received without a text preview.']],
    activity: [{
      type: 'received',
      label: 'Inbound WhatsApp message received',
      ...(event.timestamp ? { timestamp: event.timestamp } : {})
    }],
    updatedAt: eventIsoTimestamp(event),
    replies: {
      helpful: 'Thanks for your message. I am reviewing the details now and will get back to you shortly.',
      sales: 'Thanks for getting in touch. I am reviewing your request and will help you with the next step.',
      ops: 'Inbound WhatsApp message received. Review the request, confirm the required action, and reply from the operator desk.'
    }
  };
}

function eventTime(event, fallback) {
  const timestamp = Number(event?.timestamp);
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function applyInboundEvents(workspace, events) {
  let changed = 0;
  const chronological = events
    .filter((event) => event.type === 'message.received' && event.from)
    .map((event, index) => ({ event, index }))
    .sort((left, right) => eventTime(left.event, left.index) - eventTime(right.event, right.index));

  for (const { event } of chronological) {
    const existingIndex = workspace.conversations.findIndex((conversation) => {
      return conversation.source === 'whatsapp' && conversation.sourceId === event.from;
    });
    const existing = workspace.conversations[existingIndex];
    if (existing?.processedMessageIds?.includes(event.messageId)) continue;

    if (!existing) {
      workspace.conversations.unshift(createConversation(event));
      changed += 1;
      continue;
    }

    existing.processedMessageIds ??= [];
    if (event.messageId) existing.processedMessageIds.push(event.messageId);
    existing.name = event.contactName || existing.name;
    existing.status = 'New live message';
    existing.workflow = 'open';
    existing.risk = 'No automated decision has been made for this live message';
    existing.riskLevel = 'low';
    existing.action = 'Review the message and prepare a reply';
    existing.tags = (existing.tags || []).filter((tag) => tag !== 'Delivery failed');
    existing.preview = event.text || 'New WhatsApp message';
    existing.updatedAt = eventIsoTimestamp(event);
    existing.messages.push(['customer', event.text || 'Message received without a text preview.']);
    existing.activity ??= [];
    existing.activity.push({
      type: 'received',
      label: 'New inbound WhatsApp message received',
      ...(event.timestamp ? { timestamp: event.timestamp } : {})
    });
    workspace.conversations.splice(existingIndex, 1);
    workspace.conversations.unshift(existing);
    changed += 1;
  }
  return changed;
}

function applyLatestDeliveryStates(workspace) {
  const latestByMessage = new Map();
  workspace.events.forEach((event, index) => {
    if (event.type !== 'message.status' || !event.messageId) return;
    const previous = latestByMessage.get(event.messageId);
    if (!previous || eventTime(event, index) >= eventTime(previous.event, previous.index)) {
      latestByMessage.set(event.messageId, { event, index });
    }
  });

  let changed = 0;
  for (const { event } of latestByMessage.values()) {
    const conversationIndex = workspace.conversations.findIndex((conversation) => {
      return conversation.activity?.some(({ messageId }) => messageId === event.messageId);
    });
    const conversation = workspace.conversations[conversationIndex];
    const activity = conversation?.activity?.find(({ messageId }) => messageId === event.messageId);
    if (!activity) continue;

    const status = String(event.status || 'updated').toLowerCase();
    if (activity.deliveryStatus === status) continue;
    activity.deliveryStatus = status;
    activity.label = deliveryLabel(status);
    if (event.timestamp) activity.timestamp = event.timestamp;
    conversation.status = activity.label;
    if (['failed', 'undelivered'].includes(status)) {
      conversation.workflow = 'needs_review';
      conversation.risk = 'WhatsApp could not deliver the most recent live reply';
      conversation.riskLevel = 'high';
      conversation.action = 'Review the failure and choose a template or another contact path';
      conversation.tags = [...new Set([...(conversation.tags || []), 'Delivery failed'])];
      workspace.conversations.splice(conversationIndex, 1);
      workspace.conversations.unshift(conversation);
    }
    changed += 1;
  }
  return changed;
}

function addEvents(workspace, incomingEvents, limit) {
  const keys = new Set(workspace.events.map(getEventKey).filter(Boolean));
  const addedEvents = [];
  let duplicates = 0;
  for (const event of incomingEvents || []) {
    const key = getEventKey(event);
    if (key && keys.has(key)) {
      duplicates += 1;
      continue;
    }
    if (key) keys.add(key);
    addedEvents.push(clone(event));
  }

  workspace.events = [...workspace.events, ...addedEvents].slice(-limit);
  const conversationsChanged = applyInboundEvents(workspace, addedEvents)
    + applyLatestDeliveryStates(workspace);
  return { added: addedEvents.length, duplicates, conversationsChanged };
}

function recordReply(workspace, { conversationId, to, body, messageId, actor }) {
  const reply = String(body || '').trim();
  if (!reply) throw new Error('Reply cannot be empty.');
  const conversation = workspace.conversations.find(({ id }) => id === conversationId);
  if (!conversation) throw Object.assign(new Error('Live conversation not found.'), { status: 404 });
  if (conversation.sourceId !== to) {
    throw Object.assign(new Error('Reply recipient does not match the conversation.'), { status: 400 });
  }
  if (conversation.activity?.some((activity) => activity.messageId === messageId)) return conversation;

  conversation.messages.push(['agent', reply]);
  conversation.workflow = 'resolved';
  conversation.status = 'Live reply accepted by WhatsApp';
  conversation.updatedAt = new Date().toISOString();
  conversation.activity ??= [];
  conversation.activity.push({
    type: 'sent',
    label: 'Live reply accepted by WhatsApp',
    ...(actor ? { actor } : {}),
    ...(messageId ? { messageId } : {})
  });
  if (actor) {
    workspace.audits.push({
      id: `operator:reply:${messageId}`,
      type: 'operator.reply',
      conversationId,
      recipient: to,
      messageId,
      actor,
      timestamp: new Date().toISOString()
    });
  }
  return conversation;
}

function applyAction(workspace, { conversationId, action, actor }) {
  const conversation = workspace.conversations.find(({ id }) => id === conversationId);
  if (!conversation) throw Object.assign(new Error('Live conversation not found.'), { status: 404 });

  conversation.activity ??= [];
  if (action === 'escalate') {
    conversation.workflow = 'needs_review';
    conversation.activity.push({
      type: 'escalated', label: 'Escalated to a specialist', ...(actor ? { actor } : {})
    });
  } else if (action === 'defer') {
    conversation.workflow = 'deferred';
    conversation.activity.push({
      type: 'deferred', label: 'Follow-up queued for later today', ...(actor ? { actor } : {})
    });
  } else {
    throw Object.assign(new Error('Unsupported conversation action.'), { status: 400 });
  }
  conversation.updatedAt = new Date().toISOString();
  if (actor) {
    workspace.audits.push({
      id: `operator:action:${randomUUID()}`,
      type: 'operator.action',
      conversationId,
      action,
      actor,
      timestamp: new Date().toISOString()
    });
  }
  return conversation;
}

function createStoreAdapter({ read, update, eventLimit }) {
  return {
    async applyEvents(events) {
      return update((workspace) => addEvents(workspace, events, eventLimit));
    },
    async getWorkspace() {
      return clone(read());
    },
    async recordReply(input) {
      return update((workspace) => clone(recordReply(workspace, input)));
    },
    async applyAction(input) {
      return update((workspace) => clone(applyAction(workspace, input)));
    },
    async recordAudit(audit) {
      if (!audit?.id) throw new Error('An audit ID is required.');
      return update((workspace) => {
        const index = workspace.audits.findIndex(({ id }) => id === audit.id);
        if (index === -1) workspace.audits.push(clone(audit));
        else workspace.audits[index] = clone(audit);
        return clone(audit);
      });
    },
    async prune({
      retentionDays = 90,
      auditLimit = 1_000,
      eventLimit: pruneEventLimit = eventLimit,
      now = new Date()
    } = {}) {
      return update((workspace) => {
        const before = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1_000);
        const beforeSeconds = before.getTime() / 1_000;
        const countsBefore = {
          events: workspace.events.length,
          conversations: workspace.conversations.length,
          audits: workspace.audits.length
        };
        workspace.events = workspace.events
          .filter((event) => !Number.isFinite(Number(event.timestamp)) || Number(event.timestamp) >= beforeSeconds)
          .slice(-pruneEventLimit);
        workspace.audits = workspace.audits
          .filter((audit) => !Number.isFinite(Date.parse(audit.timestamp)) || Date.parse(audit.timestamp) >= before.getTime())
          .slice(-auditLimit);
        workspace.conversations = workspace.conversations.filter((conversation) => {
          if (['open', 'needs_review'].includes(conversation.workflow)) return true;
          const updatedAt = Date.parse(conversation.updatedAt);
          return !Number.isFinite(updatedAt) || updatedAt >= before.getTime();
        });
        return {
          removed: {
            events: countsBefore.events - workspace.events.length,
            conversations: countsBefore.conversations - workspace.conversations.length,
            audits: countsBefore.audits - workspace.audits.length
          },
          retained: {
            events: workspace.events.length,
            conversations: workspace.conversations.length,
            audits: workspace.audits.length
          },
          before: before.toISOString()
        };
      });
    }
  };
}

export function createMemoryWorkspaceStore({ eventLimit = 50 } = {}) {
  let workspace = emptyWorkspace();
  return createStoreAdapter({
    eventLimit,
    read: () => normalizeWorkspace(workspace),
    update(mutate) {
      workspace = normalizeWorkspace(workspace);
      const result = mutate(workspace);
      return clone(result);
    }
  });
}

export function createSqliteWorkspaceStore({ filePath, eventLimit = 50 } = {}) {
  if (!filePath) throw new Error('A workspace database path is required.');
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(filePath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS workspace_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const selectState = database.prepare('SELECT payload FROM workspace_state WHERE id = 1');
  const writeState = database.prepare(`
    INSERT INTO workspace_state (id, payload, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `);

  function read() {
    const row = selectState.get();
    return row ? normalizeWorkspace(JSON.parse(row.payload)) : emptyWorkspace();
  }

  function update(mutate) {
    database.exec('BEGIN IMMEDIATE');
    try {
      const workspace = read();
      const result = mutate(workspace);
      writeState.run(JSON.stringify(workspace), new Date().toISOString());
      database.exec('COMMIT');
      return clone(result);
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  return createStoreAdapter({ read, update, eventLimit });
}
