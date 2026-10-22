import { z } from 'zod';
import { defaultAlgorithmPattern, getAlgorithmPattern } from '../../../packages/interview/src/algorithm-patterns';

const originSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('example'), title: z.string().max(200), patternId: z.string().max(80) }),
  z.object({ kind: z.literal('bank'), title: z.string().max(200), id: z.uuid() }),
  z.object({ kind: z.literal('hot100'), title: z.string().max(200), id: z.number().int().positive() }),
  z.object({ kind: z.literal('custom'), title: z.string().max(200) }),
]);
export const drillKindSchema = z.enum(['statement', 'code']);
const targetSchema = z.object({
  key: z.string().max(150),
  kind: drillKindSchema,
  reference: z.string().max(14000),
});
const drillSchema = targetSchema.extend({ typed: z.string().max(30000) });
const algorithmDraftSchema = z.object({
  version: z.literal(1),
  problem: z.string().max(14000),
  origin: originSchema,
  patternId: z.string().max(80),
  kind: drillKindSchema,
  drills: z.array(drillSchema).max(20),
});
export type AlgorithmDraft = z.infer<typeof algorithmDraftSchema>;
export type DrillTarget = z.infer<typeof targetSchema>;
export const algorithmDraftKey = 'algorithm-practice-v1';

export function defaultAlgorithmDraft(): AlgorithmDraft {
  return {
    version: 1,
    problem: defaultAlgorithmPattern.example.statement,
    origin: { kind: 'example', title: defaultAlgorithmPattern.example.title, patternId: defaultAlgorithmPattern.id },
    patternId: defaultAlgorithmPattern.id,
    kind: 'code',
    drills: [],
  };
}

export function restoreAlgorithmDraft() {
  let raw: string | null;
  try { raw = sessionStorage.getItem(algorithmDraftKey); }
  catch { return { draft: defaultAlgorithmDraft(), warning: '当前浏览器无法读取草稿，刷新前请复制需要保留的练习。' }; }
  if (!raw) return { draft: defaultAlgorithmDraft(), warning: '' };
  try {
    if (raw.length > 1_500_000) throw new Error('草稿过大');
    const draft = algorithmDraftSchema.parse(JSON.parse(raw));
    return { draft: { ...draft, patternId: getAlgorithmPattern(draft.patternId).id }, warning: '' };
  } catch {
    return { draft: defaultAlgorithmDraft(), warning: '旧草稿无法恢复，已打开内置例题。' };
  }
}

export function sameDrill(a: DrillTarget, b: DrillTarget) {
  return a.key === b.key && a.kind === b.kind && a.reference === b.reference;
}

export function recordTyping(draft: AlgorithmDraft, target: DrillTarget, typed: string): AlgorithmDraft {
  const others = draft.drills.filter(drill => !sameDrill(drill, target));
  return { ...draft, drills: [...others, { ...target, typed }].slice(-20) };
}
