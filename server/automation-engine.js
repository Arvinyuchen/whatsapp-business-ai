function normalizeMode(mode) {
  return ['off', 'dry-run', 'live'].includes(mode) ? mode : 'dry-run';
}

function latestInboundId(conversation) {
  return conversation.processedMessageIds?.at(-1) || null;
}

function isMessageAddress(value) {
  return /^\d{8,15}$/.test(value)
    || /^[A-Z]{2}\.(?:ENT\.)?[A-Za-z0-9]{1,128}$/.test(value);
}

export function parseAutomationAllowlist(value) {
  return String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(isMessageAddress);
}

function conversationAliases(conversation) {
  return [
    conversation.sourceId,
    conversation.identity?.phoneNumber,
    conversation.identity?.userId,
    conversation.identity?.parentUserId
  ].filter(Boolean);
}

function conversationAddress(conversation) {
  const phoneNumber = conversation.identity?.phoneNumber
    || (/^\d{8,15}$/.test(conversation.sourceId) ? conversation.sourceId : null);
  const userId = conversation.identity?.userId
    || conversation.identity?.parentUserId
    || (!phoneNumber ? conversation.sourceId : null);
  return {
    ...(phoneNumber ? { to: phoneNumber } : {}),
    ...(userId ? { recipient: userId } : {})
  };
}

function baseAudit({ conversation, inboundMessageId, now }) {
  return {
    id: `automation:${conversation.id}:${inboundMessageId}`,
    type: 'automation.decision',
    conversationId: conversation.id,
    inboundMessageId,
    recipient: conversation.sourceId,
    actor: { id: 'automation', role: 'system' },
    timestamp: now().toISOString()
  };
}

export function createAutomationEngine({
  mode = 'dry-run',
  allowlist = [],
  minConfidence = 0.9,
  replyGenerator,
  whatsappClient,
  workspaceStore,
  now = () => new Date(),
  logger = console
}) {
  const configuredMode = normalizeMode(mode);
  const allowedRecipients = new Set(allowlist.filter(isMessageAddress));
  const threshold = Number.isFinite(minConfidence)
    ? Math.min(1, Math.max(0, minConfidence))
    : 0.9;
  let activeRun = null;

  function getStatus() {
    return {
      mode: configuredMode,
      allowlistSize: allowedRecipients.size,
      minConfidence: threshold
    };
  }

  async function recordBlocked(conversation, inboundMessageId, reason) {
    return workspaceStore.recordAudit({
      ...baseAudit({ conversation, inboundMessageId, now }),
      outcome: 'blocked',
      reason
    });
  }

  async function processConversation(conversation, priorAuditIds, acknowledgedConversationIds) {
    const inboundMessageId = latestInboundId(conversation);
    if (!inboundMessageId) return null;
    const auditId = `automation:${conversation.id}:${inboundMessageId}`;
    if (priorAuditIds.has(auditId)) return null;

    if (configuredMode === 'off') {
      return recordBlocked(conversation, inboundMessageId, 'automation_off');
    }
    if (!conversationAliases(conversation).some((alias) => allowedRecipients.has(alias))) {
      return recordBlocked(conversation, inboundMessageId, 'recipient_not_allowlisted');
    }
    if (conversation.workflow !== 'open') {
      return recordBlocked(conversation, inboundMessageId, 'conversation_not_open');
    }

    let draft;
    try {
      draft = await replyGenerator.generate({ conversation, tone: 'helpful' });
    } catch (error) {
      return workspaceStore.recordAudit({
        ...baseAudit({ conversation, inboundMessageId, now }),
        outcome: 'failed',
        reason: 'draft_generation_failed',
        detail: error.message
      });
    }

    if (draft.provider === 'local_acknowledgement'
      && acknowledgedConversationIds.has(conversation.id)) {
      return workspaceStore.recordAudit({
        ...baseAudit({ conversation, inboundMessageId, now }),
        outcome: 'blocked',
        reason: 'acknowledgement_already_sent',
        confidence: draft.confidence,
        draft: draft.body,
        draftProvider: draft.provider
      });
    }

    if (draft.requiresHuman) {
      return workspaceStore.recordAudit({
        ...baseAudit({ conversation, inboundMessageId, now }),
        outcome: 'blocked',
        reason: 'draft_requires_human',
        confidence: draft.confidence,
        draft: draft.body
      });
    }
    if (!Number.isFinite(draft.confidence) || draft.confidence < threshold) {
      return workspaceStore.recordAudit({
        ...baseAudit({ conversation, inboundMessageId, now }),
        outcome: 'blocked',
        reason: 'confidence_below_threshold',
        confidence: draft.confidence ?? null,
        draft: draft.body
      });
    }
    if (configuredMode === 'dry-run') {
      return workspaceStore.recordAudit({
        ...baseAudit({ conversation, inboundMessageId, now }),
        outcome: 'dry_run',
        reason: 'live_send_disabled',
        confidence: draft.confidence,
        draft: draft.body
      });
    }

    const sendingAudit = {
      ...baseAudit({ conversation, inboundMessageId, now }),
      outcome: 'sending',
      reason: 'all_guards_passed',
      confidence: draft.confidence,
      draft: draft.body,
      ...(draft.provider ? { draftProvider: draft.provider } : {})
    };
    await workspaceStore.recordAudit(sendingAudit);
    try {
      const address = conversationAddress(conversation);
      const sent = await whatsappClient.sendText({
        ...address,
        body: draft.body
      });
      await workspaceStore.recordReply({
        conversationId: conversation.id,
        ...address,
        body: draft.body,
        messageId: sent.messageId
      });
      return workspaceStore.recordAudit({
        ...sendingAudit,
        outcome: 'sent',
        messageId: sent.messageId,
        completedAt: now().toISOString()
      });
    } catch (error) {
      return workspaceStore.recordAudit({
        ...sendingAudit,
        outcome: 'failed',
        reason: 'send_failed',
        detail: error.message,
        completedAt: now().toISOString()
      });
    }
  }

  async function runOnce() {
    const workspace = await workspaceStore.getWorkspace();
    const priorAuditIds = new Set(workspace.audits.map(({ id }) => id));
    const acknowledgedConversationIds = new Set(
      workspace.audits
        .filter(({ outcome, draftProvider }) => (
          outcome === 'sent' && draftProvider === 'local_acknowledgement'
        ))
        .map(({ conversationId }) => conversationId)
    );
    const candidates = workspace.conversations.filter(({ source }) => source === 'whatsapp');
    const decisions = [];
    for (const conversation of candidates) {
      const decision = await processConversation(
        conversation,
        priorAuditIds,
        acknowledgedConversationIds
      );
      if (decision) {
        decisions.push(decision);
        priorAuditIds.add(decision.id);
        if (decision.outcome === 'sent'
          && decision.draftProvider === 'local_acknowledgement') {
          acknowledgedConversationIds.add(decision.conversationId);
        }
      }
    }
    return decisions;
  }

  function run() {
    if (!activeRun) {
      activeRun = runOnce().finally(() => {
        activeRun = null;
      });
    }
    return activeRun;
  }

  function kick() {
    queueMicrotask(() => {
      run().catch((error) => logger.error('Automation run failed.', error));
    });
  }

  return { getStatus, kick, run };
}
