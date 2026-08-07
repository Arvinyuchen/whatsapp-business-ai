function clone(value) {
  return structuredClone(value);
}

export function createConversationStore(seedConversations, { storage } = {}) {
  const storedState = storage?.load();
  let conversations = clone(storedState?.conversations || seedConversations)
    .filter(({ source }) => source !== 'whatsapp');
  let filter = storedState?.filter || 'all';
  let selectedId = conversations.some(({ id }) => id === storedState?.selectedId)
    ? storedState.selectedId
    : conversations.find(({ workflow }) => workflow !== 'resolved')?.id || null;

  function persist() {
    const demoConversations = conversations.filter(({ source }) => source !== 'whatsapp');
    storage?.save({
      conversations: demoConversations,
      filter,
      selectedId: demoConversations.some(({ id }) => id === selectedId) ? selectedId : null
    });
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

    syncLiveConversations(liveConversations) {
      const currentLive = conversations.filter(({ source }) => source === 'whatsapp');
      const nextLive = clone(liveConversations || []);
      conversations = [
        ...nextLive,
        ...conversations.filter(({ source }) => source !== 'whatsapp')
      ];
      ensureVisibleSelection();
      return { changed: JSON.stringify(currentLive) !== JSON.stringify(nextLive) };
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
