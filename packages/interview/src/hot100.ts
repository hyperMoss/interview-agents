import { z } from 'zod';
import snapshot from '../data/hot100.json';
import { hot100MetadataSchema, hot100StatusSchema, type Hot100Status } from '../../contracts/src/hot100';
import { leetcodeBatchSchema } from '../../contracts/src/bank';
import { algorithmPatterns, getAlgorithmPattern } from './algorithm-patterns';
import { hot100Lessons } from './hot100-lessons';

export const hot100Metadata = hot100MetadataSchema.parse(snapshot);
const lessonSchema = z.object({ goal: z.string().min(10), hint: z.string().min(10), patternIds: z.array(z.string()).max(3) });
const patternIds = new Set(algorithmPatterns.map(pattern => pattern.id));
export const hot100Questions = hot100Metadata.questions.map(question => {
  const lesson = lessonSchema.parse(hot100Lessons[question.id]);
  if (lesson.patternIds.some(id => !patternIds.has(id))) throw new Error(`题目 ${question.id} 引用了不存在的套路。`);
  return { ...question, ...lesson, url: `https://leetcode.cn/problems/${question.slug}/` };
});
export type Hot100Question = typeof hot100Questions[number];
export const hot100Groups = [...new Set(hot100Questions.map(question => question.group))];
export function findHot100Question(id: number) {
  return hot100Questions.find(question => question.id === id);
}
export const hot100EntrySchema = z.object({
  questionId: z.number().int().positive().refine(id => Boolean(findHot100Question(id)), '未知 Hot 100 题号'),
  code: z.string().max(12000), notes: z.string().max(3000), status: hot100StatusSchema,
});
export type Hot100Entry = z.infer<typeof hot100EntrySchema>;
export const hot100FilterSchema = z.object({
  query: z.string().max(200).default(''), group: z.string().max(80).default('all'),
  difficulty: z.enum(['all', 'easy', 'medium', 'hard']).default('all'),
  status: z.enum(['all', 'todo', 'doing', 'reviewed']).default('all'),
});
export type Hot100Filter = z.infer<typeof hot100FilterSchema>;
export const hot100StatusLabels: Record<Hot100Status, string> = { todo: '待练习', doing: '练习中', reviewed: '已复习' };
export function getHot100Entry(entries: Hot100Entry[], questionId: number): Hot100Entry {
  return entries.find(entry => entry.questionId === questionId) ?? { questionId, code: '', notes: '', status: 'todo' };
}
export function filterHot100(filters: Hot100Filter, entries: Hot100Entry[] = []) {
  const query = filters.query.trim().toLocaleLowerCase();
  return hot100Questions.filter(question =>
    (filters.group === 'all' || question.group === filters.group)
    && (filters.difficulty === 'all' || question.difficulty === filters.difficulty)
    && (filters.status === 'all' || getHot100Entry(entries, question.id).status === filters.status)
    && (!query || `${question.id} ${question.title} ${question.slug} ${question.group} ${question.tags.join(' ')} ${question.goal} ${question.patternIds.join(' ')} ${question.patternIds.map(id => getAlgorithmPattern(id).title).join(' ')}`.toLocaleLowerCase().includes(query)));
}
export function nextHot100Question(questions: Hot100Question[], entries: Hot100Entry[], afterId: number) {
  const index = questions.findIndex(question => question.id === afterId);
  const ordered = [...questions.slice(index + 1), ...questions.slice(0, Math.max(0, index))];
  return ordered.find(question => question.id !== afterId && getHot100Entry(entries, question.id).status !== 'reviewed');
}
export function hot100Brief(question: Hot100Question) {
  return `Hot 100 学习摘要（本项目原创，并非官方完整题面）\n${question.goal}\n\n请先在原题中核对输入输出、限制和示例：${question.url}`;
}
export function exportHot100Bank(questions: Hot100Question[]) {
  return leetcodeBatchSchema.parse({ questions: questions.map(question => ({
    slug: question.slug, region: 'cn', title: `${question.id}. ${question.title}`, content: hot100Brief(question),
    category: 'coding', difficulty: question.difficulty, roleFamilies: ['general'],
    tags: ['Hot100', question.group, ...question.tags].filter((tag, index, tags) => tags.indexOf(tag) === index).slice(0, 12),
    expectedAnswer: `练习提示：${question.hint}\n完整条件与提交判题以原题为准。`,
  })) });
}
