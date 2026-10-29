# Genesis video walkthrough script

**Assignment format:** a single Loom video, no longer than five minutes. The script below is written for a live walkthrough of the deployed application. Screen actions are in italics; speak the quoted text. Do not display credentials, OAuth codes, contact details or message content that should remain private.

**Demo prompt:** “Build a contact dashboard with search and a list of upcoming appointments.”

## 0:00–0:20 — Product introduction

*Show the deployed Genesis sign-in screen.*

“Genesis is an AI app builder for HighLevel. A user describes a CRM workflow, and Genesis generates editable web files with a live preview. The workspace combines conversation, code editing, real CRM data and version history.”

## 0:20–0:55 — Login and OAuth connection

*Sign in, then select the HighLevel connection option. Show the authorization and location-selection screen if a new authorization is required, and return to the connected projects page.*

“Authentication uses Firebase Authentication. To connect a CRM location, Genesis starts a HighLevel OAuth 2.0 flow. After authorization, HighLevel redirects to our backend callback. The backend validates the state, exchanges the code, and stores the access and refresh tokens encrypted in Firestore. The client and generated preview never receive those credentials.”

*If the account is already connected and HighLevel does not display consent again, show the connected status and describe the flow without claiming to have demonstrated consent.*

## 0:55–1:40 — Project and streaming generation

*Create a project. Enter the demo prompt and select Generate. Keep the chat and code panels visible while output arrives.*

“Inside a project, I describe the application I want. The generation endpoint sends the request and project context to the configured model provider, then streams the response to the workspace using server-sent events. Genesis validates generated file records and saves complete valid files. If generation is interrupted, it can preserve partial valid output and report the problem.”

*Show the resulting files and live preview. If generation is slow, keep the streaming moment in the recording and trim only the waiting time.*

“The generated HTML, CSS and JavaScript appear in the editor, and the preview runs in an isolated iframe. The workspace also supports stopping an active generation and asking for a follow-up change.”

## 1:40–2:25 — Real HighLevel data and supported APIs

*Use the generated dashboard to search contacts and load appointments from the connected test location. Show real results if they are available.*

“The preview makes real HighLevel requests through a controlled bridge and authenticated backend functions. It supports listing and searching contacts, as well as creating and updating them. It also supports listing conversations, loading messages and sending an SMS or email. Calendar operations include listing calendars, retrieving appointments and checking availability.”

*If a generated app exposes a create or update action, open the confirmation dialog and show it. Confirm only an intended change to test data.*

“Sensitive writes require confirmation in the host application. A successful send request means HighLevel accepted the request; the delivery status must still be checked in HighLevel.”

## 2:25–3:05 — Code editing, refinement and snapshots

*Open a generated file, make a small visible edit, save it and show the preview. Open History, choose View changes on a generation snapshot, then restore an earlier snapshot.*

“Generated files remain editable in the Monaco editor. Users can also ask the model to modify an existing project. Each generation saves a snapshot. History lets me compare a generation with its recorded input and restore an earlier version. Older or restored snapshots without a recorded baseline cannot show that comparison.”

## 3:05–3:45 — Architecture and design decision

*Show the architecture diagram in the repository.*

“The frontend is built with Vue 3 and TypeScript and served by Firebase Hosting. Firebase Authentication identifies the user. Cloud Functions own project operations, OAuth and CRM requests; Firestore stores project data and encrypted integration credentials. Secret Manager supplies server credentials.”

“One design decision I would highlight is the preview bridge. Generated code runs inside a sandboxed iframe instead of receiving the HighLevel token. The host exposes supported operations, and backend functions enforce identity, location checks and validation. This improves isolation, although it limits arbitrary network access and third-party dependencies in the preview.”

## 3:45–4:15 — Logs and reliability

*Show Firebase Functions Logs or Google Cloud Logs Explorer. Filter for a recent generation or CRM event if available; avoid exposing sensitive values.*

“The backend emits structured generation and CRM request logs. Generation events include timing, outcomes and invalid file counts. CRM events include the resource category, request status and duration. These application events exclude prompts, generated code, contact details and credentials. Platform logs and metrics are available separately.”

“Generation and write limits help contain usage. Clear errors and partial-file preservation help users recover from an interrupted or malformed response.”

## 4:15–4:45 — Deployment, implementation and limitations

*Show the deployed application, then the repository README or diagram.*

“Firebase Hosting serves the frontend, while second-generation Cloud Functions provide the backend. The repository includes environment examples, local emulator setup, deployment notes, an architecture diagram and runbooks. Unit tests cover application logic with service mocks; a live walkthrough is still needed to verify the actual CRM and provider connections.”

“Generation uses the OpenAI SDK. Message delivery depends on the connected HighLevel account and its messaging configuration.”

## 4:45–5:00 — Close

*Return to the project preview or repository README.*

“Genesis brings app generation, real CRM workflows and editable project history into one workspace. The repository and deployed application links are included with the submission. Thank you.”

---

## Detailed presenter reference

These points support questions after the five-minute recording. They are not additional claims that every live path has been verified.

- **Identity and access:** Firebase Authentication identifies users. Server functions validate project ownership and CRM location access. Firestore rules deny direct client access by default.
- **OAuth and credentials:** OAuth state is user-bound and consumed by the backend. Access and refresh tokens are encrypted before storage. A server-side lease coordinates refresh when tokens rotate. Client secrets and encryption keys use Secret Manager in deployment.
- **Generation:** An authenticated HTTP endpoint streams SSE. The parser validates file records, persists complete valid output and reports partial or failed generation. The workspace supports cancellation and iterative refinement. Provider and application usage limits are separate.
- **Editor and preview:** Monaco edits the generated files. A sandboxed iframe with restrictive content policy runs the preview. The message bridge exposes supported CRM operations without passing tokens to generated code.
- **CRM contract:** Contacts support list, search, create and update. Conversations support list, messages and send. Calendars support list, appointments and availability. The README documents response shapes, date bounds, limits and provider metadata. Appointment creation is outside the listed mandatory calendar operations.
- **History and diff:** Generation stores a snapshot and its input baseline. Users can view a diff when the baseline exists and restore snapshots. Existing file, project-size and snapshot-retention limits are documented in the README.
- **Operational visibility:** `generation.started`, `generation.finished`, `generation.save_failed`, `crm.request` and `crm.request_failed` provide structured events. Cloud Monitoring provides platform metrics; custom dashboards and alert policies have not been provisioned.
- **Deployment:** Firebase Hosting serves the frontend. Functions v2 run on managed infrastructure with per-function instance caps. Runtime secrets are stored separately from source. Docker is not required by the current deployment.
- **Testing:** Unit tests use Firebase and CRM mocks. Automated test coverage does not establish real delivery, live OAuth, a compliant model provider or end-to-end production behavior.
- **Known limits:** Full live verification remains necessary. Pagination and webhook updates are not presented as complete bonus features. A successful message submission does not ensure delivery.
