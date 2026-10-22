import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { filterHot100, findHot100Question, hot100FilterSchema, hot100Groups, hot100Metadata, exportHot100Bank } from '../packages/interview/src/hot100';
import { getAlgorithmPattern } from '../packages/interview/src/algorithm-patterns';

export function runAlgorithmCommand(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: {
    group: { type: 'string' }, difficulty: { type: 'string' }, query: { type: 'string' }, hint: { type: 'boolean', default: false },
  } });
  const [command = 'list', id, ...extra] = positionals;
  if (extra.length || (command !== 'show' && id)) throw new Error('多余的位置参数。用 list、show 题号 或 export-bank。');
  if (command === 'show') {
    if (!id || !/^\d+$/.test(id)) throw new Error('show 后需要 Hot 100 题号，例如 show 1。');
    const question = findHot100Question(Number(id));
    if (!question) throw new Error('该题号不在当前 Hot 100 快照中。');
    return { source: hot100Metadata.source, question: { ...question, hint: values.hint ? question.hint : undefined }, routines: question.patternIds.map(patternId => {
      const pattern = getAlgorithmPattern(patternId);
      return values.hint ? pattern : { id: pattern.id, title: pattern.title };
    }) };
  }
  const filters = hot100FilterSchema.parse({ group: values.group, difficulty: values.difficulty, query: values.query });
  if (filters.group !== 'all' && !hot100Groups.includes(filters.group)) throw new Error(`专题不存在。可选：${hot100Groups.join('、')}`);
  const questions = filterHot100(filters);
  if (command === 'export-bank') {
    if (!questions.length) throw new Error('当前筛选无题目，不能导出空题库。');
    return exportHot100Bank(questions);
  }
  if (command !== 'list') throw new Error('使用 list、show 题号 或 export-bank。');
  return { source: hot100Metadata.source, total: 100, matched: questions.length, groups: hot100Groups,
    questions: questions.map(question => ({ id: question.id, title: question.title, group: question.group, difficulty: question.difficulty, url: question.url })) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(runAlgorithmCommand(process.argv.slice(2)), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : '题单命令失败'}\n`); process.exitCode = 1; }
}
