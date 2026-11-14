# Product positioning · mode and report group · delivery record

Scope: P0-4 (REQ-055, unified model-mode badge) and P1-3 (REQ-058, per-question review action).
Repository worktree: `positioning-mode-report`, branch `hyperMoss/positioning-mode-report`, baseline commit `df9884d`.

## 1. Delivered files

| File | Change |
|---|---|
| `apps/web/src/model-mode-tag.tsx` | new. Pure mode-descriptor functions plus the shared `ModelModeTag` badge. |
| `apps/web/src/model-mode.css` | new. Layout for the badge, the intake heading row and the per-question action row. |
| `apps/web/src/intake.tsx` | adds the runtime-readiness badge to the page heading row. |
| `apps/web/src/interview.tsx` | frozen session badge, per-turn badge, per-question review action wired into the report. |
| `apps/web/src/report-priorities.tsx` | review intent logic, the shared report review controller, and the existing bulk entry pointed at it. |
| `tests/mode-report.test.ts` | new focused vitest file (9 tests). |
| `docs/evidence/positioning-mode-report.md` | this record. |

Not touched: `apps/web/src/main.tsx`, `apps/web/src/preparation-panel.tsx`, `apps/web/src/module-layout.css`, `apps/web/src/personal-data.ts`, `packages/contracts/src/**`, `app.spec.yaml`, generated docs, README, e2e specs, lockfile.

## 2. Mode provenance rules implemented (REQ-055)

The badge never infers the mode of a task from readiness. It has three entry points.

- `describeFrozenMode(mode, source, scope)` — an already started or finished interview, read from that session's snapshot (`session.modelMode` + `session.modelSource`, and per turn `turn.modelSource` formed in `packages/interview/src/domain.ts:15`). Later model-setting changes cannot alter it. The `scope` argument only changes the wording: a session row says the reading comes from this session's record and that a single question can differ after a retry switched connections, while a turn row says it shows the model that turn actually used.
  - `demo` renders「演示模式」. A recorded rules model name (`rules-demo-v1`, written by `apps/api/src/interviews.ts:159`) is never printed as the model.
  - `live` with a recorded model name renders `AI · <model>`; the hint says whether it came from a personal connection or the deployment default.
  - `live` with `{kind:'default'}` and no model name renders `AI · 部署方默认模型`, which is what that record actually proves.
  - A missing mode, a missing source, or a custom source without a model name renders「未确认」. A connection id is never used as a substitute for a model name, and neither `connectionId` nor `defaultReference` is rendered.
- `describeRecordedMode(mode, model)` — records that keep only a mode (plus an optional model name): interview-history rows (`packages/contracts/src/history.ts:23`) and preparation results (`packages/contracts/src/preparation.ts:40`). A live record without a stored model name renders `AI 模式`, not「未确认」and not a connection id.
- `describeRuntimeMode({data, pending, failed})` — a not-yet-started entry point. An enabled personal connection wins over the deployment default mode, because `apps/api/src/interviews.ts:159` snapshots the personal connection whenever one is passed; this is exactly the inference the badge must not make from readiness or `mode` alone. Otherwise: deployment default (`AI · <defaultModel>` or `AI · 部署方默认模型`), demo, or「未配置模型」when `mode === 'disabled'` and no connection is active. A load in progress reads「读取模型状态…」and a failed read reads「未确认」with a retry hint; neither becomes「演示模式」.

Placement follows the source plan: intake page heading row, session view top, and the per-turn QA line. The demo annotation inside the report (`规则演示评分`, `演示分`) is preserved (`apps/web/src/interview.tsx`).

## 3. Shared component contract for the other groups

`apps/web/src/model-mode-tag.tsx` exports (user-facing output is quoted exactly):

```tsx
export type ModelModeBadge = { tone: 'live' | 'demo' | 'pending' | 'unconfigured' | 'unconfirmed'; label: string; hint: string };
export type FrozenScope = 'session' | 'turn';
export function describeFrozenMode(mode: 'demo' | 'live' | undefined, source: ModelSource | null | undefined, scope?: FrozenScope): ModelModeBadge;
export function describeRecordedMode(mode: 'demo' | 'live' | undefined, model: string | undefined): ModelModeBadge;
export function describeRuntimeMode(input: { data?: ModelSettings | undefined; pending?: boolean; failed?: boolean }): ModelModeBadge;
export function ModelModeTag({ badge, className }: { badge: ModelModeBadge; className?: string }): JSX.Element;
```

