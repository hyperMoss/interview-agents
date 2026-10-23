import { expect, type Locator, type Page } from '@playwright/test';

export async function settingsTab(page: Page, name: '模型设置' | '联网搜索' | '本机数据') {
  await page.getByRole('tab', { name: '设置', exact: true }).click();
  await page.getByRole('tab', { name, exact: true }).click();
}
export async function nextStep(page: Page) {
  await page.getByRole('button', { name: '下一步', exact: true }).click();
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
