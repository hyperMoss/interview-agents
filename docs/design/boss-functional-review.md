# BOSS workflow functional review

## Decision

**BLOCKED on authenticated live-site verification.** The reviewed local code findings F1–F7 and the four Patchright review findings are closed. Current browser-free response checks, earlier build and driver checks, and the historical Moli regression each have the scope recorded below. This is not a claim that the BOSS adapter is ready for real delivery.

The specification and independent source rechecks used `magpie/remote-magpie/codex/gpt-6.1-sol`. Final repairs used the required `auto/deepseek-v4.1-flash` implementation route. The primary GPT session owns the runtime results below.

## Engine revision after this review

The results below were observed with the then-default Moli engine. The current tree makes Patchright the default driver and keeps Moli/Playwright as explicit legacy engines; see [Implementation status: Patchright default](boss-career-workflow.md#implementation-status-patchright-default-req-031-revision). This review's decision is unchanged: authenticated BOSS compatibility is still unverified and no real delivery is authorized.

## Patchright verification and live startup

The official Node.js `patchright` package is pinned to **1.64.2**. The production adapter launches one headed system-Chrome persistent context with a private, owner- and engine-specific profile. Session inspection neither starts a browser nor navigates; repeated opening preserves the managed page. Only an explicit owner check can release a restriction pause.

GPT-6.1-sol closed the four correction findings: restrictions reached during failed waits propagate as pauses; subsequent interactions check pause admission; any visible matching challenge takes precedence over ready navigation; and explicit initial-navigation outcomes distinguish a failed navigation from a successfully opened but unclassified page.

On the final correction tree, the real-driver synthetic browser-session suite passed **10 tests with zero skips**, and the CLI suite passed **4 tests with zero skips**, including a document that commits its URL but never finishes `DOMContentLoaded`. Build, type checking, skill validation and whitespace checks passed. Previously recorded focused recovery, authority, migration and engine-generation results remain scoped to their evaluated seams. No whole-project regression or synthetic UI rerun on the final Patchright tree is claimed.

The parent then executed the maintained `boss:login` entry point once against real BOSS, with Patchright explicitly selected and an isolated observation owner. The controller reported `initialNavigation: performed`, `loadedPage: true`, and `mutationsAllowed: false`. The observed state changed from `unavailable` to `login_required`. The desktop tool listed a Chrome window titled `【BOSS直聘注册登录】boss直聘在线注册登录-BOSS直聘`.

Native visual verification could not complete: `kimi-cu` returned `no shareable content: no display` and could not activate the window. A bounded display-wake attempt did not restore capture. The controller and private persistent profile were retained for manual login. This startup is evidence of the Patchright launch and login-page transition only; authenticated navigation, filters, recipient identity, attachment receipts and resolution of the earlier safety-page loop remain unverified. No real greeting or resume was sent. No raw challenge URL, cookie, profile content or owner identifier is included here.

## Response-backed preparation follow-up

The latest independent review of the response-backed scan left two findings open: body-read accounting reset between scans, and unreadable active-card identity could permit another click. The current correction moves outstanding read tickets to `BossBrowser`, where they survive observer disposal until the driver promises settle. Active-container count and own-link identity are now read together. Missing, ambiguous or unreadable active identity pauses before opening a card.

The parent reproduced the cross-scan defect with a failing test before the fix. After the correction, `rtk pnpm typecheck` passed, and `rtk pnpm exec vitest run tests/boss-response.test.ts tests/boss-scan.test.ts tests/boss-browser.test.ts` passed **53 tests with zero skips**. The cases cover disposal with four unresolved reads, admission after a read settles, replay of an old observer ticket, and active-container identity failures. These results establish the bounded code correction. No new independent review, browser test, runtime reload or real-site verification is claimed.

The controller uses the standard `Set` to track driver tickets. The correction removes the per-observer counter and its clamped decrement. Existing ingress, owner/session, reservation and mutation checks remain at their current boundaries. Unknown success semantics and missing city encoding remain live blockers.

A read-only process check at this follow-up found no running project Worker or `boss:login` controller. The earlier temporary observation directory was also absent. No runtime process was started or reloaded, and the earlier controller state is not current evidence of an authenticated session.

## Earlier Moli local verification

| Check | Observed result and scope |
| --- | --- |
| `rtk pnpm build` | Passed. Runtime registry, TypeScript, Vite bundle, and skill bundle/validation passed. Existing chunk-size and dependency-comment warnings remain. |
| `rtk pnpm factory diff --spec app.spec.yaml --output .` | Passed with `changed=[]` and `retirement=[]`. |
| `rtk git diff --check` | Passed. |
| `rtk env RUN_INTEGRATION=1 pnpm test` | **26 files, 267 tests passed, zero skipped**, on the final combined runtime source. A fresh isolated PostgreSQL instance used the existing test schema and credentials. No background development Worker competed for its queue. |
| `tests/e2e/career.spec.ts` through the current API, Agent, Worker, Web app, real Moli client, and synthetic site | **3 passed, zero skipped, zero flaky**. The browser used installed Chrome. The Worker attached to its own Moli endpoint and used the explicitly verified synthetic profile. |
| Authenticated real BOSS login, native controls, recipient, and original-attachment receipt | **Unverified. Production sends remain disabled before dispatch.** |

The local full regression log is `/tmp/boss-gpt-awake/current-regression.log`. The UI report is `docs/evidence/browser-results.json`; its scope is the three synthetic career cases. Private diagnostic logs are under `/tmp/boss-gpt-awake`. An earlier run overlapped system sleep and was excluded from acceptance. Its failed logs were preserved. The valid rerun used temporary idle-sleep prevention. Both original and fresh test database containers were retained, and the original test container was restarted after verification.

At that historical Moli checkpoint, the only edit after the full regression was a UI-test locator correction for Ant Design's accessible button name `保 留`. The real three-case E2E passed after that correction. The later Patchright runtime changes have their own focused evidence above; the 267-test result must not be presented as a full regression of the current Patchright tree.

## Closed source findings and behavioral evidence

| Finding | Final correction and evidence |
| --- | --- |
| Explicit outsourcing override | Owner annotations cannot erase an explicit outsourcing exclusion. Domain and API approval negative cases cover it. |
| Grounded order and initial commands | The API uses authoritative matching order and the configured AI tie preference. Resume-save, task-create, and approval commands record replay identity in their transactions. Posting reservations use an atomic gate. |
| F1: clear during delivery | Clear acceptance writes `clearing` and revokes batch/work authority in one transaction. Running-effect guards reject non-ready sessions. A delayed-chat clear test asserts zero subsequent messages and honest interrupted intents. |
| F2: cancel during fill | The browser checks authority after awaiting input fill, immediately before submit. The blocked-input cancellation case asserts the site's actual message count. |
| F3: first-match receipt deletion | The Worker persists each attempted match receipt identity before provider dispatch. Deletion locks work rows and collects attempts without needing a committed snapshot. The held-first-provider case proves late receipt removal and tombstoning without snapshot recreation. |
| F4: deleted bank source | Cleanup finds strict interview materials by their frozen career provenance as well as surviving bank IDs. Bank removal followed by source deletion and partial cleanup retry preserve unrelated controls. |
| F5: complete staging expiry | Expiry claim and bounded purge enqueue share a transaction, with at most 50 keys per payload. Idle Worker reconciliation runs without another upload. Failed cleanup retries; extracted text and metadata are cleared only after confirmed cleanup. The 51-file case preserves a live upload. |
| F6: both reservation orderings | Retry acceptance proves ownership and changes a conversation retry's application back to `reserved` in the same transaction. A new batch cannot transfer it while queued or running. The two real-browser orderings cover B-before-A-retry and A-retry-before-B; only the owning batch sends. |
| F7: UI selection and feedback | Unchecking removes a selected posting. Non-409 approval errors remain visible inside the mounted panel while final text and request identity survive retry. Deletion confirmations disclose derived bank entries and whole strict interview histories. The passing UI flow exercises these behaviors. |
| Browser endpoint isolation | Every Moli actor attaches to its own child-announced loopback endpoint from `--port 0`. The two-owner test checks distinct endpoints and separate login states. |

The real-browser authority suite now has 11 passing cases. The privacy suite has three passing cases. These are included in the final 267-test run rather than added again to its total.

## Remaining R7 prerequisite

Keep `liveBossProfile.verified` false. Public Chrome and Moli probes produced a loading shell. Synthetic select elements and fixture-only `data-job-id` or `data-resume-sha256` attributes do not establish real BOSS support.

The next step is an authorized human login in a dedicated, user-operable local browser. Authenticated read-only observation must establish the actual native city, role, and salary controls, account and recipient identity, and the original-attachment flow. The adapter then needs evidence-based implementation and a bounded check of those observed controls. Login alone is not permission to flip the verification flag.

The read-only search and detail path now takes its evidence from the site's own responses (`apps/worker/src/boss-response.ts`) instead of page state, and pauses with an explicit reason whenever that evidence is missing. It is still unexecuted against the real site and still lacks the observed form field names, the submitted city's encoded value, an application-success discriminator and the city options, so `encoding: null` and `success: {status:'unknown'}` keep live searches paused. See the response-backed preparation section of [the workflow design](boss-career-workflow.md#implementation-status-response-backed-read-only-scan-preparation).

Any real outbound acceptance also needs the exact in-product-approved posting list, final greetings, and immutable resume version, plus trustworthy attachment identity or receipt evidence. No real greeting or resume was sent during implementation or local acceptance.

## Delivery state

The code is left unstaged and uncommitted. No deployment or publication occurred. Existing `.npmrc` changes and `.DS_Store` were preserved. See [Prepare the local BOSS workflow](../boss-workflow.md) for setup, private storage, and current limits. The remaining blocker is live-site evidence and adapter compatibility, not a waived code finding or a skipped local test.
