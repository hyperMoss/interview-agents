import { Button } from '@astryxdesign/core/Button';
import type { InterviewHistoryPage } from '../../../packages/contracts/src/history';
import type { Route } from './navigation';
import { readSession } from './storage';
import type { SourceState } from './journey-map';

/** The JD preparation page stores its form plus an unsubmitted question draft under this existing key. */
const preparationKey = 'jd-preparation-v1';

function cardUnsaved(card: unknown) {
  const savedId = (card as { savedId?: string | null } | null)?.savedId;
  return savedId === null || savedId === undefined;
}

/** Unreadable or unrecognisable draft content counts as an active draft so onboarding never hides real work. */
export function hasUnsubmittedPreparationDraft(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    const draft = (JSON.parse(raw) as { draft?: unknown } | null)?.draft;
    if (draft === null || draft === undefined) return false;
    const cards = (draft as { cards?: unknown }).cards;
    if (!Array.isArray(cards)) return true;
    return cards.some(cardUnsaved);
  } catch { return true; }
}

/** Both sources must have loaded successfully and be empty; pending, failed, non-empty data or an active draft suppresses onboarding. */
export function shouldShowOnboarding(input: { interviews: SourceState<InterviewHistoryPage>; resumes: SourceState<unknown[]>; preparationDraft: boolean; intakeDraft: boolean }): boolean {
  if (input.preparationDraft || input.intakeDraft) return false;
  if (input.interviews.status !== 'ready' || input.resumes.status !== 'ready') return false;
  return input.interviews.value.items.length === 0 && input.resumes.value.length === 0;
}

export function OnboardingPanel({ interviews, resumes, navigate }: { interviews: SourceState<InterviewHistoryPage>; resumes: SourceState<unknown[]>; navigate: (route: Route) => void }) {
  const preparationDraft = hasUnsubmittedPreparationDraft(readSession(preparationKey));
  const intakeDraft = readSession('interview-intake') !== null;
  if (!shouldShowOnboarding({ interviews, resumes, preparationDraft, intakeDraft })) return null;
  return <section className="onboarding-panel" aria-labelledby="onboarding-title">
    <h2 id="onboarding-title">你想从哪里开始？</h2>
    <p>面试历史与简历库都还是空的。三条入口都不会自动创建记录，也不会调用模型。</p>
    <div className="onboarding-options">
      <Button variant="primary" label="我已有目标 JD，直接备题" onClick={() => navigate({ page: 'preparation' })} />
      <Button label="我需要先找岗位" onClick={() => navigate({ page: 'career' })} />
      <Button label="先体验模拟面试" onClick={() => navigate({ page: 'practice' })} />
    </div>
  </section>;
}
