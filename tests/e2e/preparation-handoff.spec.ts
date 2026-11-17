import { expect, test, type Page } from '@playwright/test';
import { navigateModule } from './ui-helpers';

const role = '前端工程师';
const resume = '合成测试经历：负责 React 页面与接口联调，并通过自动化测试验证状态恢复、请求竞争与错误提示。';
const jd = '岗位职责：负责 React 页面的状态管理、接口联调与性能优化。任职要求：能解释自动化测试如何验证请求竞争。';
const otherJd = '岗位职责：负责 Node.js 接口与数据库设计，维护任务队列。任职要求：能解释事务边界与接口幂等。';
const dialogName = '先根据 JD 备题？';

async function atDetails(page: Page) {
  await page.goto('/#/interviews/new');
  await expect(page.getByRole('heading', { name: '准备练习资料', exact: true })).toBeVisible();
}
async function fillDetails(page: Page, jobDescription = jd) {
  await page.getByLabel('目标岗位', { exact: true }).fill(role);
  await page.getByRole('textbox', { name: '简历与项目经历', exact: true }).fill(resume);
  await page.getByRole('textbox', { name: '岗位描述 / JD', exact: true }).fill(jobDescription);
}
async function nextStep(page: Page) {
  await page.getByRole('button', { name: '下一步', exact: true }).click();
}
async function chooseBank(page: Page, title: string) {
  const checkbox = page.getByRole('checkbox', { name: title, exact: true });
  if (!(await checkbox.isVisible())) await page.getByText('高级选项 · 选择题库与联网资料', { exact: true }).click();
  await checkbox.check();
  await expect(checkbox).toBeChecked();
  return checkbox;
}

test('valid details offer JD preparation once, keep the draft on cancel, and remember the skip across refresh', async ({ page }) => {
  await atDetails(page);
  await nextStep(page);
  await expect(page.getByRole('alert').filter({ hasText: '岗位需 2 至 120 字。' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: dialogName })).not.toBeVisible();

  await fillDetails(page);
  await nextStep(page);
  const dialog = page.getByRole('dialog', { name: dialogName });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { name: '准备练习资料', exact: true })).toBeVisible();
  await expect(page.getByLabel('目标岗位', { exact: true })).toHaveValue(role);
  await expect(page.getByRole('textbox', { name: '岗位描述 / JD', exact: true })).toHaveValue(jd);

  await nextStep(page);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel('目标岗位', { exact: true })).toHaveValue(role);

  await nextStep(page);
  await dialog.getByRole('button', { name: '直接继续', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认面试安排', exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('heading', { name: '确认面试安排', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await nextStep(page);
  await expect(page.getByRole('heading', { name: '确认面试安排', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: dialogName })).not.toBeVisible();

  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await page.getByRole('textbox', { name: '岗位描述 / JD', exact: true }).fill(otherJd);
  await nextStep(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '岗位描述 / JD', exact: true })).toHaveValue(otherJd);
  await expect(page.getByRole('heading', { name: '准备练习资料', exact: true })).toBeVisible();
});

test('opening JD preparation only carries the material and never starts a billed generation', async ({ page }) => {
  const generationRequests: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' && request.url().includes('/api/v1/preparations/generate')) generationRequests.push(request.url()); });
  await atDetails(page);
  await fillDetails(page);
  await nextStep(page);
  await page.getByRole('dialog', { name: dialogName }).getByRole('button', { name: '先备题', exact: true }).click();
  await expect(page.getByLabel('备题岗位', { exact: true })).toHaveValue(role);
  await expect(page.getByRole('textbox', { name: '备题 JD', exact: true })).toHaveValue(jd);
  await expect(page.getByRole('button', { name: '根据 JD 生成题单', exact: true })).toBeVisible();
  expect(generationRequests).toEqual([]);

  await navigateModule(page, '面试准备');
  await expect(page.getByRole('heading', { name: '准备练习资料', exact: true })).toBeVisible();
  await expect(page.getByLabel('目标岗位', { exact: true })).toHaveValue(role);
  await expect(page.getByRole('textbox', { name: '简历与项目经历', exact: true })).toHaveValue(resume);
  await expect(page.getByRole('textbox', { name: '岗位描述 / JD', exact: true })).toHaveValue(jd);
  await nextStep(page);
  await expect(page.getByRole('heading', { name: '确认面试安排', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: dialogName })).not.toBeVisible();
});

