import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { extname, resolve, sep } from 'node:path';

import { createMemoryWorkspaceStore } from './workspace-store.js';
import { createWorkspaceOperations } from './workspace-operations.js';
import { createIdempotencyStore, createOperatorAccess } from './operator-security.js';
import { createLocalReplyGenerator } from './reply-generator.js';

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

function json(payload, { status = 200, headers = {} } = {}) {
  return Response.json(payload, {
    status,
    headers: { ...securityHeaders, 'cache-control': 'no-store', ...headers }
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
  operatorAccess,
  publicWebhookUrl,
  workspaceStore = createMemoryWorkspaceStore(),
  workspaceOperations = createWorkspaceOperations({ workspaceStore }),
  replyGenerator = createLocalReplyGenerator(),
  automationEngine = {
    getStatus: () => ({ mode: 'off', allowlistSize: 0, minConfidence: 1 }),
    kick() {},
    run: async () => []
  },
  idempotencyStore = createIdempotencyStore()
}) {
  const access = operatorAccess || createOperatorAccess({ legacyAdminToken: adminToken });

  function authorize(request, permission = 'read') {
    if (!access.isConfigured()) {
      return { response: json({ error: 'Operator API is not configured.' }, { status: 503 }) };
    }
    const principal = access.authenticate(request.headers.get('authorization'));
    if (!principal) return { response: json({ error: 'Unauthorized' }, { status: 401 }) };
    if (!access.can(principal, permission)) {
      return { response: json({ error: 'Forbidden' }, { status: 403 }) };
    }
    return { principal };
  }

  return {
    async handle(request) {
      const url = new URL(request.url);

      if (request.method === 'GET' && url.pathname === '/healthz') {
        const health = await workspaceOperations.health();
        return json(health, { status: health.status === 'ok' ? 200 : 503 });
      }

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
        if (stored.added) automationEngine.kick();
        return json({
          received: true,
          eventCount: stored.added,
          duplicateCount: stored.duplicates
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/whatsapp/templates') {
        const authorization = authorize(request);
        if (authorization.response) return authorization.response;

        try {
          return json({ templates: await whatsappClient.listTemplates() });
        } catch (error) {
          return json({ error: error.message }, { status: 502 });
        }
      }

      if (request.method === 'GET' && url.pathname === '/api/whatsapp/events') {
        const authorization = authorize(request);
        if (authorization.response) return authorization.response;

        const workspace = await workspaceStore.getWorkspace();
        return json({ events: workspace.events });
      }

      if (request.method === 'GET' && url.pathname === '/api/workspace') {
        const authorization = authorize(request);
        if (authorization.response) return authorization.response;

        return json({
          ...await workspaceStore.getWorkspace(),
          operator: authorization.principal
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/session') {
        const authorization = authorize(request);
        if (authorization.response) return authorization.response;
        return json({ operator: authorization.principal });
      }

      if (request.method === 'GET' && url.pathname === '/api/operations/metrics') {
        const authorization = authorize(request);
        if (authorization.response) return authorization.response;
        return json(await workspaceOperations.metrics());
      }

      if (request.method === 'GET' && url.pathname === '/api/operations/export') {
        const authorization = authorize(request, 'admin');
        if (authorization.response) return authorization.response;
        return json(await workspaceOperations.exportWorkspace(), {
          headers: { 'content-disposition': 'attachment; filename="workspace-export.json"' }
        });
      }

      if (request.method === 'GET' && url.pathname === '/api/operations/recovery') {
        const authorization = authorize(request, 'admin');
        if (authorization.response) return authorization.response;
        return json(await workspaceOperations.verifyCurrent());
      }

      if (request.method === 'POST' && url.pathname === '/api/operations/backup') {
        const authorization = authorize(request, 'admin');
        if (authorization.response) return authorization.response;
        try {
          return json({ backup: await workspaceOperations.backup() }, { status: 201 });
        } catch (error) {
          return json({ error: error.message }, { status: 500 });
        }
      }

      if (request.method === 'POST' && url.pathname === '/api/operations/retention') {
        const authorization = authorize(request, 'admin');
        if (authorization.response) return authorization.response;
        return json({ retention: await workspaceOperations.prune() });
      }

      if (request.method === 'GET' && url.pathname === '/api/ai/status') {
        const authorization = authorize(request);
        if (authorization.response) return authorization.response;
        return json(replyGenerator.getStatus());
      }

      if (['GET', 'POST'].includes(request.method) && url.pathname === '/api/automation') {
        const authorization = authorize(request, request.method === 'POST' ? 'admin' : 'read');
        if (authorization.response) return authorization.response;
        if (request.method === 'GET') return json(automationEngine.getStatus());
        const decisions = await automationEngine.run();
        return json({ decisions });
      }

      const conversationDraftMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/draft$/);
      if (request.method === 'POST' && conversationDraftMatch) {
        const authorization = authorize(request, 'draft');
        if (authorization.response) return authorization.response;
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
          return json({ error: 'Content-Type must be application/json.' }, { status: 415 });
        }

        try {
          const payload = await request.json();
          if (payload.tone && !['helpful', 'sales', 'ops'].includes(payload.tone)) {
            return json({ error: 'Unsupported reply tone.' }, { status: 400 });
          }
          const conversationId = decodeURIComponent(conversationDraftMatch[1]);
          const workspace = await workspaceStore.getWorkspace();
          const conversation = workspace.conversations.find(({ id }) => id === conversationId);
          if (!conversation) {
            return json({ error: 'Live conversation not found.' }, { status: 404 });
          }
          const draft = await replyGenerator.generate({
            conversation,
            tone: payload.tone || 'helpful'
          });
          await workspaceStore.recordAudit({
            id: `operator:draft:${randomUUID()}`,
            type: 'operator.draft',
            conversationId,
            actor: authorization.principal,
            provider: draft.provider,
            model: draft.model,
            timestamp: new Date().toISOString()
          });
          return json({ draft });
        } catch (error) {
          return json({ error: error.message }, { status: error.status || 502 });
        }
      }

      const conversationActionMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/actions$/);
      if (request.method === 'POST' && conversationActionMatch) {
        const authorization = authorize(request, 'manage');
        if (authorization.response) return authorization.response;
        if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
          return json({ error: 'Content-Type must be application/json.' }, { status: 415 });
        }

        try {
          const payload = await request.json();
          const conversation = await workspaceStore.applyAction({
            conversationId: decodeURIComponent(conversationActionMatch[1]),
            action: payload.action,
            actor: authorization.principal
          });
          return json({ conversation });
        } catch (error) {
          return json({ error: error.message }, { status: error.status || 400 });
        }
      }

      if (request.method === 'POST' && url.pathname === '/api/whatsapp/messages') {
        const authorization = authorize(request, 'reply');
        if (authorization.response) return authorization.response;

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
            fingerprint: JSON.stringify({ ...normalizedMessage, operatorId: authorization.principal.id }),
            operation: async () => {
              const sent = normalizedMessage.type === 'template'
                ? await whatsappClient.sendTemplate(normalizedMessage)
                : await whatsappClient.sendText(normalizedMessage);
              const conversation = normalizedMessage.conversationId
                ? await workspaceStore.recordReply({
                    conversationId: normalizedMessage.conversationId,
                    to: normalizedMessage.to,
                    body: normalizedMessage.body,
                    messageId: sent.messageId,
                    actor: authorization.principal
                  })
                : null;
              if (!conversation) {
                await workspaceStore.recordAudit({
                  id: `operator:message:${sent.messageId}`,
                  type: 'operator.message',
                  actor: authorization.principal,
                  messageType: normalizedMessage.type,
                  recipient: normalizedMessage.to,
                  messageId: sent.messageId,
                  timestamp: new Date().toISOString()
                });
              }
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
