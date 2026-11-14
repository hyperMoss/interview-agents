# Navigation and journey · delivery record

Verdict: **PASS** after one correction round and one confirmation round. This delivery implements REQ-056, REQ-059, REQ-060, REQ-061 and REQ-062 for the navigation and journey group.

- Repository: `positioning-journey`, branch `hyperMoss/positioning-journey`, baseline commit `df9884d`.
- Date: 2026-11-14. Node.js `v26.7.0`, pnpm `12.11.2`; dependencies installed with `pnpm install --frozen-lockfile` (`pnpm-lock.yaml` sha256 unchanged: `f5eaa310c92c3de21b70d209b3cc908611f0d1fc325e9df3650435bcb85fda43`).
- No push, merge, deployment or worktree mutation was performed. No real `.env`, résumé, business database, BOSS site or paid model was read or called.

## 1. Provenance (actual models and session identifiers)

| Role | Model | Identifier | Outcome |
|---|---|---|---|
| Implementation session | `magpie/auto/deepseek-v4.1-flash` (`PI_MODEL`) | `01a1da67-fc76-701e-aa25-efad2135c473` | implemented the five items, fixed review findings, ran all checks |
| Read-only reviewer, round 1 | `magpie/remote-magpie/codex/gpt-6.1-sol` | Pi session `01a1da71-d4fd-7053-b922-db3befe788ab`, Orca terminal `term_99907b80-90f9-43c0-bfe5-09960c6a7f63` | `CHANGES_REQUIRED`: 3 × P1, 1 × P2 |
| Same reviewer, round 2 | `magpie/remote-magpie/codex/gpt-6.1-sol` | same session and terminal handle | `PASS`, no findings |
| Same reviewer, round 3 (confirmation) | `magpie/remote-magpie/codex/gpt-6.1-sol` | same session and terminal handle | `PASS`; confirmed that the review-count invalidation refinement still satisfies REQ-060 |
| Abandoned attempt | `magpie/auto/deepseek-v4.1-flash` | Orca chat session `pi_a2f1cac0_da56_4864_b55c_806e944c110a` | started before the model could be selected; its review result was **not** used |

The reviewer was launched with Orca's recommended `--agent pi`. Orca refuses launch-time model selection for Pi (`agent_pi_model_unsupported`), so the model was switched inside the new session with `/model magpie/remote-magpie/codex/gpt-6.1-sol`; the terminal status bar then showed `remote-magpie/codex/gpt-6.1-sol`. No global configuration was modified.

## 2. Delivered artifacts

| File | Change | Requirement |
|---|---|---|
| `apps/web/src/module-navigation.tsx` | group subtitles, handoff hints, interview-group counts | REQ-056, REQ-060 |
| `apps/web/src/home-panel.tsx` | hero copy, journey rail, onboarding mount, journey map mount, review-count invalidation | REQ-059, REQ-052 (home half), REQ-061 |
| `apps/web/src/journey-map.tsx` (new) | owner-scoped journey sources, stage evaluation, sidebar count hook, journey map component | REQ-059, REQ-060, REQ-062 |
| `apps/web/src/onboarding-panel.tsx` (new) | first-use condition and three entries | REQ-061 |
| `apps/web/src/module-layout.css` | menu subtitle/hint, rail, map, onboarding, narrow-screen styles | REQ-056, REQ-059, REQ-061, REQ-062 |
| `tests/positioning-journey.test.ts` (new) | focused tests for the pure journey/onboarding/count logic | verification only |

Untouched as required: `apps/web/src/main.tsx`, `apps/web/src/preparation-panel.tsx`, `packages/contracts/**`, `navigation.ts`, `README.md`, generated docs and `app.spec.yaml`.

## 3. Requirement acceptance

### REQ-056 — menu stage subtitles and handoff hints

- Every group renders a subtitle inside the Ant Design group title: 工作台「从这里开始」, 简历管理「第一步 · 整理简历」, 求职管理「第二步 · 发现岗位与沟通」, 面试中心「第三步 · 备题与练习」, 学习训练「第四步 · 持续训练」, 系统设置「模型与本机数据」.
- Handoff hints: 已交换简历会话「可带入备题 & 面试」, JD 备题「支持从会话带入」.
- Hints are rendered as `<small aria-hidden="true">` inside the item label, so the accessible name stays exactly the item label. `tests/e2e/ui-helpers.ts` locates menu items with `getByRole('menuitem', { name, exact: true })`; all 15 menu names still match exactly (browser check in §7).
- Group subtitles render in an element with `role="presentation"`, not a `menuitem`, so they cannot change a menu item name or its click area. `moduleTitle` (breadcrumb) still resolves from the unchanged `label` strings, so deep links and history navigation are unaffected.

