function clone(value) {
  return structuredClone(value);
}

function createWhatsAppConversation(event) {
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
    activity: [{ type: 'received', label: 'Inbound WhatsApp message received' }],
    replies: {
      helpful: 'Thanks for your message. I am reviewing the details now and will get back to you shortly.',
      sales: 'Thanks for getting in touch. I am reviewing your request and will help you with the next step.',
      ops: 'Inbound WhatsApp message received. Review the request, confirm the required action, and reply from the operator desk.'
    }
  };
}

export function createConversationStore(seedConversations, { storage } = {}) {
  const storedState = storage?.load();
  let conversations = clone(storedState?.conversations || seedConversations);
  let filter = storedState?.filter || 'all';
  let selectedId = storedState?.selectedId || conversations.find(({ workflow }) => workflow !== 'resolved')?.id || null;

  function persist() {
    storage?.save({ conversations, filter, selectedId });
  }

  function isActive(conversation) {
    return ['open', 'needs_review'].includes(conversation.workflow);
  }

  function isVisible(conversation) {
    if (filter === 'all') return isActive(conversation);
    if (['open', 'needs_review', 'deferred', 'resolved'].includes(filter)) {
      return conversation.workflow === filter;
    }

    return isActive(conversation) && conversation.queue?.includes(filter);
  }

  function ensureVisibleSelection() {
    const visible = conversations.filter(isVisible);
    if (!visible.some(({ id }) => id === selectedId)) {
      selectedId = visible[0]?.id || null;
    }
  }

  function getMetrics() {
    const active = conversations.filter(isActive);

    return {
      active: active.length,
      needsReview: active.filter(({ workflow }) => workflow === 'needs_review').length,
      orders: active.filter(({ queue }) => queue?.includes('order')).length,
      valueInPlay: active.reduce((total, conversation) => total + (conversation.valueAmount || 0), 0)
    };
  }

  return {
    getSnapshot() {
      ensureVisibleSelection();
      return clone({
        conversations,
        filter,
        selectedId,
        selectedConversation: conversations.find(({ id }) => id === selectedId) || null,
        visibleConversations: conversations.filter(isVisible),
        metrics: getMetrics()
      });
    },

    setFilter(nextFilter) {
      filter = nextFilter;
      ensureVisibleSelection();
      persist();
    },

    select(id) {
      if (conversations.some((conversation) => conversation.id === id)) {
        selectedId = id;
        persist();
      }
    },

    ingestWhatsAppEvents(events) {
      const result = { created: 0, updated: 0, ignored: 0 };
      const chronologicalEvents = [...events].sort((left, right) => {
        return (Number(left.timestamp) || 0) - (Number(right.timestamp) || 0);
      });

      for (const event of chronologicalEvents) {
        if (event.type !== 'message.received' || !event.from) continue;

        const existingIndex = conversations.findIndex((conversation) => {
          return conversation.source === 'whatsapp' && conversation.sourceId === event.from;
        });
        const existing = conversations[existingIndex];
        if (existing?.processedMessageIds?.includes(event.messageId)) {
          result.ignored += 1;
          continue;
        }

        if (!existing) {
          conversations.unshift(createWhatsAppConversation(event));
          result.created += 1;
          continue;
        }

        existing.processedMessageIds ??= [];
        if (event.messageId) existing.processedMessageIds.push(event.messageId);
        existing.name = event.contactName || existing.name;
        existing.status = 'New live message';
        existing.workflow = 'open';
        existing.preview = event.text || 'New WhatsApp message';
        existing.messages.push([
          'customer',
          event.text || 'Message received without a text preview.'
        ]);
        existing.activity ??= [];
        existing.activity.push({
          type: 'received',
          label: 'New inbound WhatsApp message received'
        });
        conversations.splice(existingIndex, 1);
        conversations.unshift(existing);
        result.updated += 1;
      }

      if (result.created || result.updated) {
        ensureVisibleSelection();
        persist();
      }

      return result;
    },

    sendReply(id, text, { live = false, messageId } = {}) {
      if (!text.trim()) {
        throw new Error('Reply cannot be empty.');
      }

      const conversation = conversations.find((item) => item.id === id);
      conversation.messages.push(['agent', text.trim()]);
      conversation.workflow = 'resolved';
      conversation.activity ??= [];
      conversation.activity.push({
        type: 'sent',
        label: live ? 'Live reply accepted by WhatsApp' : 'Reply approved and sent',
        ...(messageId ? { messageId } : {})
      });
      ensureVisibleSelection();
      persist();
    },

    escalate(id) {
      const conversation = conversations.find((item) => item.id === id);
      conversation.workflow = 'needs_review';
      conversation.activity ??= [];
      conversation.activity.push({
        type: 'escalated',
        label: 'Escalated to a specialist'
      });
      persist();
    },

    defer(id) {
      const conversation = conversations.find((item) => item.id === id);
      conversation.workflow = 'deferred';
      conversation.activity ??= [];
      conversation.activity.push({
        type: 'deferred',
        label: 'Follow-up queued for later today'
      });
      ensureVisibleSelection();
      persist();
    },

    reset() {
      conversations = clone(seedConversations);
      filter = 'all';
      selectedId = conversations.find(({ workflow }) => workflow !== 'resolved')?.id || null;
      storage?.clear();
    }
  };
}
