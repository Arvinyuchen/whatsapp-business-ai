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
- Optional OpenAI Responses API drafts with a deterministic no-key fallback
- Governed auto-response worker with dry-run default, recipient allowlist, confidence gate, and durable decisions
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
- Local viewer, agent, and admin roles with durable actor attribution
- Health, aggregate metrics, retention controls, verified export, and atomic local backups
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
   - `OPERATOR_ACCOUNTS_JSON` (optional array of named `viewer`, `agent`, and `admin` accounts; supersedes the single-token workflow)
   - `PUBLIC_WEBHOOK_URL` (the public HTTPS callback registered with Meta)
   - `WORKSPACE_DB_PATH` (optional shared local SQLite path; defaults to `.data/workspace.sqlite`)
   - `WORKSPACE_BACKUP_DIR` (admin-created JSON backup directory; defaults to `.data/backups`)
   - `WORKSPACE_RETENTION_DAYS` (defaults to 90; active conversations are preserved)
   - `WORKSPACE_EVENT_LIMIT` / `WORKSPACE_AUDIT_LIMIT` (bounded local histories)
   - `WHATSAPP_EVENT_STORE_PATH` (optional one-time migration source for older event history)
   - `META_REQUEST_TIMEOUT_MS` (optional Graph API timeout; defaults to 15000 milliseconds)
   - `OPENAI_API_KEY` (optional; enables model-generated drafts while remaining operator-reviewed)
   - `OPENAI_MODEL` (optional; defaults to `gpt-5.6-terra` for the balanced drafting role)
   - `OPENAI_REQUEST_TIMEOUT_MS` (optional; defaults to 20000 milliseconds)
   - `AUTOMATION_MODE` (`dry-run` by default; use `live` only after controlled acceptance)
   - `AUTOMATION_ALLOWLIST` (comma-separated international phone numbers or BSUIDs; required for every evaluated recipient)
   - `AUTOMATION_MIN_CONFIDENCE` (0–1; defaults to `0.9`)
   - `AUTOMATION_INTERVAL_MS` (local worker interval; defaults to 5000 milliseconds)

3. Start the app with `npm run dev`, then open the URL printed in the terminal. The **Connect WhatsApp** dialog reports any missing values.

   Do not open `index.html` directly with a `file://` URL. Browser security blocks its JavaScript modules, so interactive controls cannot run.

4. Expose only the webhook path through a public HTTPS origin and configure this callback in Meta:

   ```text
   https://your-public-origin.example/webhooks/whatsapp
   ```

   Use the same value for Meta's verify token and `WHATSAPP_VERIFY_TOKEN`. Incoming webhook POST requests are accepted only when their `X-Hub-Signature-256` HMAC matches `META_APP_SECRET`.

   For local development, a path-scoped Tailscale Funnel can expose the callback while leaving the dashboard and operator APIs private. The local server and Tailscale daemon must remain running for that URL to stay reachable.

Never commit `.env` or production credentials. The Graph API version defaults to `v25.0` and can be changed with `META_GRAPH_API_VERSION`.

### Local auto-response workflow

1. Keep `AUTOMATION_MODE=dry-run`, start the server, open **Automations**, and load the workspace with an admin or agent token.
2. Confirm the dashboard shows **DRY-RUN**, the expected confidence threshold, and the intended allowlist count. New inbound messages will create durable blocked or dry-run decisions without sending.
3. Add `OPENAI_API_KEY` for model-generated structured drafts. The no-key local fallback always requires a human, so it can never auto-send.
4. Put only controlled international-format phone numbers or BSUIDs in `AUTOMATION_ALLOWLIST`, restart, and inspect representative dry-run decisions.
5. Change `AUTOMATION_MODE=live` only after those checks. Live mode still refuses non-allowlisted, low-confidence, or human-required drafts and never retries a failed or ambiguous send automatically.

This works from the local server and does not require deploying the dashboard. The server, HTTPS webhook tunnel, and Meta app access must remain available for real inbound customer traffic.

### Template approval and sending

Meta reviews custom templates asynchronously. Open **Connect WhatsApp**, find the **Template desk**, enter your `OPERATOR_API_TOKEN`, and choose **Load templates**. The approval ledger reports each template as `APPROVED`, `PENDING`, or `REJECTED`; only approved templates are offered by the send form.

The assigned operator token is copied into page memory only, then removed from the password field. It is cleared when the page reloads and is never bundled into browser code or saved to browser storage. The workspace shows the authenticated operator ID and role. Viewer accounts can inspect, agents can draft/reply/manage, and admins can additionally run automation manually. `OPERATOR_API_TOKEN` remains a legacy admin identity when configured.

### Local API boundaries

- `GET /api/whatsapp/status` — reports configuration readiness without exposing secrets
- `GET /api/whatsapp/templates` — lists and normalizes Meta message templates; requires `Authorization: Bearer <OPERATOR_API_TOKEN>`
- `POST /api/whatsapp/messages` — sends text or an approved template through the configured WhatsApp client; requires `Authorization: Bearer <OPERATOR_API_TOKEN>` and a unique `Idempotency-Key`
- `GET /api/workspace` — returns shared live conversations and recent normalized events; requires operator authorization
- `POST /api/conversations/:id/actions` — persists a live escalation or deferral; requires operator authorization
- `POST /api/conversations/:id/draft` — generates an operator-reviewed reply draft; uses a local fallback when OpenAI is not configured
- `GET /api/ai/status` — reports the active draft provider and model without exposing credentials
- `GET /api/session` — reports the authenticated operator ID and role without exposing token material
- `GET /healthz` — storage liveness only; does not expose customer content or configuration
- `GET /api/operations/metrics` — aggregate workspace counts; requires operator read access
- `GET /api/operations/export` — downloads a versioned workspace recovery export; admin only
- `GET /api/operations/recovery` — verifies the current export structure; admin only
- `POST /api/operations/backup` — writes and re-verifies an atomic private local backup; admin only
- `POST /api/operations/retention` — runs the configured retention policy immediately; admin only
- `GET /api/automation` — reports effective automation guards; requires operator authorization
- `POST /api/automation` — runs one guarded automation pass; requires operator authorization
- `GET /webhooks/whatsapp` — handles Meta's subscription challenge
- `POST /webhooks/whatsapp` — verifies and normalizes webhook notifications
- `GET /api/whatsapp/events` — compatibility endpoint for recent normalized webhook events; requires operator authorization

If `OPERATOR_API_TOKEN` is unset, operator-only endpoints return `503` and cannot send or expose customer data.

For startup checks, credential rotation, webhook recovery, message-safety rules, and the multi-instance persistence boundary, see [docs/OPERATIONS.md](docs/OPERATIONS.md).

The customer-facing data-handling notice is published in [PRIVACY.md](PRIVACY.md).

## Future integration points

- Product catalog and inventory sync
- Warehouse management system integration
- Courier/routing provider integration
- Conversation and order analytics
- Role-based access for sales, operations, and managers