The badge is presentational only: it renders `label`, exposes `hint` as `title`, sets `data-model-mode={tone}` and does not fetch, read storage or read keys. Importing it also loads `model-mode.css`.

### 3.1 `preparation-panel.tsx` (owner: handoff and preparation group)

Replace the hand-rolled model string with the shared badge; the query already exists in that file (`model-settings`).

```tsx
import { ModelModeTag, describeRecordedMode, describeRuntimeMode } from './model-mode-tag';

// entry readiness — next to 「根据 JD 生成题单」 in the existing `.panel-actions` row
<ModelModeTag badge={describeRuntimeMode({ data: settings.data, pending: settings.isPending, failed: settings.isError })} />

// an existing preparation result keeps modelMode + model name
<ModelModeTag badge={describeRecordedMode(draft.result.modelMode, draft.result.model)} />
```

A preparation-history row that stores only `modelConnectionId` must call `describeRecordedMode(undefined, undefined)` (or omit the badge) rather than passing the connection id; the view must never print a connection id as a model name.

### 3.2 `main.tsx` (owner: handoff and preparation group)

Needed wiring, not applied here:

```tsx
import { ModelModeTag, describeFrozenMode, describeRuntimeMode } from './model-mode-tag';

const runtimeBadge = describeRuntimeMode({ data: settings.data, pending: settings.isPending, failed: settings.isError });
const headerBadge = selected && session.data ? describeFrozenMode(session.data.modelMode, session.data.modelSource) : runtimeBadge;

// replaces the `.mode-indicator` label derivation
<Button className="mode-indicator" onClick={() => openUtility('model')}>{headerBadge.label}</Button>
```

`HomePanel`'s `modelReady` prop currently reads `Boolean(settings.data?.active) || settings.data?.mode === 'live'`. It is a readiness flag only; it must not be used to claim a session's mode. Its honest equivalent from this module is `describeRuntimeMode({ ... }).tone === 'live'`.

## 4. Per-question review action (REQ-058)

- Identity: `questionIdOf(turn, index)` = `turn.question.id ?? \`turn-${index}\``, the same rule the writer in `personal-data.ts:26` applies, so the report and the writer agree on `interviewId + questionId`.
- Writes go through the existing local list only: `addReviewItem` (insertion, capacity 1000, one incomplete record per `interviewId + questionId`, one-day due date) and `saveReviews` (removal). No new storage key, endpoint or contract change. The report never pre-checks a rule the writer owns; it reads the list back and reports the observed effect through `reviewAddMessage(before, after, ...)`:
  - a record that exists after the attempt and did not exist before →「已加入面试复习清单」;
  - a record that already existed →「已在待复习清单中，没有重复加入」;
  - no record after the attempt →「没有写入：复习清单已满或本机存储写入失败」. `addReviewItem` (`apps/web/src/personal-data.ts:29-35`) returns `true` without looking at what `saveReviews` returned, so its boolean cannot distinguish a stored record, a duplicate, a capacity refusal and a failed local write; the report therefore states only what the read-back proves. The capacity constant also stays owned by `personal-data`/`reviewListSchema` instead of being mirrored here.
- `reviewIntent(items, session, turn, index)` only decides add versus remove from the stored list: `add` when nothing incomplete exists (a reviewed record does not block a new one), `remove` with the remaining list when an incomplete record exists. Removal filters `interviewId + questionId + !completedAt`, so completed records and other interviews survive.
- UI: the completed report shows one action per QA (`加入复习清单` / `已加入复习清单 · 点击移除`, `aria-pressed`), the bulk button「加入第 N 题复习」is unchanged, and the single `role="status"` message element stays unique and shared by both entries (`tests/e2e/interview.spec.ts:17` locates it by role).
- Interview deletion still clears related reviews through `removeInterviewReviews` in `main.tsx:108`; nothing in this change bypasses it.

## 5. Verification

