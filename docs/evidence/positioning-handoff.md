# Positioning handoff · delivery record (handoff and preparation group)

Scope: P0-2 / REQ-053, P0-3 / REQ-054, P1-2 / REQ-057. Base branch `hyperMoss/positioning-handoff`, base commit
`df9884db7dec0558b38fdf4ccc6cdeb7cf8ed734`. No push, no merge, no dependency change, no contract change.

Verdict: **implementation complete for REQ-053 and REQ-054, and for the card handoff entries of REQ-057. One REQ-057
acceptance clause is not delivered** — the freeze tag on a frozen delivery version. See §7.1 for the evidence and the
decision that is still open.

## 1. Process identifiers

| Role | Identifier | Model | Result |
|---|---|---|---|
| Development session (this session) | Pi session `01a1da67-5706-727c-9d1c-6fb428936851` | `magpie/auto/deepseek-v4.1-flash` (verified from `PI_PROVIDER` / `PI_MODEL`) | Implemented and verified |
| Read-only review round 1 | recorded in §8 | requested `magpie/remote-magpie/codex/gpt-6.1-sol` | recorded in §8 |

Host toolchain: Node.js `v26.7.0`, pnpm `12.11.2`. Dependency state was materialised by the repository's own scripts;
`pnpm-lock.yaml` is unchanged (`git status` shows no lockfile diff).

## 2. What each requirement now does

### 2.1 REQ-053 · pinned handoff entries with preview confirmation

Files: `apps/web/src/boss-inbox-panel.tsx`, `apps/web/src/boss-inbox.css`.

- The conversation detail now opens with a `带入准备` section (`section.inbox-handoff`) directly below the heading:
  résumé-copy selection, then the two entries `JD 备题` and `模拟面试`. The previous copy lived at the bottom of the
  detail, after the JD, the message log and the focus fields.
- Each entry opens a confirmation modal instead of the old bare `Popconfirm`. The modal shows 岗位, 公司, a bounded JD
  prefix (first 200 characters, with an explicit `共 N 字；带入时按原长度完整带入，不截断。` line), and the selected
  résumé copy, and states that confirming overwrites the unsubmitted inputs of the target page while keeping the
  generated question list, finished interviews and conversation snapshots. Cancelling writes nothing: the modal only
  resets local component state.
- Missing material disables the entry and prints the first blocking reason next to the button:
  missing/too-short/too-long JD (`20–12000`), over-long job title (`120`), no résumé copy selected for the interview
  entry (`模拟面试需要先选择一份简历库副本。`), a still-loading, failed or never-loaded résumé read, a chosen résumé
  below `20` or above `16000` characters (both entries carry the résumé, so both are blocked), and a selected history
  snapshot that is still loading or never loaded — the last one keeps the carried text and the recorded
  `sourceHash` the same snapshot. The same helper produces the entries' disabled state, the modal's blocking list and
  the mutation's precondition, so the invariant is enforced once and displayed once.
- The handoff still carries the untrimmed JD text and the full résumé text; no truncation is introduced anywhere.
- Reused keys only: `interview-intake`, `boss-interview-origin`, `boss-inbox-job`, plus the in-memory
  `preparationRequest` seed in `main.tsx`. No new API call and no new storage key.

### 2.2 REQ-054 · strict-mode copy and post-import interview entry

File: `apps/web/src/preparation-panel.tsx`.

- The copy next to `保存并带入练习` now reads `勾选的题目将以严格模式出现在面试中，题面不会被改写。…`, so the strict /
  original-text semantics are stated at the operation itself. The bank mode is still written as `strict` by
  `usePreparation` in `main.tsx`; that path is unchanged.
- A successful save reports the selected total **and** the number actually inserted in this round
  (`所选 N 道题已保存到题库（本次新增 M 道）。`) and offers `立即开始模拟面试`, which enters interview preparation with
  the same selected bank ids. Previously the notice claimed the selected count only and offered no entry. Generating a
  new question list clears that pending entry, so an entry can never point at a previous question list.
- The panel also states how many résumé characters were carried from the intake draft, because the résumé text is
  carried to practice but is never part of the preparation request itself (`备题生成不发送简历全文`).
- Existing import validation, capacity limits, ownership and rollback behaviour are untouched.

### 2.3 REQ-057 · résumé copy card handoff and freeze tag

Files: `apps/web/src/resume-studio.tsx`, `apps/web/src/main.tsx`.

- Each JSON copy card in `我的副本` now carries two secondary actions, `带入面试` and `带入备题`, next to the existing
  open-card control. Accessible names are `带入面试：<label>` / `带入备题：<label>`, which keeps the list usable by a
  screen reader and keeps the existing editor `用于面试` → `带入面试` selector unambiguous.
