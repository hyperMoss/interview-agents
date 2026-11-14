# Product positioning foundation · delivery record

Verdict: **PASS (foundation layer)**. This delivery covers the requirement contract, the generated design context and the README positioning rewrite. It does not cover the UI implementation.

- Repository: `positioning-foundation`, branch `hyperMoss/positioning-foundation`, baseline commit `91790e75474eb2dfc723627f95107cd79573e505`.
- Date: 2026-11-14. Host toolchain: Node.js `v26.7.0`, pnpm `12.11.2`.
- Delivered artifacts: `app.spec.yaml` (eleven new requirements) → factory-generated managed docs → `README.md` positioning rewrite → this record.
- Delivery commit: `75d3a47` (`docs: establish positioning requirements and foundation context`); this record's final commit reference is added by a follow-up evidence-only commit. No push or merge was performed.

## 1. What is actually delivered

| Item | State in this delivery |
|---|---|
| P0-1 README hero, nine-module table, linkage and privacy wording | **Delivered here** (`README.md`). This is the only remediation item whose file content ships in the foundation diff. |
| P0-2 … P2-3 (ten remaining items) | **Not implemented.** They exist as REQ-053…REQ-062 with acceptance criteria and a file-exclusive owner. The UI work belongs to the three downstream groups described in §6. |

A failure report produced earlier in this effort stated that no item of the eleven was delivered. That statement was wrong for P0-1: the README positioning rewrite is part of this delivery. It remains correct for the ten UI items.

## 2. Provenance (exact run identifiers)

| Role | Identifier | Outcome |
|---|---|---|
| Reconnaissance scout | `aee6f08d-21cb-4b32-a0b6-cdc3b73f3499` | completed; produced the codebase handoff used here |
| Original implementation worker | `adbe241b-2cd4-478a-b09e-f249fd7acb05` | **failed**: terminated by SIGTERM, returned no result, left the partial diff |
| Recovery worker (first attempt) | `debe8106-5e47-4929-94d8-bb8beebd0ec5` | completed the work; its workflow `69f26084-56ff-413c-8cf4-cdf3826cc558` was recorded as aborted because the parent expected a plain `PASS` line while the worker returned a JSON verdict — an output-format expectation, not a work failure and not a defect in the diff |
| Read-only reviewer | `cb944233-de6b-4698-bac9-e8101dade6be` | verdict `CHANGES_REQUIRED`: findings F1–F4 (P1) and notes N1–N5 (P2) |
| Fix round 1 | worker `1f24aa05-5670-4e4f-81a5-f1e167ca2e39`, workflow `c7919b77-2bcc-4391-9fe4-5d1cd13b3920` | resolved F1–F4 and N1/N2/N5; re-ran affected generation, checks, build and factory tests; the workflow subsequently stopped during result parsing, before re-review |
| Final read-only reviewer | `d64823c0-8780-49ba-8895-708cf7884042` | **PASS**, all original blocking findings resolved; one correction round; remaining observations are report-only |

## 3. Review findings and their resolution

