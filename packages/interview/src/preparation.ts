import { preparationOutputSchema, preparedBankDraftSchema, type PreparationInput, type PreparationOutput, type PreparationResult } from '../../contracts/src/preparation';
import type { BankDraft } from '../../contracts/src/bank';
import { candidateDifficulty } from './planner';

export function preparationDifficulty(input: PreparationInput) {
  return candidateDifficulty(input);
}

export function validatePreparation(input: PreparationInput, raw: unknown): PreparationOutput {
  const output = preparationOutputSchema.parse(raw);
  if (output.questions.length !== input.questionCount) throw new Error('PREPARATION_COUNT_MISMATCH');
  if (output.requirements.some(requirement => !input.jobDescription.includes(requirement.quote))) throw new Error('PREPARATION_UNGROUNDED');
  const referenced = new Set(output.questions.map(question => question.requirementIndex));
  if (output.requirements.some((_, index) => !referenced.has(index)) || [...referenced].some(index => !output.requirements[index])) throw new Error('PREPARATION_REQUIREMENT_MISMATCH');
  if (new Set(output.questions.map(question => question.text.replace(/\s+/g, '').toLowerCase())).size !== output.questions.length) throw new Error('PREPARATION_DUPLICATE_QUESTION');
  if (output.questions.some(question => question.difficulty !== preparationDifficulty(input))) throw new Error('PREPARATION_DIFFICULTY_MISMATCH');
  const category = input.round === 'hr' || input.roleType === 'nontechnical' ? 'behavioral' : 'technical';
  if (output.questions.some(question => question.category !== category)) throw new Error('PREPARATION_CATEGORY_MISMATCH');
  return output;
}

export function preparationBankDraft(input: PreparationInput, question: PreparationOutput['questions'][number], requirements: PreparationOutput['requirements']) {
  const requirement = requirements[question.requirementIndex];
  if (!requirement) throw new Error('PREPARATION_REQUIREMENT_MISMATCH');
  return preparedBankDraftSchema.parse({
    title: question.title, content: question.text, category: question.category, difficulty: question.difficulty,
    roleFamilies: [input.roleFamily], tags: ['JD备题'],
    expectedAnswer: [...question.answerOutline.map(item => `- ${item}`), '', '追问', ...question.followUps.map(item => `- ${item}`)].join('\n'),
    jdRequirement: requirement,
  });
}

export function preparationMarkdown(input: PreparationInput, result: PreparationResult, drafts?: BankDraft[]) {
  return [
    `# ${input.role}备题单`, '', `生成模式：${result.modelMode === 'demo' ? '规则演示，需自行校核' : result.model}`,
    '', '## 岗位要求', ...result.requirements.map((requirement, index) => `\n${index + 1}. ${requirement.competency} · ${requirement.priority === 'required' ? '必备' : '加分'}\n\n> ${requirement.quote.replace(/\n/g, '\n> ')}`),
    '', '## 面试题', ...result.questions.map((question, index) => [
      '', `### ${index + 1}. ${drafts?.[index]?.title ?? question.title}`, '', drafts?.[index]?.content ?? question.text, '', `对应要求：${question.requirementIndex + 1} · ${question.difficulty}`, '',
      ...(drafts?.[index] ? ['回答要点与追问', drafts[index].expectedAnswer] : ['回答要点', ...question.answerOutline.map(item => `- ${item}`), '', '追问', ...question.followUps.map(item => `- ${item}`)]),
    ].join('\n')), '', '回答要点用于准备思路，不代表候选人已有经历。',
  ].join('\n');
}
