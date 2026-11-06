import { z } from 'zod';
import { careerGreetingSchema, careerGenerationSourcesSchema, careerMatchReceiptSchema, jdSourceRefSchema, resumeSourceRefSchema, type CareerGenerationSources, type CareerSourceRef } from '../../contracts/src/career';
import { personalizedPreparationOutputSchema, type PersonalizedPreparationInput, type PersonalizedPreparationOutput } from '../../contracts/src/preparation';
import { candidateDifficulty } from '../../interview/src/planner';

// Cross-source provenance validation. Quotes prove grounding in the exact immutable sources,
// not the truth of free prose; callers must keep the candidate in review.

export { careerGenerationSourcesSchema };
export type { CareerGenerationSources };

export class ProvenanceError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`);
  }
}

function assertRef(ref: CareerSourceRef, sources: CareerGenerationSources) {
  if (ref.start >= ref.end) throw new ProvenanceError('PROVENANCE_RANGE', `${ref.kind} range ${ref.start}-${ref.end}`);
  if (ref.kind === 'jd') {
    if (ref.snapshotHash !== sources.postingSnapshotHash) throw new ProvenanceError('PROVENANCE_JD_HASH', 'JD hash mismatch');
    if (ref.end > sources.jdText.length) throw new ProvenanceError('PROVENANCE_RANGE', 'JD end beyond snapshot');
    if (sources.jdText.slice(ref.start, ref.end) !== ref.quote) throw new ProvenanceError('PROVENANCE_JD_QUOTE', `JD quote not verbatim at ${ref.start}`);
    return;
  }
  if (ref.resumeVersionId !== sources.resumeVersionId) throw new ProvenanceError('PROVENANCE_RESUME_VERSION', 'Resume version mismatch');
  if (ref.resumeTextHash !== sources.resumeTextHash) throw new ProvenanceError('PROVENANCE_RESUME_HASH', 'Resume text hash mismatch');
  if (ref.end > sources.resumeText.length) throw new ProvenanceError('PROVENANCE_RANGE', 'Resume end beyond text');
  if (sources.resumeText.slice(ref.start, ref.end) !== ref.quote) throw new ProvenanceError('PROVENANCE_RESUME_QUOTE', `Resume quote not verbatim at ${ref.start}`);
}

export function validateSourceRefs(refs: CareerSourceRef[], sources: CareerGenerationSources) {
  for (const ref of refs) assertRef(ref, sources);
}

/** Posting JD hash must match the immutable posting snapshot hash used by the batch. */
export function validateJdSnapshot(sources: CareerGenerationSources, snapshotHash: string) {
  if (snapshotHash !== sources.postingSnapshotHash) throw new ProvenanceError('PROVENANCE_SNAPSHOT', 'Posting snapshot hash mismatch');
}

export function validateMatchReceipt(sources: CareerGenerationSources, raw: unknown) {
  const receipt = careerMatchReceiptSchema.parse(raw);
  for (const assessment of receipt.match.assessments) {
    validateSourceRefs([...assessment.jdSources, ...(assessment.kind === 'supported' ? assessment.resumeSources : [])], sources);
    if (assessment.kind === 'supported' && assessment.priority === 'required' && !assessment.resumeSources.length) throw new ProvenanceError('PROVENANCE_SUPPORT', 'Supported requirement without resume evidence');
  }
  validateSourceRefs(receipt.match.aiApplication.jdSources, sources);
  for (const claim of receipt.greeting.factualClaims) {
    validateSourceRefs([...claim.resumeSources, ...claim.jdSources], sources);
  }
  const greeting = careerGreetingSchema.parse(receipt.greeting);
  if (/https?:\/\/|@[a-z0-9.-]+\.[a-z]{2,}|1[3-9]\d{9}/i.test(greeting.text)) throw new ProvenanceError('PROVENANCE_CONTACT', 'Greeting contains contact details');
  if (/随时到岗|随时入职|期望薪资|薪资要求|最低\s*\d+\s*[kK]/.test(greeting.text)) throw new ProvenanceError('PROVENANCE_COMMITMENT', 'Greeting contains availability or salary commitment');
  if (receipt.match.modelAttribution.connectionId !== receipt.greeting.modelAttribution.connectionId) throw new ProvenanceError('PROVENANCE_ATTRIBUTION', 'Mismatched model attribution');
  return receipt;
}

function jdRef(ref: z.infer<typeof jdSourceRefSchema>) {
  return jdSourceRefSchema.parse(ref);
}

export function validatePersonalizedPreparation(input: PersonalizedPreparationInput, sources: CareerGenerationSources, raw: unknown): PersonalizedPreparationOutput {
  const output = personalizedPreparationOutputSchema.parse(raw);
  if (output.questions.length !== 10) throw new ProvenanceError('PREPARATION_COUNT', 'Exactly ten questions are required');
  if (sources.resumeVersionId !== input.resume.versionId || sources.resumeTextHash !== input.resume.textHash) throw new ProvenanceError('PROVENANCE_RESUME_HASH', 'Input resume identity differs from resolved source');
  if (sources.postingSnapshotHash !== input.jd.snapshotHash) throw new ProvenanceError('PROVENANCE_JD_HASH', 'Input JD identity differs from resolved source');
  if (sources.jdText !== input.jd.text || sources.resumeText !== input.resume.text) throw new ProvenanceError('PROVENANCE_SOURCE_TEXT', 'Resolved source text differs from input text');
  const difficulty = candidateDifficulty({ candidateLevel: input.candidateLevel, round: input.round });
  const category = input.round === 'hr' || input.roleType === 'nontechnical' ? 'behavioral' : 'technical';
  const requirementReferenced = new Set<number>();
  for (const question of output.questions) {
    if (question.difficulty !== difficulty) throw new ProvenanceError('PREPARATION_DIFFICULTY', 'Difficulty mismatch');
    if (question.category !== category) throw new ProvenanceError('PREPARATION_CATEGORY', 'Category mismatch');
    if (!output.requirements[question.requirementIndex]) throw new ProvenanceError('PREPARATION_REQUIREMENT', `Unknown requirement ${question.requirementIndex}`);
    requirementReferenced.add(question.requirementIndex);
    if (!input.jd.text.includes(output.requirements[question.requirementIndex]?.quote ?? '')) throw new ProvenanceError('PREPARATION_UNGROUNDED', 'Requirement quote missing from JD');
    validateSourceRefs([...question.jdSources.map(jdRef), ...(question.basis.kind === 'resume_evidence' ? question.basis.resumeSources.map(ref => resumeSourceRefSchema.parse(ref)) : [])], sources);
    if (question.purpose === 'resume_project' && question.basis.kind !== 'resume_evidence') throw new ProvenanceError('PREPARATION_PROJECT_UNGROUNDED', 'Project probing requires resume evidence');
    if (question.purpose === 'skill_gap' && question.basis.kind !== 'gap') throw new ProvenanceError('PREPARATION_GAP_LABEL', 'Skill-gap question must be labeled as a gap');
  }
  if (output.requirements.some((_, index) => !requirementReferenced.has(index))) throw new ProvenanceError('PREPARATION_REQUIREMENT', 'Every requirement must be referenced');
  if (new Set(output.questions.map(question => question.text.replace(/\s+/g, '').toLowerCase())).size !== output.questions.length) throw new ProvenanceError('PREPARATION_DUPLICATE', 'Duplicate questions');
  return output;
}

export function validateEditedQuestionSources(edited: { jdSources: unknown[]; basis: { kind: string; resumeSources?: unknown[] } }, sources: CareerGenerationSources) {
  const jd = edited.jdSources.map(ref => jdSourceRefSchema.parse(ref));
  const resume = edited.basis.kind === 'resume_evidence' ? (edited.basis.resumeSources ?? []).map(ref => resumeSourceRefSchema.parse(ref)) : [];
  validateSourceRefs([...jd, ...resume], sources);
}
