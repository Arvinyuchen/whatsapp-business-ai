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

## Webhooks and recovery

- Expose only `/webhooks/whatsapp` through the public HTTPS tunnel or reverse proxy.
- Keep the dashboard and `/api/whatsapp/*` endpoints private.
- Signed normalized events are stored at `WHATSAPP_EVENT_STORE_PATH`, defaulting to `.data/whatsapp-events.json`.
- The event file contains customer identifiers and message previews. Restrict host access and include it in encrypted backups only when retention is required.
- After a server restart, load the workspace and confirm recent events are still present.
- If automatic refresh reports an error, verify the local server and network. The visible page retries when connectivity returns.
- A `401` response clears operator access and stops polling. Reload the workspace with the current token.

## Credential rotation

1. Rotate the credential in Meta or generate a new operator token.
2. Update `.env` on the host.
3. Restart the Node service.
4. Re-run the readiness and workspace checks above.
5. Revoke the old credential after the new one succeeds.

## Production boundary

The bundled file event store is appropriate for a single Node process. Before running multiple application instances, replace it with a shared durable store that provides atomic deduplication. Keep the same `append` and `list` boundary used by `server/app.js`.

Before enabling non-test customer traffic, complete the Meta app publishing and business-verification requirements for the target WhatsApp Business account, validate the approved template set, and run one controlled inbound/reply/delivery cycle with an authorized test recipient.
