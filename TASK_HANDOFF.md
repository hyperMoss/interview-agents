# Green vertical whitespace removed — 2026-11-06

User requested no extra top/bottom whitespace in green. Screen body margin is now 0 auto and padding 0 46px (mobile 0 22px). Named green PDF page margins are 0 40px, with zero body padding. Horizontal spacing and all section styling remain. This supersedes the 32px vertical margin in the previous section. Green browser regression now asserts zero vertical body margins/padding and zero vertical print page margins. No resume content was edited; no commit/push.

---

# Green resume reference layout restored — 2026-11-06

User reported the cool-resume green style was missing. Reproduced in an actual Chrome regression: selected green but section-title gap was 8px instead of reference 20px. Theme variables had been copied, but the later green-specific style.css layout block and section SVG markup were omitted. Restored green paper padding/shadow, section spacing/rules, entry typography, 24px green section icons and project divider markup. Icons use React SVG nodes from reference paths, with Lucide/Feather ISC notice in source and exported HTML. No new dependency or personal data import.

Green PDF uses a named A4 page with repeating 32px/40px margins, rather than body-only padding that left subsequent pages without top spacing. Preview/HTML/PDF share renderer and CSS. Five resume browser flows passed, five focused draft tests passed and build/typecheck/skill validation passed. Green regression was observed failing before the fix; after the final print-margin refinement it was rerun. Rasterized and visually inspected both pages of the synthetic green PDF, confirming icons, heading rules, text and repeated margins. Temporary test artifacts stay ignored under test-results/resumes and /tmp/interview-green-final-*.png. No real resume/BOSS/model activity. Existing edits retained; no commit/push.

---

# Left module navigation and resume-to-interview workflow — 2026-11-06

REQ-047–049 update the system flow. Global navigation is now a persistent left B-end menu grouped into workspace, resume management, career, interview center, learning and settings; mobile uses a left Drawer with the same thirteen entries. Removed the obsolete primary-navigation component and top tab styles. Interview history is a separate #/interviews/history module with existing filters/pagination/continue; legacy session and attachment deep links remain. Home starts with resume → career → interview workflow cards. Settings no longer contain the attachment library; its heading is 投递附件库, while JSON drafts are 简历库.

Resume studio imports PDF/DOCX/TXT/MD using the existing isolated local parser, shows editable text/warnings before saving a valid JSON copy through the existing authenticated NestJS draft API and SQLite storage. packages/resume/src/import.ts preserves full text/filename/warnings in importSource, maps only explicit name/role/experience labels and puts unclassified lines in summary. This is lossless local normalization, not semantic/AI reconstruction of work/project entries. Original attachment bytes are managed separately in the attachment library. Chinese source filenames use the browser File name to avoid multipart filename mojibake.

Saved drafts expose 用于面试 with confirmation before replacing the current intake draft. The intake also has a library picker. resumeText creates the actual text snapshot, enforces 20–16000 characters without truncation and does not mutate a saved draft or existing interview. Main menu navigation preserves model-settings return routes; preparation/algorithm transient seeds are cleared when entering those modules normally.

Verification: 32 files / 319 offline tests passed; four isolated Chrome flows passed including local file → JSON persistence → reload → interview snapshot → history, existing PDF/immutable attachment/idempotency and mobile module navigation; two affected flows rerun after screenshot timing changes passed. Desktop preview and mobile Drawer screenshots visually inspected in ignored test-results/resumes. Build/typecheck/skill/factory/whitespace checks passed; existing annotation and chunk-size warnings remain. Old global-tab browser callers were migrated to navigateModule helper; the entire default browser suite was not rerun. No real BOSS or paid model use. Preserve all earlier modifications; no commit/push. User guide: docs/resume-builder.md.

---

# SQLite-only storage cleanup — 2026-11-06

User decided this project will only use SQLite. This section supersedes all older database setup/import guidance below. Removed direct pg/@types/pg dependencies and installed driver snapshots; SQLite now owns query result types, with explicit parsing at affected boundaries. Factory options accept only sqlite, defaults no longer assemble a database server, and obsolete provider/architecture branches were removed. Redis/BullMQ remain optional notifications. Generated plans and bundled factory skill match the source. Added a regression rejecting other database engines and checking generated output.

Removed old Compose files, init-dev.sql, six legacy SQL migrations and the old import script. Their pre-removal contents, including earlier uncommitted edits, are recoverable at /tmp/interview-sqlite-retired.MDPpIq/retired-source.tar.gz. No database files, containers, data volumes, credentials or actual environment files were deleted or modified. Existing SQLite definitions and additive migration code remain under infra/sqlite and packages/database/src/migrate.ts. Source cleanup does not authorize deleting old external data. Ant Design is fixed at its original 6.6.7 after an automatic latest resolution briefly selected 6.7.0; final build and browser checks use 6.6.7.

Docs: docs/README.md is the category index; docs/design/sqlite-local.md describes current initialization, ownership, permissions and backup. Old ADRs/reference/test records retain original evidence with historical notices; fixture/job-description technology names do not represent runtime storage dependencies. Ignore .DS_Store.

Final checks: 31 files / 317 tests passed through test:offline (seven explicitly excluded browser suites remain excluded); three Chrome resume/menu flows passed; typecheck/build/skill validation passed; 226 literal SQL statements prepared; factory diff empty; frozen dependency install passed; whitespace check passed. Build retains existing dependency annotation and bundle-size warnings. Tests use synthetic data and localhost providers; no real BOSS action was requested or triggered. Preserve all remaining edits; no commit/push.

---

# JSON resume studio and feature menu verified — 2026-11-06

User requested integrating local cool-resume JSON generation and independent resume copies using this project's framework, plus a menu for all features. Recovered the implementation already present after interrupted turns and completed validation. REQ-044–046 and generated plans cover React JSON editing/preview, seven themes, v2/v3 import with extension preservation, SQLite owner-isolated copies, revision conflicts, JSON/HTML/PDF export and publication through the existing immutable attachment API. The grouped “全部功能” menu reaches twelve entries; deep links and old attachment-library URLs work. MIT notice is retained in packages/resume/COOL-RESUME-LICENSE. No personal cool-resume data directory was imported.

