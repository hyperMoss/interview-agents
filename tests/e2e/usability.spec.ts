import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { workspaceBackupSchema } from '../../packages/contracts/src/workspace';
import { expectEditorValue, nextStep, settingsTab } from './ui-helpers';

test.use({ actionTimeout: 12000 });
test.setTimeout(90000);

test('home, reusable profiles, wizard and settings return keep data after closing the page', async ({ page, context }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#/home');
  await expect(page.getByRole('heading', { name: '今天，继续练好一道题。' })).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/screenshots/usability-home.png', fullPage: true });
  await page.getByRole('button', { name: '配置模型', exact: true }).click();
  await page.getByRole('button', { name: '返回练习', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今天，继续练好一道题。' })).toBeVisible();
  await page.getByRole('button', { name: '新建面试', exact: true }).click();
  await nextStep(page); await expect(page.getByRole('alert')).toContainText('岗位需');
  await page.getByRole('button', { name: '填入示例', exact: true }).click();
  await page.getByText('复用岗位资料档案', { exact: false }).click();
  await page.getByLabel('档案名称', { exact: true }).fill('固定测试 · 校招资料');
  await page.getByRole('button', { name: '保存当前资料', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('岗位资料已保存');
  await nextStep(page);
  await page.getByLabel('面试时长（分钟）', { exact: true }).fill('10');
  await settingsTab(page, '模型设置');
  await page.getByRole('button', { name: '返回练习', exact: true }).click();
  await expect(page.getByRole('heading', { name: '确认面试安排', exact: true })).toBeVisible();
  await expect(page.getByLabel('面试时长（分钟）', { exact: true })).toHaveValue('10');
  await page.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(page.getByLabel('目标岗位')).toHaveValue('Web 全栈工程师');
  await expect(page.locator('.workspace-save-status')).toContainText('已保存到本机');
  await page.close();
  const reopened = await context.newPage(); await reopened.goto('/');
  await expect(reopened.getByLabel('目标岗位')).toHaveValue('Web 全栈工程师');
  await reopened.getByText('复用岗位资料档案', { exact: false }).click();
  await reopened.getByRole('combobox', { name: '选择已存档案' }).click();
  await reopened.getByRole('option', { name: '固定测试 · 校招资料', exact: true }).click();
  await expect(reopened.getByLabel('简历与项目经历')).not.toHaveValue('');
  await reopened.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => reopened.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reopened.screenshot({ path: 'docs/evidence/screenshots/usability-intake-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('Python editing, favorite and review survive close, route handoff and keyboard focus escape', async ({ page, context }) => {
  await page.goto('/#/algorithms/hot100/49');
  await expect(page.locator('.hot100-practice-card h3')).toHaveText('49. 字母异位词分组');
  const code = page.getByRole('textbox', { name: 'Python 独立作答', exact: true });
  const source = 'def group(words):\n    # 保留中文😀\n    return {}';
  await code.fill(source); await expectEditorValue(code, source);
  await page.getByRole('button', { name: '☆ 收藏本题', exact: true }).click();
  await page.getByRole('button', { name: '完成本次复习（自评）', exact: true }).click();
  await expect(page.locator('.hot100-review-plan')).toContainText('下次复习');
  await code.press('Escape'); await code.press('Tab'); await expect(code).not.toBeFocused();
  await page.getByRole('button', { name: '练 哈希表', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '题面或关键词', exact: true })).toHaveValue(/只改变字母顺序/);
  await page.getByRole('button', { name: /返回 Hot 100 第 49 题/ }).click();
  await expectEditorValue(code, source);
  await page.reload(); await expectEditorValue(code, source);
  await expect(page.getByRole('button', { name: '★ 已收藏', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '专注编辑', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Python 独立作答编辑器' })).toBeVisible();
  await page.getByRole('button', { name: '退出专注', exact: true }).click();
  await expect(page.locator('.workspace-save-status')).toContainText('已保存到本机');
  await page.close(); const reopened = await context.newPage(); await reopened.goto('/');
  await expectEditorValue(reopened.getByRole('textbox', { name: 'Python 独立作答', exact: true }), source);
  await reopened.screenshot({ path: 'docs/evidence/screenshots/usability-hot100.png', fullPage: true });
});

test('default backup excludes personal materials and restore previews without replacing current records', async ({ page }) => {
  await page.goto('/#/interviews/new'); await page.getByRole('button', { name: '填入示例', exact: true }).click();
  await page.goto('/#/algorithms/hot100/1');
  await page.getByRole('textbox', { name: 'Python 独立作答', exact: true }).fill('# 备份中的算法代码');
  await expect(page.locator('.workspace-save-status')).toContainText('已保存到本机');
  await settingsTab(page, '本机数据');
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: '下载 JSON 备份', exact: true }).click();
  const file = await download; const path = await file.path(); if (!path) throw new Error('Missing backup');
  const text = await readFile(path, 'utf8'); const backup = workspaceBackupSchema.parse(JSON.parse(text));
  expect(backup.includesSensitive).toBe(false); expect(text).toContain('备份中的算法代码'); expect(text).not.toContain('示例经历'); expect(text).not.toContain('interview_identity');
  await page.getByLabel('选择备份 JSON').setInputFiles(path);
  await expect(page.getByLabel('备份恢复预览')).toContainText('内容相同');
  await page.getByRole('button', { name: '确认恢复数据', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '已恢复' })).toBeVisible();
  await page.screenshot({ path: 'docs/evidence/screenshots/usability-data.png', fullPage: true });
});

test('two pages preserve conflicting draft versions while page preferences remain independent', async ({ page, context }) => {
  await page.goto('/#/interviews/new'); await page.getByLabel('目标岗位').fill('第一版岗位');
  await expect(page.locator('.workspace-save-status')).toContainText('已保存到本机');
  const second = await context.newPage(); await second.goto('/#/interviews/new'); await expect(second.getByLabel('目标岗位')).toHaveValue('第一版岗位');
  await page.getByLabel('目标岗位').fill('另一页的新岗位');
  await expect(page.locator('.workspace-save-status')).toContainText('已保存到本机');
  await second.getByLabel('目标岗位').fill('当前页保留的岗位');
  await expect(second.locator('.workspace-save-status')).toContainText('其他页面有不同修改');
  await second.getByRole('button', { name: '查看与备份', exact: true }).click();
  await second.getByText('查看两个版本的内容', { exact: true }).click();
  await expect(second.getByLabel('待处理的多页面冲突')).toContainText('另一页的新岗位');
  await expect(second.getByLabel('待处理的多页面冲突')).toContainText('当前页保留的岗位');
  await second.getByRole('button', { name: '采用本机版本', exact: true }).click();
  await second.reload(); await second.getByRole('tab', { name: '面试准备', exact: true }).click();
  await expect(second.getByLabel('目标岗位')).toHaveValue('另一页的新岗位');
});

test('unavailable IndexedDB reports failure while keeping in-memory Python editable', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined }); });
  await page.goto('/#/algorithms/hot100/1');
  await expect(page.locator('.workspace-save-status')).toContainText('本机保存失败');
  const code = page.getByRole('textbox', { name: 'Python 独立作答', exact: true });
  await code.fill('# 失败时仍可复制'); await expectEditorValue(code, '# 失败时仍可复制');
  await page.getByRole('button', { name: '查看与备份', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试本机保存', exact: true })).toBeVisible();
});