- Both actions confirm first. The confirmed action reads the saved copy through the existing
  `GET /resume-drafts/:id` (card summaries omit the document), then refuses text below `20` or above `16000`
  characters with an explicit message instead of truncating; a failure leaves the existing drafts untouched and shows
  the reason in the existing error alert.
- `带入面试` reuses `useResumeForPractice`. `带入备题` uses the new `useResumeForPreparation` in `main.tsx`, which
  patches the existing `interview-intake` value: the résumé text is replaced and the copy's target role prefills the
  preparation role, while an already entered JD and the remaining intake fields are kept. No new key is introduced.
- `PreparationSeed` became `Partial<…>` so a seed can carry just the role. Existing callers pass complete objects and
  are unaffected; the preparation panel already merged seeds over the saved form.

## 3. Facts respected

- JD `20–12000`, résumé `20–16000`, job title `120` are the bounds already enforced by
  `packages/contracts/src/preparation.ts` and `packages/contracts/src/index.ts:10`; this delivery only surfaces them
  before the handoff.
- `career.boss` stays `planned`; no capability was added or promoted, and no spec, contract, generated document or
  README was edited.
- No new API route, no new workspace storage key, no `packages/contracts/**` change.
- No real `.env`, résumé, conversation or model credentials were read; no real BOSS page or paid model was called.

## 4. Deliberate decisions

- The résumé selector moved from the bottom `准备下一步` block up into the pinned handoff section, so the first screen
  holds both the entries and their only required input. The `会话面试简历` accessible name is unchanged.
- Blocking reasons are rendered as visible text rather than a hover-only tooltip, and the modal repeats the full list.
- The preparation panel shows the carried résumé length, because the preparation form itself has no résumé field and
  the handoff would otherwise be invisible.
- `带入备题` from a résumé copy replaces the intake résumé text and prefills the preparation role from the copy's
  target role; an already entered JD and the other intake fields stay. A **confirmed** `带入面试` still replaces the
  whole interview draft, which is what the existing editor flow already did and what the confirmation text now states.

## 5. Verification executed

All commands ran from the repository root.

| Command | Exit | Result |
|---|---|---|
| `pnpm typecheck` | 0 | `tsc --noEmit` clean after every edit round |
| `pnpm build` | 0 | `factory:check`, typecheck, Vite build to `dist/web`, skill bundle and skill validation all passed |
| `pnpm vitest run tests/positioning-handoff.test.ts` | 0 | 5 of 5 new focused tests passed |
| `pnpm vitest run tests/preparation.test.ts tests/boss-inbox.test.ts` | 0 | 12 of 12 existing tests passed |
| `git status --porcelain` | 0 | only the five authorised source files, the new focused test, `docs/evidence/positioning-handoff.md` and `backups/positioning-handoff/**` |

The new test file `tests/positioning-handoff.test.ts` covers five distinct invariants of the handoff decision helper:
a missing JD blocks with a reason that does not promise truncation; practice without a selected copy blocks while
preparation does not; a chosen résumé below the limit blocks both entries; a selected history snapshot that never
loaded blocks both entries; and the JD preview is bounded while the reported length stays complete. The upper résumé
bound shares the same single branch as the lower bound and is not re-tested separately.

## 6. Defense-reduction evidence

- The handoff preconditions were moved into one exported helper (`handoffBlockers`) that now feeds the disabled state,
  the modal list and the mutation guard. The previous implementation had the same checks inline in the mutation only,
  with a different message, plus a separate `disabled` expression on the button.
- The mutation no longer re-fetches `api.resumeDraft` for the selected copy; it reuses the query result that the
  interface already displays, so the invariant is read from a single source.
- No new guard was added on the API or persistence side, and the length/lookup bounds are not re-declared outside the
  contracts that own them (they are referenced by the same numeric limits used for the preview message).

## 7. Not delivered / not verified

### 7.1 Open: the freeze tag on a frozen delivery version (REQ-057)

REQ-057 asks the résumé cards to show a freeze marker on frozen delivery versions. Within the authorised files this is
not implementable without inventing an association:

- `resumeVersionSchema` (`packages/contracts/src/career.ts:243`) has no field pointing back to a JSON copy, and
  `GET /resume-versions` therefore cannot tell `resume-studio.tsx` which copy produced which frozen version.
- Frozen versions are rendered by `apps/web/src/resume-library.tsx` (`投递附件库`), which is not part of this group's
  exclusive file set.
- The only in-scope alternatives are an inferred association (matching the label that `publish` writes, i.e.
  `<copy label> · 修订 <revision>`), which produces false negatives after a rename or later revision and can mislabel a
  hand-uploaded version with the same label, or a contracts/API change, which is outside this authority.