Verified 35 tests across resume-drafts/sqlite/dev-origin/workspace; three actual Chrome end-to-end cases covering JSON upload/export, independent copies, refresh recovery, owner/Origin isolation, stale revisions, PDF bytes and extracted text, immutable attachment digest, lost-response idempotent retry, deletion independence, mobile navigation/back/settings return and no horizontal overflow. Desktop/mobile screenshots inspected in ignored test-results/resumes. Build, typecheck, skill validation and factory diff passed; existing dependency annotation and bundle-size warnings remain. pnpm db:migrate completed for existing local databases, adding the copy table. Usage: docs/resume-builder.md; entry #/resumes. Tests use isolated temporary databases and BOSS_AUTOMATION=paused; no real BOSS action was triggered. All pre-existing edits remain; no commit or push. Existing local service/browser state was not revalidated in this task.

---

# Custom role directions implemented and locally verified — 2026-11-05

User requested adding custom role directions. Added REQ-043 and regenerated plan/context first. Existing presets remain, plus customRoleKeywords optional in policy so old saved tasks retain their exact shape and behavior. Allows custom-only searches, up to six trimmed 1–40-character literal keywords, rejects case/NFKC duplicates and control characters. Search plan adds custom words per city with case/NFKC query de-duplication. Keywords match title or JD literally with original evidence, including C++ and regex-like strings; salary/city/blacklist/direct-employment checks remain. Custom non-development directions can match without old development-only heuristics rejecting them. UI shows add/remove tags, complete task/history conditions, and instructions. Existing frozen tasks/approvals were not edited.

Validation: 42 tests across career/boss-scan/career-ui passed; 5 actual Patchright localhost integration scenarios passed, including custom-only C++ through API, persisted SQLite policy, encoded query, filtering and native-contact fixture. Full build/typecheck/factory/skill checks passed with existing dependency annotation/chunk size warnings; diff whitespace passed. Actual local browser smoke in an isolated anonymous test session verified Enter adds Python, the remove cross deletes it, and captured /tmp/custom-role-directions-20261105.png. This smoke session never opened BOSS, submitted searches or read/imported existing browser credentials; it is not the real owner's session. Test browser closed afterward. No real search/contact/attachment triggered. No commit/push; preserve all previous edits. Normal API/Worker development watchers may reload after imported code changes; verify real session status on next live use rather than trusting old DB ready/open observations.

---

# Programmatic sequential continuation added, not live-triggered — 2026-11-05

User agreed to remove per-record Computer Use triggering. Added REQ-042 and regenerated resolved/design plans before implementation. New apps/web/src/contact-continuation.ts freezes the initial failed-contact set, re-reads every target/state/version before submission, invokes existing authenticated retry API, then polls until confirmed/already_contacted before the next target. Any failed/unknown/cancelled/timeout, changed row, existing queued/dispatching/unknown contact, or AbortSignal stops further submissions. It does not approve new postings, resend confirmed effects, write DB directly, input greetings or attach files. Existing API/Worker retain authority and durable individual work.

SiteContactPanel now exposes one “继续已批准且未点击的记录” action and “停止后续提交”. Normal per-record retry and new approval are disabled during continuation. Component cleanup aborts subsequent submissions. This is intentionally a PAGE controller, not a durable backend supervisor: closing the page/restarting the server does not automatically schedule later targets. Already queued or in-flight effects remain in Worker and must be checked. Do not claim full unattended background continuation or a machine-authenticated CLI. Existing human login, direct-employment review and approval remain required.

Validation: tests/contact-continuation.test.ts plus career-ui.test.ts: 19 tests passed. Typecheck passed. Production build and skill validation passed, with existing dependency annotation/chunk-size warnings. Whitespace diff check passed. Real DB read-only unchanged at four confirmed and one failed/contact_control_unverified; no queued/processing career work. No live contact/search triggered or original target re-tried. No UI browser acceptance was performed because prior native control tool remains unavailable. Preserve existing edits; no commit/push. Actual checkout remains /Users/gooingyu/Documents/project/interview-agents.

---

# Service recovery; live browser control unavailable — 2026-11-05

User requested continuing the whole automatic application flow. Keep prior native preset-contact-only scope, strict confirmed-direct filter and no additional attachments/text. Read-only current SQLite verification differs from previous handoff: four confirmed contacts and one failed/contact_control_unverified at position 3. Position 4 became confirmed after the prior assistant trial; do not claim this turn sent it or repeat any confirmed contact. There are no queued/processing career jobs. Session ready/open timestamp is old and not current proof.

All three application ports 3000/5173/4111 were absent. Restored existing `pnpm dev` in exec session 75039 with original .env BOSS_AUTOMATION=contact, no configuration/source edits. API /api/v1/health returns status ok; web started on 5173. Existing data and edits retained. Do not start a second dev stack without checking listeners.

Original native/browser tool namespace is unavailable in this turn. Installed/executed npm agent-browser help/core and attempted `--session interview-agents-recovery --auto-connect tab list`; it returned no running Chrome instance found and requires remote debugging. No debugger port was created, no Cookie or browser profile read/import, no new browser or BOSS navigation, no queued scan/retry or business-row mutation. Therefore live search/contact end-to-end was NOT performed this turn. Need an authorized controllable existing system browser, then normal owner-authenticated app session open/check and diagnosis of the single remaining failed target. Never forge the anonymous owner cookie or directly insert delivery work as a workaround. Current four native button confirmations do not establish message delivery or attachment sending.

---

# Real native contact trial: three confirmed, fourth blocked before click — 2026-11-04

User explicitly requested automatic search/contact trial after seeing the dedicated window. Retained strict confirmed-direct rule and native preset greeting only, with no custom text or attachment. Reclaimed the original profile by gracefully terminating the one manual login controller. Changed ONLY BOSS_AUTOMATION to contact in .env. Original node --watch supervisors automatically restarted both API and Worker after environment update; current observed runtime PIDs are API 39051 and Worker 39054, with watch parents 79550/79549. A separately attempted API exited EADDRINUSE; the extra newly started Worker 41181 was gracefully terminated before any browser action. Only original Worker retained. Do not claim non-watch operation; avoid imported-source edits while browser is owned.

