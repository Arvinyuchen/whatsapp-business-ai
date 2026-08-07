import { createConversationStore } from './conversation-store.js';
import { createActivityRefresh } from './activity-refresh.js';
import { seedConversations } from './conversations.js';
import { createLocalStorageAdapter } from './storage.js';
import { createRequestKeyStore } from './request-key-store.js';
import {
  applyLiveConversationAction,
  generateLiveReplyDraft,
  loadLiveWorkspace
} from './live-workspace.js';
import { presentWhatsAppEvent, sortWhatsAppEvents } from './whatsapp-activity.js';
import { sendWhatsAppReply } from './whatsapp-reply.js';

const workflowLabels = {
  open: 'Open',
  needs_review: 'Needs review',
  deferred: 'Deferred',
  resolved: 'Resolved'
};

const store = createConversationStore(seedConversations, {
  storage: createLocalStorageAdapter('wa-business-ai-demo')
});
const requestKeys = createRequestKeyStore();

const uiState = {
  tone: 'helpful',
  stockCheck: true,
  operatorToken: '',
  templates: [],
  events: [],
  activityLoading: false,
  sendConfirmResolve: null,
  toastTimer: null
};

const elements = {
  serveWarning: document.querySelector('#serveWarning'),
  queueFilter: document.querySelector('#queueFilter'),
  conversationList: document.querySelector('#conversationList'),
  sidebarReviewCount: document.querySelector('#sidebarReviewCount'),
  metricActive: document.querySelector('#metricActive'),
  metricReview: document.querySelector('#metricReview'),
  metricOrders: document.querySelector('#metricOrders'),
  metricValue: document.querySelector('#metricValue'),
  workflowBadge: document.querySelector('#workflowBadge'),
  chatStatus: document.querySelector('#chatStatus'),
  chatName: document.querySelector('#chatName'),
  chatIntent: document.querySelector('#chatIntent'),
  chatConfidence: document.querySelector('#chatConfidence'),
  messageThread: document.querySelector('#messageThread'),
  composer: document.querySelector('#composer'),
  replyDraft: document.querySelector('#replyDraft'),
  replyError: document.querySelector('#replyError'),
  detailIntent: document.querySelector('#detailIntent'),
  detailConfidence: document.querySelector('#detailConfidence'),
  detailAction: document.querySelector('#detailAction'),
  detailValue: document.querySelector('#detailValue'),
  detailRisk: document.querySelector('#detailRisk'),
  riskBadge: document.querySelector('#riskBadge'),
  activityList: document.querySelector('#activityList'),
  shipmentRule: document.querySelector('#shipmentRule'),
  rewriteButton: document.querySelector('#rewriteButton'),
  sendButton: document.querySelector('#sendButton'),
  sendButtonLabel: document.querySelector('#sendButtonLabel'),
  escalateButton: document.querySelector('#escalateButton'),
  deferButton: document.querySelector('#deferButton'),
  resetButton: document.querySelector('#resetButton'),
  connectWhatsAppButton: document.querySelector('#connectWhatsAppButton'),
  connectButtonLabel: document.querySelector('#connectButtonLabel'),
  connectionDialog: document.querySelector('#connectionDialog'),
  closeConnectionDialog: document.querySelector('#closeConnectionDialog'),
  doneConnectionButton: document.querySelector('#doneConnectionButton'),
  refreshConnectionButton: document.querySelector('#refreshConnectionButton'),
  connectionStateBadge: document.querySelector('#connectionStateBadge'),
  connectionSummary: document.querySelector('#connectionSummary'),
  connectionChecklist: document.querySelector('#connectionChecklist'),
  webhookUrl: document.querySelector('#webhookUrl'),
  templateAccessForm: document.querySelector('#templateAccessForm'),
  operatorToken: document.querySelector('#operatorToken'),
  refreshTemplatesButton: document.querySelector('#refreshTemplatesButton'),
  templateFeedback: document.querySelector('#templateFeedback'),
  templateList: document.querySelector('#templateList'),
  templateSendForm: document.querySelector('#templateSendForm'),
  templateRecipient: document.querySelector('#templateRecipient'),
  templateSelect: document.querySelector('#templateSelect'),
  templatePreview: document.querySelector('#templatePreview'),
  sendTemplateButton: document.querySelector('#sendTemplateButton'),
  refreshActivityButton: document.querySelector('#refreshActivityButton'),
  activityFeedback: document.querySelector('#activityFeedback'),
  activityLedger: document.querySelector('#activityLedger'),
  stockCheckToggle: document.querySelector('#stockCheckToggle'),
  toneOptions: document.querySelectorAll('.tone-option'),
  sendConfirmDialog: document.querySelector('#sendConfirmDialog'),
  sendConfirmTitle: document.querySelector('#sendConfirmTitle'),
  sendConfirmRecipient: document.querySelector('#sendConfirmRecipient'),
  sendConfirmPreview: document.querySelector('#sendConfirmPreview'),
  cancelSendConfirmButton: document.querySelector('#cancelSendConfirmButton'),
  approveSendConfirmButton: document.querySelector('#approveSendConfirmButton'),
  toast: document.querySelector('#toast')
};