The question was raised with the user during this session (options: extend the write set to `resume-library.tsx` and
add the tag there; infer by label inside `resume-studio.tsx`; or defer). The question was dismissed without a choice,
so nothing was written outside the authorised files and the clause stays open. A reviewer should treat `冻结标记` as an
unmet acceptance clause, not as delivered.

### 7.2 Not verified

- Browser acceptance was not run: `pnpm test:e2e` / `test:e2e:resumes` need `pnpm dev` (API, worker, agent, web) and a
  Chrome profile, and this task does not authorise starting the real stack or touching a real environment file. All
  three existing specs that touch this surface were read and kept compatible by construction:
  `tests/e2e/boss-inbox.spec.ts` (still finds `JD 备题`, `模拟面试`, `确认带入`, `会话面试简历`,
  `将下面的沟通摘要作为备题关注点`), `tests/e2e/resume-studio.spec.ts` (still finds `用于面试` then `带入面试`),
  `tests/e2e/preparation.spec.ts` (still finds one `role="status"` containing `所选 1 道题已保存到题库`).
- Mobile layout of the new handoff section and modal was not observed in a browser; only the CSS for a single-column
  fallback below `800px` was written.
- No screenshot, no performance measurement, no accessibility audit was produced.

## 8. Read-only review

### Round 1 — `magpie / remote-magpie/codex/gpt-6.1-sol`, new Pi session `positioning-handoff-review-1`

Verdict `CHANGES_REQUIRED`: one P1 and three P2 findings. All four were accepted and fixed in this delivery.

| Finding | Severity | Resolution |
|---|---|---|
| A failed history-snapshot read unblocked the handoff while the recorded `sourceHash` was still the selected snapshot, so the carried text and the recorded source could describe different snapshots | P1 | Fixed: `HandoffFacts.snapshotUnavailable` now blocks both entries whenever a snapshot is selected but neither loading nor loaded, with its own reason. Covered by a new focused test. |
| A chosen résumé below `20` characters blocked only the interview entry, not `JD 备题` | P2 | Fixed: the lower bound applies to any chosen résumé, because both entries carry that text; `JD 备题` stays available only while no résumé is chosen. |
| After saving list A and regenerating list B, the `立即开始模拟面试` entry next to B still carried A | P2 | Fixed: a successful generation clears the pending batch entry. |
| This record claimed `带入备题` keeps an already entered target role and only replaces the résumé text, while the code prefills the role from the copy | P2 | Fixed in this record and in the code comment; the behaviour is the intended prefill. |
| The untracked `backups/positioning-handoff/**` copies were in the worktree while the record listed them as temporary | P2 | Accepted as a delivery-state observation: the copies are moved to the trash before delivery and never committed; the committed tree contains none. |

The reviewer independently confirmed with the code that the open freeze-tag clause (§7.1) is genuinely not delivered, that
no API route, storage key, contract or capability state was added, and that the existing e2e locators and the single
`role="status"` on the preparation notice were preserved.

### Round 2 — same reviewer session `positioning-handoff-review-1`, `magpie / remote-magpie/codex/gpt-6.1-sol`

Verdict `PASS` — `无阻塞问题`. The reviewer re-checked the five round-1 items against the working tree and reported no
remaining P1/P2 finding, no new inconsistency between the confirmation copy and the carried content, no duplicated
validation, and no change outside the authorised files.

Review rounds: 2. Reviewer model was verified inside each session output as
`magpie / remote-magpie/codex/gpt-6.1-sol`; no round was served by the development model.

## 9. Change inventory

Modified:

- `apps/web/src/boss-inbox-panel.tsx` — pinned handoff section, bounded JD preview, confirmation modal, single-source
  blocking helper, delete action kept.
- `apps/web/src/boss-inbox.css` — styles for the handoff section, mode column, reason text and preview grid.
- `apps/web/src/preparation-panel.tsx` — strict-mode copy, actual saved count, direct interview entry, carried-résumé
  note, `PreparationSeed` as `Partial`.
- `apps/web/src/resume-studio.tsx` — per-card handoff actions with confirmed read and hard length refusal.
- `apps/web/src/main.tsx` — `useResumeForPreparation` and the `onPreparation` wiring for the résumé studio.

Added:

- `tests/positioning-handoff.test.ts` — focused tests for the handoff decision helper.
- `docs/evidence/positioning-handoff.md` — this record.

Temporary: `backups/positioning-handoff/apps/web/src/**` held the pre-edit copies of the five source files. They were
moved to the trash before delivery and were never committed, so this tree contains no backup or temporary artifact.

Not touched: `packages/**`, `app.spec.yaml`, `docs/generated/**`, `README.md`, other groups' files
(`intake.tsx`, `interview.tsx`, `report-priorities.tsx`, `module-navigation.tsx`, `home-panel.tsx`,
`module-layout.css`, `resume-library.tsx`), `tests/e2e/**` and `.env`.