Through the real owner's localhost system UI, explicitly opened the session. Worker persisted a fresh ready/humanWindow=open observation. System visibly shows contact mode. Then retried the existing frozen approvals one at a time using the normal UI/API, not direct DB writes. First, second and third records became confirmed: native button on the same approved posting changed to an existing-communication label. This confirms the button-level result, NOT actual greeting delivery/read or resume upload. No extra message/attachment was sent.

Fourth approved record was attempted once in this turn but again failed contact_control_unverified before click. Stopped all subsequent operations at that failure; did not retry fifth, did not retry the failed fourth again, did not run a fresh search. All existing selections and approval snapshots retained. Current totals: three confirmed, two failed before click, no unknown. One of the two failed is still its original un-retried record. Session still reported ready, which does not prove risk cleared. There is no evidence to call this a platform restriction rather than missing/ambiguous controls. Diagnose actual fourth page before more navigation or clicking; never broaden selectors blindly or count button confirmation as message delivery.

Final local result screenshot is /tmp/boss-contact-results-20261104.png and remains private, not a repo evidence/public-report artifact. UI task execution records show the results; header eligible/contacted grouping may not count the separate native-contact ledger, so rely on the per-contact execution list and persisted rows. Last queue check recorded separately in this turn: no queued/processing career work. Current .env contact mode remains authorized, but no background scan or outbound work was scheduled. Dedicated window is owned by system Worker, not manual login CLI. No code edits, new fixture tests, commit or push this turn. Preserve all earlier modifications.

---

# Dedicated manual BOSS window reopened — 2026-11-04

User could not see any local dedicated window. Verified only daily Chrome existed and old Worker PID 74649 remained T. Read-only DB check found no queued/processing career work and no queued/running/processing general jobs. Sent SIGTERM then SIGCONT to that exact Worker so it handled termination and released ownership normally; verified graceful exit. The watch parent was not killed and other services were not restarted. Do not assume generation Worker is running after this operation.

Opened the existing single owner's original profile with the maintained command `env BOSS_AUTOMATION=manual pnpm boss:login`, without editing .env, credentials or business tables. Long-running exec session 43167 owns the window. Its startup reports state=ready, engine=patchright, humanWindow=open, loadedPage=true, initialNavigation=performed, mutationsAllowed=false, accountObserved=false. It detected logged-in navigation, but did not verify a stable account marker or prove absence of platform risk. No search, click, message or attachment occurred. The login command brings its own page to front and retains the window; its later observations do not navigate. Do not run a second controller or restart Worker while this CLI holds the profile. To return ownership to Worker, close this exact login session gracefully first and verify mode/queued work before starting Worker.

.env remains paused for normal application processes; the manual override applies only to this login process. CLI intentionally writes no app rows, so the web app may still show its prior cached session state. Do not claim the system status has been refreshed. Native CUA getApp selected daily Chrome rather than the dedicated process; do not inspect unrelated tabs or treat their UI as BOSS proof. Startup lifecycle provides the verified window-open evidence; no screenshot of the dedicated window was obtained.

All five prior approved contacts remain failed before click. Previous four local retry integration tests passed. No source changes, no business-state writes, no commit/push.

---

# Approved contact retry validation; live execution blocked by window access — 2026-11-04

User explicitly asked to continue the same five approved native contacts. This preserves exact targets, confirmed-direct rule, site-preset greeting only, no extra text or attachment. No new approval is needed for that unchanged scope.

Read-only SQLite verification still shows five failed/contact_control_unverified records, no confirmed external result. The narrowed job-banner exact-label locator and failed-only explicit retry path already exist. Ran RUN_INTEGRATION=1 pnpm exec vitest run tests/works-preview.integration.test.ts against isolated temporary databases/profiles and localhost fixtures: 1 file, all 4 tests passed, including retry_before_click, verification stop and unknown no-resend. This completes the previously uncollected retry fixture; it does not validate live BOSS controls or remove platform restrictions.

Worker PID 74649 remains stopped (T), no SIGCONT/restart/config change/retry was performed. Process inventory shows only the daily Chrome main process PID 1215, with no separate dedicated Chrome main process observed. Native Chrome Window menu lists only the daily new-tab window. Do not mistake it for the approved dedicated session.

Computer use initially reported Mac locked and automatic unlock failed. Asked user to unlock and foreground dedicated BOSS; answer was only “继续”, which does authorize continuation but does not establish current page/login/verification state. Subsequent native observations did not yield the dedicated window, native screenshot was unavailable, and the known localhost app tab DOMSnapshot timed out. No verification was solved, no login/refresh/navigation on BOSS, no browser/debugger port opened. Do not blindly resume the old contact-enabled Worker or write the database to simulate delivery. Next requires functioning native window access or explicit user visible-page state, followed by the application's normal session open/inspect flow before failed-only retries, one at a time, stopping on any restriction or ambiguity.

All pre-existing edits retained; branch main. This turn changed this handoff only and ran isolated tests. No real contact sent, no commit/push.

---

# Paused after reported BOSS restriction; works research complete — 2026-11-04

This section supersedes stale status below. Preserve every uncommitted change. Actual checkout remains /Users/gooingyu/Documents/project/interview-agents, main. No commit or push.

User reported another apparent BOSS restriction. Real automation remains paused. Earlier containment set BOSS_AUTOMATION=paused and SIGSTOP on Worker PID 74649; this research turn verified its process state T and no queued/processing career work. A changed .env alone does not prove already-running API/Worker configuration reloaded. Do not SIGCONT, restart watch processes, edit imported Worker source, open/refresh/navigate BOSS or retry contacts during research. Keep the dedicated window for manual inspection; do not inspect unrelated Chrome or reopen debugger ports.

Later implementation supersedes older “site-preset contact not wired” and “0 eligible” statements. User reviewed five corrected candidates as direct and approved five exact targets. Native site-preset contact now has frozen owner/session/posting records, a durable intent before browser action, cancellation/fencing, shared deduplication and unknown-outcome no-resend. It only clicks 立即沟通 and sends no additional text or attachment. Preserve strict confirmed-direct filtering. Current five contact records are failed with contact_control_unverified, with no confirmed successful contact. These failures occurred before a verified button click; this does not prove why the user saw a restriction. The exact visible button locator was subsequently narrowed to the job banner, but has not been retried on the real five targets. A failed-only explicit retry API/UI was added; never retry unknown/confirmed effects. Do not treat a pending retry fixture from the interrupted previous turn as passed.

