import { expect, test } from '@playwright/test';
import { navigateModule } from './ui-helpers';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});

test('destructive confirmation supports cancel, failed retry and pending dismissal protection', async ({ page }) => {
  await page.goto('/#/resumes');
  await page.getByRole('button', { name: '从示例开始', exact: true }).click();
  const name = page.getByLabel('副本名称', { exact: true });
  await expect(name).toHaveValue('示例简历');
  const trigger = page.getByRole('button', { name: '删除副本', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: '删除这个 JSON 简历副本？' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(name).toHaveValue('示例简历');

  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/resume-drafts/*', async route => {
    if (route.request().method() !== 'DELETE') return route.continue();
    await pending;
    await route.fulfill({ status: 503, json: { code: 'fixture_unavailable', message: '合成测试：请重试删除' } });
  });
  await trigger.click();
  await dialog.getByRole('button', { name: '删除副本', exact: true }).click();
  try {
    await expect(dialog.getByRole('button', { name: '保留', exact: true })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
  } finally { release?.(); }
  await expect(dialog.getByRole('alert')).toContainText('合成测试：请重试删除');
  await expect(dialog.getByRole('button', { name: '删除副本', exact: true })).toBeEnabled();
  await expect(name).toHaveValue('示例简历');
  await page.unroute('**/api/v1/resume-drafts/*');
  await dialog.getByRole('button', { name: '删除副本', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: '从示例开始', exact: true })).toBeVisible();
});

test('mobile navigation and keyboard selector preserve the selected module and filters', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#/home');
  await navigateModule(page, '算法练习');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  const difficulty = page.getByRole('combobox', { name: 'Hot 100 难度', exact: true });
  await difficulty.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: '简单', exact: true }).click();
  await expect(difficulty).toContainText('简单');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await navigateModule(page, '本机数据与备份');
  await expect(page.getByRole('heading', { name: '本机数据与备份', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/astryx/mobile-data.png', fullPage: true });
});

test('module menu supports arrow keys, boundaries and keyboard activation', async ({ page }) => {
  await page.goto('/#/home');
  const menu = page.getByRole('menu', { name: '模块导航', exact: true });
  const home = menu.getByRole('menuitem', { name: '首页', exact: true });
  await home.focus();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: '简历库', exact: true })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: '本机数据与备份', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(home).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '本机数据与备份', exact: true })).toBeVisible();
  await page.keyboard.press('Home');
  await expect(home).toBeFocused();
});

test('deployment restrictions disable model and search fields and actions', async ({ page }) => {
  await page.route('**/api/v1/models/settings', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), enabled: false } });
  });
  await page.route('**/api/v1/search/settings', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...await response.json(), enabled: false } });
  });
  await page.goto('/#/home');
  await navigateModule(page, '模型设置');
  await expect(page.getByLabel('API 根地址', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('模型名', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存并启用', exact: true })).toBeDisabled();
  await navigateModule(page, '联网搜索');
  await expect(page.getByRole('combobox', { name: '搜索服务', exact: true })).toBeDisabled();
  await expect(page.getByLabel('搜索 API Key', { exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: '保留搜索连接 30 天', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '保存搜索连接', exact: true })).toBeDisabled();
});

test('career free-form tags and switches preserve controlled values', async ({ page }) => {
  await page.goto('/#/career');
  const roles = page.getByRole('group', { name: '添加自定义岗位方向', exact: true });
  const input = roles.getByRole('combobox');
  await input.fill('Python');
  await expect(page.getByRole('option', { name: /Python/ })).toBeVisible();
  await input.press('Enter');
  await expect(roles.getByRole('button', { name: '移除 Python', exact: true })).toBeVisible();
  await input.fill('前端');
  await expect(page.getByRole('option', { name: /前端/ })).toBeVisible();
  await input.press('Enter');
  await roles.getByRole('button', { name: '移除 Python', exact: true }).click();
  await expect(roles.getByRole('button', { name: '移除 Python', exact: true })).toHaveCount(0);
  await expect(roles.getByRole('button', { name: '移除 前端', exact: true })).toBeVisible();
  const blacklist = page.getByRole('combobox', { name: /^公司黑名单关键词/ });
  await blacklist.fill('合成公司');
  await expect(page.getByRole('option', { name: /合成公司/ })).toBeVisible();
  await blacklist.press('Enter');
  await expect(page.getByRole('button', { name: '移除 合成公司', exact: true })).toBeVisible();
  const ai = page.getByRole('switch', { name: '启用 AI 匹配、招呼语与备题', exact: true });
  await ai.click();
  await expect(ai).toBeChecked();
  await expect(page.getByRole('button', { name: '配置模型', exact: true })).toBeVisible();
  await ai.click();
  await expect(ai).not.toBeChecked();
  await page.getByRole('checkbox', { name: '全栈开发', exact: true }).uncheck();
  await expect(page.getByRole('checkbox', { name: '全栈开发', exact: true })).not.toBeChecked();
});
