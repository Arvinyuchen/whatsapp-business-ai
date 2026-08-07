import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

import { createMemoryWorkspaceStore } from './workspace-store.js';
import { createIdempotencyStore, isOperatorAuthorized } from './operator-security.js';

const securityHeaders = {
  'content-security-policy': "default-src 'self'; base-uri 'none'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; script-src 'self'; style-src 'self'",
  'permissions-policy': 'camera=(), geolocation=(), microphone=()',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY'
};

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
    headers: { ...securityHeaders, 'cache-control': 'no-store' }
  });
}

function text(payload, { status = 200 } = {}) {
  return new Response(payload, {
    status,
    headers: {
      ...securityHeaders,
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
        ...securityHeaders,
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
  workspaceStore = createMemoryWorkspaceStore(),
  idempotencyStore = createIdempotencyStore()
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

        const stored = await workspaceStore.applyEvents(result.events);
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

        if (!isOperatorAuthorized(request.headers.get('authorization'), adminToken)) {
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

        if (!isOperatorAuthorized(request.headers.get('authorization'), adminToken)) {
          return json({ error: 'Unauthorized' }, { status: 401 });
        }

        const workspace = await workspaceStore.getWorkspace();
        return json({ events: workspace.events });
      }

      if (request.method === 'GET' && url.pathname === '/api/workspace') {
        if (!adminToken) {
          return json({ error: 'Operator API is not configured.' }, { status: 503 });
        }

        if (!isOperatorAuthorized(request.headers.get('authorization'), adminToken)) {
          return json({ error: 'Unauthorized' }, { status: 401 });
        }

        return json(await workspaceStore.getWorkspace());
      }

      const conversationActionMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/actions$/);
      if (request.method === 'POST' && conversationActionMatch) {
        if (!adminToken) {
          return json({ error: 'Operator API is not configured.' }, { status: 503 });
        }
        if (!isOperatorAuthorized(request.headers.get('authorization'), adminToken)) {
          return json({ error: 'Unauthorized' }, { status: 401 });
        }
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
          return json({ error: 'Content-Type must be application/json.' }, { status: 415 });
        }

        try {
          const payload = await request.json();
          const conversation = await workspaceStore.applyAction({
            conversationId: decodeURIComponent(conversationActionMatch[1]),
            action: payload.action
          });
          return json({ conversation });
        } catch (error) {
          return json({ error: error.message }, { status: error.status || 400 });
        }
      }

      if (request.method === 'POST' && url.pathname === '/api/whatsapp/messages') {
        if (!adminToken) {
          return json({ error: 'Operator API is not configured.' }, { status: 503 });
        }

        if (!isOperatorAuthorized(request.headers.get('authorization'), adminToken)) {
          return json({ error: 'Unauthorized' }, { status: 401 });
        }

        const idempotencyKey = request.headers.get('idempotency-key') || '';
        if (!/^[A-Za-z0-9_-]{8,128}$/.test(idempotencyKey)) {
          return json(
            { error: 'A valid Idempotency-Key header is required.' },
            { status: 400 }
          );
        }
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
          return json({ error: 'Content-Type must be application/json.' }, { status: 415 });
        }

        let payload;
        try {
          payload = await request.json();
        } catch {
          return json({ error: 'Request body must be valid JSON.' }, { status: 400 });
        }

        try {
          if (!/^\d{8,15}$/.test(payload.to || '')) {
            return json(
              { error: 'A valid recipient is required.' },
              { status: 400 }
            );
          }

          let normalizedMessage;
          if (payload.type === 'template') {
            const name = payload.template?.name || '';
            const language = payload.template?.language || 'en_US';
            if (!/^[a-z0-9_]+$/.test(name) || !/^[a-z]{2}_[A-Z]{2}$/.test(language)) {
              return json(
                { error: 'A valid template name and language are required.' },
                { status: 400 }
              );
            }

            normalizedMessage = {
              type: 'template',
              to: payload.to,
              name,
              language
            };
          } else {
            if (typeof payload.body !== 'string' || !payload.body.trim()) {
              return json(
                { error: 'A non-empty message is required.' },
                { status: 400 }
              );
            }

            normalizedMessage = {
              type: 'text',
              to: payload.to,
              body: payload.body.trim(),
              ...(payload.conversationId ? { conversationId: payload.conversationId } : {})
            };
          }

          const result = await idempotencyStore.execute({
            key: idempotencyKey,
            fingerprint: JSON.stringify(normalizedMessage),
            operation: async () => {
              const sent = normalizedMessage.type === 'template'
                ? await whatsappClient.sendTemplate(normalizedMessage)
                : await whatsappClient.sendText(normalizedMessage);
              const conversation = normalizedMessage.conversationId
                ? await workspaceStore.recordReply({
                    conversationId: normalizedMessage.conversationId,
                    to: normalizedMessage.to,
                    body: normalizedMessage.body,
                    messageId: sent.messageId
                  })
                : null;
              return { ...sent, conversation };
            }
          });

          return json({
            sent: true,
            messageId: result.messageId,
            ...(result.conversation ? { conversation: result.conversation } : {})
          }, { status: 201 });
        } catch (error) {
          return json({ error: error.message }, { status: error.status || 502 });
        }
      }

      const staticResponse = await serveStatic(url.pathname, staticRoot, request.method);
      if (staticResponse) return staticResponse;

      return json({ error: 'Not found' }, { status: 404 });
    }
  };
}