The user-facing app originally used 127.0.0.1 while the canonical owner/session lived on localhost. Development HTML navigation now redirects the loopback alias to WEB_ORIGIN; API Origin checks stay strict. The task UI shows review candidates, original company evidence and native-contact results. These paths exist; do not recreate the older resume/model blocker for click-only contact. Preserve existing owners, models, resumes and drafts.

Latest request is to study YuGuanzhou/works, not to resume site access. Remote latest commit was freshly verified as 21a96187a5e9f9028cb210db9e4d4b02cfbf2054. Findings are in docs/research/works-risk-controls.md. Useful reference mechanisms: persistent headed profile, one browser owner, manual verification stop, durable attempt ledger, failed/unconfirmed stops whole batch, interrupted attempts require review. Its default 50/day and 5–10 second delay are not safe thresholds; filtering/duplicate branches skip the loop-end delay. Patchright and offline tests do not establish avoidance of BOSS restrictions.

Code-level gaps identified, NOT implemented this turn: unified persistent pacing across every navigation/detail/click including skipped rows; durable daily attempt budget; conservative whole-batch stop on ordinary contact failure; persistent site/account pause checked before each action; separation of real-browser ownership from development watch restarts. Retain our stronger frozen approvals, leases/fencing and action-time cancellation. Do not copy reference custom text/image sending. Any implementation must update spec/resolved plan first and preserve paused browser state. Current restriction root cause remains unproven.

This turn changed research/handoff documents only. No browser, real contact, application-data write or source-triggered Worker restart. Documentation whitespace validation is recorded after writing; no application tests were rerun for documentation-only changes.

---

# Current user decision and corrected company audit — 2026-11-03

Latest instruction simplifies the requested external action to clicking 立即沟通 only: user already configured BOSS automatic greeting. Do not compose/send an additional greeting or send a resume attachment. The earlier local/manual resume work is not an authorization to upload/send anything. User explicitly chose to KEEP confirmed-direct-employer filtering; do not silently treat the later click-only instruction as permission to contact employment-unknown jobs. No real 立即沟通 click, greeting, attachment or delivery batch has occurred.

User confirmed the dedicated resume page visibly shows their resume. A subsequent existing-page read, without refresh/re-login, confirmed expectedNameMatched=true and two attachment links: an English PDF and the named Chinese PDF. User had selected the Chinese named BOSS attachment. No stable file/resume ID was exposed by captured nodes; no local byte hash or site-source binding was fabricated. The initial empty resume observation was taken before the SPA finished loading, not evidence of missing resume/login failure.

Audit found a real prior preview data defect: .company-info .name on detail pages matched the job title/salary, so all six pending records had bogus company/profile values. A localhost Patchright regression with a banner decoy reproduces this (red before the fix). Company extraction now prefers current .sider-company .company-info a and falls back to current .job-boss-info .boss-info-attr (recruiter organization before separator), preserving the recruiter role and certification as companyProfile evidence. Recommendation companies are never used. No match means a proof pause with private bounded structural evidence.

Added owner-scoped reinspection command for already-read, unbound, unapproved review snapshots. Worker archives the prior snapshot privately before reading; store validates work lease, owner, task state, posting identity, revision, absence of owner review/approval, then replaces only that preview observation and re-evaluates rules. Distinct read_count stays 15 and no search is repeated. Canceled/bound/approved data is not overwritten. Diagnostic session precondition failures no longer replace the underlying task pause with a generic failed state. UI has a resubmit/reload control for this read-only correction.

Real audit of all six completed: one explicit recruitment intermediary was identified from both “客户公司：某大型互联网公司” and “猎头顾问”; it is now excluded using the distinct employment_intermediary reason. Other five have corrected company names and matching recruiter organizations with roles such as project lead, technical lead, HRBP or general manager, but no explicit employment/contract confirmation. They remain needs_review, not automatically confirmed direct. Total task is 15 distinct postings: 10 excluded (9 salary + 1 intermediary), 5 needs_review, 0 eligible, no batches/outbound. The nine salary-excluded initial snapshots were not re-read for company identity; their old company/profile values are not verified and must not be reused as employer evidence. Only the six review candidates received corrected observations. Actual public employer observations remain local; do not publish private task/owner IDs or raw artifacts.

Current immediate blocker for the user's retained rule: no posting has confirmed direct-employment evidence. Company/recruiter identity agreement is recorded but not presented as proof of the labor-contract party. Click-only site-preset greeting execution is still not wired as a separate durable effect path (REQ-040 records it as requested); do not claim that changing a source/profile flag or enabling all outbound delivery would implement it. Do not force verified=true, substitute a local resume, reopen debugger ports, or send a custom greeting as a workaround.

Latest focused verification after company and intermediary fix: 3 files, 35 tests passed with actual localhost Patchright. Earlier full selected offline run: 28 files, 292 tests passed (7 existing browser suites excluded), before the latest company/exclusion changes. Final verification on this tree passed: selected offline regression 28 files / 293 tests / zero skips (7 existing browser suites explicitly excluded), build/typecheck/skill validation, 196 fixed SQL preparations and whitespace check. All original modifications are preserved, no commit/push. Actual checkout /Users/gooingyu/Documents/project/interview-agents; chat cwd differs.

---

# Automatic delivery follow-up and source correction — 2026-11-02

Latest user direction: use the resume already inside BOSS for the named candidate. This explicitly changes the old local-original-file-only selection. Do not substitute the locally saved resume, bind that version on their behalf, or upload an extra copy. The locally saved version now exists, but none of the live preview task's resume fields were bound by this turn. No real greeting, attachment, application batch or delivery was created. Local BOSS mode remains search and live verified remains false.

Added REQ-038: a completed preview can atomically bind an owner-scoped local immutable resume and become a manual (no AI) delivery-preparation task without re-searching. Added manual delivery/greeting attribution with null connectionId; AI matches retain connection-only attribution. Manual approval persists frozen delivery work and creates no preparation or Agent work. UI exposes this as LOCAL resume binding and explicitly distinguishes it from a BOSS resume. This is useful local capability, but is NOT the user's selected station-resume delivery path. REQ-039 records the user's station-source decision; actual station-resume binding/frozen identity/receipt support is still unfinished.

