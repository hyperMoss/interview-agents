import { test, expect, type Page } from '@playwright/test';

// Career city multi-select UI. Only local page state is exercised: this file never starts a task,
// launches the BOSS browser or contacts the site. It needs the normal local stack, like the other
// Astryx component checks, and no CAREER_E2E_SITE_ORIGIN.

const cityGroupName = /^城市（多选，最多 10 个）/;
const cities = [
  ['杭州', '浙江'], ['成都', '四川'], ['北京', '北京'], ['上海', '上海'], ['南京', '江苏'],
  ['武汉', '湖北'], ['西安', '陕西'], ['苏州', '江苏'], ['重庆', '重庆'], ['长沙', '湖南'],
] as const;

async function openCareer(page: Page) {
  await page.request.get('/api/v1/identity');
  await page.goto('/#/career');
  await expect(page.getByRole('heading', { name: '本机 BOSS 求职', exact: true })).toBeVisible();
}

function cityGroup(page: Page) {
  return page.getByRole('group', { name: cityGroupName });
}

async function pickCity(page: Page, name: string, province: string) {
  const group = cityGroup(page);
  const input = group.getByRole('combobox');
  await input.fill(name);
  await page.getByRole('option', { name: new RegExp(`^${name} · ${province}$`) }).click();
}

test('city search selects mainland cities by name or province and keeps removable tags', async ({ page }) => {
  await openCareer(page);
  const group = cityGroup(page);

  // Historical tasks and a fresh task both start with the same two cities.
  await expect(group.getByRole('button', { name: '移除 广州 · 广东', exact: true })).toBeVisible();
  await expect(group.getByRole('button', { name: '移除 深圳 · 广东', exact: true })).toBeVisible();
  await expect(page.locator('.career-city-field')).toContainText('已选 2/10 个城市');

  // City-name search.
  await pickCity(page, '杭州', '浙江');
  await expect(group.getByRole('button', { name: '移除 杭州 · 浙江', exact: true })).toBeVisible();
  await expect(page.locator('.career-city-field')).toContainText('已选 3/10 个城市');

  // Province search returns the controlled cities of that province.
  await group.getByRole('combobox').fill('四川');
  await expect(page.getByRole('option', { name: /^成都 · 四川$/ })).toBeVisible();
  await page.getByRole('option', { name: /^成都 · 四川$/ }).click();
  await expect(group.getByRole('button', { name: '移除 成都 · 四川', exact: true })).toBeVisible();
  await expect(page.locator('.career-city-field')).toContainText('已选 4/10 个城市');

  // Selected tags are removed through their own controls.
  await group.getByRole('button', { name: '移除 深圳 · 广东', exact: true }).click();
  await expect(group.getByRole('button', { name: '移除 深圳 · 广东', exact: true })).toHaveCount(0);
  await expect(page.locator('.career-city-field')).toContainText('已选 3/10 个城市');
});

test('city search rejects free text and stops at the ten-city limit', async ({ page }) => {
  await openCareer(page);
  const group = cityGroup(page);

  // There is no create option: unknown text produces the empty result and never becomes a city.
  await group.getByRole('combobox').fill('纽约');
  await expect(page.getByRole('option', { name: /纽约/ })).toHaveCount(0);
  await expect(group.getByText('没有匹配的大陆城市；只能选择列表中的城市。')).toBeVisible();
  await group.getByRole('combobox').press('Enter');
  await expect(group.getByRole('button', { name: /移除 纽约/ })).toHaveCount(0);
  await expect(page.locator('.career-city-field')).toContainText('已选 2/10 个城市');

  // Clear the default selection to exercise the empty-selection prompt, then fill the bound.
  await group.getByRole('button', { name: '移除 广州 · 广东', exact: true }).click();
  await group.getByRole('button', { name: '移除 深圳 · 广东', exact: true }).click();
  await expect(page.locator('.career-city-field')).toContainText('已选 0/10 个城市');
  await expect(page.locator('.career-city-field')).toContainText('至少选择一个城市');
  await expect(page.getByText('至少选择一个城市；默认广州、深圳。街道、县、海外地点不在城市列表中，请选择对应的地级城市。')).toBeVisible();
  await expect(page.locator('.career-blockers')).toContainText('至少选择一个城市。');

  for (const [name, province] of cities) await pickCity(page, name, province);
  await expect(page.locator('.career-city-field')).toContainText('已选 10/10 个城市');
  for (const [name, province] of cities) await expect(group.getByRole('button', { name: `移除 ${name} · ${province}`, exact: true })).toBeVisible();
  // At the limit the search input is hidden, so an eleventh city cannot be entered.
  await expect(group.getByRole('combobox')).toBeHidden();

  await group.getByRole('button', { name: '移除 杭州 · 浙江', exact: true }).click();
  await expect(group.getByRole('combobox')).toBeVisible();
  await expect(page.locator('.career-city-field')).toContainText('已选 9/10 个城市');
});
