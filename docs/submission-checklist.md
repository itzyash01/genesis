# Submission checklist

Use this checklist against the actual submitted revision. A checkbox is a task to verify, not a claim that it has already passed.

## Assignment and implementation

- [ ] Compare the final implementation and submission against every mandatory assignment item and record any remaining gap.
- [ ] Verify the configured model provider, API key, model and streaming behavior in the target environment.
- [ ] Verify sign-in, HighLevel OAuth and the assignment's sandbox environment with the intended reviewer account.
- [ ] Verify contacts list, search, create and update; conversations list, messages and send; calendars list, appointments and availability. Confirm actual message delivery separately from API acceptance.
- [ ] Verify generation streaming, generated file validity, preview, editing and saving, iterative changes, snapshot restore, and diff. Recheck the previously observed malformed output and delayed contact refresh.
- [ ] Verify errors, cancellation and limits are understandable to the user; identify which bonus features are complete and which remain unimplemented.

## Repository and deployment

- [ ] Run lint, builds and the test suite against the exact revision to submit; review results and limitations of mocked tests.
- [ ] Push the intended files to the public repository and confirm a reviewer can access it. Review changes and history for secrets; rotate the API key previously shared in chat.
- [ ] Confirm the README setup instructions, environment examples, deployed URL and OAuth callback match the final deployment. Verify Firestore rules, indexes and required secrets are deployed.
- [ ] Confirm CI runs the required checks; the current workflow does not yet run the full test suite.
- [ ] Open the deployed application and Help page in a fresh browser session; confirm the reviewer can follow the setup and use the demo.

## Submission materials

- [ ] Record the requested Loom walkthrough (maximum five minutes) and add its URL to the README.
- [ ] Include the public repository URL, live application URL and walkthrough URL in the submission as requested.
- [ ] Document known limitations and any reviewer setup required.
