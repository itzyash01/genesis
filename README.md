# Genesis — HighLevel App Builder

Genesis is a Vue 3 and TypeScript workspace for generating small, sandboxed apps that use live HighLevel CRM data. Firebase Authentication, Firestore, Cloud Functions, and Firebase Hosting provide the application backend and deployment target.

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
    │       ├── highlevel.ts      OAuth, token refresh, and read-only CRM adapters
    │       ├── index.ts          Callable and HTTP function entry points
    │       └── validation.ts     Server-side input constraints
    ├── firebase.json             Hosting, Functions, Firestore and emulator config
    ├── firestore.rules           Deny-by-default client access
    └── firestore.indexes.json    Required compound indexes

## Requirements

- Node.js 22.12 or newer in the Node 22 release line, and npm
- Firebase CLI
- A Firebase project with Authentication (email/password), Firestore, Cloud Functions, and Hosting enabled
- Firebase Blaze billing for deployed Cloud Functions and Secret Manager
- A HighLevel Marketplace app and a sandbox location
- An OpenAI API key

## Local setup

1. Select your Firebase project and copy the Firebase web app values into frontend/.env.local. The project alias is kept in your local Firebase CLI configuration and is not committed to this repository.

       cp frontend/.env.example frontend/.env.local
       cp functions/.env.example functions/.env
       firebase use --add

2. Set the server-only values in functions/.env. Use the emulator callback URI when using a local HTTPS tunnel or a callback URL supported by your HighLevel app. The deployed redirect URI should be:

       https://<project-id>.web.app/api/oauth/callback

3. Create the token encryption key and the local secret file. Do not commit either file.

       openssl rand -base64 32

   Save the generated value as TOKEN_ENCRYPTION_KEY in functions/.secret.local. Put OPENAI_API_KEY and HL_CLIENT_SECRET in the same file.

   Set APP_CHECK_REQUIRED=false in functions/.env for local emulator use unless App Check is configured for the local app.

4. Install dependencies:

       npm --prefix frontend install
       npm --prefix functions install

   For local development, set VITE_FIREBASE_EMULATORS=true and VITE_GENERATION_URL=http://127.0.0.1:5001/<project-id>/us-central1/api in frontend/.env.local. Set APP_ORIGIN and ALLOWED_ORIGINS in functions/.env. Start the emulators in one terminal and the Vite server in another:

       firebase emulators:start
       npm --prefix frontend run dev

   The Firebase Hosting emulator serves the built SPA and proxies /api routes. The Vite development server serves the frontend directly and uses the direct Functions emulator URL for SSE.

5. For local HighLevel OAuth, register the callback URL served by the Hosting emulator or expose the local emulator through an HTTPS tunnel. HighLevel must redirect to the exact configured URI. Use a sandbox location.

## HighLevel Marketplace setup

Register the callback URI exactly as configured in HL_REDIRECT_URI:

    https://<project-id>.web.app/api/oauth/callback

Request only these scopes:

- contacts.readonly
- conversations.readonly
- conversations/message.readonly
- calendars.readonly
- calendars/events.readonly
- locations.readonly

The OAuth callback exchanges the one-time code server-side. Access and refresh tokens are encrypted with AES-256-GCM before storage in a user-scoped, server-only Firestore document. Firebase Secret Manager provides the encryption key and HighLevel client secret to function instances. Token refresh is coordinated with a short Firestore lease because HighLevel rotates refresh tokens.

Each user connects one HighLevel location. Projects are associated with that location. The browser and generated preview never receive an OAuth token.

## Environment and secrets

frontend/.env.local contains the public Firebase web app values and optional App Check site key. functions/.env contains non-secret runtime parameters. Server credentials belong in Firebase Secret Manager:

    firebase functions:secrets:set OPENAI_API_KEY
    firebase functions:secrets:set HL_CLIENT_SECRET
    firebase functions:secrets:set TOKEN_ENCRYPTION_KEY

Set these non-secret function parameters in functions/.env.<project-id> before deployment:

