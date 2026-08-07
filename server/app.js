import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

import { createMemoryEventStore } from './event-store.js';

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function json(payload, { status = 200 } = {}) {
  return Response.json(payload, {
    status,
    headers: { 'cache-control': 'no-store' }
  });
}

function text(payload, { status = 200 } = {}) {
  return new Response(payload, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

async function serveStatic(pathname, staticRoot, method) {
  if (!staticRoot || !['GET', 'HEAD'].includes(method)) return null;

  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).slice(1);
  const isPublicPath = relativePath === 'index.html' || relativePath.startsWith('src/');
  if (!isPublicPath) return null;

  const root = resolve(staticRoot);
  const filePath = resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) return null;

  try {
    const body = await readFile(filePath);
    return new Response(method === 'HEAD' ? null : body, {
      status: 200,
      headers: {
        'content-type': contentTypes[extname(filePath)] || 'application/octet-stream',
        'cache-control': 'no-store'
      }
    });
  } catch {
    return null;
  }
}

export function createApp({
  whatsappClient,
  whatsappWebhook,
  staticRoot,
  adminToken,
  publicWebhookUrl,
  eventStore = createMemoryEventStore()
}) {
  return {
    async handle(request) {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/api/whatsapp/status') {
        const clientStatus = whatsappClient.getStatus();
        const webhookStatus = whatsappWebhook.getStatus();
        const missing = [...new Set([
          ...clientStatus.missing,
          ...webhookStatus.missing
        ])];

        return json({
          configured: clientStatus.configured && webhookStatus.configured,
          graphVersion: clientStatus.graphVersion,
          missing,
          webhookPath: '/webhooks/whatsapp',
          webhookUrl: publicWebhookUrl || null
        });
      }

      if (request.method === 'GET' && url.pathname === '/webhooks/whatsapp') {
        const result = whatsappWebhook.verifySubscription({
          mode: url.searchParams.get('hub.mode'),
          token: url.searchParams.get('hub.verify_token'),
          challenge: url.searchParams.get('hub.challenge')
        });

        return result.verified
          ? text(result.challenge)
          : text('Forbidden', { status: 403 });
      }

      if (request.method === 'POST' && url.pathname === '/webhooks/whatsapp') {
        const result = whatsappWebhook.receive({
          rawBody: Buffer.from(await request.arrayBuffer()),
          signature: request.headers.get('x-hub-signature-256')
        });

        if (!result.accepted) {
          return json({ error: 'Invalid webhook signature' }, { status: 401 });
        }

        const stored = await eventStore.append(result.events);
        return json({
          received: true,
          eventCount: stored.added,
          duplicateCount: stored.duplicates
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/whatsapp/templates') {
        if (!adminToken) {
          return json({ error: 'Operator API is not configured.' }, { status: 503 });
        }

        if (request.headers.get('authorization') !== `Bearer ${adminToken}`) {
          return json({ error: 'Unauthorized' }, { status: 401 });
        }

        try {
          return json({ templates: await whatsappClient.listTemplates() });
        } catch (error) {
          return json({ error: error.message }, { status: 502 });
        }
      }

      if (request.method === 'GET' && url.pathname === '/api/whatsapp/events') {
        if (!adminToken) {
          return json({ error: 'Operator API is not configured.' }, { status: 503 });
        }

        if (request.headers.get('authorization') !== `Bearer ${adminToken}`) {
          return json({ error: 'Unauthorized' }, { status: 401 });
        }

        return json({ events: await eventStore.list() });
      }

      if (request.method === 'POST' && url.pathname === '/api/whatsapp/messages') {
        if (!adminToken) {
          return json({ error: 'Operator API is not configured.' }, { status: 503 });
        }

        if (request.headers.get('authorization') !== `Bearer ${adminToken}`) {
          return json({ error: 'Unauthorized' }, { status: 401 });
        }

        try {
          const payload = await request.json();
          if (!/^\d{8,15}$/.test(payload.to || '')) {
            return json(
              { error: 'A valid recipient is required.' },
              { status: 400 }
            );
          }

          let result;
          if (payload.type === 'template') {
            const name = payload.template?.name || '';
            const language = payload.template?.language || 'en_US';
            if (!/^[a-z0-9_]+$/.test(name) || !/^[a-z]{2}_[A-Z]{2}$/.test(language)) {
              return json(
                { error: 'A valid template name and language are required.' },
                { status: 400 }
              );
            }

            result = await whatsappClient.sendTemplate({
              to: payload.to,
              name,
              language
            });
          } else {
            if (!payload.body?.trim()) {
              return json(
                { error: 'A non-empty message is required.' },
                { status: 400 }
              );
            }

            result = await whatsappClient.sendText({
              to: payload.to,
              body: payload.body.trim()
            });
          }

          return json({ sent: true, messageId: result.messageId }, { status: 201 });
        } catch (error) {
          return json({ error: error.message }, { status: 502 });
        }
      }

      const staticResponse = await serveStatic(url.pathname, staticRoot, request.method);
      if (staticResponse) return staticResponse;

      return json({ error: 'Not found' }, { status: 404 });
    }
  };
}