### REQ-059 — home journey guidance

- Home hero copy is now `简历 → 岗位与 JD 备题 → 模拟面试 → 复盘复习 → 算法训练，按你自己保存的记录标出下一步。`; it promises no interview result or offer.
- A rail of five steps (简历, 岗位会话, JD 备题, 模拟面试, 复盘与复习) is built from `buildJourneyStages`; each step is a real button to its module. Algorithm training appears only in the full map, because REQ-059 lists interview, résumé, preparation, conversation and local review as the sources.
- States are distinct: `done` / `open` / `loading` / `unavailable`, with `已完成 / 未开始 / 加载中 / 不可用` labels. A failed source shows a page-level `重试读取旅程状态` button calling every refetch.
- Paged endpoints are never presented as totals: when the first page is full and a cursor exists, the detail reads `至少 N …（单页上限 20）`, and the interview extra reads `本页内 …`.
- The existing three workflow cards, the three home action cards and the recent-interview list are unchanged.

### REQ-060 — interview-group counts

- `useJourneyCounts` reads the interview history through the same cache key as the home page (`['recent-history']`, `api.history({limit:20})`) and the local review list through the same shared key (`['local-reviews']`), so menu and home render one source.
- `待复习`: local pending review items; `不可用` when the local list cannot be parsed; `暂无待复习` only for a readable empty list.
- `进行中`: interview items whose status is neither `completed` nor `cancelled`. Loading, failure, real zero, and the full-page lower bound are separate strings (`进行中 读取中`, `进行中 不可用`, `暂无进行中`, `进行中 ≥N`, and `进行中 0（本页）` when a full page shows no active interview but older records exist).
- Counts live inside the group title, so menu names, click areas and keyboard handling are unchanged.

### REQ-061 — first-use guidance