| Command | Exit | Result |
|---|---|---|
| `pnpm install --frozen-lockfile` | 1 (pre-existing) | Dependencies installed; pnpm 12 exits non-zero only for「Ignored build scripts」(`bun`, `esbuild`, `msgpackr-extract`). `pnpm-lock.yaml` unchanged; `git status` shows no lockfile change. |
| `pnpm typecheck` | 0 | `tsc --noEmit` clean with the new files and test. |
| `pnpm exec vitest run tests/mode-report.test.ts tests/personal-data.test.ts` | 0 | 11 tests passed (9 new, 2 existing review-list tests). |
| `pnpm exec vite build --config apps/web/vite.config.ts` | 0 | Production bundle built; `dist/web/**` is git-ignored and no tracked file changed. |

Not run, with reason: `pnpm build` (its `skill:bundle`/`skill:validate` steps write outside this group's files), `pnpm test` (full suite is outside this group's scope), `pnpm test:e2e` (needs `pnpm dev` and Chrome). No real `.env`, résumé, business database, BOSS site or paid model was read or called; test data is synthetic fixtures only.

## 6. Read-only review rounds

Reviewer: a separate Pi session launched through Orca in this worktree, model `remote-magpie/codex/gpt-6.1-sol` (thinking `high`), terminal handle `term_e26117ed-d0ab-48ca-b034-1824192be4ab`, launch operation `1794666107426-2c43b783bce143e188ff4b1f95d026e9`. The reviewer was read-only and reported problems only. Orca refuses `--model` for `--agent pi`, so the model was selected inside the session with `/model`; the terminal status line showed `remote-magpie/codex/gpt-6.1-sol • high` before the brief was sent.

Round 1 verdict: `CHANGES_REQUIRED`.

| Finding | Severity | Resolution |
|---|---|---|
| A refused insert was still reported as success, because the existing writer ignores its own save result and the new action trusted its boolean | P1 | Fixed. The report now compares the list before and after the attempt (`reviewAddMessage`) and states「没有写入」when nothing was stored. |
| Per-turn provenance was explained as the whole session's start snapshot, which cannot explain a retry that switched connections | P1 | Fixed. `describeFrozenMode` takes a `session` / `turn` scope with wording per row, and the session row now says per-question rows show their own source. |
| The duplicate invariant was checked both before the writer and inside it, and the `blocked` branch was unreachable from the toggle path | P2 | Fixed. The pre-check was removed; `reviewIntent` only decides add versus remove, and the duplicate is reported from the observed post-write list. |
| New tests asserted intent only, and one test name claimed a write it never performed | P2 | Fixed. The misleading case was replaced by direct assertions on `reviewAddMessage` (joined / duplicate / refused-or-failed), plus a scope-wording case. Deduplication at write time stays covered by `tests/personal-data.test.ts`. |
| Command results in this record could not be reproduced by the reviewer | P2 | Accepted as a limitation; the commands, exit codes and observed results are recorded above and were re-run after the fixes. |

Round 2 verdict: `CHANGES_REQUIRED` — static verification of A–C passed (per-turn scope wording, removed pre-check, no new unreachable branch, bulk entry and single `role="status"` still compatible), and only D remained: this record still described a failed write as something the writer's boolean expresses, while `apps/web/src/personal-data.ts:29,34` ignores the save result and returns `true`.

Round 3 verdict: `PASS`. D was corrected in §4 to state that the boolean cannot separate a stored record, a duplicate, a capacity refusal and a failed local write, which is why the report reads the list back; the reviewer confirmed the corrected line matches the code.

Reviewer-observed gaps that stay open and are recorded in §7: React interaction (button synchronisation, storage failure at click time) and independent re-execution of the commands below.

## 7. Not verified / limitations

- Browser behaviour of the new badge and per-question action (desktop and mobile layout, focus order) is not verified in this delivery; only the pure logic and the bundle build are.
- React-level behaviour is not covered by an automated test: the hook's state, the button label synchronisation and a runtime storage failure have unit coverage only for the decisions they call (`reviewIntent`, `reviewAddMessage`), not for a rendered click.
- The bulk entry and per-question action share one `role="status"` message; the per-question button additionally reflects state through its own label. A separate live region per question was rejected to keep `getByRole('status')` unique for the existing browser acceptance spec.
- `preparation-panel.tsx` and `main.tsx` wiring (§3) is a request to their owner; until it lands, the JD preparation page and the header indicator keep their previous inline copy.
