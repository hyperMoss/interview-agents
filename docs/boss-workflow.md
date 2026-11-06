## Search preview without AI

The default career form leaves AI off. Select cities, roles, salary threshold and blacklist, then start a preview; no resume, model connection or processing acknowledgement is required. The Worker saves rule decisions and source snapshots in SQLite. Enable AI explicitly to use the existing personalized task flow, which requires an immutable resume version, a configured model and processing acknowledgement.

The works-style adapter uses the public job-search URL and DOM detail links. Evidence labeled “URL 请求” describes requested route parameters; it is not a claim that native filter controls or API success envelopes were verified. Salary is checked against each posting's visible range. One page is read per city/role, at most 30 distinct details per task. Missing stable links or a verification page pauses the scan. Unknown employment requires manual evidence and is never presumed direct.

A preview never generates fictional AI scores or greetings, and cannot approve a delivery batch. Currently create a separate personalized task for AI/delivery; conversion of saved preview rows is not yet available. Live outbound actions remain independently gated by automation mode, observed controls, original-file receipts and explicit frozen approval.

The 2026-11-02 real Guangzhou/fullstack preview saved 15 postings (9 salary exclusions, 6 needing employment review). This is read-only search evidence, not acceptance of messaging or resume delivery. No account or raw observation data is included here.

> 2026-11-02：用户报告真实 BOSS 风控。真实站点自动化暂停，不自动打开、刷新、检查或重试；恢复需要用户明确要求。SQLite 离线工作不访问 BOSS。

# Prepare the local BOSS workflow

The app has a local resume library, a career review workspace, approval records, and personalized preparation. Authenticated BOSS compatibility is still unverified. The live adapter deliberately blocks outbound messages and attachments before dispatch. A successful synthetic test does not enable real delivery.

`BOSS_AUTOMATION=manual` is now saved after the user explicitly authorized manual login and session checks. This permits only session open/check/clear work; scan and delivery remain unclaimable, and task creation is rejected. The UI displays this mode separately from the observed website state. `BOSS_AUTOMATION=paused` remains the strict stop setting in `.env.example`. In strict paused mode, API open/check requests return 409, the login CLI exits before opening a browser, and the Worker leaves scan, delivery, and open/check jobs queued. Preparation and private-data cleanup can continue. Do not enable real-site automation without an explicit request to resume. The home-entry change does not establish that the reported account restriction has cleared.

## Start the local services

Use the repository's [local setup instructions](../README.md#快速开始) to install dependencies and initialize SQLite, then start the API, Agent, Worker, and Web app. Use `pnpm db:migrate` for the two SQLite files. Storage and backup are documented in `docs/design/sqlite-local.md`. The Agent uses its own SQLite file.

The default browser engine is Patchright 1.64.2 driving the Google Chrome installed on this machine. Confirm both before starting the Worker:

```sh
rtk pnpm run doctor
rtk pnpm dev
```

Patchright is a maintained npm package based on Playwright's driver. It is not a custom browser framework, and this project adds no fingerprint, signature or anti-detection scripts of its own. The Worker opens one long-lived headed persistent context in a private profile directory instead of launching short-lived browsers.

Open `http://localhost:5173` and keep that address consistent. `localhost` and `127.0.0.1` have separate browser identities.

The optional career environment variables are:

| Variable | Default or purpose |
| --- | --- |
| `BOSS_BROWSER_ENGINE` | `patchright`. The Worker drives the installed Chrome through Patchright. `moli` and `playwright` stay available as explicit legacy engines; each engine keeps its own private profile directory. |
| `BOSS_MOLI_EXECUTABLE` | `moli`, resolved through the Worker's `PATH`. Only used by the legacy `moli` engine. |
| `BOSS_HEADED_FALLBACK` | `on`. Opens the disclosed headed Playwright context when the legacy `moli` engine cannot offer a human-operable window. |
| `BOSS_SITE_ORIGIN` | `https://www.zhipin.com`. Test fixtures use a separately configured local origin. |
| `CAREER_LOCAL_DATA_DIR` | Optional absolute private storage directory. The macOS default is `~/Library/Application Support/interview-agents/career`; the Linux default is under the operating user's application-data directory. |

Each engine actor owns one profile lock and one browser. There is no shared `BOSS_CDP_PORT` setting. The app does not import a daily browser profile or ask for passwords, verification codes, or cookies in an app form. Changing the engine starts a new session generation, which revokes any unstarted approved delivery.

## Save a resume version

1. Open **设置 → 简历库**.
2. Upload a PDF, DOCX, TXT, or Markdown file of at most 5 MB.
3. Preview the original file and correct extraction errors in the text. A text correction does not rewrite the original attachment.
4. Acknowledge any parser warnings and save a named version.
5. Select that version for a career task. Matching, preparation, and an approved attachment use the same immutable version and content hashes.

The existing one-time resume import for interview preparation still discards original bytes. The resume library is separate and retains private originals for versioned use. Preview or download a version to check its exact file before approving delivery.

## Complete the private site-observation prerequisite