| Finding | Severity | Resolution in this round |
|---|---|---|
| F1 README claimed a review→practice linkage that does not exist | P1 | Fixed. The only real review-list consumers are the home count, the `ReviewPanel` actions (回看原始 QA / 标记已复习 / 移除), the interview-delete cascade and the local data export; nothing feeds review items into interview planning, and the 1/3/7/14-day scheduling belongs to Hot 100 only. README row 7 now reads「复习清单可回看原作答依据、写笔记并标记已复习；删除面试会一并清理关联复习。」 |
| F2 README and REQ-052 misstated what the external search service receives | P1 | Fixed in both places. README paragraph 2 now states that「简历、JD 或作答」go only to the user-confirmed model and that「联网搜索」sends only the confirmed keyword (2–200 字). REQ-052 acceptance carries the same split. README「数据与隐私」gained an explicit bullet about the Tavily / Firecrawl keyword disclosure. Verified against `apps/web/src/intake.tsx:66,110-111` and `apps/agent/src/search.ts` (query trimmed to 2–200 chars; only `{query, max_results, search_depth}` is posted). |
| F3 Evidence attributed the delivery to a workflow id as if it were a worker | P1 | Fixed in §2 above: `69f26084-…` is the workflow, `debe8106-…` is the worker, and the abort reason is recorded. |
| F4 Evidence must be written in English | P1 | Fixed by this rewrite. Chinese is preserved only inside quoted spec/README strings and the two byte-exact requirement copies. |
| N1 §7 under-reported which managed outputs changed | P2 | Fixed: §10 now scopes each factory run to what that run changed, and §11 carries the complete file list |
| N2 REQ-059/REQ-062 depend on conversation data but omitted `career.boss` | P2 | Fixed: both requirements now list `capabilities: [core.platform, interview.practice, career.boss]`, so generated traceability and the capability matrix attribute the conversation-data dependency correctly. The existing capability-based task index is unchanged and downstream groups must load the conversation module context when needed. |
| N3 REQ-052 mixes the README half and the home-copy half | P2 | Documented, no edit. The home Hero copy belongs to P1-4 (`home-panel.tsx`) and is assigned to the navigation/journey group; §4 and §8 state the split so no group can close REQ-052 alone. Splitting the requirement belongs to integration, not to this delivery. |
| N4 Two deliberate deviations from the source documents | P2 | Recorded for owner acknowledgement: the README slogan deliberately drops the source's「从找岗位到拿 Offer」result promise, and REQ-057 renames the source's「已投递」tag to「冻结」with an explicit "not proof of delivery" clause. Both follow the product-honesty rules and are listed in §9. |
| N5 Copied requirement docs embed machine-local `file://` paths | P2 | Addressed in the reviewer-facing surfaces: README's document navigation now says the two copies are byte-exact copies whose `file://` links point at the source machine, not at this repository. The copies themselves stay byte-identical. |

## 4. Requirement traceability for the eleven source items

The source documents contain 11 items (P0 ×4, P1 ×4, P2 ×3). Each maps one-to-one to a requirement in `app.spec.yaml`, and the factory generates the matching `TEST-REQ-*` and `TASK-REQ-*` entries.

| Source item | Requirement | Acceptance | Downstream implementation owner |
|---|---|---|---|
| P0-1 README hero and nine-module copy | REQ-052 | TEST-REQ-052 | delivered here (README); the same requirement's home-copy half is P1-4 in `home-panel.tsx` |
| P0-2 pinned handoff entries with preview confirmation | REQ-053 | TEST-REQ-053 | `boss-inbox-panel.tsx`, `boss-inbox.css`, `main.tsx` handoff callbacks |
| P0-3 strict-mode copy plus post-import interview entry | REQ-054 | TEST-REQ-054 | `preparation-panel.tsx` |
| P0-4 unified demo/AI mode badge | REQ-055 | TEST-REQ-055 | new `model-mode-tag.tsx`, `intake.tsx`, `interview.tsx`; `preparation-panel.tsx` only consumes it |
| P1-1 menu group subtitles and handoff hints | REQ-056 | TEST-REQ-056 | `module-navigation.tsx` |
| P1-2 resume card handoff actions and frozen tag | REQ-057 | TEST-REQ-057 | `resume-studio.tsx` |
| P1-3 per-question add/remove review action | REQ-058 | TEST-REQ-058 | `interview.tsx`, `report-priorities.tsx` |
| P1-4 home journey rail and Hero subtitle | REQ-059 | TEST-REQ-059 | `home-panel.tsx`, `module-layout.css` |
| P2-1 interview-group due/in-progress counts | REQ-060 | TEST-REQ-060 | `module-navigation.tsx` |
| P2-2 first-use onboarding | REQ-061 | TEST-REQ-061 | new `onboarding-panel.tsx` |
| P2-3 standalone journey map | REQ-062 | TEST-REQ-062 | new `journey-map.tsx` |