elements.serveWarning.hidden = true;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0
  }).format(value);
}

function renderMetrics(metrics) {
  elements.metricActive.textContent = metrics.active;
  elements.metricReview.textContent = metrics.needsReview;
  elements.metricOrders.textContent = metrics.orders;
  elements.metricValue.textContent = formatCurrency(metrics.valueInPlay);
  elements.sidebarReviewCount.textContent = `${metrics.needsReview} ${metrics.needsReview === 1 ? 'needs' : 'need'} review`;
}

function renderConversationList(snapshot) {
  if (!snapshot.visibleConversations.length) {
    elements.conversationList.innerHTML = `
      <div class="empty-queue">
        <div>
          <strong>Nothing in this queue.</strong>
          <span>Choose another filter or reset the demo.</span>
        </div>
      </div>
    `;
    return;
  }

  elements.conversationList.innerHTML = snapshot.visibleConversations
    .map((conversation) => {
      const active = conversation.id === snapshot.selectedId ? ' active' : '';
      const tags = conversation.tags
        .map((tag) => `<span>${escapeHtml(tag)}</span>`)
        .join('');

      return `
        <button
          class="conversation-item${active}"
          type="button"
          data-id="${escapeHtml(conversation.id)}"
          data-workflow="${escapeHtml(conversation.workflow)}"
          aria-pressed="${conversation.id === snapshot.selectedId}"
        >
          <span class="conversation-topline">
            <strong>${escapeHtml(conversation.name)}</strong>
            <small>${conversation.confidence}%</small>
          </span>
          <span class="conversation-company">${escapeHtml(conversation.company)}</span>
          <span class="conversation-preview">${escapeHtml(conversation.preview)}</span>
          <span class="tag-row">${tags}</span>
          <span class="workflow-label">${escapeHtml(workflowLabels[conversation.workflow])}</span>
        </button>
      `;
    })
    .join('');
}

function renderMessages(conversation) {
  elements.messageThread.innerHTML = conversation.messages
    .map(([sender, text]) => {
      return `<div class="message ${escapeHtml(sender)}"><span>${escapeHtml(text)}</span></div>`;
    })
    .join('');
  elements.messageThread.scrollTop = elements.messageThread.scrollHeight;
}

function renderActivity(conversation) {
  elements.activityList.innerHTML = conversation.activity
    .map(({ label }) => `<li>${escapeHtml(label)}</li>`)
    .join('');
}

