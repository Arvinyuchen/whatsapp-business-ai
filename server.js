import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './server/app.js';
import { createSqliteWorkspaceStore } from './server/workspace-store.js';
import { createNodeHandler } from './server/node-adapter.js';
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
const workspaceStore = createSqliteWorkspaceStore({
  filePath: resolve(
    projectRoot,
    process.env.WORKSPACE_DB_PATH || '.data/workspace.sqlite'
  )
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
const app = createApp({
  whatsappClient,
  whatsappWebhook,
  staticRoot: projectRoot,
  adminToken: process.env.OPERATOR_API_TOKEN,
  publicWebhookUrl: process.env.PUBLIC_WEBHOOK_URL,
  replyGenerator,
  workspaceStore
});
const server = createServer(createNodeHandler(app));
const port = Number.parseInt(process.env.PORT || '5179', 10);
const host = process.env.HOST || '127.0.0.1';

server.listen(port, host, () => {
  console.log(`WhatsApp Business AI running at http://${host}:${port}`);
});