The new requirements attach only to already-assembled capabilities (`core.platform`, `interview.practice`, `resume.import`, `ai.text`, `career.boss`). No capability was added, and none was promoted to `supported`.

## 5. Copied requirement documents

Both documents are read-only copies of the user's originals and were not edited in any character.

| Copy | Source | sha256 | Byte check |
|---|---|---|---|
| `docs/product-positioning-refactor.md` | `/Users/gooingyu/orca/workspaces/interview-agents/自检/docs/product-positioning-refactor.md` | `8b31199d100c40c8902262f057337b0f34b66ea2f0470d8cadfbc8ce4bc837da` | `cmp` exit 0 |
| `docs/product-positioning-dev-plan.md` | `/Users/gooingyu/orca/workspaces/interview-agents/自检/docs/product-positioning-dev-plan.md` | `c941c88dfb01f32780c5d053260d402c21e2f664561175ff4ef256303354eae8` | `cmp` exit 0 |

Their trailing `file:///Users/gooingyu/...` reference lines are preserved because byte identity is mandatory; those links point at the machine that produced the originals, not at repository paths.

## 6. README positioning rewrite (P0-1)

The README hero now presents a full-pipeline job-search assistant, and the module table lists nine modules in natural order: résumé, job discovery, approval and outreach, conversation follow-up, JD preparation, mock interview, review and spaced repetition, algorithm practice, model and local data. Every row names a linkage that exists today.

Verified factual boundaries:

- No outcome promise: the page states「不承诺面试结果或录用」and the source slogan「从找岗位到拿 Offer」was deliberately not copied.
- AI is explicit and optional: résumé, JD and answers go only to the user-selected model; web search receives only the confirmed keyword.
- The three BOSS rows (job discovery, approval/outreach, conversation follow-up) are marked「开发中」; `career.boss` is never described as verified against the real site.
- Numbers match the contracts: 「最多六个自定义方向」→ `customRoleKeywords` max 6 in `packages/contracts/src/career.ts`; 「3 至 12 道题」→ `questionCount` 3–12 in `packages/contracts/src/preparation.ts`; 「七套主题」→ the seven `resumeThemes` values.
- Two overstated linkage claims were removed earlier (résumé card → preparation handoff is P1-2; handoff preview confirmation is P0-2) so the table never advertises unbuilt behaviour.
- F1 and F2 further removed a non-existent review→practice prioritisation claim and corrected the search-disclosure sentence.

## 7. Facts downstream implementation must respect

### 7.1 Mode provenance versus readiness (REQ-055)

Provenance is a frozen snapshot, never inferred from readiness:

- Session level: `session.modelMode` (`demo` / `live`) plus `session.modelSource` (`{kind:'default',model?}` or `{kind:'custom',connectionId,model,baseUrl}`); each turn also carries `turn.modelSource`.
- Interview history keeps `modelMode` only; `preparationResult` keeps `modelMode` plus the model name; preparation history keeps `modelConnectionId` only. History and preparation views must therefore never print a connection id as a model name.
- `api.capabilities()` and `modelSettings.active` are readiness. Unstarted entry points may show readiness; a started or finished interview must show the frozen mode and model name. Unknown or unavailable renders「未确认」, not「演示」.

### 7.2 Per-question review (REQ-058)

- Local key `review-list-v1`, cap 1000 items; duplicate suppression uses `interviewId + questionId` and applies only to incomplete items.
- The stable question identity is `turn.question.id`, falling back to `turn-<index>` in existing code; per-question actions must reuse that source.
- Due date is fixed at one day after insertion; deleting an interview cascades through `removeInterviewReviews`. The existing bulk entry for the three lowest-scoring turns must be preserved.

### 7.3 Cross-page handoff (REQ-053, REQ-057)