function renderDecisionRail(conversation) {
  elements.detailIntent.textContent = conversation.intent;
  elements.detailConfidence.textContent = `${conversation.confidence}% confidence`;
  elements.detailAction.textContent = conversation.action;
  elements.detailValue.textContent = `${conversation.value} conversation value`;
  elements.detailRisk.textContent = conversation.risk;
  elements.riskBadge.textContent = `${conversation.riskLevel} risk`;
  elements.riskBadge.dataset.risk = conversation.riskLevel;
  elements.shipmentRule.hidden = !conversation.queue.some((queue) => ['order', 'delivery'].includes(queue));
  renderActivity(conversation);
}

function getSuggestedReply(conversation) {
  const stockSuffix =
    uiState.stockCheck && conversation.queue.includes('order')
      ? ' I will include stock availability before confirming the order.'
      : '';

  return `${conversation.replies[uiState.tone]}${stockSuffix}`;
}

function renderReply(conversation) {
  elements.stockCheckToggle.disabled = !conversation.queue.includes('order');
  elements.stockCheckToggle.checked = uiState.stockCheck && !elements.stockCheckToggle.disabled;
  elements.replyDraft.value = getSuggestedReply(conversation);
}

function renderEmptyConversation() {
  elements.workflowBadge.textContent = 'Queue clear';
  elements.workflowBadge.dataset.workflow = 'resolved';
  elements.chatStatus.textContent = 'No conversation selected';
  elements.chatName.textContent = 'Choose another queue';
  elements.chatIntent.textContent = '—';
  elements.chatConfidence.textContent = '—';
  elements.messageThread.innerHTML = `
    <div class="empty-chat">
      <div>
        <strong>This queue is clear.</strong>
        <span>Select another filter to continue reviewing conversations.</span>
      </div>
    </div>
  `;
  elements.composer.hidden = true;
  elements.detailIntent.textContent = 'No active conversation';
  elements.detailConfidence.textContent = 'Waiting for a selection';
  elements.detailRisk.textContent = 'No guardrail is active';
  elements.detailValue.textContent = '—';
  elements.detailAction.textContent = 'Choose another queue';
  elements.riskBadge.textContent = 'No risk';
  elements.riskBadge.dataset.risk = 'low';
  elements.activityList.innerHTML = '<li>Queue review complete</li>';
  elements.shipmentRule.hidden = true;
}

function renderConversation(conversation, { refreshDraft }) {
  if (!conversation) {
    renderEmptyConversation();
    return;
  }

  elements.composer.hidden = false;
  elements.workflowBadge.textContent = workflowLabels[conversation.workflow];
  elements.workflowBadge.dataset.workflow = conversation.workflow;
  elements.chatStatus.textContent = conversation.status;
  elements.chatName.textContent = conversation.name;
  elements.chatIntent.textContent = conversation.intent;
  elements.chatConfidence.textContent = `${conversation.confidence}%`;
  elements.sendButtonLabel.textContent = conversation.source === 'whatsapp'
    ? 'Review & send live'
    : conversation.workflow === 'needs_review'
      ? 'Approve & send'
      : 'Send reply';
  elements.escalateButton.disabled = conversation.workflow === 'needs_review';
  elements.escalateButton.textContent = conversation.workflow === 'needs_review' ? 'Escalated' : 'Escalate';
  renderMessages(conversation);
  renderDecisionRail(conversation);
  if (refreshDraft) renderReply(conversation);
}

function clearReplyError() {
  elements.replyError.textContent = '';
  elements.replyDraft.removeAttribute('aria-invalid');
}

function render(options = { refreshDraft: true }) {
  const snapshot = store.getSnapshot();
  elements.queueFilter.value = snapshot.filter;
  renderMetrics(snapshot.metrics);
  renderConversationList(snapshot);
  renderConversation(snapshot.selectedConversation, options);
  clearReplyError();
}

function showToast(message) {
  window.clearTimeout(uiState.toastTimer);
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  uiState.toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 3200);
}

