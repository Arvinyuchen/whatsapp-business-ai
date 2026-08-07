# WhatsApp operator runbook

## Start and verify

1. Keep production credentials in `.env`; never commit that file.
2. Start the service with `npm run start`.
3. Open the local dashboard and confirm the header reports **API ready**.
4. Open **API ready**, enter `OPERATOR_API_TOKEN`, and choose **Load workspace**.
5. Confirm the token field clears, template approval states load, and the activity panel reports **Auto-refresh active**.
6. Run `npm test` before every deployment. All tests must pass.

## Message safety

- Seeded demo conversations never contact WhatsApp.
- Webhook-created conversations are labelled live.
- Every live reply and template displays an in-app review with the exact recipient and message before dispatch.
- Cancelling the review keeps the conversation open and does not call the send API.
- Outbound requests require an operator bearer token and an idempotency key. Retrying the same unchanged request reuses the original key.
- A live conversation resolves only after Meta accepts the message. Failed or undelivered status webhooks reopen it for review.
- AI generation only drafts text. It never sends to WhatsApp, and the normal recipient/message confirmation remains mandatory.
- Without `OPENAI_API_KEY`, Rewrite uses the deterministic local fallback. With a key, the server uses the Responses API and does not store the response at OpenAI (`store: false`).

## Automation safety

- `AUTOMATION_MODE` defaults to `dry-run`; this evaluates and records decisions but never contacts a customer.
- `live` mode is still denied unless the recipient appears in `AUTOMATION_ALLOWLIST`, the draft reaches `AUTOMATION_MIN_CONFIDENCE`, and the draft does not require human review.
- The no-key local fallback always requires human review, so it cannot auto-send.
- Each inbound message gets one durable automation decision. A failed or ambiguous send is not automatically retried, preventing duplicate customer messages.
- Review automation decisions in the live activity ledger before changing from `dry-run` to `live`.

## Webhooks and recovery

- Expose only `/webhooks/whatsapp` through the public HTTPS tunnel or reverse proxy.
- Keep the dashboard and `/api/whatsapp/*` endpoints private.
- Signed normalized events and live conversation state are stored in SQLite at `WORKSPACE_DB_PATH`, defaulting to `.data/workspace.sqlite`.
- On first start, an empty workspace imports events from `WHATSAPP_EVENT_STORE_PATH` when the legacy JSON file exists. The legacy file is left intact for recovery.
- The workspace database contains customer identifiers and message previews. Restrict host access and include it in encrypted backups only when retention is required.
- After a server restart, load the workspace and confirm recent events are still present.
- If automatic refresh reports an error, verify the local server and network. The visible page retries when connectivity returns.
- A `401` response clears operator access and stops polling. Reload the workspace with the current token.

## Health, retention, and recovery

- `GET /healthz` checks local storage readiness without authentication and returns no counts, identifiers, paths, or credentials.
- The server runs retention at startup and every `WORKSPACE_RETENTION_INTERVAL_MS` (six hours by default). It removes expired raw events, audits, and inactive conversations while always preserving open and needs-review conversations.
- Event and audit histories are additionally bounded by `WORKSPACE_EVENT_LIMIT` and `WORKSPACE_AUDIT_LIMIT`.
- An admin can download a versioned recovery export with `GET /api/operations/export` or create a mode-`0600` atomic JSON backup with `POST /api/operations/backup`.
- Every backup is structurally verified before and after writing. `GET /api/operations/recovery` verifies the current export contract without writing a file.
- Keep `.data/backups` on encrypted storage. Exports contain customer identifiers, message text, and audit history.

## Credential rotation

1. Rotate the credential in Meta or generate a new operator token.
2. Update `.env` on the host.
3. Restart the Node service.
4. Re-run the readiness and workspace checks above.
5. Revoke the old credential after the new one succeeds.

## Operator roles

- Configure named local accounts with `OPERATOR_ACCOUNTS_JSON`; use long, unique tokens and safe non-personal IDs when possible.
- `viewer` can inspect workspace, event, template, AI, and automation status data.
- `agent` adds draft generation, live replies, escalations, and deferrals.
- `admin` adds manual automation runs. Background automation still follows the environment safety policy.
- `OPERATOR_API_TOKEN` is treated as the `legacy-admin` identity for backward compatibility.
- Reply, template, draft, escalate, and defer records include operator ID and role but never the bearer token.

## Production boundary

The bundled SQLite workspace provides atomic, durable state for one local server and multiple browser/operator sessions. A future multi-host deployment should replace the adapter with a network database while preserving the `applyEvents`, `getWorkspace`, `recordReply`, and `applyAction` interface.

Before enabling non-test customer traffic, complete the Meta app publishing and business-verification requirements for the target WhatsApp Business account, validate the approved template set, and run one controlled inbound/reply/delivery cycle with an authorized test recipient.