- Reuse existing keys `interview-intake`, `jd-preparation-v1`, `boss-interview-origin`, `boss-inbox-job` plus the in-memory `preparationRequest` seed in `main.tsx`. No new API and no new local storage key may be added; new keys would require `packages/contracts/src/workspace.ts` changes that are outside this authority.
- Existing bounds: JD 20–12000 characters, résumé 20–16000 characters, hard error with an explicit「不会自动截断」message. The current Popconfirm only warns that it replaces an unsubmitted preparation draft and has no content preview — that is what P0-2 changes.
- A frozen résumé version means immutable only. It is not evidence of sending, delivery or reply (encoded in REQ-057 acceptance and in the README「当前限制」section).

### 7.4 Journey data (REQ-059, REQ-060, REQ-062)

- Owner-scoped sources: interview history (paged, `limit` ≤ 50), résumé drafts and versions, preparation history (≤ 50 per page), local conversation summaries, local review list, local job profiles (≤ 50), Hot 100 draft.
- Loading, load failure and a true zero must render differently; offline algorithm and local-data pages must never be blocked by journey or onboarding UI.
- No `/stats` endpoint exists; REQ-061/REQ-062 forbid adding one or adding a local storage key.

### 7.5 First use (REQ-061)

Onboarding appears only when interview history and résumé drafts both loaded successfully, both are empty, and no unsubmitted preparation draft exists. Any pending or failed request suppresses it. It must not create records or call a model.

## 8. Ownership split for the three downstream groups

Ownership is file-exclusive; no two groups edit the same file.

| Group | Exclusive files | Items |
|---|---|---|
| Handoff and preparation | `boss-inbox-panel.tsx`, `boss-inbox.css`, `preparation-panel.tsx`, `resume-studio.tsx` | P0-2, P0-3, P1-2 |
| Mode and report | new `model-mode-tag.tsx`, `intake.tsx`, `interview.tsx`, `report-priorities.tsx` | P0-4, P1-3 |
| Navigation and journey | `module-navigation.tsx`, `home-panel.tsx`, `module-layout.css`, new `onboarding-panel.tsx`, new `journey-map.tsx` | P1-1, P1-4, P2-1, P2-2, P2-3 |

- `apps/web/src/main.tsx` has a single integration owner: the **handoff and preparation** group. The mode and journey groups submit their `main.tsx` needs (mode label and demo-banner wiring, home routing, handoff callbacks) to that owner instead of editing the file.
- `preparation-panel.tsx` is owned by the handoff and preparation group and only consumes the exported mode component produced by the mode group; it must not fork a second badge implementation.
- Any `packages/contracts/src/**` change, including a new workspace storage key, needs separate authorisation.
- Menu item accessible names are asserted verbatim by `tests/e2e/ui-helpers.ts`; renaming them breaks every browser acceptance spec.

## 9. Acknowledged deviations from the literal source documents

- Slogan: the source suggests「从找岗位到拿 Offer，全流程 AI 求职助手」; the README uses an outcome-free sentence because REQ-052 forbids result promises.
- Résumé tag: the source suggests an「已投递」badge; REQ-057 uses「冻结」and states that a frozen version is not proof of sending or reply, matching the four independent conversation/attachment states.

Both deviations implement the explicit task requirements for factual wording and for distinguishing frozen versions from actual delivery.

## 10. Executed verification

All commands ran from the repository root. No `.env` was read, no real BOSS site or paid model was called, and no user environment was modified.

This fix round re-ran only the commands affected by the spec and README edits:

