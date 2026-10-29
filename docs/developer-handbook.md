# Developer handbook

This guide covers the implementation, local development, deployment and operations. The [user handbook](../frontend/public/help.html) explains the product workflow.

## 1. Product and architecture

Genesis is an authenticated app-building workspace. A user connects a HighLevel location, creates a project, describes an app, edits generated HTML, CSS and JavaScript, and uses an isolated live preview. Supported preview operations are proxied through the backend. See the [architecture diagram and flows](architecture.md) and the README's architecture decisions and tradeoffs.

Generation uses the OpenAI SDK with a configurable model endpoint. The configured service requires its own API credential and has its own usage limits.

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

## 2. Repository map

- `frontend/src/components`: authentication, project list, workspace, chat, editor, preview and history.
- `frontend/src/lib`: Firebase initialization and callable/SSE clients.
- `frontend/public`: static assets and the product Help page.
- `functions/src/index.ts`: authenticated callable endpoints, OAuth callback and generation HTTP entry point.
- `functions/src/generation.ts`: provider streaming, parsing, persistence, rate limits and generation logging.
- `functions/src/highlevel.ts`: OAuth, token refresh and CRM adapters.
- `functions/src/validation.ts`, `crypto.ts`, `snapshot-diff.ts`: input checks, encrypted token storage and snapshot comparison.
- `tests` and `functions/test`: automated unit suites. External services are mocked in unit tests.
- `firebase.json`, `firestore.rules`, `firestore.indexes.json`: hosting, functions, emulators, database access and indexes.

## 3. Complete local setup

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

In Genesis, confirm the CRM connection shows as connected. Create a project, request a small app such as a contact search dashboard, and check that generation and the preview work. Use test data to verify the required contact, conversation and calendar operations. A message accepted by the API is not necessarily delivered; check its status in HighLevel. For errors, see [Operations runbooks](runbooks.md).

Local emulator state may not persist after shutdown unless you explicitly export and import it. The deployed callback and production credentials remain separate from this local setup.


## 5. Development and verification

The workspace uses Firebase callable functions for project and CRM operations and an authenticated HTTP stream for generation. Preview code uses the `window.genesis.crm` bridge, whose supported methods and provider-shaped responses are documented in the README. The iframe does not receive OAuth credentials. Inspect request and response shapes before changing generated-code instructions or adapters.

```bash
npm run lint
npm run build
npm test
npm run test:coverage
```

Tests and coverage measure the code and mocks in the checked-out revision. A passing unit suite does not prove live OAuth, actual message delivery or provider generation. Separately verify the required operations using a HighLevel test location and the deployed application. Avoid sending messages to real recipients during tests without their authorization.

## 6. Deployment and release

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



## 7. Operations and configuration

Use the [runbooks](runbooks.md) to diagnose OAuth, generation, CRM and deployments. Structured generation and CRM logs omit prompts, generated content, contact fields and credentials; platform logs can have additional fields. No dashboard or alert policy is provisioned by this repository.

The application limits generation attempts, CRM writes, file count, file size and snapshot retention. Provider limits are separate. The preview restricts external resources. Snapshot comparisons require a recorded generation baseline; older or restored snapshots may not have one. A send API response is not proof of message delivery. See the README for exact current limits and response shapes.

