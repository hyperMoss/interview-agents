import { test, expect, type Page } from '@playwright/test';
import { getAlgorithmPattern } from '../../packages/interview/src/algorithm-patterns';
import { bankListSchema, bankQuestionSchema } from '../../packages/contracts/src/bank';

test.use({ actionTimeout: 15000 });
test.setTimeout(90000);
const headers = { Origin: 'http://localhost:5173' };
async function openAlgorithm(page: Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: '算法跟打', exact: true }).click();
  await expect(page.getByRole('heading', { name: '先认套路，再亲手打出来。' })).toBeVisible();
}
async function choosePattern(page: Page, name: string) {
  await page.getByRole('combobox', { name: '选择算法模式', exact: true }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('Python code and statement typing retain separate drafts, locate differences, and support keyboard indentation', async ({ page }) => {
  await openAlgorithm(page);
  const code = getAlgorithmPattern('hash-map').code;
  const typing = page.getByRole('textbox', { name: '你的代码', exact: true });
  await typing.fill('def solve(nums, target):\n');
  await typing.press('End');
  await typing.press('Tab');
  await expect(typing).toHaveValue('def solve(nums, target):\n    ');
  await page.getByRole('button', { name: '核对跟打', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('第 2 行、第 5 列');
  await typing.fill(code);
  await page.getByRole('button', { name: '核对跟打', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('跟打一致');
  await page.getByRole('switch', { name: '显示参考' }).click();
  await expect(page.getByLabel('跟打参考文本')).toHaveCount(0);
  await page.getByRole('switch', { name: '显示参考' }).click();
  await choosePattern(page, '二分查找');
  await expect(typing).toHaveValue('');
  await typing.fill('binary draft');
  await choosePattern(page, '哈希表');
  await expect(typing).toHaveValue(code);
  await page.getByText('题面跟打', { exact: true }).click();
  const statement = page.getByRole('textbox', { name: '你的题面', exact: true });
  await statement.fill('题面草稿😀');
  await page.getByRole('tab', { name: '题库管理', exact: true }).click();
  await page.getByRole('tab', { name: '算法跟打', exact: true }).click();
  await expect(statement).toHaveValue('题面草稿😀');
  await page.reload();
  await page.getByRole('tab', { name: '算法跟打', exact: true }).click();
  await expect(statement).toHaveValue('题面草稿😀');
  await page.getByRole('button', { name: '重置本次跟打', exact: true }).click();
  await expect(statement).toHaveValue('');
  await page.getByText('核心代码跟打', { exact: true }).click();
  await expect(page.getByText('当前跟打已清空，其他对象的草稿保留。')).toHaveCount(0);
  await expect(typing).toHaveValue(code);
  await page.getByRole('button', { name: '重置本次跟打', exact: true }).click();
  await typing.fill(code.replace('seen = {}', 'seen = []'));
  await page.getByRole('button', { name: '核对跟打', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('第 2 行、第 12 列');
  await expect(page.locator('.algorithm-line-review .different').first()).toContainText('第 2 行');
});

test('keywords provide evidence and limits; pasted Unicode statements match with no external generation', async ({ page }) => {
  await openAlgorithm(page);
  const calls: string[] = [];
  page.on('request', request => { if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) calls.push(request.url()); });
  const problem = page.getByRole('textbox', { name: '题面或关键词', exact: true });
  await problem.fill('连续子数组和为 k，可能有负数。');
  await expect(page.getByLabel('关键词推荐模式')).toContainText('前缀和 + 哈希计数');
  await expect(page.locator('.algorithm-source')).toContainText('单调性');
  await page.getByRole('button', { name: /前缀和 \+ 哈希计数.*命中/ }).click();
  await expect(page.locator('.algorithm-recipe h3')).toContainText('前缀和 + 哈希计数');
  await problem.fill('加权图最短路径');
  await expect(page.locator('.algorithm-source')).toContainText('不能直接用普通 BFS');
  await problem.fill('设计一个缓存淘汰策略');
  await expect(page.getByLabel('关键词推荐模式')).toContainText('没有命中现有模式');
  const unicode = '题面😀\n保留    四个空格。';
  await problem.fill(unicode);
  await page.getByText('题面跟打', { exact: true }).click();
  await page.getByRole('textbox', { name: '你的题面', exact: true }).fill(unicode);
  await page.getByRole('button', { name: '核对跟打', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('跟打一致');
  await problem.fill('');
  await expect(page.getByRole('textbox', { name: '你的题面', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '核对跟打', exact: true })).toBeDisabled();
  expect(calls).toEqual([]);
});

test('coding bank cards transfer an original snapshot, and changed text cannot inherit an old draft', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tab', { name: '题库管理', exact: true })).toBeVisible();
  await page.request.get('/api/v1/identity');
  const title = '跟打测试 · 无重复字符子串';
  const content = '给定字符串，返回无重复字符的最长连续子串长度。请说明窗口左右边界如何移动。';
  const response = await page.request.post('/api/v1/question-bank', { headers, data: { requestId: crypto.randomUUID(), draft: { title, content, category: 'coding', difficulty: 'easy', roleFamilies: ['general'], tags: ['滑动窗口'], expectedAnswer: '' } } });
  expect(response.ok()).toBe(true);
  const saved = bankQuestionSchema.parse(await response.json());
  try {
    await page.getByRole('tab', { name: '题库管理', exact: true }).click();
    await page.getByRole('button', { name: `算法跟打 · ${title}`, exact: true }).click();
    await expect(page.getByRole('textbox', { name: '题面或关键词', exact: true })).toHaveValue(content);
    await expect(page.locator('.algorithm-recipe h3')).toContainText('滑动窗口');
    await expect(page.locator('.algorithm-example')).toContainText('无重复字符的最长子串');
    await page.getByText('题面跟打', { exact: true }).click();
    await page.getByRole('textbox', { name: '你的题面', exact: true }).fill('独立题面草稿');
    await page.getByRole('tab', { name: '题库管理', exact: true }).click();
    await page.getByRole('tab', { name: '算法跟打', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '你的题面', exact: true })).toHaveValue('独立题面草稿');
    const edited = content + '补充条件：允许空串。';
    await page.getByRole('textbox', { name: '题面或关键词', exact: true }).fill(edited);
    await expect(page.getByRole('textbox', { name: '你的题面', exact: true })).toHaveValue('');
    const bank = bankListSchema.parse(await (await page.request.get('/api/v1/question-bank')).json());
    expect(bank.find(question => question.id === saved.id)?.content).toBe(content);
    await page.getByRole('combobox', { name: '从编程题库选择', exact: true }).click();
    await page.getByRole('option', { name: title, exact: true }).click();
    await expect(page.getByRole('textbox', { name: '你的题面', exact: true })).toHaveValue('独立题面草稿');
  } finally { await page.request.delete(`/api/v1/question-bank/${saved.id}`, { headers }); }
});

test('corrupt or unavailable storage stays usable, and the workbench fits mobile', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('algorithm-practice-v1', '{bad json'));
  await page.getByRole('tab', { name: '算法跟打', exact: true }).click();
  await expect(page.getByText('旧草稿无法恢复，已打开内置例题。')).toBeVisible();
  await page.getByRole('textbox', { name: '你的代码', exact: true }).fill('def');
  await page.screenshot({ path: 'docs/evidence/screenshots/algorithm-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/evidence/screenshots/algorithm-mobile.png', fullPage: true });
  await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Unavailable', 'QuotaExceededError'); }; });
  await page.reload();
  await page.getByRole('tab', { name: '算法跟打', exact: true }).click();
  await expect(page.getByText('浏览器无法保存草稿，请保持页面打开，并及时复制自己的练习。')).toBeVisible();
  await page.getByRole('textbox', { name: '你的代码', exact: true }).fill('still usable');
  await expect(page.getByRole('textbox', { name: '你的代码', exact: true })).toHaveValue('still usable');
});
