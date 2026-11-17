import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { resumeVersionListSchema } from '../../packages/contracts/src/career';
import { navigateModule } from './ui-helpers';

// Unified resume library (REQ-064). Every fixture here is synthetic and the file only needs the local
// API + web stack; no BOSS request, browser session or real resume is involved.

const syntheticResumeText = '固定测试经历：负责前端页面与接口联调，用自动化测试验证请求竞争与页面状态一致性。';
const syntheticResume = Buffer.from(`${syntheticResumeText}\n仅用于本地软件验收的合成简历，不代表任何真实候选人。\n`, 'utf8');

function menu(page: Page) {
  return page.getByRole('navigation', { name: '模块导航' }).first();
}

test.describe('unified resume library', () => {
  test.setTimeout(90000);
  test.use({ actionTimeout: 10000 });

  test('offers one menu entry with editor and attachment views that survive refresh and history', async ({ page }) => {
    await page.goto('/#/home');
    await expect(menu(page).getByRole('menuitem', { name: '简历库', exact: true })).toBeVisible();
    await expect(menu(page).getByRole('menuitem', { name: '投递附件库', exact: true })).toHaveCount(0);

    await navigateModule(page, '简历库');
    await expect(page).toHaveURL(/#\/resumes$/);
    await expect(page.getByRole('tab', { name: '简历编辑', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(menu(page).getByRole('menuitem', { name: '简历库', exact: true })).toHaveAttribute('aria-current', 'page');

    await page.getByRole('tab', { name: '投递附件', exact: true }).click();
    await expect(page).toHaveURL(/#\/resumes\/attachments$/);
    await expect(page.getByRole('heading', { name: '投递附件', exact: true })).toBeVisible();
    await expect(menu(page).getByRole('menuitem', { name: '简历库', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(menu(page).getByRole('menuitem', { name: '投递附件库', exact: true })).toHaveCount(0);

    await page.reload();
    await expect(page.getByRole('heading', { name: '投递附件', exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/#\/resumes$/);
    await expect(page.getByRole('tab', { name: '简历编辑', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.goForward();
    await expect(page.getByRole('heading', { name: '投递附件', exact: true })).toBeVisible();
  });

  test('mobile menu shows only the unified resume library entry', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/#/home');
    await page.getByRole('button', { name: '打开模块菜单', exact: true }).click();
    const drawer = page.getByRole('dialog', { name: '功能模块', exact: true });
    await expect(drawer.getByRole('menuitem', { name: '简历库', exact: true })).toBeVisible();
    await expect(drawer.getByRole('menuitem', { name: '投递附件库', exact: true })).toHaveCount(0);
    await drawer.getByRole('menuitem', { name: '简历库', exact: true }).click();
    await expect(page.getByRole('tab', { name: '投递附件', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '投递附件', exact: true }).click();
    await expect(page).toHaveURL(/#\/resumes\/attachments$/);
  });

  test('legacy attachment link opens the attachments view and keeps upload, download and delete working', async ({ page }) => {
    await page.goto('/#/settings/resumes');
    await expect(page.getByRole('heading', { name: '投递附件', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/#\/resumes\/attachments$/);

    await page.getByLabel('选择简历原始文件（只在本机解析，不会上传到 BOSS）').and(page.locator('input[type="file"]'))
      .setInputFiles({ name: 'synthetic-unified-resume.txt', mimeType: 'text/plain', buffer: syntheticResume });
    await page.getByLabel('版本名称（仅用于你自己区分版本）').fill('合成统一库简历');
    const corrected = syntheticResumeText + ' 校正文本与原附件分别保存。';
    await page.getByLabel('修正后的提取文本（会用于匹配与外发内容核对）').fill(corrected);
    await page.getByRole('tab', { name: '简历编辑', exact: true }).click();
    await page.getByRole('tab', { name: '投递附件', exact: true }).click();
    await expect(page.getByLabel('版本名称（仅用于你自己区分版本）')).toHaveValue('合成统一库简历');
    await expect(page.getByLabel('修正后的提取文本（会用于匹配与外发内容核对）')).toHaveValue(corrected);
    await page.getByRole('button', { name: '保存为不可变版本', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已保存不可变版本' })).toBeVisible();
    await expect(page.getByLabel(/该版本的提取文本（只读/)).toBeVisible();

    const versions = resumeVersionListSchema.parse(await (await page.request.get('/api/v1/resume-versions')).json());
    const saved = versions.find(version => version.label === '合成统一库简历');
    if (!saved) throw new Error('Missing immutable version');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载原始文件', exact: true }).click();
    const download = await downloadPromise;
    const path = await download.path();
    if (!path) throw new Error('Missing original download');
    const bytes = await readFile(path);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(saved.attachmentSha256);
    expect(bytes.toString('utf8')).toContain('合成简历');

    await page.reload();
    await expect(page.getByRole('heading', { name: '投递附件', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /合成统一库简历/ }).click();
    await expect(page.getByLabel(/该版本的提取文本（只读/)).toBeVisible();
    await page.getByRole('button', { name: '删除这个版本及派生数据', exact: true }).click();
    await page.getByRole('button', { name: '确认删除版本', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '已删除该版本' })).toBeVisible();
    const remaining = resumeVersionListSchema.parse(await (await page.request.get('/api/v1/resume-versions')).json());
    expect(remaining.map(version => version.id)).not.toContain(saved.id);
  });

  test('publishing from the JSON editor hands off to the attachments view and back to the same copy', async ({ page }) => {
    await page.goto('/#/resumes');
    await page.getByRole('button', { name: '从示例开始', exact: true }).click();
    await expect(page.getByLabel('副本名称')).toHaveValue('示例简历');
    await page.getByRole('button', { name: '保存为投递版本', exact: true }).click();
    await expect(page.getByText('已将生成的 PDF 保存为不可变投递版本，可在简历库的“投递附件”中核对。', { exact: true })).toBeVisible({ timeout: 45000 });
    const draftRoute = page.url();

    await page.getByRole('button', { name: '查看投递附件', exact: true }).click();
    await expect(page).toHaveURL(/#\/resumes\/attachments$/);
    await expect(page.getByRole('button', { name: /示例简历 · 修订 1/ })).toBeVisible();

    await page.getByRole('tab', { name: '简历编辑', exact: true }).click();
    await expect(page).toHaveURL(draftRoute);
    await expect(page.getByLabel('副本名称')).toHaveValue('示例简历');
  });
});