function requestSendConfirmation({ title, recipient, body, confirmLabel }) {
  if (uiState.sendConfirmResolve) return Promise.resolve(false);

  elements.sendConfirmTitle.textContent = title;
  elements.sendConfirmRecipient.textContent = recipient;
  elements.sendConfirmPreview.textContent = body;
  elements.approveSendConfirmButton.textContent = confirmLabel;
  elements.sendConfirmDialog.showModal();
  elements.cancelSendConfirmButton.focus();

  return new Promise((resolve) => {
    uiState.sendConfirmResolve = resolve;
  });
}

function resolveSendConfirmation(confirmed) {
  const resolve = uiState.sendConfirmResolve;
  uiState.sendConfirmResolve = null;
  if (elements.sendConfirmDialog.open) elements.sendConfirmDialog.close();
  resolve?.(confirmed);
}

const connectionFields = [
  ['WHATSAPP_ACCESS_TOKEN', 'Access token'],
  ['WHATSAPP_PHONE_NUMBER_ID', 'Phone number ID'],
  ['WHATSAPP_VERIFY_TOKEN', 'Webhook verify token'],
  ['META_APP_SECRET', 'Meta app secret']
];

function renderConnectionStatus(status) {
  const missing = new Set(status.missing || connectionFields.map(([name]) => name));
  const ready = Boolean(status.configured);
  elements.connectWhatsAppButton.dataset.ready = String(ready);
  elements.connectButtonLabel.textContent = ready ? 'API ready' : 'Connect WhatsApp';
  elements.connectionStateBadge.dataset.ready = String(ready);
  elements.connectionStateBadge.textContent = ready ? 'Ready' : 'Setup needed';
  elements.connectionSummary.textContent = status.serverOffline
    ? 'Start the Node development server to check WhatsApp configuration.'
    : ready
      ? `Cloud API ${status.graphVersion} is configured and signed webhooks are required.`
      : `${missing.size} required ${missing.size === 1 ? 'value is' : 'values are'} missing from the local environment.`;
  elements.connectionChecklist.innerHTML = connectionFields
    .map(([name, label]) => {
      const fieldReady = !missing.has(name);
      return `
        <li data-ready="${fieldReady}">
          <span>${escapeHtml(label)}</span>
          <code>${escapeHtml(name)}</code>
          <strong>${fieldReady ? 'Ready' : 'Missing'}</strong>
        </li>
      `;
    })
    .join('');
  elements.webhookUrl.textContent = status.webhookUrl || (status.webhookPath
    ? `${window.location.origin}${status.webhookPath}`
    : 'Start npm run dev to expose the webhook path');
}

