import type { CareerStore } from '../../../packages/career/src/store';
import type { QuestionBank } from './bank';
import { deleteInterviewSessions } from './interview-deletion';

/** Personal records derived from career sources live outside the career tables: the owner bank keeps
 *  the resume/preparation provenance on saved questions, and strict interviews froze those questions
 *  in their materials. Both are removed through the existing bank and interview deletion boundaries
 *  (which queue runtime receipt purges) before the career cascade, so a later failure cannot leave a
 *  derived personal copy without an owner-visible record. Unrelated versions, JD-only questions and
 *  other interviews are untouched. */
export async function deleteCareerDerivedPersonalData(
  store: CareerStore,
  bank: QuestionBank,
  owner: string,
  sources: { resumeVersionId?: string; preparationIds: string[] },
) {
  const impact = await store.derivedPersonalData(owner, sources);
  await bank.removeCareerDerived(owner, impact.bankQuestionIds);
  await deleteInterviewSessions(store.pool, owner, impact.interviewSessionIds);
  return impact;
}
