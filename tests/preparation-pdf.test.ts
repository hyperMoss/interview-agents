import { describe, expect, it } from 'vitest';
import { preparationPdfSchema, type PreparationInput, type PreparationResult } from '../packages/contracts/src/preparation';
import { preparationPdfHtml } from '../packages/interview/src/preparation-pdf';
import { demoPreparation } from '../apps/agent/src/preparation';
const preparationInput:PreparationInput={role:'前端工程师',jobDescription:'熟悉 React 与 TypeScript，负责复杂页面状态与性能优化。优先考虑熟悉自动化测试的候选人。',candidateLevel:'new_grad',round:'first',roleType:'technical',roleFamily:'frontend',questionCount:6,focus:'请求竞争与状态管理'};

describe('JD PDF export snapshot', () => {
  const result:PreparationResult = { ...demoPreparation(preparationInput), modelMode: 'demo', model: 'rules-demo-v1' };
  it('preserves edited notes, Unicode and every question while escaping all user HTML', () => {
    const drafts = result.questions.map((question, index) => ({ title: question.title, content: question.text, expectedAnswer: `第${index + 1}题原文\n\n<script>fetch("https://untrusted.invalid")</script>` }));
    const html = preparationPdfHtml({ input: preparationInput, result, drafts });
    expect(html).toContain('第6题原文');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('规则演示题单');
    expect(html).toContain('优先考虑');
    expect(html).toContain('size:A4');
  });
  it('refuses mismatched counts and unbounded export bodies', () => {
    expect(preparationPdfSchema.safeParse({ input: preparationInput, result }).success).toBe(true);
    expect(preparationPdfSchema.safeParse({ input: preparationInput, result, drafts: [] }).success).toBe(false);
    expect(preparationPdfSchema.safeParse({ input: { ...preparationInput, questionCount: 3 }, result }).success).toBe(false);
    const drafts = result.questions.map(question => ({ title: question.title, content: question.text, expectedAnswer: '超'.repeat(8001) }));
    expect(preparationPdfSchema.safeParse({ input: preparationInput, result, drafts }).success).toBe(false);
  });
});
