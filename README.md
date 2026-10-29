# Genesis — HighLevel App Builder

Genesis is a Vue 3 and TypeScript workspace for generating small, sandboxed apps that use live HighLevel CRM data. Firebase Authentication, Firestore, Cloud Functions, and Firebase Hosting provide the application backend and deployment target.

Generation uses the OpenAI JavaScript SDK. Configure the model endpoint and its corresponding `LLM_API_KEY` through the environment settings.

**Product walkthrough:** [Watch the Genesis demo on Loom](https://www.loom.com/share/5150672e0ec94222ae637b64df036b2c)

## Product capabilities

| Capability | What Genesis supports |
| --- | --- |
| **Accounts and projects** | Email/password sign-in with Firebase Authentication; create, reopen and manage user-scoped projects. |
| **Streaming app generation** | Describe an app in chat; generated output streams into the workspace using SSE. Complete valid files are saved, including when a response is interrupted. |
| **Code editor and preview** | Inspect and edit HTML, CSS and JavaScript in Monaco; run the app in an isolated live preview. |
| **HighLevel contacts** | List, search, create and update contacts. |
| **HighLevel conversations** | List conversations, retrieve messages and request SMS or email sends. |
| **HighLevel calendars** | List calendars, retrieve appointments and check availability. |
| **Version history** | Save generation snapshots and restore an earlier version. |
| **Operational visibility** | Structured generation and CRM request logs report outcomes and timing. |

### Implemented bonus features

- **Generation cancellation:** Stop an active generation from the workspace.
- **Iterative refinement:** Send follow-up requests that modify the current project files.
- **Generation diff:** In **History → View changes**, compare generated files with their recorded input. Comparisons use the generation’s recorded baseline.
- **Cloud Function rate limits:** Per-user limits cover generation attempts and CRM preview reads and writes. The configured generation limit defaults to 20 attempts per 60 minutes; CRM reads and writes have separate limits.

### Security controls

- **User authentication:** Firebase Authentication handles email/password sign-in; application operations require an authenticated user.
- **OAuth 2.0 and token encryption:** HighLevel credentials are exchanged and refreshed on the backend. Tokens are encrypted with AES-256-GCM before storage; the browser and generated app do not receive them.
- **Server-side secrets:** Model and HighLevel credentials and the encryption key are provided to deployed Functions through Secret Manager.
- **User and location isolation:** Server functions validate inputs and enforce project ownership and connected-location checks. Firestore client access is denied by default.
- **Sandboxed preview and confirmed writes:** Generated code runs in an isolated iframe with restricted network access. Supported CRM writes are presented to the user for confirmation.
- **Privacy-conscious logs:** Application events omit prompts, generated code, contact details and credentials. Platform logs have separate fields and retention settings.

Message delivery depends on the connected HighLevel account and should be checked through its delivery status. Supported API operations and limits are detailed later in this document.

## Quick start

The deployed app is [Genesis](https://genesis-699ec.web.app). To run the project locally, follow [Local setup](#local-setup); it includes Firebase emulators and the HighLevel OAuth callback. The sections below also cover tests, deployment, architecture and the CRM API contract.

## Repository layout

    .
    ├── frontend/                 Vue 3 SPA, shadcn-vue primitives, bundled Monaco editor
    │   └── src/
    │       ├── components/       Auth, projects, workspace, preview and UI components
    │       └── lib/              Firebase client and callable/SSE API clients
    ├── functions/                Firebase Functions v2, TypeScript, Node.js 22
    │   └── src/
    │       ├── admin.ts          Firebase Admin initialization
    │       ├── config.ts         Runtime parameters and Secret Manager bindings
    │       ├── crypto.ts         AES-256-GCM OAuth token encryption
    │       ├── generation.ts     LLM stream parsing, validation, snapshots, limits
    │       ├── highlevel.ts      OAuth, token refresh, and scoped CRM read/write adapters
    │       ├── index.ts          Callable and HTTP function entry points
    │       └── validation.ts     Server-side input constraints
    ├── firebase.json             Hosting, Functions, Firestore and emulator config
    ├── firestore.rules           Deny-by-default client access
    └── firestore.indexes.json    Required compound indexes

## Documentation

- [User handbook](frontend/public/help.html) — connect a CRM, build an app, edit files, and use history. The Help link in Genesis opens the same page.
- [Architecture and data flows](docs/architecture.md) — system diagram, boundaries, data storage, and operations.
- [Developer handbook](docs/developer-handbook.md) — setup, architecture, development, deployment and verification.
- [Operations runbooks](docs/runbooks.md) — troubleshooting and recovery.
- [Product presentation](docs/presentation/Genesis-product-presentation.pptx) — optional presentation artifact.

## Requirements

- Node.js 22.12 or newer in the Node 22 release line, and npm
- Java 21 or newer for the Firebase emulators
- Firebase CLI
- A Firebase project with Authentication (email/password), Firestore, Cloud Functions, and Hosting enabled
- Firebase Blaze billing for deployed Cloud Functions and Secret Manager
- A HighLevel Marketplace app and a sandbox location
- An API key for the selected model provider.

## Local setup

These steps run the frontend and Firebase emulators on your computer while connecting to a real HighLevel test location. Keep the three terminal windows open throughout the session. Emulator data is separate from the deployed application.

### Before you start

You need Node.js 22.12 or newer within the Node 22 release line, npm, Java 21 or newer, a Firebase project with a registered web app, a HighLevel Marketplace app and test location, and a model API key. The Marketplace app needs these scopes: `contacts.readonly`, `contacts.write`, `conversations.readonly`, `conversations/message.readonly`, `conversations/message.write`, `calendars.readonly`, `calendars/events.readonly`, and `locations.readonly`. Its client ID and client secret are used below. For deployed Functions, Firebase billing is also required; these steps use emulators.

Clone the repository and enter it before running the remaining commands:

```bash
git clone https://github.com/itzyash01/genesis.git
cd genesis
```

If you already have the source, open a terminal in its root directory instead. The checked-in `.firebaserc` selects `genesis-699ec`. For another Firebase project, select it using the Firebase CLI and use the same project ID in the frontend configuration and callback URLs. You may need to run `npx firebase login` and `npx firebase use --add` first.

### 1. Install dependencies and build the backend

```bash
npm install
npm --prefix frontend install
npm --prefix functions install
npm --prefix functions run build
```

The Functions emulator loads compiled JavaScript from `functions/lib`. Rebuild after changing backend TypeScript and restart the emulator to load the changes.

### 2. Configure the frontend

Copy the example file if you have not already created your local configuration:

```bash
cp frontend/.env.example frontend/.env.local
```

**Do not overwrite an existing `.env.local` containing your settings.** In `frontend/.env.local`, fill in the Firebase web app values from Firebase Console → Project settings → Your apps. Then set the following, replacing `<project-id>` with the same Firebase project ID:

```dotenv
VITE_FIREBASE_FUNCTIONS_REGION=us-central1
VITE_FIREBASE_EMULATORS=true
VITE_GENERATION_URL=http://127.0.0.1:5001/<project-id>/us-central1/api
VITE_FIREBASE_APP_CHECK_SITE_KEY=
```

Use `127.0.0.1` consistently for this walkthrough. Vite reads these values at startup, so restart it after changing the file. Keep the other Firebase web app values from the example and fill them in; the block above is not the complete file.

### 3. Configure Functions and local secrets

Create the emulator-specific settings file if it does not already exist:

```bash
cp functions/.env.example functions/.env.local
```

Edit `functions/.env.local` and set:

- `HL_CLIENT_ID`: the client ID from your HighLevel Marketplace app.
- `HL_SCOPES`: the scopes listed above; request and grant them in the Marketplace app too.
- `APP_ORIGIN=http://127.0.0.1:5173` and `ALLOWED_ORIGINS=http://127.0.0.1:5173`. If Vite prints a different address or port, use that exact origin instead.
- `LLM_PROVIDER` and the relevant model setting: use the values for your model service; its API key goes in the secret file below.
- `APP_CHECK_REQUIRED=false` for this emulator walkthrough.
- `HL_REDIRECT_URI`: fill this in after starting the tunnel in step 5.

Firebase also reads applicable `functions/.env` and project-specific environment files. For emulation, values in `functions/.env.local` override matching values from those files. Use the emulator-specific file for the local callback and origin so that production settings are not confused with local settings.

Generate a **new** 32-byte encryption key:

```bash
openssl rand -base64 32
```

Create `functions/.secret.local` with these three entries. Replace the placeholders with your own values; use the output from the command for `TOKEN_ENCRYPTION_KEY`:

```dotenv
HL_CLIENT_SECRET=<highlevel-client-secret>
TOKEN_ENCRYPTION_KEY=<generated-base64-key>
LLM_API_KEY=<model-service-api-key>
```

Keep this file private and never commit it. The emulator uses it for local secrets; deployment uses Firebase Secret Manager. Retain the same local encryption key while you need to read existing locally stored credentials.

### 4. Start the frontend and emulators

In **terminal 1**, start the Functions, Authentication and Firestore emulators:

```bash
npm run emulators
```

In **terminal 2**, start the frontend:

```bash
npm run dev
```

Open the URL printed by Vite, normally [http://127.0.0.1:5173](http://127.0.0.1:5173). The Functions emulator normally listens on port `5001`; Auth and Firestore listen on `9099` and `8080`. Wait until the emulator reports that Functions are loaded. The frontend uses the Functions emulator directly for streaming.

### 5. Set up the local OAuth callback

HighLevel must be able to reach the callback over HTTPS. In **terminal 3**, start a tunnel to the Functions emulator. One example is:

```bash
npx --yes localtunnel --port 5001 --local-host 127.0.0.1
```

Keep the tunnel running and copy its printed HTTPS host. Construct the callback using the same Firebase project ID and region used above:

```text
https://<tunnel-host>/<project-id>/us-central1/oauthCallback
```

For example, if the tunnel prints `https://example.loca.lt` and the project ID is `genesis-699ec`, the callback is `https://example.loca.lt/genesis-699ec/us-central1/oauthCallback`.

1. Put that complete URL in `HL_REDIRECT_URI` in `functions/.env.local`.
2. Add the **exact same URL** to the HighLevel Marketplace app's redirect URLs and save it. Keep the deployed callback too if the app supports multiple redirect URLs.
3. Restart **terminal 1** so the Functions emulator reloads its configuration. Leave Vite and the tunnel running.
4. In the local Genesis page, create an account or sign in using the **Auth emulator**. This account is separate from your deployed Firebase account. Start the HighLevel connection from Genesis and authorize the intended test location.

To check the local callback handler without an OAuth code, open `http://127.0.0.1:5001/<project-id>/us-central1/oauthCallback`. Once the app origin is configured, a **400 missing required parameters** response means the handler was reached; it does not mean authorization succeeded. A 503, gateway error or tunnel verification page means the public request has not yet reached the handler. Check the emulator, tunnel and callback URL; a tunnel that inserts a browser verification page may not work reliably for OAuth.

If the tunnel host changes, update both `functions/.env.local` and the Marketplace redirect URL, restart the Functions emulator, and begin a **new** connection from Genesis. OAuth codes and state belong to the flow that created them; do not reuse an old callback URL.

### 6. Verify the local workflow

In Genesis, confirm the CRM connection shows as connected. Create a project, request a small app such as a contact search dashboard, and check that generation and the preview work. Use test data to verify the required contact, conversation and calendar operations. A message accepted by the API is not necessarily delivered; check its status in HighLevel. For errors, see [Operations runbooks](docs/runbooks.md).

Local emulator state may not persist after shutdown unless you explicitly export and import it. The deployed callback and production credentials remain separate from this local setup.

## Tests and coverage

Install dependencies in the root, `frontend`, and `functions` directories as shown above, then run:

```bash
npm test                 # Backend node tests and frontend/backend Vitest suite
npm run test:coverage    # Whole-source Vitest coverage report
```

The coverage report is written to `coverage/`. Unit tests use mocks for Firebase and CRM calls; they do not replace a live OAuth, CRM, or deployed-app walkthrough. The original backend node tests run in `npm test`; their assertions are represented separately in the Vitest coverage suite.

## HighLevel Marketplace setup

Register the callback URI exactly as configured in HL_REDIRECT_URI:

    https://us-central1-<project-id>.cloudfunctions.net/oauthCallback

Request these scopes for the supported contact, conversation and calendar workflows:

- contacts.readonly
- contacts.write
- conversations.readonly
- conversations/message.readonly
- conversations/message.write
- calendars.readonly
- calendars/events.readonly
- locations.readonly

The OAuth callback exchanges the one-time code server-side. Access and refresh tokens are encrypted with AES-256-GCM before storage in a user-scoped, server-only Firestore document. Firebase Secret Manager provides the encryption key and HighLevel client secret to function instances. Token refresh is coordinated with a short Firestore lease because HighLevel rotates refresh tokens.

Each user connects one HighLevel location. Projects are associated with that location. The browser and generated preview never receive an OAuth token.

### Generated app CRM contract

The sandbox exposes asynchronous methods under `window.genesis.crm`; the server retains credentials. CRM read methods return objects: `contacts({query})` returns `{contacts, total}`; `conversations()` returns `{conversations, total}`; `messages(conversationId)` returns `{messages: {messages, ...}}`; `calendars()` returns `{calendars}`; `contact(contactId)` returns `{contact}`. Contact names may be returned as `firstName`, `lastName`, and `contactName`; do not assume a `name` field. Provider metadata is preserved. `appointments({startDate, endDate, calendarId})` returns `{events, truncated}`; it aggregates events across up to 20 calendars and reports truncation. Appointment bounds are Unix milliseconds and the maximum range is 31 days.

`availability(calendarId, {startDate, endDate, timezone})` preserves the provider's date-keyed response, such as `{ "2026-01-01": { "slots": ["2026-01-01T10:00:00+00:00"] } }`, potentially with metadata like `traceId`. Each slot is a start-time string; an end time is not provided. The maximum range is 31 days. Messages include `body`, `dateAdded`, `direction`, `messageType`, `status`, and possibly `error`; a successful send request does not guarantee delivery. Write operations return provider response objects after host confirmation. The application aggregates appointment results; other read responses retain the provider response shape.


## Environment and secrets

frontend/.env.local contains the public Firebase web app values and optional App Check site key. functions/.env contains non-secret runtime parameters. Server credentials belong in Firebase Secret Manager:

    firebase functions:secrets:set LLM_API_KEY
    firebase functions:secrets:set HL_CLIENT_SECRET
    firebase functions:secrets:set TOKEN_ENCRYPTION_KEY

Set these non-secret function parameters in functions/.env.<project-id> before deployment:

- HL_CLIENT_ID
- HL_REDIRECT_URI
- HL_SCOPES
- APP_ORIGIN
- ALLOWED_ORIGINS
- GROQ_MODEL
- LLM_PROVIDER
- OPENAI_MODEL
- MAX_GENERATIONS_PER_HOUR
- APP_CHECK_REQUIRED

App Check is optional. If enabled, register the web app with an appropriate provider, configure VITE_FIREBASE_APP_CHECK_SITE_KEY, and enable APP_CHECK_REQUIRED only after verifying that the frontend sends valid tokens. Keep the allowed origin list limited to the production site and known development origins.

## Deploy

Deployment publishes to a Firebase project and is separate from the local emulators. The frontend, Functions, Firestore rules and indexes can be deployed independently or together. Confirm the target project and billing configuration before running a deploy.

1. Select the intended Firebase project with the Firebase CLI. Enable Authentication, Firestore, Hosting, Functions and billing for deployed Functions. Create or register the Firebase web app.
2. Configure the non-secret Functions parameters in `functions/.env.<project-id>`: `HL_CLIENT_ID`, `HL_REDIRECT_URI`, `HL_SCOPES`, `APP_ORIGIN`, `ALLOWED_ORIGINS`, the model provider and model settings, `MAX_GENERATIONS_PER_HOUR`, and `APP_CHECK_REQUIRED`. Use the production Hosting origin for the origin settings.
3. Register the exact production callback in the HighLevel Marketplace app. For this project it is `https://us-central1-genesis-699ec.cloudfunctions.net/oauthCallback`. Enable and grant `contacts.readonly`, `contacts.write`, `conversations.readonly`, `conversations/message.readonly`, `conversations/message.write`, `calendars.readonly`, `calendars/events.readonly`, and `locations.readonly`.
4. Store the server secrets in Firebase Secret Manager. Run the following commands separately and provide the secret values when prompted:

   ```bash
   npx firebase functions:secrets:set LLM_API_KEY
   npx firebase functions:secrets:set HL_CLIENT_SECRET
   npx firebase functions:secrets:set TOKEN_ENCRYPTION_KEY
   ```

   Keep the production encryption key stable while existing OAuth credentials need to be decrypted. Never copy local secrets into source control.
5. For a new project, deploy the backend first so the `api` function URL is available in the Firebase deployment output:

   ```bash
   npm --prefix functions run build
   npx firebase deploy --only firestore:rules,firestore:indexes,functions
   ```

6. Set the frontend Firebase web app configuration and the deployed generation function URL in `frontend/.env.local` before building. `VITE_GENERATION_URL` should point to the deployed `api` function, so long SSE streams do not rely on the Hosting proxy timeout. For the existing Genesis deployment, that endpoint is `https://api-hvxysjnffq-uc.a.run.app`; check your own Functions deployment output if using a different project. Set `VITE_FIREBASE_EMULATORS=false`.
7. Build and deploy from the repository root:

   ```bash
   npm run build
   npx firebase deploy --only firestore:rules,firestore:indexes,functions,hosting
   ```

8. Confirm that the frontend loads, a fresh OAuth connection returns to the production origin, and generation, CRM reads, confirmed writes and history work with a test location. The deployed frontend is `https://genesis-699ec.web.app`; the Cloud Functions base is `https://us-central1-genesis-699ec.cloudfunctions.net`.

The current GitHub Actions workflow runs lint and build; it does not deploy or run the full test suite. Deployment remains a manual Firebase CLI operation. Frontend Help changes require a new frontend build and Hosting deployment. Do not expose credentials in terminal output, logs, screenshots or documentation.


## Architecture decisions and tradeoffs

1. **Server-mediated data access instead of direct Firestore access.** Project and CRM operations pass through authenticated Functions, and client Firestore rules deny direct access. This centralizes ownership checks and keeps integration credentials out of the browser. It adds a network hop and makes backend authorization code and Functions availability part of every operation.
2. **Sandboxed preview with an explicit CRM bridge instead of running generated code in the workspace origin.** The iframe has an opaque origin and restrictive content policy; the host exposes only supported operations and confirms writes. This limits what generated code can access, but rules out arbitrary external scripts, network calls and APIs that the bridge has not implemented.
3. **Server-side OAuth with encrypted tokens and a refresh lease instead of browser-held credentials.** The callback exchanges codes on the backend, stores encrypted credentials and coordinates refresh in Firestore because refresh tokens rotate. This reduces client exposure and concurrent refresh races, at the cost of a shared encryption key, extra reads and lease/recovery logic. Loss or incorrect rotation of the key makes existing encrypted credentials unreadable.
4. **SSE over a direct HTTP function instead of waiting for one complete response through Hosting.** The browser can receive generation output incrementally, while the direct endpoint avoids the Hosting proxy's shorter timeout. The tradeoff is a long-lived request, separate endpoint/origin configuration, and explicit handling for cancellation, interrupted streams and malformed output. Valid partial files can be saved, so the UI must distinguish partial results from completion.
5. **Full snapshots with generation baselines instead of storing only patches.** A snapshot records complete output files and the generation input, making restore and per-file comparison independent of replaying earlier changes, including manual edits. This duplicates content and increases Firestore writes and storage. File-count, project-size and retention limits bound that cost, and snapshots created before baseline capture cannot provide an exact diff.
6. **One active generation per project with a Firestore transaction instead of unconstrained parallel writes.** A project lock and user rate window are updated transactionally before generation, preventing overlapping runs from silently overwriting each other's project state. This serializes work while the lease is valid and requires expiry, release and retry handling when a stream or process fails; a long-running request can outlive its lease.
7. **Provider-shaped CRM responses instead of a complete application-specific data model.** Preserving HighLevel response fields retains provider metadata and reduces adapter mapping. Generated code must understand each documented response shape, optional fields and provider changes; availability remains date-keyed, while appointments require aggregation and expose a truncation indicator.
8. **Synchronous, confirmed CRM writes instead of a queued mutation pipeline.** The host displays the requested payload and the server performs validation and location checks before calling HighLevel. This keeps the user in control and returns an immediate API outcome, but upstream errors and latency remain visible to the caller. API acceptance is not a delivery guarantee, and an automatic retry could duplicate a side effect.
9. **Managed Functions with bounded instances instead of provisioned application servers.** Hosting and Functions remove server and container administration, and per-function caps bound concurrent scaling. Cold starts and provider limits still affect latency, and instance caps are not a cost ceiling. Streaming consumes a function connection while generation runs.
10. **Metadata-only application logs instead of logging complete requests and responses.** Generation and CRM events record outcome, timing and operational counts without prompts, generated files or contact data. This limits exposure of customer data but leaves less information for reproducing content-dependent failures; platform logs, CRM status and controlled debugging are still needed.

## Operational configuration

- Firebase Hosting proxy requests have a 60-second request timeout. Configure VITE_GENERATION_URL to call the deployed Functions endpoint directly for longer generation streams.
- The preview renderer supports index.html, local CSS, and plain JavaScript files. It intentionally blocks external network connections and third-party scripts.
- Preview API access supports contacts, conversations, messages, calendars, upcoming appointments, and calendar availability. Generated apps can create/update contacts and send SMS/email messages; each write opens a host confirmation showing the exact payload.
- Write operations are limited to 10 per user per minute. Contact ownership is checked against the connected location before updates or messages.
- Generation is limited per user to `MAX_GENERATIONS_PER_HOUR` attempts in a 60-minute window beginning with the first attempt (default 20). The provider may impose separate limits.
- Each project is limited to 150 files and 1.5 MB total. Snapshots contain the whole current tree, and the latest 20 complete snapshots are retained per project.
- Firestore TTL is defined in firestore.indexes.json for expired OAuth state and 90-day CRM action audit records.
- Production deployment needs a Firebase project ID, Firebase app settings, and the three server secrets. HighLevel OAuth also requires a Marketplace app with the registered redirect URI and scopes above.

## Observability

Cloud Functions emit structured `generation.started`, `generation.finished`, and `generation.save_failed` logs, including an opaque generation ID, elapsed time, first-token latency, outcome, and file counts. CRM requests emit `crm.request` or `crm.request_failed` with a resource category, HTTP method, status when available, and elapsed time. These application events omit prompts, generated code, contact data, credentials, user IDs, and CRM record IDs. Existing Firebase/Cloud Run request logs have their own fields and retention settings.

View these events in Firebase Console > Functions > Logs or Google Cloud > Logging > Logs Explorer. Filter by the event name to investigate failures and latency. Cloud Monitoring also provides request, latency, and instance metrics for the underlying Cloud Run services. Set alerts and budgets in the Google Cloud console if needed; this repository does not create alert policies or dashboards.

## Future improvements

1. Add end-to-end emulator and deployed tests for OAuth, token rotation and CRM ownership.
2. Improve validation and recovery for malformed model output and interrupted streams.
3. Implement pagination and verified webhook-driven updates for generated apps.
4. Add monitored release pipelines, alert policies and operational dashboards.
5. Improve real-time refresh after CRM changes and validate provider consistency across workflows.
