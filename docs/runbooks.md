# Operations runbooks

These are diagnostic procedures for the existing Firebase deployment. Confirm the project and environment before taking action. Do not put tokens, keys, contact details or prompts into tickets or public logs.

## Where to look

- Firebase Console → Functions → Logs, or Google Cloud Logging → Logs Explorer for the selected project and region.
- Generation events: `generation.started`, `generation.finished`, `generation.save_failed`. Inspect outcome, elapsed time, first-token time and invalid file counts.
- CRM events: `crm.request` and `crm.request_failed`. Inspect category, HTTP status and elapsed time. Event success describes the request, not downstream message delivery.
- Cloud Monitoring exposes platform requests, latency and instance metrics. Application logs are necessary to distinguish generation failures returned within a successful stream response. Dashboards and alerts are not configured by this repository.

## HighLevel connection fails

1. Confirm the intended Firebase environment, HighLevel account and location. Check the app's installed scopes and the user's location access.
2. Compare the callback configured in the Marketplace with `HL_REDIRECT_URI` exactly. For local testing confirm the tunnel and Functions emulator are both running and the tunnel targets the correct port.
3. Start a fresh OAuth flow; avoid reusing a callback URL or authorization code. Inspect backend logs for the callback outcome without sharing query parameters or tokens.
4. If the installation or granted scopes changed, reconnect as needed. Escalate an upstream account or Marketplace problem with sanitized error details.

## Generation stalls, is limited or produces invalid files

1. Check the displayed error, generation events and provider quota. Distinguish the application's per-user limit from the provider's independent limit.
2. Verify the selected provider/model, server secret, direct generation URL and allowed origin for the active environment. The app's deployment configuration may differ from local files.
3. Review the saved files and snapshot. Partial valid output may have been preserved; it should not be described as a complete successful generation.
4. Retry with a specific prompt only after identifying the issue. Repeated malformed output requires investigation of provider output and parser behaviour using appropriate access controls.

## CRM data or updates appear wrong

1. Confirm the connected location, permissions, search filters and date range; test the same record in HighLevel.
2. Inspect the generated app's bridge call and the response shape documented in the README. CRM data can have optional fields; availability slots are start-time strings.
3. After a write, check the upstream record and refresh the generated app's data. A successful API response does not guarantee an immediate updated list or message delivery.
4. For failed sends inspect HighLevel's message status, account configuration and any upstream error. Do not retry a send repeatedly without checking whether it already succeeded.

## Deployment or local startup fails

1. Check the selected Firebase project, Node and Java versions, installed dependencies, service enablement, billing and secrets. Consult sanitized CLI diagnostics.
2. Confirm frontend build settings and direct SSE URL, functions configuration, origins, callback, rules and indexes for the target environment.
3. For local failures check the frontend and emulator processes separately; a running tunnel does not mean a backend is listening.
4. After a release, verify the site and a controlled end-to-end flow. Use the platform's documented revision/deployment history for recovery; this repository does not provide an automated rollback procedure.

## Credential exposure

Revoke or rotate the affected credential with its provider, update the corresponding secret in the correct environment, redeploy any affected functions and verify access. Review repository history and logs for exposure; removing a file from the latest revision alone does not remove a secret from history.