Open **BOSS 求职 → 打开 BOSS 登录/验证** on the host computer. Patchright opens the installed Chrome as a dedicated window in a private profile directory and navigates once to the public BOSS home page. Complete login and any website verification inside that window.

Then use **我已完成，检查会话**. The check only reads the page the window is showing: it never launches a browser, creates a page, navigates, refreshes or reopens, and a button click alone does not mark a session ready.

If the site shows a safety page, an explicit frequency/limit notice or a short main-frame navigation loop, program actions stop and the session is latched as paused. The current page stays open for you to handle. Only an explicit session check that observes a usable page clears that latch; automated readiness checks and the Worker's own checks never do. Stopping program actions does not stop the website's own scripts, so a page that keeps navigating itself is reported as still restricted.

For a manual observation without the app UI, the maintained local command opens the same production session once, keeps a single controller, observes it without navigating and closes on `Ctrl-C`:

```sh
rtk pnpm boss:login
```

It prints only redacted state (state, engine, window, whether an account marker was observed) and never prints URLs with query strings, cookies or profile contents. Stop the app Worker before using it: one private profile accepts one controller at a time.

Real delivery remains blocked until authenticated observations establish the actual native filters, account and recipient identity, and trustworthy original-attachment identity or receipt. The current live selectors and fixture-only hash attributes do not establish those facts. Keep `liveBossProfile.verified` false while this work is pending. Do not bypass verification, access controls, or the production mutation gate.

The read-only search and detail path is now response-backed, but it is still **not executed against a real BOSS session**. It drives the controls of the page the session already holds — the keyword box and the search control — and accepts a result only from the response that answered that submit, correlated through the driver's own request identity. Only the two published endpoints with the methods the observed frontend uses (`POST` search, `GET` detail) are candidates at all. It never builds a search URL, never navigates during a scan, never opens a second window and never fetches a business endpoint by itself. Every control lookup must resolve to exactly one visible control (`.job-search-form input[placeholder='搜索职位、公司']`, `a.search-btn`, the city label `.c-filter-condition .city-label .cur-city-label`, the `薪资待遇` control), and every applied control is re-read after submission; an absent or ambiguous control pauses the task as `native_filter_unverified`.

An accepted search requires all of the following; otherwise the task pauses with the reason and records nothing. The pinned frontend release must be loaded (a different build is release drift, not a fallback); the page must still show the submitted city and keyword; the four bounded fields projected out of the form submit (`city`/`query`/`page`/`pageSize`, `POST` on `/wapi/zpgeek/search/joblist.json` with the observed `application/x-www-form-urlencoded` body) must map onto those controls through an observed encoding; the response must carry the explicitly recognized application-success discriminator and the published successful data shape; the site's own loading marker must be gone; and the rendered card links inside `.rec-job-list` must be exactly the successful `jobList` ids in order. A successful empty result also needs the site's own empty marker. A changed address, an arriving HTTP 200, a disappearing loader, a transient empty list, two equal samples, a matching title/company or a card's position are never accepted as proof.

A detail read is accepted only for an identity reserved inside the shared thirty-posting budget before opening, and only from the response that answered its own card click (`GET` on `/wapi/zpgeek/job/detail.json`): the reserved id, the response `encryptId` and the own pane's `.more-job-btn` posting id must be equal, `.job-detail-loading` must be absent, the pane's own title, salary and description must be present in one fixed DOM pass, and no detail request or response may have arrived since that response — including one inside the same action, or one whose body is still loading. The response fields are authoritative for the JD and salary; the pane is only present-checked and hashed, so a transformed or private-use glyph never becomes a value. Each accepted posting keeps a bounded `detail_receipt` row (canonical path plus body and pane digests) beside the existing search evidence. A response the page loaded by itself is quarantined until its identity is reserved. A card is opened through the one `.rec-job-list .job-card-wrap` that owns its exact canonical link, so a list reorder cannot open an unreserved posting. If the reserved posting is already the active card, its still-valid receipt is reused; without one the scan pauses instead of clicking again, because the page does not re-request an already selected posting. Failures and unknown reads keep their reserved slot, and a missing response proof pauses the task at once instead of counting as a page failure.

What is still missing on the live site: the form field names, the submitted city's encoded value, the application-success discriminator and the city options inside `.city-select-dialog`. The live profile therefore carries no search encoding, `success: {status:'unknown'}` (which accepts no envelope at all) and no city-option selector, so a live search pauses with the reason instead of guessing a code, a field name or a selector, and a city the page does not already show — or an opened city panel — pauses the scan. Those become small data updates once real responses establish them; nothing is defaulted to make scanning look enabled.

The salary dropdown is read and never operated: only the broad/unset state is accepted, because the per-posting monthly upper bound — not a native band — decides eligibility. Response bodies are bounded as far as the driver allows: at most four are read at once across all scans on the same browser controller. A disposed scan's pending reads retain their slots until the driver promises settle. A declared `content-length` over the limit is refused before the read, a decoded body over the limit is rejected, a read has its own deadline, and a body that arrives after disposal or from a newer scan is dropped. The standard driver still hands out a whole body through `response.text()` without streaming or cancellation, so one oversized body can be allocated before it is rejected; the contract is about what the adapter starts and accepts. The live profile stays `verified:false`, so no outbound BOSS action can follow from any of this. A running Worker cannot hot-load this change; loading it needs a reviewed same-owner service reload, which is a separate step.