async function loadConnectionStatus() {
  elements.connectionStateBadge.removeAttribute('data-ready');
  elements.connectionStateBadge.textContent = 'Checking';
  elements.connectionSummary.textContent = 'Checking the local server configuration…';

  try {
    const response = await fetch('/api/whatsapp/status', {
      headers: { accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Status endpoint unavailable');
    renderConnectionStatus(await response.json());
  } catch {
    renderConnectionStatus({
      configured: false,
      missing: connectionFields.map(([name]) => name),
      serverOffline: true
    });
  }
}

function templateStatusTone(status) {
  if (status === 'APPROVED') return 'approved';
  if (status === 'REJECTED') return 'rejected';
  if (status === 'PENDING' || status === 'IN_APPEAL') return 'pending';
  return 'paused';
}

function setTemplateFeedback(message, tone = 'neutral') {
  elements.templateFeedback.dataset.tone = tone;
  elements.templateFeedback.textContent = message;
}

function setActivityFeedback(message, tone = 'neutral') {
  elements.activityFeedback.dataset.tone = tone;
  elements.activityFeedback.textContent = message;
}

function renderWhatsAppActivity() {
  const events = sortWhatsAppEvents(uiState.events).map((event) => presentWhatsAppEvent(event));
  if (!events.length) {
    elements.activityLedger.innerHTML = `
      <div class="activity-empty">
        <strong>No signed events yet.</strong>
        <span>Send a message to the connected number or refresh after a delivery update.</span>
      </div>
    `;
    return;
  }

  elements.activityLedger.innerHTML = events
    .map((event) => `
      <article class="activity-ledger-row" data-kind="${escapeHtml(event.kind)}">
        <span class="activity-direction" aria-hidden="true">${escapeHtml(event.marker)}</span>
        <div class="activity-copy">
          <span>${escapeHtml(event.label)}</span>
          <strong>${escapeHtml(event.subject)}</strong>
          <p>${escapeHtml(event.detail)}</p>
          <code title="${escapeHtml(event.id)}">${escapeHtml(event.id)}</code>
        </div>
        <time>${escapeHtml(event.timestamp)}</time>
      </article>
    `)
    .join('');
}

async function loadWhatsAppActivity({ useEnteredToken = false, silent = false } = {}) {
  const token = useEnteredToken
    ? elements.operatorToken.value.trim()
    : uiState.operatorToken;
  if (!token) {
    if (!silent) {
      setActivityFeedback('Enter the operator token to load WhatsApp activity.', 'warning');
    }
    return false;
  }
  if (uiState.activityLoading) return false;

  uiState.operatorToken = token;
  uiState.activityLoading = true;
  elements.refreshActivityButton.disabled = true;
  if (!silent) setActivityFeedback('Loading signed webhook activity…');

  try {
    const payload = await loadLiveWorkspace({ token });

    uiState.events = payload.events;
    const selectedBeforeSync = store.getSnapshot().selectedId;
    const syncResult = store.syncLiveConversations(payload.conversations);
    const selectedAfterSync = store.getSnapshot().selectedId;
    if (syncResult.changed) {
      render({ refreshDraft: selectedBeforeSync !== selectedAfterSync });
    }
    renderWhatsAppActivity();
    setActivityFeedback(
      payload.events.length
        ? `${payload.events.length} recent ${payload.events.length === 1 ? 'event' : 'events'} from signed webhooks · ${payload.conversations.length} shared live ${payload.conversations.length === 1 ? 'conversation' : 'conversations'} · Auto-refresh active.`
        : 'Webhook connection is ready. No events have arrived yet · Auto-refresh active.',
      'success'
    );
    return true;
  } catch (error) {
    uiState.events = [];
    elements.activityLedger.innerHTML = '';
    if (error.status === 401) {
      uiState.operatorToken = '';
      activityRefresh.stop();
      elements.refreshTemplatesButton.disabled = true;
      setTemplateFeedback('Operator access expired. Load the workspace again.', 'warning');
    }
    setActivityFeedback(error.message, 'danger');
    return false;
  } finally {
    uiState.activityLoading = false;
    elements.refreshActivityButton.disabled = !uiState.operatorToken;
  }
}

const activityRefresh = createActivityRefresh({
  refresh: () => loadWhatsAppActivity({ silent: true }),
  isVisible: () => !document.hidden
});

function renderTemplatePreview() {
  const template = uiState.templates.find(({ id }) => id === elements.templateSelect.value);
  elements.templatePreview.innerHTML = template
    ? `
      <span>${escapeHtml(template.category)} · ${escapeHtml(template.language)}</span>
      <p>${escapeHtml(template.body || 'No body preview available.')}</p>
    `
    : '';
}

function renderTemplateDesk() {
  const templates = uiState.templates;
  if (!templates.length) {
    elements.templateList.innerHTML = '<p class="template-empty">No templates found for this business account.</p>';
    elements.templateSendForm.hidden = true;
    return;
  }

  elements.templateList.innerHTML = templates
    .map((template) => `
      <article class="template-ledger-row">
        <span class="template-status-marker" data-status="${templateStatusTone(template.status)}" aria-hidden="true"></span>
        <div>
          <strong>${escapeHtml(template.name)}</strong>
          <p>${escapeHtml(template.body || 'No body preview available.')}</p>
        </div>
        <span class="template-status" data-status="${templateStatusTone(template.status)}">${escapeHtml(template.status)}</span>
      </article>
    `)
    .join('');

  const approvedTemplates = templates.filter(({ status }) => status === 'APPROVED');
  elements.templateSelect.innerHTML = approvedTemplates
    .map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)}</option>`)
    .join('');
  elements.templateSendForm.hidden = approvedTemplates.length === 0;
  renderTemplatePreview();
}

async function loadTemplates({ useEnteredToken = false } = {}) {
  const token = useEnteredToken
    ? elements.operatorToken.value.trim()
    : uiState.operatorToken;
  if (!token) {
    setTemplateFeedback('Enter the operator token from your local .env file.', 'warning');
    elements.operatorToken.focus();
    return;
  }

  uiState.operatorToken = token;
  elements.refreshTemplatesButton.disabled = true;
  setTemplateFeedback('Loading approval states from Meta…');

  try {
    const response = await fetch('/api/whatsapp/templates', {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`
      }
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Unable to load templates.');

    uiState.templates = payload.templates;
    renderTemplateDesk();
    const approvedCount = payload.templates.filter(({ status }) => status === 'APPROVED').length;
    setTemplateFeedback(
      `${payload.templates.length} ${payload.templates.length === 1 ? 'template' : 'templates'} loaded · ${approvedCount} approved`,
      approvedCount ? 'success' : 'warning'
    );
    elements.refreshTemplatesButton.disabled = false;
  } catch (error) {
    uiState.templates = [];
    elements.templateList.innerHTML = '';
    elements.templateSendForm.hidden = true;
    setTemplateFeedback(error.message, 'danger');
  }
}

