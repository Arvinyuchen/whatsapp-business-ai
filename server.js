import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './server/app.js';
import { createAutomationEngine } from './server/automation-engine.js';
import { createSqliteWorkspaceStore } from './server/workspace-store.js';
import { createWorkspaceOperations } from './server/workspace-operations.js';
import { createNodeHandler } from './server/node-adapter.js';
import { createOperatorAccess, parseOperatorAccounts } from './server/operator-security.js';
import { createReplyGenerator } from './server/reply-generator.js';
import { createWhatsAppClient } from './server/whatsapp-client.js';
import { createWhatsAppWebhook } from './server/whatsapp-webhook.js';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const graphVersion = process.env.META_GRAPH_API_VERSION || 'v25.0';
const configuredRequestTimeout = Number.parseInt(process.env.META_REQUEST_TIMEOUT_MS || '', 10);
const whatsappClient = createWhatsAppClient({
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  graphVersion,
  requestTimeoutMs: Number.isSafeInteger(configuredRequestTimeout) && configuredRequestTimeout > 0
    ? configuredRequestTimeout
    : 15_000
});
const whatsappWebhook = createWhatsAppWebhook({
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  appSecret: process.env.META_APP_SECRET
});
const configuredOpenAITimeout = Number.parseInt(process.env.OPENAI_REQUEST_TIMEOUT_MS || '', 10);
const replyGenerator = createReplyGenerator({
  apiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
  requestTimeoutMs: Number.isSafeInteger(configuredOpenAITimeout) && configuredOpenAITimeout > 0
    ? configuredOpenAITimeout
    : 20_000
});
const configuredEventLimit = Number.parseInt(process.env.WORKSPACE_EVENT_LIMIT || '', 10);
const workspaceEventLimit = Number.isSafeInteger(configuredEventLimit) && configuredEventLimit > 0
  ? configuredEventLimit
  : 500;
const workspaceStore = createSqliteWorkspaceStore({
  filePath: resolve(
    projectRoot,
    process.env.WORKSPACE_DB_PATH || '.data/workspace.sqlite'
  ),
  eventLimit: workspaceEventLimit
});
const existingWorkspace = await workspaceStore.getWorkspace();
if (!existingWorkspace.events.length) {
  const legacyEventPath = resolve(
    projectRoot,
    process.env.WHATSAPP_EVENT_STORE_PATH || '.data/whatsapp-events.json'
  );
  try {
    const legacyPayload = JSON.parse(await readFile(legacyEventPath, 'utf8'));
    if (Array.isArray(legacyPayload.events)) {
      await workspaceStore.applyEvents(legacyPayload.events);
      console.log(`Imported ${legacyPayload.events.length} legacy WhatsApp events into the shared workspace.`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Legacy event history was not imported: ${error.message}`);
    }
  }
}
const configuredAutomationConfidence = Number.parseFloat(
  process.env.AUTOMATION_MIN_CONFIDENCE || ''
);
const automationEngine = createAutomationEngine({
  mode: process.env.AUTOMATION_MODE || 'dry-run',
  allowlist: (process.env.AUTOMATION_ALLOWLIST || '')
    .split(',')
    .map((value) => value.replace(/\D/g, ''))
    .filter(Boolean),
  minConfidence: Number.isFinite(configuredAutomationConfidence)
    ? configuredAutomationConfidence
    : 0.9,
  replyGenerator,
  whatsappClient,
  workspaceStore
});
const operatorAccess = createOperatorAccess({
  accounts: parseOperatorAccounts(process.env.OPERATOR_ACCOUNTS_JSON),
  legacyAdminToken: process.env.OPERATOR_API_TOKEN
});
const configuredRetentionDays = Number.parseInt(process.env.WORKSPACE_RETENTION_DAYS || '', 10);
const configuredAuditLimit = Number.parseInt(process.env.WORKSPACE_AUDIT_LIMIT || '', 10);
const workspaceOperations = createWorkspaceOperations({
  workspaceStore,
  backupDirectory: resolve(
    projectRoot,
    process.env.WORKSPACE_BACKUP_DIR || '.data/backups'
  ),
  retentionDays: Number.isSafeInteger(configuredRetentionDays) && configuredRetentionDays > 0
    ? configuredRetentionDays
    : 90,
  eventLimit: workspaceEventLimit,
  auditLimit: Number.isSafeInteger(configuredAuditLimit) && configuredAuditLimit > 0
    ? configuredAuditLimit
    : 1_000
});
const app = createApp({
  whatsappClient,
  whatsappWebhook,
  staticRoot: projectRoot,
  operatorAccess,
  publicWebhookUrl: process.env.PUBLIC_WEBHOOK_URL,
  automationEngine,
  replyGenerator,
  workspaceStore,
  workspaceOperations
});
const server = createServer(createNodeHandler(app));
const port = Number.parseInt(process.env.PORT || '5179', 10);
const host = process.env.HOST || '127.0.0.1';

server.listen(port, host, () => {
  console.log(`WhatsApp Business AI running at http://${host}:${port}`);
  automationEngine.kick();
  workspaceOperations.prune().catch((error) => {
    console.error('Workspace retention pass failed.', error);
  });
});
const configuredAutomationInterval = Number.parseInt(
  process.env.AUTOMATION_INTERVAL_MS || '',
  10
);
const automationTimer = setInterval(
  () => automationEngine.kick(),
  Number.isSafeInteger(configuredAutomationInterval) && configuredAutomationInterval >= 1_000
    ? configuredAutomationInterval
    : 5_000
);
automationTimer.unref();
const configuredRetentionInterval = Number.parseInt(
  process.env.WORKSPACE_RETENTION_INTERVAL_MS || '',
  10
);
const retentionTimer = setInterval(
  () => workspaceOperations.prune().catch((error) => {
    console.error('Workspace retention pass failed.', error);
  }),
  Number.isSafeInteger(configuredRetentionInterval) && configuredRetentionInterval >= 60_000
    ? configuredRetentionInterval
    : 6 * 60 * 60 * 1_000
);
retentionTimer.unref();
