function normalizeMode(mode) {
  return ['off', 'dry-run', 'live'].includes(mode) ? mode : 'dry-run';
}

function latestInboundId(conversation) {
  return conversation.processedMessageIds?.at(-1) || null;
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
  const allowedRecipients = new Set(allowlist.filter((value) => /^\d{8,15}$/.test(value)));
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

  async function processConversation(conversation, priorAuditIds) {
    const inboundMessageId = latestInboundId(conversation);
    if (!inboundMessageId) return null;
    const auditId = `automation:${conversation.id}:${inboundMessageId}`;
    if (priorAuditIds.has(auditId)) return null;

    if (configuredMode === 'off') {
      return recordBlocked(conversation, inboundMessageId, 'automation_off');
    }
    if (!allowedRecipients.has(conversation.sourceId)) {
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
      draft: draft.body
    };
    await workspaceStore.recordAudit(sendingAudit);
    try {
      const sent = await whatsappClient.sendText({
        to: conversation.sourceId,
        body: draft.body
      });
      await workspaceStore.recordReply({
        conversationId: conversation.id,
        to: conversation.sourceId,
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
    const candidates = workspace.conversations.filter(({ source }) => source === 'whatsapp');
    const decisions = [];
    for (const conversation of candidates) {
      const decision = await processConversation(conversation, priorAuditIds);
      if (decision) {
        decisions.push(decision);
        priorAuditIds.add(decision.id);
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
