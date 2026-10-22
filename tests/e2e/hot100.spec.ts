import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { bankListSchema, leetcodeBatchSchema } from '../../packages/contracts/src/bank';

test.setTimeout(90000);
test.use({ actionTimeout: 12000 });
const headers = { Origin: 'http://localhost:5173' };
async function openHot100(page: Page) {
  await page.goto('/');
  await page.getByRole('tab', { name: '算法跟打', exact: true }).click();
  await page.getByText('Hot 100 题单', { exact: true }).click();
  await expect(page.getByRole('heading', { name: '一题一练，把套路用起来。' })).toBeVisible();
}
async function select(page: Page, name: string, label: string) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}

test('Hot 100 filters, independent Python drafts, self review and routine handoff work across reload', async ({ page }) => {
  await openHot100(page);
  const list = page.getByRole('list', { name: 'Hot 100 题目列表' });
  await expect(list.getByRole('listitem')).toHaveCount(100);
  await select(page, 'Hot 100 专题', '哈希');
  await expect(list.getByRole('listitem')).toHaveCount(3);
  await select(page, 'Hot 100 难度', '简单');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.getByRole('button', { name: '练习 49 字母异位词分组', exact: true }).click();
  await expect(page.locator('.hot100-practice-card h3')).toHaveText('49. 字母异位词分组');
  await page.getByRole('textbox', { name: '你的解题思路', exact: true }).fill('排序后的字符串作为字典键，将相同键的单词分组。');
  const code = page.getByRole('textbox', { name: 'Python 独立作答', exact: true });
  await code.fill('def group_anagrams(words):\n');
  await code.press('End'); await code.press('Tab');
  await expect(code).toHaveValue('def group_anagrams(words):\n    ');
  await page.getByRole('button', { name: '需要一点提示', exact: true }).click();
  await expect(page.locator('.hot100-hint')).toContainText('分组键');
  await page.locator('.hot100-review').getByText('已复习', { exact: true }).click();
  await page.getByRole('button', { name: '练习 1 两数之和', exact: true }).click();
  await expect(code).toHaveValue(''); await code.fill('two sum draft');
  await page.getByRole('button', { name: '练习 49 字母异位词分组', exact: true }).click();
  await expect(code).toHaveValue('def group_anagrams(words):\n    ');
  await expect(page.getByRole('radio', { name: '已复习', exact: true })).toBeChecked();
  await page.reload(); await page.getByRole('tab', { name: '算法跟打', exact: true }).click();
  await expect(code).toHaveValue('def group_anagrams(words):\n    ');
  await expect(page.getByRole('radio', { name: '已复习', exact: true })).toBeChecked();
  await page.getByRole('button', { name: '练 哈希表', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '题面或关键词', exact: true })).toHaveValue(/只改变字母顺序/);
  await expect(page.locator('.algorithm-example')).toContainText('模板例题 · 两数之和');
  await expect(page.locator('.algorithm-source')).toContainText('49. 字母异位词分组（Hot 100 学习摘要）');
  await page.getByText('Hot 100 题单', { exact: true }).click();
  await expect(code).toHaveValue('def group_anagrams(words):\n    ');
});

test('uncovered routines stay explicit and next question follows the selected topic', async ({ page }) => {
  await openHot100(page);
  await select(page, 'Hot 100 专题', '子串');
  await page.getByRole('button', { name: '练习 239 滑动窗口最大值', exact: true }).click();
  await expect(page.locator('.hot100-routines')).toContainText('还没有对应的跟打模板');
  await expect(page.locator('.hot100-routines').getByRole('button')).toHaveCount(0);
  await page.getByRole('button', { name: '需要一点提示', exact: true }).click();
  await expect(page.locator('.hot100-hint')).toContainText('单调双端队列');
  await page.getByRole('button', { name: '下一道待练习', exact: true }).click();
  await expect(page.locator('.hot100-practice-card h3')).toHaveText('76. 最小覆盖子串');
  await page.getByRole('textbox', { name: '搜索题号、标题或关键词', exact: true }).fill('没有这道题');
  await expect(page.getByText('没有符合筛选条件的题目')).toBeVisible();
  await page.getByRole('button', { name: '下一道待练习', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('暂无其他待练习题');
});

test('exported one hundred cards import through the real bank boundary and repeated imports skip duplicates', async ({ page }) => {
  await openHot100(page);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出当前题单到题库 JSON', exact: true }).click();
  const path = await (await download).path();
  if (!path) throw new Error('Missing Hot 100 export');
  const exported = leetcodeBatchSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  expect(exported.questions).toHaveLength(100);
  await page.getByRole('tab', { name: '题库管理', exact: true }).click();
  const panel = page.locator('section[aria-labelledby="bank-title"]');
  try {
    await panel.getByRole('tab', { name: '导入题目', exact: true }).click();
    for (let attempt = 0; attempt < 2; attempt++) {
      await panel.getByLabel('导入 LeetCode JSON 题库').setInputFiles(path);
      await expect(panel.getByRole('status')).toContainText(attempt ? '导入 0 题，跳过 100' : '导入 100 题，跳过 0');
    }
    await panel.getByRole('tab', { name: '已保存题目', exact: true }).click();
    const question = panel.locator('.bank-card').filter({ hasText: '1. 两数之和' });
    await question.getByText('查看题面', { exact: true }).click();
    await expect(question).toContainText('并非官方完整题面');
    await expect(question.getByRole('link', { name: '查看原始来源' })).toHaveAttribute('href', 'https://leetcode.cn/problems/two-sum/');
    await question.getByRole('button', { name: '算法跟打 · 1. 两数之和', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '题面或关键词', exact: true })).toHaveValue(/Hot 100 学习摘要/);
  } finally {
    const questions = bankListSchema.parse(await (await page.request.get('/api/v1/question-bank')).json()).filter(question => question.editable && question.tags.includes('Hot100'));
    for (let index = 0; index < questions.length; index += 10) await Promise.all(questions.slice(index, index + 10).map(question => page.request.delete(`/api/v1/question-bank/${question.id}`, { headers })));
  }
});

test('Hot 100 mobile layout and unavailable storage keep Python practice usable', async ({ page }) => {
  await openHot100(page);
  await page.getByRole('button', { name: '练习 1 两数之和', exact: true }).click();
  await page.getByRole('textbox', { name: '你的解题思路', exact: true }).fill('用字典查找目标减去当前值的补数。');
  await page.getByRole('textbox', { name: 'Python 独立作答', exact: true }).fill('def two_sum(nums, target):\n    seen = {}');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/evidence/screenshots/hot100-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'docs/evidence/screenshots/hot100-mobile.png', fullPage: true });
  await page.addInitScript(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function (key, value) { if (key === 'hot100-practice-v1') throw new DOMException('Quota', 'QuotaExceededError'); original.call(this, key, value); }; });
  await page.reload(); await page.getByRole('tab', { name: '算法跟打', exact: true }).click();
  await expect(page.getByText('浏览器无法保存 Hot 100 草稿，请及时导出作答；刷新可能丢失本次修改。')).toBeVisible();
  await page.getByRole('textbox', { name: 'Python 独立作答', exact: true }).fill('still editable');
  await expect(page.getByRole('textbox', { name: 'Python 独立作答', exact: true })).toHaveValue('still editable');
});
