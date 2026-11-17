import { expect, type Locator, type Page } from '@playwright/test';

export async function expectStatus(scope: Page | Locator, text: string | RegExp, options?: { timeout?: number }) {
  // Astryx also maintains live regions for button loading and empty states.
  await expect(scope.getByRole('status').filter({ hasText: text })).toContainText(text, options);
}

export async function settingsTab(page: Page, name: '模型设置' | '联网搜索' | '本机数据') {
  await navigateModule(page, name === '本机数据' ? '本机数据与备份' : name);
}
export async function navigateModule(page: Page, name: string) {
  const mobile = page.getByRole('button', { name: '打开模块菜单', exact: true });
  if (await mobile.isVisible()) await mobile.click();
  await page.getByRole('menuitem', { name, exact: true }).click();
  await expect(page.getByRole('dialog', { name: '功能模块', exact: true })).not.toBeVisible();
}
export async function nextStep(page: Page) {
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  const offer = page.getByRole('dialog', { name: '先根据 JD 备题？', exact: true });
  if (await offer.isVisible()) await offer.getByRole('button', { name: '直接继续', exact: true }).click();
}
export async function expectEditorValue(editor: Locator, value: string) {
  await expect.poll(() => editor.evaluate(element => {
    const copy = element.cloneNode(true);
    if (!(copy instanceof HTMLElement)) return '';
    copy.querySelectorAll('.cm-placeholder').forEach(placeholder => placeholder.remove());
    return Array.from(copy.querySelectorAll('.cm-line')).map(line => line.textContent).join('\n');
  })).toBe(value);
}
export async function confirmDelete(page: Page) {
  const confirmation = page.getByRole('button', { name: '确认删除', exact: true });
  await confirmation.click();
  await expect(confirmation).not.toBeVisible();
}