- HL_CLIENT_ID
- HL_REDIRECT_URI
- HL_SCOPES
- APP_ORIGIN
- ALLOWED_ORIGINS
- OPENAI_MODEL
- APP_CHECK_REQUIRED

Enable Firebase App Check for the web app, set VITE_FIREBASE_APP_CHECK_SITE_KEY, and keep APP_CHECK_REQUIRED=true for production deployment. Functions enforce App Check when this flag is enabled. Keep the allowed origin list limited to the production site and known development origins.

## Deploy

1. Set the Firebase project alias and deploy Firestore rules and indexes.
2. Add the three server secrets through Firebase CLI.
3. Set APP_ORIGIN and ALLOWED_ORIGINS to the Firebase Hosting origin. Set HL_REDIRECT_URI to the registered callback URL.
4. Set VITE_GENERATION_URL in frontend/.env.local to the deployed api function URL. This lets the browser stream directly to the function. The Hosting rewrite remains useful for OAuth callback handling and local development; Firebase Hosting proxy requests have a 60-second request timeout.
5. Build and deploy:

       npm run build
       firebase deploy --only firestore:rules,firestore:indexes,functions,hosting

6. Confirm the callback returns to the production origin, the Hosting URL is reachable, and the deployed api function URL is documented before sharing a release.

The final URLs depend on the Firebase project and are intentionally not fabricated here:

- Frontend: https://<project-id>.web.app
- Functions base URL: https://us-central1-<project-id>.cloudfunctions.net

## Architecture decisions

- Cloud Functions own all project mutations and HighLevel authorization checks; Firestore client access is denied by default.
- Project, message, snapshot, file, and integration records are scoped under the Firebase user.
- OAuth state is random, hashed at rest, user-bound, expires after ten minutes, and is consumed once.
- OAuth credentials are AES-GCM encrypted before Firestore writes and use a Secret Manager key separate from HighLevel credentials.
- Generation streams SSE records; only validated JSONL file operations are stored.
- Generation is rate-limited per user, overlapping runs are blocked per project, context and file sizes are capped, and complete valid files are preserved if later output is malformed or interrupted.
- Each successful generation stores a point-in-time file snapshot and updates project files in one Firestore batch.
- Projects are limited to 150 files and 1.5 MB total; the latest 20 complete snapshots are retained per project.
- HighLevel access is read-only and proxied through server functions; generated code does not receive tokens.
- The preview iframe has an opaque sandbox origin, restrictive CSP, and an explicit message bridge for supported CRM reads.
- Firebase App Check can be enforced for callable and SSE functions when the production site key is configured.

## Operational notes and known limits

- Firebase Hosting proxy requests have a 60-second request timeout. Configure VITE_GENERATION_URL to call the deployed Functions endpoint directly for longer generation streams.
- The preview renderer supports index.html, local CSS, and plain JavaScript files. It intentionally blocks external network connections and third-party scripts.
- Preview API access supports reading contacts, conversations, conversation messages, calendars, and upcoming appointments. It does not send messages or modify HighLevel records.
- Each project is limited to 150 files and 1.5 MB total. Snapshots contain the whole current tree, and the latest 20 complete snapshots are retained per project.
- Configure Firestore TTL on oauthStates.expiresAt for automatic cleanup of expired OAuth state documents.
- Production deployment needs a Firebase project ID, Firebase app settings, and the three server secrets. HighLevel OAuth also requires a Marketplace app with the registered redirect URI and scopes above.

## Follow-up work

- Add integration and emulator tests for OAuth state consumption, refresh-token rotation, ownership checks, snapshot restore, and interrupted generation.
- Add an audited HighLevel write-action flow with user confirmation before sending messages or changing CRM records.
- Add generation cancellation persistence and diffs between snapshots.
- Add a cleanup job for expired OAuth state and old generation artifacts.
- Add staged Firebase deployments after the production project and deployment credentials are provisioned.

## Submission materials

- Loom walkthrough (maximum five minutes): add its URL once recorded.
- Architecture discussion and deployment notes are in this README.
- This repository should be public for assignment submission.