Added explicit owner-authenticated POST /career/boss/session/inspect-resume and Worker check payload inspectResumeName. It uses only the existing owned Patchright window, validates the observed resume entry's origin/path, navigates to /web/geek/resume, captures private bounded structural metadata and a name-match boolean. It does not read Cookie or full resume text and never sends. Absolute and relative entry links are supported. Diagnostic BrowserUnavailable failures now persist failed status and reason rather than silently marking completed. Regular scan pauses remain as before.

Real observation: homepage's visible 简历 anchor resolves to /web/geek/resume. Initial diagnostic attempts returned no artifact while work reported completed; this exposed missing diagnostic failure reporting and exact-relative-link assumptions, now corrected. A later successful observation invocation reached /web/geek/resume but found expectedNameMatched=false and controls=[]; subsequent cached session state was unavailable on that path. This DOES NOT establish that the user's resume is missing or their login failed; the content may not have loaded or selectors/state classification may be incomplete. Do not claim the station resume identity or attachment ID is verified. No reload or re-login loop was attempted. The last owned browser stays on that resume page (verify runtime before relying on this). A concise async question asks the user whether the dedicated window shows their resume, a login/verification page or blank/error. Do not inspect unrelated daily Chrome or reopen Node Inspector/CDP.

The prior Guangzhou preview still has 0 eligible and 6 employment-unknown needs-review rows; no direct-employment evidence was fabricated. Even after fixing station resume compatibility, this batch cannot be sent under current qualification rules without actual evidence/review or an explicit policy change.

Validation: 50 focused tests passed for binding/approval, ownership, revision/idempotency, snapshot retention and no automatic AI preparation. Actual Patchright localhost tests pass normal URL preview + station-resume read-only inspection and verification-page stop, including absolute resume links. Full selected offline regression passed 28 files / 292 tests / zero skips; seven existing browser-control suites explicitly excluded. Build/typecheck passed before the final small absolute-link/diagnostic-error change; focused Patchright rerun passed after it; final typecheck is being checked separately. 189 fixed SQL statements prepared. No commit or push. Preserve all pre-existing edits.

Next: handle the pending user UI-state answer and diagnose the real resume page without refreshing it. Implement a separate station-resume source/selection contract and stable receipt checks before live sending; do not encode a station resume as a fabricated local ResumeRow or set verified=true merely to get past the gate. Keep explicit frozen targets/greetings, unknown-outcome no-resend and owner/lease boundaries.

---

# Works-style preview implemented and live-checked — 2026-11-02

This section supersedes the earlier note that all career tasks require a resume/model. Preserve every uncommitted modification. Actual checkout remains /Users/gooingyu/Documents/project/interview-agents, main; no commit or push.

REQ-037 now specifies independent URL/DOM search preview, optional AI and distinct URL-vs-native-control evidence. Landing defaults to AI off; strict preview creation needs only requestId/policy, with no Agent call, resume or model. Existing personalized creation remains supported and requires the immutable resume/model/acknowledgement. Preview tasks cannot approve delivery, edit AI greetings, or generate personalized preparation. Moving a preview into an AI/delivery task is not implemented: currently return to conditions and create a personalized task. Do not describe the entire automatic-delivery workflow as completed.

SQLite now supports all-null preview bindings or complete personalized bindings. A transactional legacy task-table rebuild preserves IDs, children and the owner index; regression covers repeat migration and foreign-key integrity. Before local migration an SQLite API backup was saved privately under .local/backups. Existing records and original PostgreSQL remain preserved.

Worker uses worksBossProfile: headed persistent Patchright, /web/geek/jobs query/city routing from the pinned works city snapshot, DOM card links and detail text; salary evaluated locally. This path records method=search_url and labels requested conditions explicitly. It does not establish native filter widget selection or API envelope success. Original rendered/response-backed adapter remains in source. Only one result page per city/role is read, under the shared 30-distinct-detail task cap. Cards without stable detail links stop preview rather than guessing or clicking. Live profile verified=false and local mode=search still block outbound actions.

Real owned-window validation: Worker reopened the existing application owner's dedicated profile and observed ready/window open, with no account marker invented. A single Guangzhou/fullstack preview reached review, read and saved 15 postings: 9 salary exclusions, 6 needs_review for unknown employment, 0 eligible, 0 batches. All 15 identities matched detail links; JD lengths 322–1175 characters; all cities and roles matched; 6 salary ranges qualified. No model receipt, greeting, conversation or attachment was created. The task reference is in private .local/observations/works-preview-task.json. Do not publish private IDs, owner, resumes, session profile or raw observations. Do not mistake the fresh IAB UI-smoke identity for the real application's owner.

Fixed another root cause while validating: optional account-marker lookup previously auto-waited on every passive session observation. It now reads only an immediately present unique visible marker; missing or ambiguous remains unknown.

Validation on this tree: pnpm test:offline: 28 files, 291 passed, zero skips within the selected run; seven existing browser-control suites explicitly excluded. New tests use actual Patchright against 127.0.0.1 fixtures through API/Worker/SQLite, covering normal preview and verification-page stop without Agent/outbound calls. Build/typecheck/skill validation passed; 182 fixed SQL queries prepared. UI smoke in a fresh local IAB identity confirmed search enabled with AI off/no resume/model; AI on disables it pending those inputs and acknowledgement. Doctor passed after services restarted. Earlier failed synthetic preview attempts were corrected (optional-marker auto-wait and an invalid three-character fixture posting ID); do not count those as successful runs.

Services run in exec session 29812 (API 3000, Agent 4111, Worker, Web 5173); verify live state before relying on these IDs. Worker owns the real dedicated window. No Chrome CDP port or Node Inspector was opened. Never use unrelated daily Chrome for inspection. Avoid source changes that restart the Worker until needed.

Next: let the user inspect the six needs-review postings and supply real employment evidence; never automatically classify unknown as direct. To proceed with personalized matching/delivery, the real resume and model are still absent, and preview-to-personalized conversion/manual model-free delivery remains future work. Original-file identity, actual recipient/attachment receipts and frozen explicit approval remain separate delivery gates. No claim that Patchright bypassed a risk control.

---

# Real-page observation and reference study — 2026-11-02