- `shouldShowOnboarding` requires both sources to be `ready` and empty, and rejects any active draft: a JD preparation draft with unsaved cards (detected through the preparation page's existing local key) or an interview intake draft (`interview-intake`).
- Loading, failed or non-empty sources hide the panel. Unreadable draft content is treated as an existing draft, so real work is never hidden.
- Offline algorithm and local-data pages do not render home, so the panel cannot block them; failed queries only surface as `不可用`/`读取中` text.
- Three entries navigate to `preparation`, `career` and `practice`. The panel creates no record and calls no model.

### REQ-062 — standalone journey map

- `JourneyMap` renders six stages (résumé, conversation, preparation, interview, review, algorithm) with `已完成 / 未开始 / 加载中 / 不可用` tags and a per-stage detail string.
- Every source is an existing owner-scoped query (`['recent-history']`, `['resume-drafts']`, `['preparation-history', undefined]`, `['boss-inbox']`) or the existing local keys (`review-list-v1`, `hot100-practice-v1`). No API endpoint, contract or storage key was added.
- The recommendation points at the first `open` stage and its real module; when stages are all done it states that; when part of the data is unavailable it says so instead of claiming completeness.
- The map never infers delivery, sending, offers or interview results: conversation text is `已同步 N 个 BOSS 会话记录`, and interview text reports only counts and statuses that the API returns.
- It is an independent component and page section. A separate top-level route would require `navigation.ts` and `main.tsx`, which are outside this group's write authority; see §5.

## 4. Data sources and honesty boundaries

| Stage | Source | Owner scope |
|---|---|---|
| Résumé | `api.resumeDrafts()` (`['resume-drafts']`) | server, owner cookie |
| Conversation | `api.bossConversations()` (`['boss-inbox']`) | server, owner cookie |
| JD preparation | `api.preparationHistory()` (`['preparation-history', undefined]`) | server, owner cookie |
| Mock interview | `api.history({limit:20})` (`['recent-history']`) | server, owner cookie |
| Review | local `review-list-v1` | this browser workspace |
| Algorithm | local `hot100-practice-v1` | this browser workspace |

`career.boss` remains `planned`: the conversation stage only reflects locally synced conversation records and never claims that BOSS outreach is verified.

## 5. Integration needs handed to other owners

No `main.tsx` change is required: `HomePanel` already receives `navigate`, and the onboarding panel and journey map are mounted inside it. The remaining optional request, for the handoff/integration owner, is a dedicated route for the journey map (`navigation.ts` `Page` + `main.tsx` render branch) if the product decides the map needs its own URL. This delivery intentionally does not touch those files.

## 6. Review findings and resolution

| Finding | Severity | Resolution |
|---|---|---|
| F1 full portfolio page could assert `暂无进行中` although older pages may contain active interviews | P1 | Counts now check the cursor first: a full page with no active item renders `进行中 0（本页）`; a full page with active items renders `进行中 ≥N`. Asserted in the focused test. |
| F2 sidebar review count did not update after review-list edits | P1 | Local reviews moved to a shared React Query cache key `['local-reviews']` (`staleTime: 0`, `initialData`), so menu and home share one value; `ReviewPanel` invalidates that key after actions that change pending/total counts (mark reviewed, re-add, remove). Typing notes still saves but does not refetch counts, because notes do not affect them. No new storage key. |
| F3 onboarding ignored an active interview intake draft | P1 | `shouldShowOnboarding` now also takes `intakeDraft` (`interview-intake` present) and suppresses the panel; a test asserts both draft kinds. |
| F4 summary claimed all stages have records when some were unavailable | P2 | `JourneyMap` has an `unavailable` branch before the all-done sentence. |

Round 2 review returned `PASS` with no findings. Round 3 confirmed the added invalidation refinement with `PASS`, noting that note typing cannot drop a count change.

## 7. Executed verification

| Command / check | Exit | Result |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | installed; build-script warnings only; lock file unchanged |
| `pnpm typecheck` | 0 | clean |
| `pnpm vitest run tests/positioning-journey.test.ts` | 0 | 7 tests passed |
| `pnpm exec vite build --config apps/web/vite.config.ts` | 0 | bundle built into `dist/web` (git-ignored); chunk-size warning only |
| Browser check, local `pnpm dev:web` on 127.0.0.1:5174 (read-only GETs against the local API) | — | see below |

Browser check (Playwright, Chrome, 1280×900 and 420×900):

- All 15 menu items resolve with `getByRole('menuitem', { name, exact: true })`; zero failures.
- Six group subtitles render on desktop and again in the mobile drawer; two handoff hints render with `aria-hidden`.
- Group count with a fresh anonymous identity shows `暂无待复习 · 暂无进行中`.
- Rail renders five steps with `未开始 · …` details; map renders six `未开始` tags; recommendation shows `下一步建议：简历`.
- Onboarding panel renders once for an empty identity.
- Menu items are focusable, `ArrowDown` moves the rc-menu cursor, and `Enter` navigates (`#/resumes`); no page errors were reported.

Reviewer verification (round 2, same session): `pnpm typecheck` exit 0; `pnpm vitest run tests/positioning-journey.test.ts` exit 0, 7 passed.

After the final review-count refinement, the same three commands were re-run locally: `pnpm typecheck` exit 0, `pnpm vitest run tests/positioning-journey.test.ts` exit 0 with 7 passed, `pnpm exec vite build --config apps/web/vite.config.ts` exit 0.

## 8. Not verified / limitations

- No end-to-end suite was run: there is no `.env` in this checkout, and starting the full stack would require real environment configuration. Menu accessibility, keyboard behaviour and responsive layout were checked against a frontend-only dev server, which is the same bundle but without the complete service topology.
- Loading and failure states were verified by unit tests and server-rendered DOM structure, not by forcing a failing API in the browser. The `重试读取旅程状态` button was not clicked in a failing state.
- Review-count synchronisation across components after a save is covered by static review plus the shared cache key; it was not exercised end to end in a browser.
- Escape-closing the mobile drawer while focus is inside the drawer was not asserted.
- No visual baseline or screenshot comparison exists; the desktop/mobile screenshots produced during the check were temporary artifacts and were not committed.
- Real BOSS site behaviour, paid model calls, deployment and cross-owner identity isolation remain outside this delivery, as do all other groups' files.

## 9. Change inventory

Modified: `apps/web/src/home-panel.tsx`, `apps/web/src/module-layout.css`, `apps/web/src/module-navigation.tsx`.
Added: `apps/web/src/journey-map.tsx`, `apps/web/src/onboarding-panel.tsx`, `tests/positioning-journey.test.ts`, this record.

Backups of the three modified files and the temporary verification scripts/screenshots were kept only under `backups/positioning-journey/` during the work and moved to the user's Trash before delivery; `backups/` is not part of this delivery.

Defense-reduction notes: no new API, contract or storage key was introduced; `sourceState` and the stage evaluator each validate a source once at the only place a query result becomes a visible state; the local parsers treat missing keys as a real zero and unreadable content as unavailable, which is the trust boundary for locally stored records; no invariant is checked twice, and no caller/callee pair re-validates the same value.