function normalizeWhatsAppRecipient(value) {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('610') ? `61${digits.slice(3)}` : digits;
}

async function sendSelectedTemplate() {
  const template = uiState.templates.find(({ id }) => id === elements.templateSelect.value);
  const recipient = normalizeWhatsAppRecipient(elements.templateRecipient.value);
  if (!template || template.status !== 'APPROVED') {
    setTemplateFeedback('Choose an approved template before sending.', 'warning');
    return;
  }
  if (!/^\d{8,15}$/.test(recipient)) {
    setTemplateFeedback('Enter a recipient with country code, such as 61449550842.', 'warning');
    elements.templateRecipient.focus();
    return;
  }
  const confirmed = await requestSendConfirmation({
    title: `Send ${template.name}?`,
    recipient: `+${recipient}`,
    body: template.body || template.name,
    confirmLabel: 'Send template'
  });
  if (!confirmed) return;
  const requestScope = 'template-send';
  const idempotencyKey = requestKeys.get(
    requestScope,
    JSON.stringify([recipient, template.name, template.language])
  );

  elements.sendTemplateButton.disabled = true;
  elements.sendTemplateButton.textContent = 'Sending…';
  try {
    const response = await fetch('/api/whatsapp/messages', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${uiState.operatorToken}`,
        'content-type': 'application/json',
        'idempotency-key': idempotencyKey
      },
      body: JSON.stringify({
        to: recipient,
        type: 'template',
        template: { name: template.name, language: template.language }
      })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Template could not be sent.');

    requestKeys.complete(requestScope);
    setTemplateFeedback(`${template.name} accepted by WhatsApp for ${recipient}.`, 'success');
    showToast('Approved template sent to WhatsApp.');
  } catch (error) {
    setTemplateFeedback(error.message, 'danger');
  } finally {
    elements.sendTemplateButton.disabled = false;
    elements.sendTemplateButton.textContent = 'Send approved template';
  }
}

elements.queueFilter.addEventListener('change', (event) => {
  store.setFilter(event.target.value);
  render();
});

elements.conversationList.addEventListener('click', (event) => {
  const button = event.target.closest('.conversation-item');
  if (!button) return;
  store.select(button.dataset.id);
  render();
});

elements.toneOptions.forEach((button) => {
  button.addEventListener('click', () => {
    elements.toneOptions.forEach((option) => {
      const active = option === button;
      option.classList.toggle('active', active);
      option.setAttribute('aria-pressed', String(active));
    });
    uiState.tone = button.dataset.tone;
    const conversation = store.getSnapshot().selectedConversation;
    if (conversation) renderReply(conversation);
  });
});

elements.stockCheckToggle.addEventListener('change', () => {
  uiState.stockCheck = elements.stockCheckToggle.checked;
  const conversation = store.getSnapshot().selectedConversation;
  if (conversation) renderReply(conversation);
});

elements.replyDraft.addEventListener('input', clearReplyError);

elements.rewriteButton.addEventListener('click', async () => {
  const conversation = store.getSnapshot().selectedConversation;
  if (!conversation) return;
  elements.rewriteButton.disabled = true;
  const label = elements.rewriteButton.lastChild;
  label.textContent = ' Generating…';
  try {
    if (conversation.source === 'whatsapp') {
      const result = await generateLiveReplyDraft({
        token: uiState.operatorToken,
        conversationId: conversation.id,
        tone: uiState.tone
      });
      elements.replyDraft.value = result.draft.body;
      showToast(result.draft.provider === 'openai'
        ? `AI draft generated with ${result.draft.model}.`
        : 'Local fallback draft generated. Add OPENAI_API_KEY for model-generated drafts.');
    } else {
      const opening = uiState.tone === 'ops'
        ? 'Operational update:'
        : uiState.tone === 'sales'
          ? 'Thanks for getting in touch.'
          : 'Thanks for the details.';
      elements.replyDraft.value = `${opening} ${getSuggestedReply(conversation)}`;
    }
    clearReplyError();
    elements.replyDraft.focus();
  } catch (error) {
    elements.replyError.textContent = error.message;
    elements.replyDraft.setAttribute('aria-invalid', 'true');
  } finally {
    elements.rewriteButton.disabled = false;
    label.textContent = ' Rewrite';
  }
});

elements.sendButton.addEventListener('click', async () => {
  const conversation = store.getSnapshot().selectedConversation;
  if (!conversation) return;
  const reply = elements.replyDraft.value.trim();

  try {
    if (!reply) throw new Error('Reply cannot be empty.');

    if (conversation.source === 'whatsapp') {
      if (!uiState.operatorToken) {
        elements.replyError.textContent = 'Load the live workspace before sending a WhatsApp reply.';
        elements.replyDraft.setAttribute('aria-invalid', 'true');
        elements.connectionDialog.showModal();
        elements.operatorToken.focus();
        return;
      }

      const confirmed = await requestSendConfirmation({
        title: 'Send this reply now?',
        recipient: `${conversation.name} · +${conversation.sourceId}`,
        body: reply,
        confirmLabel: 'Send live reply'
      });
      if (!confirmed) return;

      elements.sendButton.disabled = true;
      elements.sendButtonLabel.textContent = 'Sending live…';
      const requestScope = `live-reply:${conversation.id}`;
      const result = await sendWhatsAppReply({
        token: uiState.operatorToken,
        conversationId: conversation.id,
        to: conversation.sourceId,
        body: reply,
        idempotencyKey: requestKeys.get(
          requestScope,
          JSON.stringify([conversation.sourceId, reply])
        )
      });
      requestKeys.complete(requestScope);
      if (result.conversation) {
        const currentLive = store.getSnapshot().conversations
          .filter(({ source, id }) => source === 'whatsapp' && id !== result.conversation.id);
        store.syncLiveConversations([result.conversation, ...currentLive]);
      } else {
        await loadWhatsAppActivity({ silent: true });
      }
      showToast(`Live reply accepted by WhatsApp for ${conversation.name}.`);
    } else {
      store.sendReply(conversation.id, reply);
      showToast(`Demo reply saved for ${conversation.name}.`);
    }

    render();
  } catch (error) {
    elements.replyError.textContent = error.message;
    elements.replyDraft.setAttribute('aria-invalid', 'true');
    elements.replyDraft.focus();
  } finally {
    elements.sendButton.disabled = false;
    const selectedConversation = store.getSnapshot().selectedConversation;
    if (selectedConversation) {
      elements.sendButtonLabel.textContent = selectedConversation.source === 'whatsapp'
        ? 'Review & send live'
        : selectedConversation.workflow === 'needs_review'
          ? 'Approve & send'
          : 'Send reply';
    }
  }
});

elements.escalateButton.addEventListener('click', async () => {
  const conversation = store.getSnapshot().selectedConversation;
  if (!conversation || conversation.workflow === 'needs_review') return;
  try {
    if (conversation.source === 'whatsapp') {
      const result = await applyLiveConversationAction({
        token: uiState.operatorToken,
        conversationId: conversation.id,
        action: 'escalate'
      });
      const currentLive = store.getSnapshot().conversations
        .filter(({ source, id }) => source === 'whatsapp' && id !== result.conversation.id);
      store.syncLiveConversations([result.conversation, ...currentLive]);
    } else {
      store.escalate(conversation.id);
    }
    showToast(`${conversation.name} moved to human review.`);
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.deferButton.addEventListener('click', async () => {
  const conversation = store.getSnapshot().selectedConversation;
  if (!conversation) return;
  try {
    if (conversation.source === 'whatsapp') {
      const result = await applyLiveConversationAction({
        token: uiState.operatorToken,
        conversationId: conversation.id,
        action: 'defer'
      });
      const currentLive = store.getSnapshot().conversations
        .filter(({ source, id }) => source === 'whatsapp' && id !== result.conversation.id);
      store.syncLiveConversations([result.conversation, ...currentLive]);
    } else {
      store.defer(conversation.id);
    }
    showToast(`${conversation.name} deferred until later today.`);
    render();
  } catch (error) {
    showToast(error.message);
  }
});

elements.resetButton.addEventListener('click', () => {
  store.reset();
  uiState.tone = 'helpful';
  uiState.stockCheck = true;
  elements.toneOptions.forEach((option) => {
    const active = option.dataset.tone === 'helpful';
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', String(active));
  });
  render();
  showToast('Demo conversations reset.');
});

elements.connectWhatsAppButton.addEventListener('click', () => {
  elements.connectionDialog.showModal();
  loadConnectionStatus();
});

elements.refreshConnectionButton.addEventListener('click', loadConnectionStatus);
elements.templateAccessForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadTemplates({ useEnteredToken: true });
  const activityLoad = loadWhatsAppActivity({ useEnteredToken: true });
  elements.operatorToken.value = '';
  activityLoad.then((loaded) => {
    if (loaded) activityRefresh.start();
  });
});
elements.refreshTemplatesButton.addEventListener('click', () => loadTemplates());
elements.refreshActivityButton.addEventListener('click', () => {
  loadWhatsAppActivity().then((loaded) => {
    if (loaded) activityRefresh.start();
  });
});
elements.templateSelect.addEventListener('change', renderTemplatePreview);
elements.templateSendForm.addEventListener('submit', (event) => {
  event.preventDefault();
  sendSelectedTemplate();
});
elements.closeConnectionDialog.addEventListener('click', () => elements.connectionDialog.close());
elements.doneConnectionButton.addEventListener('click', () => elements.connectionDialog.close());
elements.cancelSendConfirmButton.addEventListener('click', () => resolveSendConfirmation(false));
elements.approveSendConfirmButton.addEventListener('click', () => resolveSendConfirmation(true));
elements.sendConfirmDialog.addEventListener('cancel', (event) => {
  event.preventDefault();
  resolveSendConfirmation(false);
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  loadConnectionStatus();
  activityRefresh.refreshNow();
});
window.addEventListener('online', () => {
  loadConnectionStatus();
  activityRefresh.refreshNow();
});
window.addEventListener('beforeunload', () => activityRefresh.stop());

render();
loadConnectionStatus();
