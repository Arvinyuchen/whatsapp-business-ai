import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './server/app.js';
import { createFileEventStore } from './server/event-store.js';
import { createNodeHandler } from './server/node-adapter.js';
import { createWhatsAppClient } from './server/whatsapp-client.js';
import { createWhatsAppWebhook } from './server/whatsapp-webhook.js';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const graphVersion = process.env.META_GRAPH_API_VERSION || 'v25.0';
const whatsappClient = createWhatsAppClient({
  accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
  whatsappBusinessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
  graphVersion
});
const whatsappWebhook = createWhatsAppWebhook({
  verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
  appSecret: process.env.META_APP_SECRET
});
const eventStore = createFileEventStore({
  filePath: resolve(
    projectRoot,
    process.env.WHATSAPP_EVENT_STORE_PATH || '.data/whatsapp-events.json'
  )
});
const app = createApp({
  whatsappClient,
  whatsappWebhook,
  staticRoot: projectRoot,
  adminToken: process.env.OPERATOR_API_TOKEN,
  publicWebhookUrl: process.env.PUBLIC_WEBHOOK_URL,
  eventStore
});
const server = createServer(createNodeHandler(app));
const port = Number.parseInt(process.env.PORT || '5179', 10);
const host = process.env.HOST || '127.0.0.1';

server.listen(port, host, () => {
  console.log(`WhatsApp Business AI running at http://${host}:${port}`);
});