| Command | Exit | Result |
|---|---|---|
| `pnpm factory plan --spec app.spec.yaml` | 0 | 62 requirements; 8 assembled capabilities; `career.boss` still `planned`; REQ-059/REQ-062 now resolve with `career.boss` |
| `pnpm factory docs --spec app.spec.yaml --output .` | 0 | this run changed `capabilities.resolved.json`, `00-PROJECT-BRIEF.md`, `03-CAPABILITY-MATRIX.md`, `08-TEST-PLAN.md`, `modules/career.boss.md`, `traceability.json`, and updated `factory.lock.json` |
| `pnpm factory diff --spec app.spec.yaml --output .` | 0 | `{"changed": [], "retirement": []}` |
| `pnpm build` | 0 | `factory:check` (runtime capability registry matches the spec), `tsc --noEmit`, Vite build to `dist/web`, skill bundle and skill validation all passed |
| `pnpm vitest run tests/factory.test.ts` | 0 | 22 of 22 tests passed |
| `cmp` of both copied requirement documents against the `自检` originals | 0 | byte-identical; sha256 values in §5 |
| `git status --porcelain` / `git diff --cached --name-only` | 0 | 14 modified plus 3 untracked files, all inside the authorised write set; nothing staged |

The earlier delivery round ran the same factory plan/docs/diff, `pnpm build` and `pnpm vitest run tests/factory.test.ts` successfully. Together the two factory runs produced the managed changes listed in §11.

- Build output goes to `dist/web/**`, which `.gitignore` ignores (`.gitignore:4`); the build created no tracked files.
- `pnpm-lock.yaml` is unchanged (`sha256 f5eaa310c92c3de21b70d209b3cc908611f0d1fc325e9df3650435bcb85fda43`). Dependencies were installed by the failed first attempt with `--frozen-lockfile`; this round installed nothing.
- `pnpm factory:check` verifies the runtime capability registry only; it is never used here as a substitute for spec validation.

## 11. Change inventory

Modified:

- `app.spec.yaml`: adds REQ-052…REQ-062, tightens REQ-059/REQ-060 pagination wording, corrects the REQ-052 search-disclosure clause, and attributes REQ-059/REQ-062 to `career.boss`.
- Factory-managed outputs regenerated by the CLI (never hand-edited): `capabilities.resolved.json`, `docs/generated/00-PROJECT-BRIEF.md`, `docs/generated/03-CAPABILITY-MATRIX.md`, `docs/generated/08-TEST-PLAN.md`, `docs/generated/09-TASKS.md`, `docs/generated/traceability.json`, `docs/generated/modules/{ai.text,career.boss,core.platform,interview.practice,resume.import}.md`, `factory.lock.json`.
- `README.md`: P0-1 positioning rewrite, the F1/F2 factual corrections, the search-disclosure privacy bullet, and the note that the copied requirement documents contain source-machine `file://` links.

Added:

- `docs/product-positioning-refactor.md`, `docs/product-positioning-dev-plan.md` (byte-identical copies).
- `docs/evidence/positioning-foundation.md` (this record).

Untouched: `docs/context/index.json` (task contexts are per capability and the capability set is unchanged), `config/generated/**`, `infra/generated/**`, `apps/**`, `packages/**`, tests, and `.env`.

## 12. Not verified / limitations

- No UI implementation is included; P0-1 README content is delivered, while the ten UI items remain downstream.
- `pnpm factory validate --spec app.spec.yaml --target production` still fails because `career.boss` is `planned`. That is pre-existing behaviour and was preserved, not bypassed.
- `pnpm test:e2e` and the integration suites were not run (they need `pnpm dev` + Chrome and are downstream acceptance); real BOSS behaviour, real paid model calls, production deployment and HTTPS/credential isolation remain unverified.
- No ADR, screenshot or performance data was added. This record contains no real résumé, credential, cookie or conversation content.
- Before committing, the parent independently confirmed factory diff (no drift), all 22 factory tests, both byte-exact copies and `git diff --check`; every command exited 0.
- Final reviewer noted deployment-default live models as an additional provenance case: downstream mode displays must also handle the deployment default, rather than assuming every live task uses a user-added connection. Browser/integration behavior remains outside this foundation delivery.
- No runtime checks or tests were added or changed; defense-reduction analysis is not applicable to these contract and documentation changes.