Current local mode is search: explicit session work and scans are allowed; delivery remains blocked at API, queue claim and unverified live profile. Updated queue permission to the shared BossAutomationMode enum. Do not restore old boolean claimWork callers.

The BOSS login mismatch is now fixed: removed generic class*=login matching, added the observed/reference authenticated nav-figure markers, and enabled chromiumSandbox for future Patchright launches. Actual Worker observation reported ready with window open; account marker remains absent and must not be invented. The authenticated-home regression passes in an actual Node/tsx child process against a local fixture. Focused SQLite/UI/commands/profile suite passed 31 tests before that fixture; the fixture passed separately after correcting the tsx browser callback helper serialization issue.

A bounded explicit check captured actual /guangzhou/ homepage controls into private owner-bound storage. The visible input is name=query, class ipt-search, placeholder 搜索职位、公司; homepage GET form action is /web/geek/jobs and the search button is btn btn-search. These are homepage facts, not proof of native job-list filters or successful backend request envelopes. No search was submitted and no greeting or attachment was sent. Preserve the current owned browser; no CDP 9223 or Node Inspector is needed for this observation path.

User then requested a full source study of YuGuanzhou/works. Read docs/research/works-functional-flow.md and docs/research/works-patchright.md. Key lesson: separate search preview from optional AI and resume; works deliver reruns searches rather than freezing preview selection, and its resume send is a chat image. Preserve this project's stronger approval/original-file/ownership contracts. Study used fixed commit 21a96187a5e9f9028cb210db9e4d4b02cfbf2054 and did not run the reference application.

Next: implement/validate a bounded native homepage search transition and observe the resulting job-list city/salary controls and natural request/response. Do not guess API fields, encoded cities or success semantics. Full career tasks still require a real resume version and custom model; none was fabricated or imported.

---

# Diagnostic limit update — 2026-11-02

User confirmed the dedicated BOSS page is authenticated and authorized one loopback Worker read-only diagnostic. The diagnostic failed before locating the browser-holding object. The temporary Node Inspector port was confirmed closed. Automatic review rejected reopening it as outside the one-use authorization; do not retry or work around that rejection. A direct screenshot of the dedicated BOSS window was requested as the safer next input. The native UI tool remained bound to unrelated daily Chrome, so do not keep reading that window.

Application/Worker synchronization and manual-only mode are implemented and built. Observed backend remains login_required, while the user reports an authenticated page. This mismatch is unresolved. No ready state was fabricated, no Chrome CDP port was opened, and no search/messages/attachments were enabled.

---

# Manual-session follow-up — 2026-11-02

User authorized manual login, then asked to resolve the application showing an unopened session before doing any CDP experiment. No 9223 experiment was started.

The standalone manual controller used the same application owner, but it did not write observations to the application. `BOSS_AUTOMATION=paused` also prevented API/Worker checks. Added `manual` mode: allow session open/check/clear, leave scan/delivery queued, reject task creation, expose automationMode in the session response and UI. Current local config is manual; the sample remains strict paused. Outbound liveBossProfile.verified stays false.

Gracefully stopped only the owned standalone controller, kept the same profile, and passed control to the Worker. One explicit initial open timed out waiting for DOMContentLoaded. One subsequent check, without refresh/navigation, was written through the Worker as login_required, window open, account marker absent. This does not prove the user's reported login failed; selector compatibility and visible window confirmation remain unresolved. Do not mark ready manually or repeatedly reopen.

Focused SQLite/commands/UI regression: 23 tests passed; type checking passed. Original 284-test run predates this small follow-up. Build passed. User confirmed the dedicated window displays an authenticated homepage/job page. The native UI tool continued to bind the unrelated daily Chrome instance, so it did not independently verify the dedicated page. A proposed temporary loopback Node Inspector diagnostic was rejected by automatic approval before execution because it broadens access to the authenticated controller; explicit authorization was requested. No Node Inspector or Chrome 9223 port was opened. Do not retry that step without the new authorization.

Resume version and custom model connection were absent in the visible application. Do not fabricate them or expose credentials. Next: confirm actual dedicated-window content, repair observation from real evidence if needed, then have the user supply/select the real resume and configure the model in-app. Keep search/delivery closed.

---

# Current continuation update — 2026-11-02

This section supersedes the old PostgreSQL startup instructions below. User requested SQLite, then reported real BOSS risk controls and supplied `YuGuanzhou/works` as a Patchright reference.

- The actual workspace is `/Users/gooingyu/Documents/project/interview-agents`, main, HEAD unchanged. All original modifications are retained; nothing staged, committed or pushed.
- SQLite migration is applied and local files initialized. API, Bun Agent, Worker and Web were started. Existing PostgreSQL data remains untouched and has not been imported. Original local environment was backed up privately before changing only database URLs, optional Redis and the BOSS pause setting.
- Keep `BOSS_AUTOMATION=paused`. Do not run login, open/check a real site, refresh it, or resume delivery without explicit user direction. API open/check currently return 409; Worker skips live work but retains cleanup. `liveBossProfile.verified` remains false.
- Final offline regression: 26 files, 284 tests, zero skips within the selected run. Seven browser-control suites were explicitly excluded. Build, 182 fixed SQL preparations, doctor, factory diff and whitespace checks passed. Browser and real-site readiness are not established.
- Read `docs/evidence/sqlite-acceptance.md`, `docs/design/sqlite-local.md` and `docs/research/works-patchright.md` before continuing. The research pins works at 21a96187a5e9f9028cb210db9e4d4b02cfbf2054 and records its limited unauthenticated validation.
- Next: diagnose two recorded synthetic browser failures offline, then validate the complete SQLite career flow on the synthetic site when appropriate. Real account compatibility and original-attachment receipts still block delivery. Never present a home-entry change or Patchright itself as proof that account restrictions cleared.
- Commands: `pnpm verify:sqlite`, `pnpm test:offline`, `pnpm build`, `pnpm run doctor`. The first rejected broad codemod was never run against this workspace. Migration was developed and tested in a temporary copy, then applied as fixed files with hash checks and backups. No unavailable DeepSeek route or independent implementation review is claimed.

---

# Task handoff for Codex

## Current outcome and evidence limits

