import type { z } from 'zod';
import { algorithmDraftSchema } from '../../../packages/contracts/src/workspace';
import { defaultAlgorithmPattern, getAlgorithmPattern } from '../../../packages/interview/src/algorithm-patterns';
import { findHot100Question } from '../../../packages/interview/src/hot100';
import { readDraftValue } from './storage';

export { drillKindSchema } from '../../../packages/contracts/src/workspace';
export type AlgorithmDraft = z.infer<typeof algorithmDraftSchema>;
export type DrillTarget = Omit<AlgorithmDraft['drills'][number], 'typed'>;
export const algorithmDraftKey = 'algorithm-practice-v1';

export function defaultAlgorithmDraft(): AlgorithmDraft {
  return {
    version: 1,
    problem: defaultAlgorithmPattern.example.statement,
    origin: { kind: 'example', title: defaultAlgorithmPattern.example.title, patternId: defaultAlgorithmPattern.id },
    patternId: defaultAlgorithmPattern.id,
    kind: 'code',
    codeSource: 'pattern',
    questionCodeStyle: 'concise',
    drills: [],
  };
}

export function restoreAlgorithmDraft() {
  let raw: string | null;
  try { raw = readDraftValue(algorithmDraftKey); }
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

export function getAlgorithmDrillTarget(draft: AlgorithmDraft): DrillTarget {
  const origin = draft.origin;
  const question = origin.kind === 'hot100' && draft.codeSource === 'question' ? findHot100Question(origin.id) : undefined;
  if (draft.kind === 'code') {
    return question
      ? draft.questionCodeStyle === 'annotated'
        ? { key: `hot100-python-annotated:${question.id}`, kind: 'code', reference: question.annotatedCode }
        : { key: `hot100-python:${question.id}`, kind: 'code', reference: question.referenceCode }
      : { key: `python:${draft.patternId}`, kind: 'code', reference: getAlgorithmPattern(draft.patternId).code };
  }
  const key = origin.kind === 'bank' ? `bank:${origin.id}` : origin.kind === 'hot100' ? `hot100:${origin.id}` : origin.kind === 'example' ? `example:${origin.patternId}` : 'custom';
  return { key, kind: 'statement', reference: draft.problem };
}