A phone can monitor the app, but login must happen in the browser on the host computer. Clearing the session revokes pending delivery authority and removes the dedicated login state. A reset or account change requires a new approval; an old batch cannot silently act under the new account.

## Review a task after the adapter is verified

1. Enable an owner-bound model connection in **设置 → 模型设置**. The career flow requires an explicit connection and has no hidden demo fallback.
2. Choose a saved resume version and review the data-processing acknowledgment.
3. Keep or change the search policy before starting. The requested defaults are full stack or Agent development, Guangzhou or Shenzhen, monthly salary range upper bound at least CNY 18,000, and AI application preference. `15–25K` qualifies. Extra salary months do not change a low monthly range into a qualifying one.
4. Enter literal company blacklist keywords. Matching ignores case and normalizes full-width characters. The app shows the original matched evidence.
5. Start the task manually. It reads at most 30 distinct postings. The Worker drives the keyword box and the search control on the page the open session already holds, re-reads the applied city/keyword/salary controls and accepts a result only from the response that answered that submit, as described above. A control that cannot be resolved unambiguously, a city the page does not already show, an unrecognized release or an unrecognized response pauses the task as `native_filter_unverified` instead of being assumed, and the reserved detail identity keeps its slot. A salary shown only in private-use glyphs, in a non-monthly unit, or as an unreadable range stays in review and can never enter an approved batch.
6. Inspect eligible, uncertain, excluded, and previously contacted postings. Explicit outsourcing stays excluded even after an owner review. Unknown employment relationships remain reviewable. Match ordering displays source evidence rather than an automatic pass score.
7. Select up to ten postings, edit their greetings, preview the fixed attachment, and confirm the exact batch. Unchecking a row removes it from the batch. Failed approval keeps the final texts and request identity for an idempotent retry.

Approval authorizes conversation initiation and the selected original resume when the site permits it. It does not authorize ongoing recruiter replies. Conversation, recipient consent, attachment confirmation, and preparation have separate states. A click, HTTP 200, filename, or file size alone cannot establish successful delivery. An ambiguous result stays unknown and is not automatically resent.

## Use the preparation and deletion controls

Each approved posting independently queues ten questions grounded in its frozen JD and the selected resume. Project questions cite actual resume evidence. Skill-gap questions are preparation goals, not claims about experience. A preparation failure can be retried without resending a greeting or attachment.

Open a preparation to edit questions and guidance, export private Markdown or JSON, save selected questions to the bank, or enter strict practice. Source limits are explicit; the app does not silently truncate a long resume to make practice fit.

Before deleting a task or resume version, read the impact confirmation. Derived bank questions and entire strict interviews containing those questions, including their answer histories, can be removed. Unrelated versions, JD-only questions, and unrelated interviews remain. Source rows are removed through the business boundary, and durable Worker cleanup removes private files and Agent receipts. Failed cleanup retries with backoff; it is not reported as completed. Expired staging cleanup also removes extracted personal text after confirmed file cleanup.

## Check the implementation locally

Use the isolated test database and synthetic providers. Keep background development Workers away from the same test database while suites control their own ticks.

```sh
rtk pnpm db:migrate
rtk env RUN_INTEGRATION=1 pnpm test
rtk pnpm build
rtk pnpm factory diff --spec app.spec.yaml --output .
```

The focused suites cover command replay, browser ownership, cancellation during actions, reservation transfer, late match receipts, frozen interview provenance, expiry cleanup, and the complete local career flow. The Patchright suite drives the installed Chrome against the synthetic site and counts real fixture requests to prove that a check never navigates; it also covers the persistent profile across a restart, safety pages, frequency notices with a new container class, navigation loops and the unverified live mutation gate. The legacy browser suite uses the installed Moli client against the same synthetic site. The gated UI cases require the synthetic full stack and `CAREER_E2E_SITE_ORIGIN`; a skipped case is not a pass. Never point those cases at a real BOSS account. The response-backed read/detail path is covered without a browser by `tests/boss-response.test.ts` (`pnpm exec vitest run tests/boss-response.test.ts tests/boss-scan.test.ts tests/boss-browser.test.ts` plus `pnpm typecheck`): it composes the production observation lifecycle through deferred bodies, a second request inside one action, disposal and a newer lifetime while a body is in flight, a read past its deadline, a declared oversize, the concurrent-read bound, unknown and failure success envelopes carrying well-shaped data, wrong-method requests, field projection and secret retention, identity-bound card resolution and escaping, active-card reuse/pause/open, the Worker proof-pause stopping the scan before a second card, older/in-flight/wrong-query responses, transient versus accepted empty results, same-title different-id rows, release drift, panes, admission withdrawn during a wait, and the thirty-slot reservation cap.

Current acceptance and the remaining real-site prerequisite are tracked in [BOSS workflow functional review](design/boss-functional-review.md).
