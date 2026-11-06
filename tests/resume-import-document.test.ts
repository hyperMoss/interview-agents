import { expect, it } from 'vitest';
import { resumeFromText, resumeText } from '../packages/resume/src/import';
import { parseResumeDocument } from '../packages/contracts/src/resume-document';
import { parseRoute, routeHash } from '../apps/web/src/navigation';

it('converts extracted text to valid JSON without guessing missing experience', () => {
  const text = '姓名：合成测试用户\n目标岗位：前端工程师\n参与示例项目，负责 React 页面与接口联调。\n不能识别的栏目 🧪';
  const document = resumeFromText({ filename: 'sample.txt', text, warnings: ['请核对排版'] });
  expect(parseResumeDocument(document)).toEqual(document);
  expect(document.name).toBe('合成测试用户');
  expect(document.title).toBe('前端工程师');
  expect(document.work).toEqual([]);
  expect(document.importSource).toEqual({ filename: 'sample.txt', text, warnings: ['请核对排版'], status: 'needs_review' });
  expect(resumeText(document)).toContain('不能识别的栏目 🧪');
  expect(resumeFromText({ filename: 'x.md', text: '一段没有字段标签的经历', warnings: [] }).name).toBe('');
});
it('keeps interview history distinct from session deep links', () => {
  expect(parseRoute(routeHash({ page: 'history' }))).toEqual({ page: 'history' });
  expect(parseRoute('#/interviews/new')).toEqual({ page: 'practice' });
});
