# WhatsApp Business AI

AI chatbot dashboard prototype for WhatsApp Business. The first screen focuses on customer conversations, AI-assisted replies, lead/order intent detection, and basic automation controls. The structure leaves clear room for future warehouse, logistics, and business analysis integrations.

## Run

Run the local app server:

```bash
npm run dev
```

No package install is required.

Run the behavior tests with:

```bash
npm test
```

## Current scope

- WhatsApp-style customer inbox
- AI reply composer with tone presets
- Intent, urgency, confidence, and order metadata
- Operator actions to send, escalate, or defer AI replies
- Queue metrics and automatic advancement after a decision
- Browser-local persistence for resettable demo records
- Decision rail explaining intent, risk, recommended action, and activity
- Integration-status dialog for WhatsApp Cloud API configuration
- Template desk for checking Meta approval status and sending approved templates
- Live WhatsApp activity ledger for inbound messages and delivery updates from signed webhooks
- Signed inbound messages promoted into persistent, deduplicated operator inbox conversations
- Shared SQLite-backed live workspace across refreshes and browser sessions
- Confirmed live replies sent through the authenticated operator API, with Meta message IDs retained server-side
- Delivery-status webhooks reconciled into matching replies, with failures reopened for review
- Bounded, deduplicated webhook history and live conversation state persisted across server restarts
- Visibility-aware live activity refresh with authorization and network recovery
- Constant-time operator authentication and idempotent outbound message requests
- Strict operator request validation and restrictive browser security headers
- Future module navigation for warehouse, logistics, and analytics

Seeded demo conversations remain browser-local. Conversations created from signed WhatsApp webhooks are marked live and stored in the local server workspace; their reply action requires loaded operator access and an in-app recipient/message review before the server contacts Meta. Live replies, escalations, and deferrals are shared across browser sessions.

## WhatsApp Cloud API setup

1. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

2. Fill in these values from your Meta app and WhatsApp Business account:

   - `WHATSAPP_ACCESS_TOKEN`
   - `WHATSAPP_PHONE_NUMBER_ID`
   - `WHATSAPP_BUSINESS_ACCOUNT_ID`
   - `WHATSAPP_VERIFY_TOKEN` (a secret value you choose and also enter in Meta)
   - `META_APP_SECRET`
   - `OPERATOR_API_TOKEN` (a private bearer token for operator-only APIs)
   - `PUBLIC_WEBHOOK_URL` (the public HTTPS callback registered with Meta)
   - `WORKSPACE_DB_PATH` (optional shared local SQLite path; defaults to `.data/workspace.sqlite`)
   - `WHATSAPP_EVENT_STORE_PATH` (optional one-time migration source for older event history)
   - `META_REQUEST_TIMEOUT_MS` (optional Graph API timeout; defaults to 15000 milliseconds)

3. Start the app with `npm run dev`, then open the URL printed in the terminal. The **Connect WhatsApp** dialog reports any missing values.

   Do not open `index.html` directly with a `file://` URL. Browser security blocks its JavaScript modules, so interactive controls cannot run.

4. Expose only the webhook path through a public HTTPS origin and configure this callback in Meta:

   ```text
   https://your-public-origin.example/webhooks/whatsapp
   ```

   Use the same value for Meta's verify token and `WHATSAPP_VERIFY_TOKEN`. Incoming webhook POST requests are accepted only when their `X-Hub-Signature-256` HMAC matches `META_APP_SECRET`.

   For local development, a path-scoped Tailscale Funnel can expose the callback while leaving the dashboard and operator APIs private. The local server and Tailscale daemon must remain running for that URL to stay reachable.

Never commit `.env` or production credentials. The Graph API version defaults to `v25.0` and can be changed with `META_GRAPH_API_VERSION`.

### Template approval and sending

Meta reviews custom templates asynchronously. Open **Connect WhatsApp**, find the **Template desk**, enter your `OPERATOR_API_TOKEN`, and choose **Load templates**. The approval ledger reports each template as `APPROVED`, `PENDING`, or `REJECTED`; only approved templates are offered by the send form.

The operator token is copied into page memory only, then removed from the password field. It is cleared when the page reloads and is never bundled into browser code or saved to browser storage. The same operator session loads the template desk and the recent signed-webhook activity ledger.

### Local API boundaries

- `GET /api/whatsapp/status` — reports configuration readiness without exposing secrets
- `GET /api/whatsapp/templates` — lists and normalizes Meta message templates; requires `Authorization: Bearer <OPERATOR_API_TOKEN>`
- `POST /api/whatsapp/messages` — sends text or an approved template through the configured WhatsApp client; requires `Authorization: Bearer <OPERATOR_API_TOKEN>` and a unique `Idempotency-Key`
- `GET /api/workspace` — returns shared live conversations and recent normalized events; requires operator authorization
- `POST /api/conversations/:id/actions` — persists a live escalation or deferral; requires operator authorization
- `GET /webhooks/whatsapp` — handles Meta's subscription challenge
- `POST /webhooks/whatsapp` — verifies and normalizes webhook notifications
- `GET /api/whatsapp/events` — compatibility endpoint for recent normalized webhook events; requires operator authorization

If `OPERATOR_API_TOKEN` is unset, operator-only endpoints return `503` and cannot send or expose customer data.

For startup checks, credential rotation, webhook recovery, message-safety rules, and the multi-instance persistence boundary, see [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Future integration points

- Product catalog and inventory sync
- Warehouse management system integration
- Courier/routing provider integration
- Conversation and order analytics
- Role-based access for sales, operations, and managers