The workspace contains an uncommitted local BOSS career workflow. Its maintained review marks delivery **blocked on authenticated live-site verification**. Keep production outbound delivery disabled.

This handoff was prepared from the current conversation, Git state, project guidance, and existing design and evidence files. The current conversation contains the request to transfer work from pi to the Codex app and to create this file. It does not contain the original BOSS implementation conversation. Product goals and earlier execution results below come from repository artifacts, with their sources identified. This session did not implement or execute the career workflow.

## User goal and acceptance conditions

The immediate user request is to create `TASK_HANDOFF.md` with the goal, acceptance conditions, settled decisions, completed and remaining work, branch and directory, key files, verification results, blockers, and concrete next steps. Preserve existing uncommitted changes and distinguish verified facts from inference.

The broader product goal recorded in `app.spec.yaml`, REQ-025–034, and [the design](docs/design/boss-career-workflow.md) is a local candidate workflow that finds BOSS postings, supports review and exact-batch approval, uses an immutable resume version, and creates grounded interview preparation.

The recorded acceptance conditions include:

- A task reads at most 30 distinct postings. An approved batch contains at most 10 postings.
- Target full stack or Agent development in Guangzhou or Shenzhen, with a monthly salary range upper bound of at least CNY 18,000. AI application work is a preference after match quality.
- Use and verify native site filters. Preserve exclusion evidence, unknown employment or salary facts, and cross-task duplicates.
- Bind matching, preparation, and any approved attachment to the same immutable resume version. Final greetings and the exact posting list are frozen by approval.
- Preserve separate conversation, recipient-consent, attachment, failure, and unknown states. Unknown external outcomes must not trigger blind retries.
- Generate ten grounded preparation questions per approved posting, with independent retry, export, bank-save, and strict-practice paths.
- Enforce owner isolation, cancellation, restart recovery, browser ownership, deletion propagation, and private local storage.
- Verify local behavior with synthetic fixtures. Establish authenticated BOSS compatibility separately before enabling real delivery. A login-page launch or successful synthetic test does not satisfy this condition.

These are artifact-backed requirements. The original task transcript has not been recovered in this session.

## Workspace baseline

Observed on `2026-11-02T05:43:11Z`, before creating this handoff:

| Item | Observed value |
| --- | --- |
| Working directory | `/Users/gooingyu/Documents/project/interview-agents` |
| Branch | `main` |
| Upstream shown by status | `origin/main`; no ahead or behind count was shown. No fetch was performed. |
| HEAD | `9c808536e9716dbe11c0ca1cada906acf7283052` |
| HEAD subject | `ci: verify build database and browser workflows on GitHub` |
| Existing tracked modifications | 36 files, all unstaged |
| Existing untracked files | 47 files, with directory contents expanded |
| Tracked diff size | 951 insertions and 303 deletions; excludes untracked files |

This handoff is an additional untracked file. The existing changes include `.npmrc` and `.DS_Store`; preserve both. Worktree files are the continuation baseline. Checking out HEAD elsewhere would omit this implementation.

No commits, staging, resets, stashes, migrations, service launches, deployments, or publication were performed in this session.

## Settled decisions and project boundaries

- Read root `AGENTS.md`, `docs/generated/AGENTS.generated.md`, the generated project brief, capability matrix, and security context. Select task context through `docs/context/index.json`.
- Prefix shell commands with `rtk`, as required by `/Users/gooingyu/.codex/RTK.md`.
- `app.spec.yaml` owns capability intent. The generated matrix still marks `career.boss` as `planned`; local implementation files do not establish live-site readiness.
- NestJS authorizes business requests. API and Worker business modules own writes to `app`; Agent writes only `agent_runtime`. Shared wire contracts belong in `packages/contracts`.
- PostgreSQL is task truth; BullMQ carries notifications. Do not reinterpret interview `app.jobs` as recruitment postings.
- The documented default browser driver is official Patchright 1.64.2 with headed system Chrome and a dedicated persistent profile. Moli and Playwright remain explicit legacy options.
- Session inspection reads an existing page without launching, creating a page, or navigating. Explicit opening permits bounded initial navigation. Restrictions latch a pause; only an explicit check observing a usable page clears it.
- Keep `liveBossProfile.verified` false. Real outbound messages and attachments remain blocked before dispatch.
- The design records a prior model-routing constraint: GPT-6.1-sol authors the specification and checks functionality; DeepSeek workers implement it. Consult that artifact before further implementation, and report unavailable routes rather than claiming they were used. No delegation occurred in this session.
- Keep real resumes, credentials, browser profiles, and private diagnostics out of public evidence. Fixture results describe synthetic software behavior.

## Completed work and key files

Only this handoff was authored in the current session. The following pre-existing implementation areas are identified from Git inventory and maintained documentation. Their presence is verified; their behavior was not independently revalidated here.

| Area | Key existing changed or untracked files |
| --- | --- |
| Specification and generated context | `app.spec.yaml`, `capabilities.resolved.json`, `factory.lock.json`, `docs/context/index.json`, `docs/generated/00-PROJECT-BRIEF.md`, `docs/generated/03-CAPABILITY-MATRIX.md`, `docs/generated/08-TEST-PLAN.md`, `docs/generated/09-TASKS.md`, `docs/generated/modules/career.boss.md`, `docs/generated/traceability.json` |
| Career contracts and domain | `packages/contracts/src/career.ts`, `packages/contracts/src/preparation.ts`, `packages/contracts/src/bank.ts`, `packages/career/src/domain.ts`, `filters.ts`, `provenance.ts`, `storage.ts`, `store.ts` |
| API, resume versions, and deletion | `apps/api/src/career.ts`, `career-deletion.ts`, `resume-versions.ts`, `interview-deletion.ts`, `errors.ts`, `main.ts`, `interviews.ts`, `bank.ts`, `runtime-capabilities.ts` |
| Worker and browser observations | `apps/worker/src/boss-browser.ts`, `boss-response.ts`, `career-worker.ts`, `main.ts`, `packages/jobs/src/queue.ts` |
| Agent generation | `apps/agent/src/career.ts`, `apps/agent/src/server.ts` |
| Web workflow | `apps/web/src/career-panel.tsx`, `career-view.ts`, `career.css`, `resume-library.tsx`, `api.ts`, `main.tsx`, `navigation.ts`, `primary-navigation.tsx` |
| Persistence and runtime setup | `infra/migrations/004-career.sql`, `005-career-approval-session.sql`, `006-career-browser-engine.sql`, `infra/compose.yaml`, `infra/compose.test.yaml`, `infra/generated/services.json`, `packages/config/src/index.ts`, `package.json`, `pnpm-lock.yaml` |
| Local tools and tests | `scripts/boss-login.ts`, `scripts/boss-fixture.ts`, `tests/boss-*.ts`, `tests/career*.ts`, `tests/e2e/career.spec.ts`, `tests/provider-fixture.ts` |
| Operating and acceptance records | `docs/boss-workflow.md`, `docs/design/boss-career-workflow.md`, `docs/design/boss-functional-review.md`, `docs/evidence/browser-results.json`, two career screenshots |
| Other existing changes | `.npmrc`, `.DS_Store`, `README.md`, `packages/factory/src/catalog.ts`, `skills/software-factory/scripts/factory.mjs`, generated interview and resume module context |