test('selected questions continue without a prompt, survive a refresh, and are re-judged after the JD changes', async ({ page }) => {
  await atDetails(page);
  await fillDetails(page);
  await nextStep(page);
  await page.getByRole('dialog', { name: dialogName }).getByRole('button', { name: '直接继续', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认面试安排', exact: true })).toBeVisible();

  const title = '状态管理与请求竞争验证';
  const question = {
    requestId: crypto.randomUUID(),
    draft: {
      title, content: '请结合你亲自实现的页面，说明如何防止旧请求覆盖新请求，并给出自动化验证步骤。',
      category: 'technical', difficulty: 'medium', roleFamilies: ['frontend', 'fullstack', 'backend'], tags: ['JD备题'],
      expectedAnswer: '先定义有效请求，再验证乱序响应不会覆盖当前结果。',
      jdRequirement: { competency: '状态管理', priority: 'required', quote: '能解释自动化测试如何验证请求竞争。' },
    },
  };
  const origin = new URL(page.url()).origin;
  const imported = await page.request.post('/api/v1/question-bank/import/preparation', { headers: { Origin: origin }, data: { questions: [question] } });
  expect(imported.ok()).toBe(true);
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: '确认面试安排', exact: true })).toBeVisible();
    await chooseBank(page, title);

    await page.reload();
    await expect(page.getByRole('heading', { name: '确认面试安排', exact: true })).toBeVisible();
    await chooseBank(page, title);
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    await nextStep(page);
    await expect(page.getByRole('heading', { name: '确认面试安排', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: dialogName })).not.toBeVisible();
    await chooseBank(page, title);

    await page.getByRole('button', { name: '上一步', exact: true }).click();
    await page.getByRole('textbox', { name: '岗位描述 / JD', exact: true }).fill(otherJd);
    await nextStep(page);
    const dialog = page.getByRole('dialog', { name: dialogName });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '直接继续', exact: true }).click();
    await chooseBank(page, title);
  } finally {
    await page.request.delete(`/api/v1/question-bank/${question.requestId}`, { headers: { Origin: origin } });
  }
});

test('a carried strict question list continues without prompting and is re-judged only after the JD changes', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Missing test base URL');
  const origin = new URL(baseURL).origin;
  await page.request.get('/api/v1/identity');
  const title = '严格题单中的状态管理题';
  const question = {
    requestId: crypto.randomUUID(),
    draft: {
      title, content: '说明严格题单中这道题如何验证旧请求不会覆盖新请求。',
      category: 'technical', difficulty: 'medium', roleFamilies: ['frontend', 'fullstack'], tags: ['JD备题'],
      expectedAnswer: '定义有效请求并以自动化测试验证乱序响应。',
      jdRequirement: { competency: '状态管理', priority: 'required', quote: '能解释自动化测试如何验证请求竞争。' },
    },
  };
  const imported = await page.request.post('/api/v1/question-bank/import/preparation', { headers: { Origin: origin }, data: { questions: [question] } });
  expect(imported.ok()).toBe(true);
  try {
    const seeded = JSON.stringify({
      role, resume, jobDescription: jd, level: 'mid', questionCount: 6, focus: '', step: 0,
      planning: {
        durationMinutes: 20, answerLength: 'medium', candidateLevel: 'new_grad', round: 'first',
        practiceMode: 'candidate', roleType: 'technical', roleFamily: 'fullstack',
        codingRequested: false, bankMode: 'strict', bankIds: [question.requestId],
      },
    });
    await page.addInitScript(value => {
      if (sessionStorage.getItem('preparation-handoff-seeded')) return;
      sessionStorage.setItem('preparation-handoff-seeded', '1');
      sessionStorage.setItem('interview-intake', value);
    }, seeded);
    await page.goto('/#/interviews/new');
    await expect(page.getByLabel('目标岗位', { exact: true })).toHaveValue(role);
    await nextStep(page);
    await expect(page.getByRole('heading', { name: '确认面试安排', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: dialogName })).not.toBeVisible();
    await chooseBank(page, title);

    await page.reload();
    await expect(page.getByRole('heading', { name: '确认面试安排', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '上一步', exact: true }).click();
    await nextStep(page);
    await expect(page.getByRole('heading', { name: '确认面试安排', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: dialogName })).not.toBeVisible();
    await chooseBank(page, title);

    await page.getByRole('button', { name: '上一步', exact: true }).click();
    await page.getByRole('textbox', { name: '岗位描述 / JD', exact: true }).fill(otherJd);
    await nextStep(page);
    await expect(page.getByRole('dialog', { name: dialogName })).toBeVisible();
  } finally {
    await page.request.delete(`/api/v1/question-bank/${question.requestId}`, { headers: { Origin: origin } });
  }
});