Use `rtk git status --short --untracked-files=all` for the exact inventory. The table groups files for navigation and does not assign authorship or claim a full source review.

## Verification performed in this session

- Inspected `git status --short --branch`, `git branch --show-current`, `git rev-parse HEAD`, recent commit subjects, and `git diff --stat`.
- Read the applicable project guidance, generated brief, capability matrix, security context, context index, package scripts, operating-guide content, functional review, and browser report. The design was read for scope and constraints, not reviewed in full.
- Recorded SHA-256 hashes for all 83 pre-existing modified or untracked files before writing this handoff. The subsequent check found all 83 unchanged, no removed paths, and `TASK_HANDOFF.md` as the only added path. Required handoff sections were present.
- Did not run a build, type check, unit test, integration test, browser test, doctor, database migration, or live BOSS check. No current runtime readiness is established.

## Earlier verification recorded in artifacts

These are historical results, not executions by this session. Most have no immutable evaluated commit because the work is uncommitted. Use the recorded scope rather than treating all results as current-tree coverage.

| Source and evaluated scope | Recorded result | Limit |
| --- | --- | --- |
| `docs/design/boss-functional-review.md`, latest response-backed correction | `rtk pnpm typecheck` passed; focused `boss-response`, `boss-scan`, and `boss-browser` suites passed 53 tests, zero skips | No new independent review, browser run, runtime reload, or real-site verification was claimed. |
| Same review, earlier Patchright correction tree | Real-driver synthetic session suite passed 10 tests; CLI suite passed 4 tests, zero skips; build, type checking, skill validation, and whitespace checks passed | No whole-project regression or synthetic UI rerun on that final Patchright tree was claimed. |
| Same review, historical Moli baseline | Full integration run passed 26 files and 267 tests, zero skips; build and factory diff passed | Predates later Patchright and response-backed changes. It is not a full regression of the current tree. |
| `docs/evidence/browser-results.json` | Report dated `2026-10-30T14:34:15.568Z` records three synthetic career UI cases passed, zero skipped, unexpected, or flaky | The JSON does not bind the run to a Git hash. It covers its historical synthetic stack. |
| Functional review, real Patchright startup | Login controller reportedly reached `login_required` with `mutationsAllowed: false` | Authenticated behavior was not verified; no real greeting or resume was sent. |

The review records that the response-backed correction moved unresolved body-read tickets to the browser owner across observer lifetimes and paused before a card click when active identity was unreadable. It also records removal of the old per-observer counter and clamped decrement. This session made no application guard or test changes.

## Remaining work, failures, and blockers

1. Authenticated BOSS behavior remains the delivery blocker. Actual native city, role, and salary controls, account and recipient identity, and trustworthy original-attachment identity or receipts need private observation.
2. The latest review records missing city encoding/options and application-success semantics. `encoding: null` and `success: {status:'unknown'}` intentionally keep live searches paused. Response-backed search and detail have not been executed against a real session.
3. The historical desktop observation failed because `kimi-cu` reported `no shareable content: no display`. The later review found no running project Worker or `boss:login` controller and no earlier temporary observation directory. Neither process state nor display availability was checked in this handoff session.
4. Current build and test health has not been established here. Earlier green results have the baseline limits above. Availability of old `/tmp` logs, containers, services, private profiles, and installed Chrome is unknown.
5. This conversation does not establish a new request to send messages, upload a resume to BOSS, enable production mutations, commit, or publish. The current authorized task is the handoff. The next session should recover the prior user conversation if further authority depends on it.

The functional review reports earlier local findings closed and live-site evidence still blocking. That is the maintained review's conclusion; this handoff did not conduct another code review.

## Concrete next steps for Codex

1. Open `/Users/gooingyu/Documents/project/interview-agents` itself. Read this file and root `AGENTS.md`. Recheck `rtk git status --short --branch` and `rtk git status --short --untracked-files=all` against this baseline.
2. Read `docs/design/boss-functional-review.md` for the latest blocker and `docs/boss-workflow.md` for the maintained login and verification procedure. For career implementation, load `implement-career.boss` from `docs/context/index.json` and inspect the relevant current source.
3. If continuing the BOSS work, first establish existing user authorization and current service/browser ownership. The documented next product step is human login in a dedicated headed browser, followed by authenticated read-only observation. Check whether the Worker already owns the private profile before using `rtk pnpm boss:login`; the command and Worker cannot control the same profile concurrently. Login alone does not authorize delivery or changing the verification flag.
4. Resolve missing live observation facts at the existing adapter boundary. Preserve production mutation gating and explicit paused or unknown states. Carry forward the design's actual implementation and review requirements.
5. After relevant source changes, use the scripts from `package.json` and the operating guide. Focused commands already documented are `rtk pnpm typecheck` and `rtk pnpm exec vitest run tests/boss-response.test.ts tests/boss-scan.test.ts tests/boss-browser.test.ts`. Broader checks include `rtk pnpm build`, isolated integration tests, and synthetic browser cases when their prerequisites are available. Record the evaluated tree and any skips. Do not point synthetic E2E cases at a real account.

For the immediate handoff request, no product code change is needed. The user can start Codex with: "Read AGENTS.md and TASK_HANDOFF.md, verify the workspace baseline, and recover the documented next task without discarding existing changes."
